import { PowerState, shutdownsPages } from './vendor/constants.js';
import { scheduleDates } from './public/dates.js';
import {extractEmergency} from './emergency.js';
export const groups = Array.from({length:12},(_,i)=>`${Math.floor(i/2)+1}.${i%2+1}`);
export function normalize(raw) {
  const days = Object.entries(raw?.data ?? {}).filter(([timestamp, data]) =>
    /^\d+$/.test(timestamp) && Number.isFinite(new Date(Number(timestamp)*1000).getTime()) && data && typeof data === 'object'
  ).sort(([a],[b])=>Number(a)-Number(b)).map(([timestamp, data])=>({
    date:new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kyiv'}).format(new Date(Number(timestamp)*1000)),
    groups:Object.fromEntries(groups.map(group=>[group,Array.from({length:24},(_,hour)=>{
      const state=data[`GPV${group}`]?.[hour+1];
      switch(state){case PowerState.ON:return [true,true];case PowerState.OFF:return [false,false];case PowerState.HALF_ON:return [true,false];case PowerState.HALF_OFF:return [false,true];default:return [null,null];}
    }).flat()]))
  })).filter(d=>Object.values(d.groups).some(s=>s.some(v=>v!==null)));
  if(!days.length) throw Error('ДТЕК не опублікував розпізнаваний графік');
  return days;
}

export function mergeSchedules(incoming, saved = [], now = new Date()) {
  const dates = scheduleDates(now);
  const fresh = incoming.filter(day => dates.includes(day.date));
  if (!fresh.length) throw Error('ДТЕК не опублікував графік на сьогодні або завтра');
  const retainedDates = [];
  const days = dates.flatMap(date => {
    const day = fresh.find(day => day.date === date);
    if (day) return [day];
    const cached = saved.find(day => day.date === date);
    if (!cached) return [];
    retainedDates.push(date);
    return [cached];
  });
  return {days, retainedDates};
}
export function extractFact(html) {
  const start=html.search(/(?:DisconSchedule\.)?fact\s*=\s*\{/);
  if(start<0)return null;
  const begin=html.indexOf('{',start);let depth=0,quoted=false,escaped=false;
  for(let i=begin;i<html.length;i++){
    const c=html[i];
    if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
    if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0)return JSON.parse(html.slice(begin,i+1));
  }
  return null;
}
export async function scrape(region, {proxyUrl, fetchImpl=fetch, browserType} = {}) {
  const dispatcher=proxyUrl?new (await import('undici')).ProxyAgent(proxyUrl):null;
  const result=(raw,html)=>{
    const emergency=extractEmergency(html);
    let days=[];
    try {days=normalize(raw);}catch(error){if(emergency.active!==true)throw error;}
    return {days,sourceUpdatedAt:raw?.update??null,emergency};
  };
  try {
  // The same fact JSON used by upstream; HTTP first avoids a browser for static pages.
  try {
    const response=await fetchImpl(shutdownsPages[region],{signal:AbortSignal.timeout(30000),...(dispatcher?{dispatcher}:{})});
    if(response.ok){const html=await response.text();const raw=extractFact(html);if(raw||extractEmergency(html).active===true)return result(raw,html);}
  }catch{/* Dynamic pages fall back to upstream's Playwright approach. */}

  const chromium=browserType??(await import('playwright')).chromium;
  const browser=await chromium.launch({headless:true,...(proxyUrl?{proxy:{server:proxyUrl}}:{}),...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
  try {
    const page=await browser.newPage();
    await page.goto(shutdownsPages[region],{waitUntil:'load',timeout:45000});
    const initialHtml=await page.content();
    if(extractEmergency(initialHtml).active===true){
      const raw=await page.evaluate(()=>typeof DisconSchedule!=='undefined'?DisconSchedule.fact:null);
      return result(raw,initialHtml);
    }
    try {
      await page.waitForFunction(()=>(typeof DisconSchedule!=='undefined'&&DisconSchedule.fact?.data)||document.querySelector('#modal-attention .m-attention__text')?.textContent?.trim(),null,{timeout:15000});
    }catch(error){if(extractEmergency(await page.content()).active!==true)throw error;}
    const raw=await page.evaluate(()=>typeof DisconSchedule!=='undefined'?DisconSchedule.fact:null);
    return result(raw,await page.content());
  } finally {await browser.close();}
  } finally {if(dispatcher)await dispatcher.close();}
}
