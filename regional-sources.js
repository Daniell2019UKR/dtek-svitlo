import {shutdownsPages} from './vendor/constants.js';
import {normalize} from './schedule.js';
import {scheduleDates,dateInKyiv} from './public/dates.js';
import {standardGroups} from './public/regions.js';
import {classifyEmergency} from './emergency.js';

const mirror='https://koly-svitlo.web.app/v1';
const community='https://raw.githubusercontent.com/yaroslav2901/OE_OUTAGE_DATA/main/data';
const feeds={
 k:['kyiv'],kr:['kyiv-region'],dn:['dnipro'],o:['odesa'],
 cek:['cek','https://cek.dp.ua/'],
 vinnytsia:['vinnytsia','https://disconnection.voe.com.ua/'],
 volyn:['volyn','https://energy.volyn.ua/'],
 zhytomyr:['zhytomyr','https://www.ztoe.com.ua/','Zhytomyroblenergo'],
 zakarpattia:['zakarpattia','https://zakarpat.energy/customers/break-in-electricity-supply/','Zakarpattiaoblenerho'],
 zaporizhzhia:['zaporizhzhia','https://www.zoe.com.ua/','Zaporizhzhiaoblenergo'],
 'ivano-frankivsk':['ivano-frankivsk','https://svitlo.oe.if.ua/','Prykarpattiaoblenerho'],
 kirovohrad:['kirovohrad','https://kiroe.com.ua/'],
 lviv:['lviv','https://poweron.loe.lviv.ua/','Lvivoblenerho'],
 mykolaiv:['mykolaiv','https://off.energy.mk.ua/'],
 poltava:['poltava','https://www.poe.pl.ua/','Poltavaoblenergo'],
 rivne:['rivne','https://www.ez.rv.ua/grafiky-pogodynnyh-vidklyuchen/','Rivneoblenergo'],
 sumy:['sumy','https://www.soe.com.ua/'],
 ternopil:['ternopil','https://www.toe.com.ua/','Ternopiloblenerho'],
 kharkiv:['kharkiv','https://www.oblenergo.kharkov.ua/','Kharkivoblenerho'],
 khmelnytskyi:['khmelnytskyi','https://hoe.com.ua/','Khmelnytskoblenerho'],
 cherkasy:['cherkasy','https://www.cherkasyoblenergo.com/','Cherkasyoblenergo'],
 chernivtsi:['chernivtsi','https://oblenergo.cv.ua/shutdowns/'],
 chernihiv:['chernihiv','https://chernihivoblenergo.com.ua/','Chernihivoblenergo']
};
export const regionalSources=Object.freeze({...Object.fromEntries(Object.entries(feeds).map(([code,[,site]])=>[code,site])),...shutdownsPages});
const pulse='https://svitlopulse.andrewboyko.name';
const feedCredits={mirror:'https://github.com/retro20201/svitlo-mirror',community:'https://github.com/yaroslav2901/OE_OUTAGE_DATA',pulse:`${pulse}/api/`};
let vinnytsiaCache, mirrorIndex;

async function vinnytsiaSchedules(read,now){
 const dates=scheduleDates(now);
 const days=[];
 let sourceUpdatedAt=null;
 for(const date of dates){
  const groups={};
  for(let i=0;i<standardGroups.length;i+=4){
   await Promise.all(standardGroups.slice(i,i+4).map(async group=>{
    try{
     const {schedule}=await read(`${pulse}/api/v1/history/plan/vinnytsiaoblenergo/${group}?date=${date}`);
     if(schedule?.operator_id!=='vinnytsiaoblenergo'||schedule.group_code!==group||schedule.date!==date||
        schedule.status!=='applies'||!Array.isArray(schedule.slots))return;
     const slots=Array(48).fill(true);
     const startOfDay=Date.parse(`${date}T12:00:00Z`);
     const minutes=value=>{
      if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))throw Error('Invalid interval time');
      const difference=(Date.parse(value.slice(0,10)+'T12:00:00Z')-startOfDay)/86400000;
      return difference*1440+Number(value.slice(11,13))*60+Number(value.slice(14,16));
     };
     for(const interval of schedule.slots){
      const start=minutes(interval.start),end=minutes(interval.end);
      if(!(start>=0&&end<=1440&&start<end))throw Error('Invalid interval range');
      for(let i=Math.floor(start/30);i<Math.ceil(end/30);i++){
       slots[i]=interval.kind==='off'&&start<=i*30&&end>=(i+1)*30?false:null;
      }
     }
     groups[group]=slots;
     if(Date.parse(schedule.source_updated_at)>(sourceUpdatedAt?Date.parse(sourceUpdatedAt):0))sourceUpdatedAt=schedule.source_updated_at;
    }catch{/* Missing or invalid queues remain unpublished. */}
   }));
  }
  if(Object.keys(groups).length)days.push({date,groups:Object.fromEntries(standardGroups.filter(group=>groups[group]).map(group=>[group,groups[group]]))});
 }
 return {days,sourceUpdatedAt};
}

function normalizeFeed(payload, region, now){
 const dates=scheduleDates(now);
 // The mirror's Dnipro file contains additional CEK queues, served separately here.
 const options={onlyPublished:true,includeGroup:group=>region!=='dn'||!group.startsWith('100')};
 const days=normalize(payload.fact,options).filter(day=>dates.includes(day.date));
 if(!days.length)throw Error('No published schedule for today or tomorrow');
 return days;
}

export async function scrapeRegional(region,{fetchImpl=fetch,now=new Date()}={}){
 const [id,,backup]=feeds[region]??[];
 if(!id)return {days:[],emergency:{active:null,message:null,areas:[]},dataSource:null,sourceUpdatedAt:null};
 const read=async url=>{
  const response=await fetchImpl(url,{signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('Regional feed unavailable');
  return response.json();
 };
 let payload, days=[], emergency={active:null,message:null,areas:[]}, dataSource=null;
 try{
  if(!mirrorIndex||now-mirrorIndex.at>=120000||mirrorIndex.fetchImpl!==fetchImpl){
   mirrorIndex={at:now,fetchImpl,pending:read(`${mirror}/index.json`).catch(()=>null)};
  }
  const index=await mirrorIndex.pending;
  const entry=Array.isArray(index?.regions)?index.regions.find(region=>region?.id===id):null;
  if(entry?.stale===true||entry?.hasSchedule===false&&entry?.emergencySignal!==true)throw Error('Regional mirror has no fresh schedule');
  payload=await read(`${mirror}/${id}.json`);
  if(payload?.regionId!==id||payload.meta?.schemaVersion!=='1.0.0')throw Error('Unexpected regional feed');
  const fact=payload.fact;
  const note=typeof fact?.emergencyNote==='string'?fact.emergencyNote.trim().slice(0,1000):'';
  const age=now-Date.parse(payload.mirroredAt);
  const today=dateInKyiv(now);
  const reportedToday=Array.isArray(fact?.emergency)&&fact.emergency.some(epoch=>
   Number.isFinite(epoch)&&epoch>0&&epoch<4102444800&&dateInKyiv(new Date(epoch*1000))===today);
  if(note&&age>=0&&age<2*3600000&&reportedToday){
   const notice=classifyEmergency(note);
   if(notice.active)emergency=notice;
  }
  days=normalizeFeed(payload,region,now);
  dataSource=feedCredits.mirror;
 }catch{
  if(backup){
   try{
    payload=await read(`${community}/${backup}.json`);
    days=normalizeFeed(payload,region,now);
    dataSource=feedCredits.community;
   }catch{/* Keep the last locally saved schedule when both feeds are unavailable. */}
  }
 }
 if(!days.length&&region==='vinnytsia'){
  const cached=fetchImpl===fetch;
  if(!cached||!vinnytsiaCache||dateInKyiv(vinnytsiaCache.at)!==dateInKyiv(now)||now-vinnytsiaCache.at>=600000){
   const result=await vinnytsiaSchedules(read,now);
   if(cached)vinnytsiaCache={at:now,result};
   return {...result,emergency,dataSource:result.days.length?feedCredits.pulse:null};
  }
  return {...vinnytsiaCache.result,emergency,dataSource:vinnytsiaCache.result.days.length?feedCredits.pulse:null};
 }
 return {days,emergency,dataSource,sourceUpdatedAt:days.length?payload.fact?.update??null:null};
}
