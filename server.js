import http from 'node:http';
import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {scrape,mergeSchedules} from './schedule.js';
import {shutdownsPages} from './vendor/constants.js';
import {schedulesResponse} from './api.js';
import {createTransportSelector} from './transport.js';
import {createTelegram} from './telegram.js';

const region=process.env.REGION||'o';
if(!shutdownsPages[region])throw Error('Unknown REGION');
const intervalSeconds=Number(process.env.POLL_INTERVAL_SECONDS||120);
if(!Number.isFinite(intervalSeconds)||intervalSeconds<30||intervalSeconds>3600)throw Error('POLL_INTERVAL_SECONDS must be between 30 and 3600');
const retrySeconds=Number(process.env.VPN_RETRY_SECONDS||60);
if(!Number.isFinite(retrySeconds)||retrySeconds<10)throw Error('VPN_RETRY_SECONDS must be at least 10');
const dir=process.env.DATA_DIR||'./data';
await mkdir(dir,{recursive:true});
const empty=()=>({current:null,previous:null,checkedAt:null,lastSuccess:null,error:null,emergency:{active:null,message:null,areas:[],checkedAt:null,stale:true}});
let state=empty();
try{state={...state,...JSON.parse(await readFile(`${dir}/state.json`,'utf8'))};}catch(error){if(error.code!=='ENOENT')throw error;}
if(state.current?.region&&state.current.region!==region)state=empty();
delete state.pending; // Telegram has its own durable queue/subscription store.
const save=async()=>{await writeFile(`${dir}/state.tmp`,JSON.stringify(state));await rename(`${dir}/state.tmp`,`${dir}/state.json`);};
const hash=value=>createHash('sha256').update(JSON.stringify(value??null)).digest('hex');
const selector=createTransportSelector({proxyUrl:process.env.DTEK_PROXY_URL,healthUrl:process.env.DTEK_PROXY_HEALTH_URL,retrySeconds});
let nextRefreshAt=new Date().toISOString();
let telegram;
function snapshot(){
 const {current,previous,checkedAt,lastSuccess,error,emergency}=state;
 return {current,previous,checkedAt,lastSuccess,error,emergency,region,source:shutdownsPages[region],telegramEnabled:Boolean(telegram?.enabled),telegramUsername:telegram?.getUsername()||null,
 api:{endpoint:'/api/v1/schedules',refreshIntervalSeconds:intervalSeconds,nextRefreshAt}};
}
telegram=await createTelegram({token:process.env.TELEGRAM_BOT_TOKEN,dataDir:dir,getSnapshot:snapshot,publicUrl:process.env.PUBLIC_URL||''});
telegram.start();

async function poll(){
 const oldSnapshot=snapshot();
 let route=await selector.take();
 let noticeRead=false;
 try{
  let next;
  try{next=await scrape(region,{proxyUrl:route.proxyUrl});}
  catch(error){
   selector.failed(route);
   if(route.name!=='vpn')throw error;
   console.warn('VPN source request failed; retrying directly.');
   route={name:'direct'};next=await scrape(region);
  }
  state.checkedAt=new Date().toISOString();
  noticeRead=next.emergency.active!==null;
  if(next.emergency.active!==null)state.emergency={...next.emergency,checkedAt:state.checkedAt,stale:false};
  else state.emergency={...state.emergency,stale:true};
  if(next.days.length){
   Object.assign(next,mergeSchedules(next.days,state.current?.days));
   delete next.emergency;next.region=region;
   if(hash(next.days)!==hash(state.current?.days)){
    state.previous=state.current;state.current={...next,receivedAt:state.checkedAt};
   }else{
    state.current.sourceUpdatedAt=next.sourceUpdatedAt;state.current.retainedDates=next.retainedDates;
   }
   state.lastSuccess=state.checkedAt;state.error=null;
  }else state.error='ДТЕК не надав актуальний плановий графік. Показуємо збережені дані.';
 }catch{
  state.checkedAt=new Date().toISOString();
  state.error='Не вдалося отримати графік ДТЕК. Показуємо останні збережені дані.';
  if(!noticeRead)state.emergency={...state.emergency,stale:true};
  console.error(`DTEK fetch failed via ${route.name}; saved schedules preserved.`);
 }
 await save();
 await telegram.notify(oldSnapshot,snapshot());
}

const files=Object.assign(Object.create(null),{'/':'index.html','/style.css':'style.css','/app.js':'app.js','/dates.js':'dates.js'});
for(const asset of ['favicon.svg','favicon.png','logo.svg','avatar.png','logo-transparent.png'])files[`/brand/${asset}`]=`brand/${asset}`;
const mimeTypes={js:'text/javascript',css:'text/css',svg:'image/svg+xml',png:'image/png',html:'text/html; charset=utf-8'};
const assets=new Map(await Promise.all(Object.entries(files).map(async ([path,file])=>[path,{
 type:mimeTypes[file.split('.').at(-1)],body:await readFile(new URL(`./public/${file}`,import.meta.url))
}])));
const apiCache=new Map();
let cacheGeneration;
const limits=new Map();
let minute=-1, apiRequests=0;
function allowApiRequest(req){
 const window=Math.floor(Date.now()/60000);
 if(window!==minute){minute=window;limits.clear();apiRequests=0;}
 const forwarded=req.headers['x-dtek-client-ip'];
 const address=process.env.TRUST_CADDY==='1'&&typeof forwarded==='string'&&isIP(forwarded)?forwarded:req.socket.remoteAddress;
 const count=limits.get(address)??0;
 if(count>=120||apiRequests>=2400)return false;
 limits.set(address,count+1);apiRequests++;
 return true;
}
const server=http.createServer({headersTimeout:10000,requestTimeout:15000,keepAliveTimeout:5000,maxHeaderSize:8192,connectionsCheckingInterval:1000},(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
 res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
 try{
  if(req.url.length>2048){res.writeHead(414);res.end();return;}
  const url=new URL(req.url,'http://localhost');const path=url.pathname;
  if(path==='/api/v1/schedules')res.setHeader('Access-Control-Allow-Origin','*');
  if((path==='/api/v1/schedules'||path==='/api/schedule')&&!allowApiRequest(req)){
   res.writeHead(429,{'Retry-After':String(60-Math.floor(Date.now()/1000)%60),'Cache-Control':'no-store'});res.end();return;
  }
  if(req.headers['transfer-encoding']||(req.headers['content-length']&&req.headers['content-length']!=='0')){
   res.writeHead(400,{'Connection':'close'});res.end();return;
  }
  if(req.method==='OPTIONS'&&path==='/api/v1/schedules'){
   res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, HEAD, OPTIONS','Access-Control-Allow-Headers':'If-None-Match'});res.end();return;
  }
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
  if(path==='/api/v1/schedules'){
   const generation=JSON.stringify([state.checkedAt,nextRefreshAt]);
   if(generation!==cacheGeneration){apiCache.clear();cacheGeneration=generation;}
   const result=schedulesResponse(url,snapshot(),{ifNoneMatch:req.headers['if-none-match'],cache:apiCache});
   res.writeHead(result.status,{...result.headers,'Access-Control-Expose-Headers':'ETag, Retry-After'});res.end(req.method==='HEAD'?'':result.body);return;
  }
  if(path==='/api/schedule'){
   res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(req.method==='HEAD'?'':JSON.stringify(snapshot()));return;
  }
  if(path==='/health'){res.writeHead(200);res.end(req.method==='HEAD'?'':'ok');return;}
  const asset=assets.get(path);
  if(!asset){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':asset.type,'Content-Length':asset.body.length});
  res.end(req.method==='HEAD'?'':asset.body);
 }catch{if(!res.headersSent)res.writeHead(500);res.end('Server error');}
});
server.on('checkContinue',(_req,res)=>{res.writeHead(417,{'Connection':'close'});res.end();});
server.listen(Number(process.env.PORT||3000),'0.0.0.0');
let stopping=false,timer;
async function loop(){
 const started=Date.now();nextRefreshAt=new Date(started+intervalSeconds*1000).toISOString();
 try{await poll();}catch{console.error('Polling state persistence failed; retrying next cycle.');}
 if(!stopping){const wait=Math.max(1000,intervalSeconds*1000-(Date.now()-started));nextRefreshAt=new Date(Date.now()+wait).toISOString();timer=setTimeout(loop,wait);timer.unref();}
}
loop();
async function shutdown(){if(stopping)return;stopping=true;clearTimeout(timer);server.close();await telegram.stop();}
process.on('SIGTERM',()=>{void shutdown();});process.on('SIGINT',()=>{void shutdown();});
