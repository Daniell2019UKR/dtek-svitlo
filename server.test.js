import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import net from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';

test('HTTP API reads one saved snapshot; clients never trigger upstream parsing',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dtek-api-'));
 const reservation=net.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
 const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const counter=join(dir,'fetches');
 const preload=`import {appendFile} from 'node:fs/promises';
 const real=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  if(!String(url).includes('dtek-'))return real(url,options);
  await appendFile(process.env.TEST_FETCH_COUNTER,'request\\n');
  const {scheduleDates}=await import(${JSON.stringify(new URL('./public/dates.js',import.meta.url).href)});
  const data=Object.fromEntries(scheduleDates().map(date=>[Date.parse(date+'T12:00:00Z')/1000,{'GPV1.1':Object.fromEntries(Array.from({length:24},(_,i)=>[i+1,'yes']))}]));
  return new Response('DisconSchedule.fact = '+JSON.stringify({data,update:'fixture'})+';');
 };`;
 const child=spawn(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(preload),'server.js'],{
  cwd:new URL('.',import.meta.url),env:{...process.env,PORT:String(port),DATA_DIR:dir,TEST_FETCH_COUNTER:counter,TELEGRAM_BOT_TOKEN:'',DTEK_PROXY_URL:'',DTEK_PROXY_HEALTH_URL:'',POLL_INTERVAL_SECONDS:'120'},stdio:['ignore','pipe','pipe']
 });
 let errors='';child.stderr.on('data',data=>{errors+=data;});
 try{
  const url=`http://127.0.0.1:${port}/api/v1/schedules`;
  let first;
  for(let i=0;i<100;i++){
   try{first=await fetch(url);if(first.ok)break;}catch{}
   await delay(50);
  }
  assert.equal(first?.status,200,errors);
  const json=await first.json();assert.equal(json.days.length,2);
  const requests=await readFile(counter,'utf8');
  const responses=await Promise.all(Array.from({length:20},()=>fetch(url+'?group=1.1')));
  assert.ok(responses.every(response=>response.status===200));
  assert.equal(await readFile(counter,'utf8'),requests);
  const second=await fetch(url,{headers:{'If-None-Match':first.headers.get('etag')}});
  assert.equal(second.status,304);
  const preflight=await fetch(url,{method:'OPTIONS'});
  assert.equal(preflight.status,204);
  assert.match(preflight.headers.get('access-control-allow-headers'),/If-None-Match/);
  const internal=await (await fetch(`http://127.0.0.1:${port}/api/schedule`)).json();
  assert.equal(internal.telegramEnabled,false);assert.equal('pending' in internal,false);
  const catalog=await (await fetch(new URL('/api/v1/regions',url))).json();
  assert.deepEqual(catalog.regions.map(region=>region.code),['o','k','kr','dn','d']);
  assert.equal((await fetch(url+'?region=o&region=k')).status,400);
  assert.equal((await fetch(url+'?region=constructor')).status,400);
  const kyiv=await (await fetch(new URL('/api/schedule?region=k',url))).json();
  assert.equal(kyiv.region,'k');
  assert.equal(kyiv.current,null);
  const unavailable=await fetch(url+'?region=k');
  assert.equal(unavailable.status,503);
  assert.equal((await unavailable.json()).region,'k');
 }finally{
  child.kill();await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});
  await rm(dir,{recursive:true,force:true});
 }
});
