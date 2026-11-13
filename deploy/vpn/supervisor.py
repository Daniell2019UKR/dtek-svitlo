"""PPTP and a fail-closed HTTP proxy inside their own Docker network namespace."""
import http.server
import ipaddress
import json
import os
from pathlib import Path
import signal
import subprocess
import threading
import time

server_ip = str(ipaddress.IPv4Address(os.environ['PPTP_SERVER']))
username, password = os.environ['PPTP_USERNAME'], os.environ['PPTP_PASSWORD']
if not username or not password or any(c in username + password for c in '\r\n\0'):
    raise ValueError('Invalid PPTP credentials')

def quoted(value):
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'

gateway = json.loads(subprocess.check_output(['ip', '-j', '-4', 'route', 'show', 'default']))[0]
subprocess.run(['ip', 'route', 'replace', server_ip + '/32', 'via', gateway['gateway'], 'dev', gateway['dev']], check=True)
options = '\n'.join([
    'pty ' + quoted('pptp ' + server_ip + ' --nolaunchpppd'),
    'name ' + quoted(username), 'password ' + quoted(password),
    'noauth', 'noipdefault', 'nodetach', 'hide-password', 'logfd 1',
    'defaultroute', 'replacedefaultroute', 'persist', 'maxfail 0', 'holdoff 5',
    'refuse-eap', 'refuse-pap', 'refuse-chap', 'refuse-mschap', 'require-mppe-128',
    'nobsdcomp', 'nodeflate', 'mtu 1400', 'mru 1400', 'unit 0',
    'lcp-echo-interval 5', 'lcp-echo-failure 3'
]) + '\n'
os.umask(0o077)
Path('/run/pptp-options').write_text(options)
health = {'healthy': False, 'checkedAt': 0, 'egressIp': None}
stopping = threading.Event()

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != '/health':
            self.send_error(404)
            return
        healthy = health['healthy'] and time.time() - health['checkedAt'] < 45
        self.send_response(200 if healthy else 503)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({**health, 'healthy': bool(healthy)}).encode())
    def log_message(self, *_):
        pass

httpd = http.server.ThreadingHTTPServer(('0.0.0.0', 8889), Handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
ppp = subprocess.Popen(['pppd', 'file', '/run/pptp-options'])
proxy = None
bound_ip = None
next_probe = 0

def terminate(process):
    if process and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()

def stop(*_):
    stopping.set()

signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
try:
    while not stopping.is_set():
        if ppp.poll() is not None:
            raise RuntimeError('PPTP process exited; container will restart')
        result = subprocess.run(['ip', '-j', '-4', 'addr', 'show', 'dev', 'ppp0'], capture_output=True, text=True)
        addresses = json.loads(result.stdout or '[]') if result.returncode == 0 else []
        address = next((item['local'] for link in addresses for item in link.get('addr_info', []) if item.get('family') == 'inet'), None)
        if not address:
            health.update(healthy=False, egressIp=None)
            terminate(proxy)
            proxy, bound_ip = None, None
        else:
            if address != bound_ip or not proxy or proxy.poll() is not None:
                terminate(proxy)
                Path('/run/tinyproxy.conf').write_text('\n'.join([
                    'User nobody', 'Group nogroup', 'Port 8888', 'Listen 0.0.0.0',
                    'Bind ' + address, 'Timeout 30', 'MaxClients 20',
                    'Allow 127.0.0.1', 'Allow 172.16.0.0/12', 'Allow 10.0.0.0/8', 'Allow 192.168.0.0/16',
                    'ConnectPort 443', 'DisableViaHeader Yes', 'LogLevel Warning',
                    'LogFile "/tmp/tinyproxy.log"', 'PidFile "/tmp/tinyproxy.pid"'
                ]) + '\n')
                os.chmod('/run/tinyproxy.conf', 0o644)
                proxy = subprocess.Popen(['tinyproxy', '-d', '-c', '/run/tinyproxy.conf'])
                bound_ip, next_probe = address, 0
            if time.time() >= next_probe:
                probe = subprocess.run(['curl', '--silent', '--show-error', '--fail', '--max-time', '8', '--proxy', 'http://127.0.0.1:8888', 'https://api.ipify.org'], capture_output=True, text=True)
                try:
                    egress = str(ipaddress.ip_address(probe.stdout.strip())) if probe.returncode == 0 else None
                except ValueError:
                    egress = None
                health.update(healthy=bool(egress), checkedAt=time.time(), egressIp=egress)
                next_probe = time.time() + (30 if egress else 5)
        stopping.wait(2)
finally:
    health['healthy'] = False
    terminate(proxy)
    terminate(ppp)
    httpd.shutdown()
