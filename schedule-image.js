import {brandSvg} from './public/brand/mark.js';
import {currentSlot, dateInKyiv, outageHours} from './public/dates.js';

const names={o:'Одеса та область',k:'Київ',kr:'Київська область',dn:'Дніпропетровська область',d:'Донецька область'};
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const clock=slot=>`${String(Math.floor(slot/2)).padStart(2,'0')}:${slot%2?'30':'00'}`;

export function buildScheduleHtml({day,previousDay,selectedGroups=[],region='o',now=new Date(),emergency=null}) {
 if(!day?.date||!day.groups) throw Error('Schedule image requires a published day');
 const today=day.date===dateInKyiv(now);
 const slot=today?currentSlot(now):0;
 const selected=Object.entries(day.groups).filter(([group])=>!selectedGroups.length||selectedGroups.includes(group));
 if(!selected.length) throw Error('Schedule image has no matching groups');
 const rows=selected.map(([group,values])=>{
  const slots=Array.from({length:48},(_,i)=>typeof values?.[i]==='boolean'?values[i]:null);
  const old=previousDay?.groups?.[group];
  const changed=Boolean(old&&slots.some((value,i)=>value!==old[i]));
  const remaining=slots.filter((_,i)=>i+1>slot);
  const hours=outageHours(slots,slot);
  const total=remaining.every(value=>value===null)?'немає даних':hours?`${today?'ще ':''}${new Intl.NumberFormat('uk-UA',{maximumFractionDigits:2}).format(hours)} год${remaining.includes(null)?' + ?':''}`:remaining.includes(null)?'неповні дані':'без відкл.';
  return `<div class="row"><b class="group${changed?' changed':''}">${escape(group)}${changed?' •':''}</b><div class="track">${slots.map((value,i)=>`<div class="cell ${value===false?'off':value===null?'unknown':'on'}${today&&i+1<=slot?' past':''}${old&&old[i]!==value?' was':''}" title="${clock(i)}–${clock(i+1)}"></div>`).join('')}${today?`<div class="now" style="left:${slot/48*100}%"></div>`:''}</div><span class="total">${escape(total)}</span></div>`;
 }).join('');
 const date=new Date(`${day.date}T12:00:00Z`).toLocaleDateString('uk-UA',{timeZone:'Europe/Kyiv',weekday:'long',day:'numeric',month:'long'});
 const emergencyText=emergency?.active?(emergency.text||emergency.message||'Діють екстрені відключення. Плановий графік може не діяти.'):' Під час аварійних та екстрених відключень графік може не діяти.';
 return `<!doctype html><html lang="uk"><meta charset="utf-8"><style>
 *{box-sizing:border-box}body{margin:0;background:#101725;color:#f0f4f9;font-family:Arial,system-ui,sans-serif}.image{padding:36px;width:1080px}.brand{display:flex;align-items:center;gap:8px;font-size:25px;font-weight:800;color:#53e78d;border-bottom:1px solid #354157;padding-bottom:22px}h1{font-size:34px;margin:24px 0 10px}.date{color:#a9b4c4;font-size:22px;margin-bottom:28px}.row{display:grid;grid-template-columns:72px 1fr 130px;gap:12px;align-items:center;margin-bottom:9px}.group{font-size:23px}.group.changed{color:#53e78d}.track{display:grid;grid-template-columns:repeat(48,1fr);height:44px;position:relative}.cell{background:#203d30;border-right:1px solid #101725}.cell:nth-child(2n){border-right:2px solid #101725}.off{background:#f14550}.unknown{background:#303a49}.past{opacity:.4}.was{outline:2px dashed #eef4ff;outline-offset:-2px}.now{position:absolute;top:-7px;bottom:-7px;width:2px;background:#53e78d}.total{text-align:right;font-size:18px;color:#b3bdcc}.hours{position:relative;height:24px;margin-bottom:8px;color:#9aa7b9;font-size:12px}.hours span{position:absolute;transform:translateX(-50%)}.hours span:first-child{transform:none}.hours span:last-child{transform:translateX(-100%)}.legend{display:flex;gap:21px;flex-wrap:wrap;color:#a9b4c4;margin-top:26px;font-size:16px}.legend span{display:flex;gap:7px;align-items:center}.legend i{display:inline-block;height:18px;width:18px;border-radius:4px}.foot{margin-top:24px;color:#97a2b4;font-size:15px;line-height:1.6}.emergency{background:#571d28;border:1px solid #ee5c69;padding:16px;margin:18px 0;color:#ffe2e5;font-size:19px;line-height:1.5}
 </style><div class="image"><div class="brand">${brandSvg({size:34})} Світло · Графік ДТЕК</div><h1>${escape(names[region]||region)}</h1><div class="date">${today?'Сьогодні':'Графік'} · ${escape(date)}</div>${emergency?.active?`<div class="emergency">⚠ ${escape(emergencyText)}</div>`:''}<div class="row"><span></span><div class="hours">${Array.from({length:25},(_,i)=>`<span style="left:${i/24*100}%">${String(i).padStart(2,'0')}</span>`).join('')}</div><span></span></div>${rows}<div class="legend"><span><i class="off"></i>Світла немає</span><span><i style="background:#203d30"></i>Світло є</span><span><i class="unknown"></i>Немає даних</span><span><i style="border:2px dashed white"></i>Змінено</span></div><div class="foot">Станом на ${escape(now.toLocaleString('uk-UA',{timeZone:'Europe/Kyiv',dateStyle:'short',timeStyle:'short'}))} · Час київський.<br>Джерело: ДТЕК.${emergency?.active?'':escape(emergencyText)}<br><strong style="color:#48df87">Сформовано в t.me/dtekschedule_bot</strong></div></div></html>`;
}

export async function renderScheduleImage(options) {
 const {chromium}=await import('playwright');
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try {
  const page=await browser.newPage({viewport:{width:1080,height:900},deviceScaleFactor:1});
  // Images are rendered only from the saved schedule; block every external request.
  await page.route('**/*',route=>route.abort());
  await page.setContent(buildScheduleHtml(options),{waitUntil:'load'});
  return await page.locator('.image').screenshot({type:'png'});
 } finally {await browser.close();}
}
