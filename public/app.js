import {regionNames,isRegion} from './regions.js';
import {scheduleDates, currentSlot, outageHours, changedRanges} from './dates.js?v=outline-colors';

const $=s=>document.querySelector(s);
let data, region='', filter='', connectionError=false, requestVersion=0;
const collapsedRows=new Set();
function stored(key){try{return localStorage.getItem(key)||'';}catch{return '';}}
function remember(key,value){try{localStorage.setItem(key,value);}catch{}}
const requested=new URLSearchParams(location.search).get('region');
region=isRegion(requested)?requested:isRegion(stored('region'))?stored('region'):'';
const regionSelect=$('#region-select');
for(const [code,name] of Object.entries(regionNames))regionSelect.add(new Option(name,code));
if(region)regionSelect.value=region;
for(let i=0;i<12;i++){const g=Math.floor(i/2)+1+'.'+(i%2+1);$('#group').add(new Option(g,g));}
function restoreGroup(code, legacy=false){
 filter=stored('group:'+code)||(legacy?stored('group'):'');
 if(![...$('#group').options].some(option=>option.value===filter))filter='';
 $('#group').value=filter;
}
if(region)restoreGroup(region);
$('#group').onchange=e=>{filter=e.target.value;if(region)remember('group:'+region,filter);render();};
regionSelect.onchange=()=>{
 region=regionSelect.value;remember('region',region);restoreGroup(region);
 data=null;$('#chart').replaceChildren();$('#emergency').hidden=true;$('#my-group').hidden=true;
 $('#region').textContent=regionNames[region];$('#source').removeAttribute('href');
 $('#public-api').href='/api/v1/schedules?region='+region;
 $('#notice').textContent='Завантажуємо графік…';$('#badge').textContent='Очікуємо дані';$('#badge').classList.remove('emergency-badge');
 $('#emergency-check').textContent='';$('#updated').textContent='';$('#api-status').textContent='';
 void load();
};
const time=v=>v?new Date(v).toLocaleString('uk-UA',{timeZone:'Europe/Kyiv',dateStyle:'short',timeStyle:'short'}):'—';
const clock=slot=>`${String(Math.floor(slot/2)).padStart(2,'0')}:${slot%2?'30':'00'}`;
const hoursText=hours=>new Intl.NumberFormat('uk-UA',{maximumFractionDigits:2}).format(hours);
const setText=(selector,value)=>{const node=$(selector);if(node.textContent!==value)node.textContent=value;};

function renderMyGroup(dates, now, stale){
 const card=$('#my-group');
 card.hidden=!filter;
 if(!filter)return;
 setText('#my-group-title',`Моя черга · ${filter}`);
 const days=data.current?.days??[];
 const today=days.find(day=>day.date===dates[0])?.groups[filter]??[];
 const tomorrow=days.find(day=>day.date===dates[1])?.groups[filter]??[];
 const index=Math.floor(currentSlot(now));
 const value=today[index];
 setText('#my-group-state',value===true?'За графіком світло є':value===false?'За графіком світла немає':'Немає даних на цей час');
 card.dataset.state=value===false?'off':value===true?'on':'unknown';
 const slots=[...Array.from({length:48},(_,i)=>today[i]??null),...tomorrow];
 let end=index+1;
 while(end<slots.length&&slots[end]===value)end++;
 let next='Наступний час поки невідомий';
 if(typeof value==='boolean'&&typeof slots[end]==='boolean'){
  const when=`${end>=48?'завтра ':''}о ${clock(end%48)}`;
  next=value?`Наступне відключення ${when}`:`Очікується світло ${when}`;
 }
 setText('#my-group-next',next);
 const retained=data.current?.retainedDates??[];
 setText('#my-group-note',data.emergency?.active?'Фактичні відключення можуть відрізнятися від графіка.':stale||retained.includes(dates[0])||(end>=48&&retained.includes(dates[1]))?'За збереженим графіком.':'');
}

function mobileIntervals(slots, previous){
 const list=document.createElement('div');list.className='mobile-intervals';
 for(let start=0;start<slots.length;){
  const value=slots[start];
  const changed=Boolean(previous&&previous[start]!==value);
  let end=start+1;
  while(end<slots.length&&slots[end]===value&&Boolean(previous&&previous[end]!==value)===changed)end++;
  if(value!==true||changed){
   const label=value===null?'Немає даних':value?'Світло є':'Світла немає';
   const item=document.createElement('span');
   item.className=`interval-pill ${value===null?'unknown':value?'on':'off'}${changed?' interval-changed':''}`;
   const change=changed?(value===false?'Додано':value===true?'Скасовано':'Дані зникли'):'';
   item.textContent=`${clock(start)}–${clock(end)}${change?' · '+change:''}`;
   item.setAttribute('aria-label',`${item.textContent} · ${label}`);
   list.append(item);
  }
  start=end;
 }
 return list;
}

const outageTitle=warning=>warning.kind==='unplanned'?'Аварійні відключення':warning.kind==='mixed'?'Аварійні та екстрені відключення':'Екстрені відключення';

function renderEmergency(now){
 const warning=data.emergency;
 const banner=$('#emergency');
 banner.hidden=warning?.active!==true;
 const old=warning?.stale||connectionError||!Number.isFinite(Date.parse(warning?.checkedAt))||now-new Date(warning.checkedAt)>Math.max(300000,(data.api?.refreshIntervalSeconds||120)*3000);
 setText('#emergency-check',warning?.active!==true&&(warning?.active==null||old)?'Статус аварійних та екстрених відключень наразі не підтверджено.':'');
 if(warning?.active!==true)return;
 // Keep unchanged live-region text in place so polling does not repeatedly
 // announce the same emergency to screen-reader users.
 setText('#emergency-title',outageTitle(warning));
 setText('#emergency-message',warning.message||'ДТЕК повідомляє про екстрені відключення.');
 setText('#emergency-areas',warning.areas?.length?`Зазначені території: ${warning.areas.join('; ')}`:'');
 setText('#emergency-status',old?'Останнє збережене повідомлення. Актуальність зараз не підтверджено.':`Перевірено: ${time(warning.checkedAt)}`);
 $('#emergency-source').href=data.source;
}

function renderDay(date, today, now){
 const section=document.createElement('section');section.className='day-card';
 section.id=today?'today':'tomorrow';
 const heading=document.createElement('div');heading.className='day-heading';
 const title=document.createElement('h2');
 title.textContent=`${today?'Сьогодні':'Завтра'} · ${new Date(`${date}T12:00:00Z`).toLocaleDateString('uk-UA',{timeZone:'Europe/Kyiv',day:'numeric',month:'long'})}`;
 heading.append(title);
 const current=data.current?.days.find(d=>d.date===date);
 const retained=data.current?.retainedDates?.includes(date);
 const status=document.createElement('span');status.className='day-status'+(retained?' cached':'');
 status.textContent=retained?'Збережений графік · відсутній в останній відповіді':current?'Графік опубліковано':'Очікуємо публікацію';
 heading.append(status);section.append(heading);
 if(!current){
  const empty=document.createElement('p');empty.className='empty';
  empty.textContent=`ДТЕК ще не опублікував графік на ${today?'сьогодні':'завтра'}.`;
  section.append(empty);return section;
 }
 const scroll=document.createElement('div');scroll.className='scroll';
 const chart=document.createElement('div');chart.className='day-chart';
 scroll.append(chart);section.append(scroll);
 const previous=data.previous?.days.find(d=>d.date===date);
 const slot=today?currentSlot(now):0;
 const axis=document.createElement('div');axis.className='row axis-row';
 axis.innerHTML='<span class="axis-label">Група</span><div class="hours">'+Array.from({length:25},(_,i)=>`<span>${String(i).padStart(2,'0')}</span>`).join('')+`</div><span class="axis-label total">${today?'Залишилось без світла':'Всього без світла'}</span>`;
 chart.append(axis);
 for(const [g,slots] of Object.entries(current.groups)){
  if(filter&&g!==filter)continue;
  const old=previous?.groups[g];const changed=old&&slots.some((v,i)=>v!==old[i]);
  const row=document.createElement('div');row.className='row';
  const title=document.createElement('span');title.className='group'+(changed?' changed-text':'');title.textContent=g+(changed?' •':'');row.append(title);
  const track=document.createElement('div');track.className='track';
  slots.forEach((v,i)=>{
   const cell=document.createElement('div');
   cell.className='cell '+(v===false?'off':v===null?'unknown':'')+(today&&i+1<=slot?' past':'')+(old&&old[i]!==v?' was':'');
   cell.title=`${date} · ${g} · ${clock(i)}–${clock(i+1)} · ${v===null?'Немає даних':v?'Світло є':'Світла немає'}${old&&old[i]!==v?' · Змінено':''}`;
   track.append(cell);
  });
  const changes=changedRanges(slots,old);
  for(const [index,{start,end,state}] of changes.entries()){
   const outline=document.createElement('span');outline.className='change-outline '+(state===false?'change-added':state===true?'change-restored':'change-unknown');
   if(changes[index-1]?.end===start)outline.classList.add('joins-left');
   if(changes[index+1]?.start===end)outline.classList.add('joins-right');
   outline.style.left=`${start/48*100}%`;outline.style.width=`${(end-start)/48*100}%`;
   outline.setAttribute('aria-hidden','true');track.append(outline);
  }
  if(today){const line=document.createElement('div');line.className='now';line.style.left=`${slot/48*100}%`;track.append(line);}
  row.append(track);
  const total=document.createElement('span');total.className='total';
  const remaining=slots.filter((_,i)=>i+1>slot);
  const off=outageHours(slots,slot);
  total.textContent=remaining.every(v=>v===null)?'немає даних':off?`${today?'ще ':''}${hoursText(off)} год${remaining.includes(null)?' + ?':''}`:remaining.includes(null)?'неповні дані':'без відкл.';
  const intervals=mobileIntervals(slots,old);
  row.append(total,intervals);
  if(!filter&&intervals.childElementCount){
   const key=`${data.region}-${date}-${g}`;
   intervals.id=`intervals-${key}`;
   row.classList.add('has-details');
   const toggle=document.createElement('button');toggle.type='button';toggle.className='group-details';
   toggle.setAttribute('aria-controls',intervals.id);
   const update=()=>{
    const open=!collapsedRows.has(key);
    row.classList.toggle('expanded',open);
    toggle.setAttribute('aria-expanded',String(open));
    toggle.setAttribute('aria-label',`Інтервали черги ${g}`);
    toggle.textContent=open?'Сховати ▴':'Інтервали ▾';
   };
   toggle.addEventListener('click',()=>{if(!collapsedRows.delete(key))collapsedRows.add(key);update();});
   update();row.append(toggle);
  }
  chart.append(row);
 }
 return section;
}

function render(){
 if(!data)return;
 $('#region').textContent=regionNames[data.region]||data.region;$('#source').href=data.source;$('#public-api').href='/api/v1/schedules?region='+data.region;
 $('#notice').textContent=connectionError?'Немає зв’язку із сервером. Повторюємо спробу автоматично.':data.error||'';
 const now=new Date();const dates=scheduleDates(now);
 renderEmergency(now);
 const relevant=data.current?.days.some(day=>dates.includes(day.date));
 const stale=!data.lastSuccess||now-new Date(data.lastSuccess)>300000;
 renderMyGroup(dates,now,stale||connectionError||Boolean(data.error));
 setText('#jump-tomorrow',data.current?.days.some(day=>day.date===dates[1])?'Завтра':'Завтра · очікуємо');
 $('#badge').textContent=data.emergency?.active?outageTitle(data.emergency):connectionError||data.error||stale||!relevant?'Дані не оновлено':data.current?.retainedDates?.some(date=>dates.includes(date))?'Є збережені дані':'Актуальний графік';
 $('#badge').classList.toggle('emergency-badge',data.emergency?.active===true);
 $('#updated').textContent=`Перевірено: ${time(data.checkedAt)} · Отримано: ${time(data.lastSuccess)}`;
 $('#api-status').textContent=data.api?.nextRefreshAt?`Наступна перевірка джерела: ${time(data.api.nextRefreshAt)}. Запити до API читають збережений графік.`:'';
 const telegram=$('#telegram');
 telegram.replaceChildren();
 if(data.telegramEnabled&&/^[A-Za-z0-9_]{5,32}$/.test(data.telegramUsername||'')){
  telegram.append('Отримуйте графіки картинками та сповіщення для своєї групи. ');
  const link=document.createElement('a');link.href=`https://t.me/${data.telegramUsername}`;link.target='_blank';link.rel='noopener';link.textContent='Відкрити бота ↗';telegram.append(link);
 }else telegram.textContent=data.telegramEnabled?'Telegram підключено. Відкрийте бота й виберіть свою групу для сповіщень.':'Для сповіщень власник сайту має підключити Telegram-бота в налаштуваннях сервера.';
 const focused=document.activeElement?.closest('.group-details')?.getAttribute('aria-controls');
 $('#chart').replaceChildren(...dates.map((date,i)=>renderDay(date,i===0,now)));
 if(focused)document.querySelector(`[aria-controls="${CSS.escape(focused)}"]`)?.focus({preventScroll:true});
}
async function load(){
 const version=++requestVersion;
 try{
  const r=await fetch('/api/schedule'+(region?'?region='+encodeURIComponent(region):''));
  if(!r.ok)throw Error('Schedule unavailable');
  const next=await r.json();
  if(version!==requestVersion)return;
  if(!region){region=next.region;regionSelect.value=region;restoreGroup(region,true);}
  data=next;connectionError=false;render();
 }catch{
  if(version!==requestVersion)return;
  connectionError=true;
  if(data)render();else $('#notice').textContent='Немає зв’язку із сервером. Повторюємо спробу автоматично.';
 }
}
load();setInterval(load,15000);setInterval(render,30000);
