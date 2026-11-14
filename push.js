import {initializeApp,applicationDefault} from 'firebase-admin/app';
import {getMessaging} from 'firebase-admin/messaging';
import {scheduleDates} from './public/dates.js';

const normalized=text=>(text??'').normalize('NFC').replace(/[\u00ad\u200b-\u200f\u2060\ufeff]/gu,'').replace(/\s+/gu,' ').trim();
const displayDate=date=>date.split('-').reverse().join('-');

export function pushEvents(before,after,now=new Date()){
 const region=after.region;
 const previous=before.emergency;
 const notice=after.emergency;
 const events=[];
 if(!notice?.stale&&(notice?.active===true||notice?.active===false&&previous?.active===true)){
  const message=normalized(notice.message);
  if(notice.active!==previous?.active||notice.active&&(notice.kind!==previous.kind||message!==normalized(previous.message))){
   events.push({topic:`notice-${region}`,region,body:notice.active?message||'Оператор повідомив про відключення.':'Оператор зняв попередження про відключення.'});
  }
 }
 const dates=scheduleDates(now);
 if(after.error)return events;
 for(const day of after.current?.days??[]){
  if(!dates.includes(day.date)||after.current.retainedDates?.includes(day.date))continue;
  const old=before.current?.days?.find(candidate=>candidate.date===day.date);
  if(!old&&(!before.current||day.date!==dates[1]))continue;
  for(const [group,slots] of Object.entries(day.groups)){
   if(!slots.some(value=>typeof value==='boolean')||JSON.stringify(old?.groups[group])===JSON.stringify(slots))continue;
   events.push({topic:`schedule-${region}-${group}`,region,group,
    body:`${old?'Оновлено':'Додано'} графік на ${displayDate(day.date)} · черга ${group}`});
  }
 }
 return events;
}

export function createPush(){
 if(!process.env.FCM_PROJECT_ID)return async()=>{};
 const app=initializeApp({credential:applicationDefault(),projectId:process.env.FCM_PROJECT_ID},'esvitlo-push');
 const messaging=getMessaging(app);
 return async(before,after,title)=>{
  const events=pushEvents(before,after);
  for(let offset=0;offset<events.length;offset+=8){
   const results=await Promise.allSettled(events.slice(offset,offset+8).map(({topic,region,group,body})=>messaging.send({
    topic,data:{title,body:body.slice(0,800),region,...(group?{group}:{})},
    android:{priority:'high',ttl:30*60*1000}
   })));
   if(results.some(result=>result.status==='rejected'))console.warn('FCM delivery failed for one or more topics.');
  }
 };
}
