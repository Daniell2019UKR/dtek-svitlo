import {createHash} from 'node:crypto';
import {groups} from './schedule.js';
import {scheduleDates} from './public/dates.js';

const slotTime=index=>`${String(Math.floor(index/2)).padStart(2,'0')}:${index%2?'30':'00'}`;

function intervals(slots, state) {
  const result=[];
  for(let start=0;start<48;){
    if(slots[start]!==state){start++;continue;}
    let end=start+1;
    while(end<48&&slots[end]===state)end++;
    result.push([slotTime(start),slotTime(end)]);
    start=end;
  }
  return result;
}

export function compactDays(days) {
  return days.map(day=>{
    const profiles=new Map();
    for(const [group,values] of Object.entries(day.groups)){
      // Missing and unrecognized slots remain explicitly unknown, never on.
      const slots=Array.from({length:48},(_,index)=>typeof values?.[index]==='boolean'?values[index]:null);
      const key=JSON.stringify(slots);
      if(profiles.has(key)){profiles.get(key).groups.push(group);continue;}
      const unknown=intervals(slots,null);
      profiles.set(key,{groups:[group],off:intervals(slots,false),...(unknown.length?{unknown}:{})});
    }
    return {date:day.date,schedules:[...profiles.values()]};
  });
}

export function schedulesResponse(url, snapshot, options = {}) {
  const now = options.now ?? Date.now();
  const headers = {'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff'};
  const fail = (status, error) => ({status,headers:{...headers,'Cache-Control':'no-store'},body:JSON.stringify({error})});
  const group=url.searchParams.get('group');
  const date=url.searchParams.get('date');
  const parameters=[...url.searchParams.keys()];
  if(parameters.some(key=>!['region','date','group','format'].includes(key))||new Set(parameters).size!==parameters.length)return fail(400,'Use unique region, date, group or format parameters');
  const format=url.searchParams.get('format')??'compact';
  if(!['compact','slots'].includes(format))return fail(400,'Invalid format; expected compact or slots');
  if (group !== null && !groups.includes(group)) return fail(400,'Invalid group; expected 1.1–6.2');
  if (date !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0,10)!==date)) return fail(400,'Invalid date; expected YYYY-MM-DD');
  const validDates=scheduleDates(new Date(now));
  let days=(snapshot.current?.days??[]).filter(day=>validDates.includes(day.date));
  if (!days.length) {
    const result=fail(503,'No saved schedule for today or tomorrow');
    result.body=JSON.stringify({error:'No saved schedule for today or tomorrow',region:snapshot.region,source:snapshot.source,emergency:snapshot.emergency,nextRefreshAt:snapshot.api.nextRefreshAt});
    return result;
  }
  if (date) days=days.filter(day=>day.date===date);
  if (!days.length) return fail(404,'Schedule for this date has not been published');
  if (group) days=days.map(day=>({...day,groups:{[group]:day.groups[group]}}));
  const seconds=Math.max(0,Math.ceil((Date.parse(snapshot.api.nextRefreshAt)-now)/1000))||0;
  const stale=Boolean(snapshot.error || !snapshot.lastSuccess || now-Date.parse(snapshot.lastSuccess)>Math.max(300000,snapshot.api.refreshIntervalSeconds*2500));
  const key=JSON.stringify([snapshot.region,validDates,date,group,format,stale]);
  let cached=options.cache?.get(key);
  if(!cached){
  const payload={version:1,format,region:snapshot.region,timeZone:'Europe/Kyiv',generatedAt:snapshot.current.receivedAt,
    checkedAt:snapshot.checkedAt,lastSuccess:snapshot.lastSuccess,stale,error:snapshot.error,
    refreshIntervalSeconds:snapshot.api.refreshIntervalSeconds,nextRefreshAt:snapshot.api.nextRefreshAt,
    days:format==='compact'?compactDays(days):days,retainedDates:(snapshot.current.retainedDates??[]).filter(date=>days.some(day=>day.date===date)),
    emergency:snapshot.emergency,source:snapshot.source};
  const body=JSON.stringify(payload);
  const etag='"'+createHash('sha256').update(body).digest('hex')+'"';
  cached={body,etag};
  if(options.cache&&options.cache.size<160)options.cache.set(key,cached);
  }
  const {body,etag}=cached;
  Object.assign(headers,{'ETag':etag,'Cache-Control':`public, max-age=${stale?0:seconds}, must-revalidate`,'Retry-After':String(seconds)});
  const matches=(options.ifNoneMatch??'').split(',').some(value=>value.trim().replace(/^W\//,'')===etag||value.trim()==='*');
  return {status:matches?304:200,headers,body:matches?'':body};
}
