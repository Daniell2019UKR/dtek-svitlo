"""Load PPP drivers and scope the PPTP NAT helper to this Docker network/server.

Run as root after creating the Compose network. Does not change host routes.
"""
import argparse
import ipaddress
import json
from pathlib import Path
import subprocess

parser=argparse.ArgumentParser()
parser.add_argument('--env-file',default='.env.vpn')
parser.add_argument('--network',default='dtek-monitor_default')
args=parser.parse_args()
for module in ['ppp_async','ppp_mppe','nf_conntrack_pptp','nf_nat_pptp']:
    subprocess.run(['modprobe',module],check=True)
values=dict(line.split('=',1) for line in Path(args.env_file).read_text().splitlines() if '=' in line and not line.startswith('#'))
host=str(ipaddress.IPv4Address(values['PPTP_SERVER']))
network=json.loads(subprocess.check_output(['docker','network','inspect',args.network]))[0]
subnet=str(ipaddress.IPv4Network(network['IPAM']['Config'][0]['Subnet']))
rule=['PREROUTING','-s',subnet,'-d',host+'/32','-p','tcp','--dport','1723','-j','CT','--helper','pptp']
exists=subprocess.run(['iptables','-t','raw','-C',*rule],stderr=subprocess.DEVNULL).returncode==0
if not exists:
    subprocess.run(['iptables','-t','raw','-A',*rule],check=True)
print('PPP drivers and scoped PPTP NAT helper configured; host routes unchanged.')
