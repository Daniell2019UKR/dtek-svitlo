import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {scheduleDates} from './public/dates.js';
import {renderScheduleImage} from './schedule-image.js';

const allGroups=Array.from({length:12},(_,i)=>`${Math.floor(i/2)+1}.${i%2+1}`);
const keyboard={inline_keyboard:[...Array.from({length:6},(_,i)=>[
 {text:`${i+1}.1`,callback_data:`group:${i+1}.1`},
 {text:`${i+1}.2`,callback_data:`group:${i+1}.2`}
]),[{text:'Усі групи',callback_data:'group:all'}]]};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unwrap=snapshot=>snapshot?.current??snapshot;
const alertOf=snapshot=>snapshot?.emergency??unwrap(snapshot)?.emergency??null;
const semanticAlert=alert=>({active:typeof alert?.active==='boolean'?alert.active:null,
 text:alert?.text||alert?.message||'',areas:alert?.areas??[]});
const clone=value=>JSON.parse(JSON.stringify(value));

export async function createTelegram({token,dataDir,getSnapshot,publicUrl='',fetchImpl=fetch,renderImage=renderScheduleImage,now=()=>new Date(),chatIds=process.env.TELEGRAM_CHAT_IDS||'',initialGroups=process.env.TELEGRAM_GROUPS||'',identityRetryMs=60000}) {
 if(!token) return {enabled:false,getUsername:()=>null,start(){},async stop(){},async notify(){},async flush(){},async pollOnce(){}};
 await mkdir(dataDir,{recursive:true});
 const path=join(dataDir,'telegram.json');
 let state={version:1,offset:0,username:null,tokenFingerprint:digest(token),subscriptions:{},queue:[]};
 let exists=false;
 try {state={...state,...JSON.parse(await readFile(path,'utf8'))};exists=true;} catch(error) {if(error.code!=='ENOENT')throw Error('Cannot read persisted Telegram state');}
 if(!state.subscriptions||typeof state.subscriptions!=='object'||!Array.isArray(state.queue))throw Error('Invalid persisted Telegram state');
 if(state.tokenFingerprint!==digest(token)) {state.offset=0;state.username=null;state.queue=[];state.tokenFingerprint=digest(token);}
 if(!exists) {
  const selected=initialGroups.split(',').map(value=>value.trim()).filter(group=>allGroups.includes(group));
  for(const chat of chatIds.split(',').map(value=>value.trim()).filter(value=>/^-?\d+$/.test(value))) state.subscriptions[chat]={groups:selected,enabled:true};
 }
 let serial=Promise.resolve(),running=false,loopPromise=null,flushing=null,retryTimer=null,retryResolve=null;
 const controllers=new Set();
 const locked=operation=>{const task=serial.then(operation);serial=task.catch(()=>{});return task;};
 const persist=async()=>{await writeFile(`${path}.tmp`,JSON.stringify(state),{mode:0o600});await rename(`${path}.tmp`,path);};
 await persist();
 const link=publicUrl?`\n${publicUrl}`:'';
 const enqueue=event=>state.queue.push({id:randomUUID(),attempts:0,createdAt:now().toISOString(),...event});
 const message=(chat,text,extra={})=>enqueue({type:'message',chat,text,...extra});
 function photo(chat,day,before,snapshot,selectedGroups,caption) {
  enqueue({type:'photo',chat,day:clone(day),previousDay:before?clone(before):null,
   selectedGroups:[...selectedGroups],region:snapshot?.region||unwrap(snapshot)?.region||'o',
   emergency:clone(alertOf(snapshot)),caption:`${caption}${link}`});
 }
 async function api(method,payload,{multipart=false,timeout=35000}={}) {
  const controller=new AbortController();controllers.add(controller);
  const timer=setTimeout(()=>controller.abort(),timeout);timer.unref?.();
  try {
   const response=await fetchImpl(`https://api.telegram.org/bot${token}/${method}`,{
    method:'POST',...(multipart?{}:{headers:{'Content-Type':'application/json'}}),
    body:multipart?payload:JSON.stringify(payload),signal:controller.signal
   });
   const body=await response.json();
   if(!response.ok||!body.ok) {const error=Error('Telegram request rejected');error.code=body.error_code||response.status;error.retryAfter=body.parameters?.retry_after;throw error;}
   return body.result;
  } catch(error) {
   // Fetch exceptions may embed the token-bearing URL; never let those escape.
   const safe=Error('Telegram request failed');safe.code=error.code||'NETWORK';safe.retryAfter=error.retryAfter;throw safe;
  } finally {clearTimeout(timer);controllers.delete(controller);}
 }
 function enqueueSchedule(chat,subscription,snapshot) {
  const current=unwrap(snapshot);
  if(!current?.days?.length) {message(chat,'Графік ще завантажується. Спробуйте /schedule трохи пізніше.');return;}
  const dates=scheduleDates(now());
  let count=0;
  for(const day of current.days.filter(day=>dates.includes(day.date))) {
   photo(chat,day,snapshot?.previous?.days?.find(before=>before.date===day.date),snapshot,subscription.groups,`⚡ Графік ДТЕК · ${day.date} · ${subscription.groups.length?`група ${subscription.groups.join(', ')}`:'усі групи'}`);count++;
  }
  if(!count)message(chat,'На сьогодні та завтра ще немає збережених графіків.');
  else if(!current.days.some(day=>day.date===dates[1]))message(chat,'Графік на завтра ще не опублікований.');
 }
 function selectGroup(chat,subscription,value,chooserMessageId=null) {
  if(value==='Усі групи'||value.toLowerCase()==='all')subscription.groups=[];
  else if(allGroups.includes(value))subscription.groups=[value];
  else {message(chat,'Оберіть групу кнопкою або напишіть /group 1.1.',{replyMarkup:keyboard});return;}
  subscription.enabled=true;
  // Remove obsolete schedules queued for a previously selected group.
  state.queue=state.queue.filter(event=>event.chat!==chat||event.type!=='photo');
  const confirmation=`Збережено: ${subscription.groups.length?`група ${subscription.groups.join(', ')}`:'усі групи'}. Надсилатиму зміни графіка картинками.`;
  if(chooserMessageId!==null)enqueue({type:'edit',chat,messageId:chooserMessageId,text:confirmation,replyMarkup:{inline_keyboard:[]}});
  else message(chat,confirmation,subscription.shared?{}:{replyMarkup:{remove_keyboard:true}});
  enqueueSchedule(chat,subscription,getSnapshot());
 }
 async function processGroupCommand(update,incoming,text,command,args) {
  const chat=String(incoming.chat.id);
  const callback=update.callback_query;
  const answer=text=>enqueue({type:'callback',chat,callbackId:callback.id,text});
  const subscription=state.subscriptions[chat];
  if(!callback&&(command==='/schedule'||command==='/start')) {
   if(subscription?.lastGroupRequestAt&&now().getTime()-subscription.lastGroupRequestAt<30000)return;
   const saved=subscription??(state.subscriptions[chat]={groups:null,enabled:false});
   saved.lastGroupRequestAt=now().getTime();
   if(saved.groups===null)message(chat,'Адміністраторе, обери чергу відключень командою /group. Після цього всі учасники зможуть отримувати графік через /schedule.');
   else enqueueSchedule(chat,saved,getSnapshot());
   return;
  }
  if(callback?!text.startsWith('group:'):!['/group','/stop'].includes(command))return;
  const actor=callback?.from??update.message?.from;
  let allowed=false;
  if(!actor?.is_bot&&Number.isSafeInteger(actor?.id)&&(callback||!incoming.sender_chat)){
   try {
    const administrators=await api('getChatAdministrators',{chat_id:chat},{timeout:5000});
    allowed=administrators.some(member=>member.user?.id===actor.id&&['creator','administrator'].includes(member.status));
   } catch { /* Keep the current setting if Telegram cannot verify the role. */ }
  }
  if(!allowed){
   const denial='Налаштування може змінити лише підтверджений адміністратор чату.';
   if(callback)answer(denial);else message(chat,denial);
   return;
  }
  const saved=subscription??(state.subscriptions[chat]={groups:null,enabled:false});
  saved.shared=true;
  if(callback){answer();selectGroup(chat,saved,text.slice('group:'.length),incoming.message_id??null);}
  else if(command==='/stop'){
   saved.enabled=false;
   state.queue=state.queue.filter(event=>event.chat!==chat||event.type!=='photo');
   message(chat,'Автоматичні сповіщення вимкнено. /schedule покаже збережений графік, /group увімкне сповіщення після вибору черги.');
  }else if(args.length)selectGroup(chat,saved,args.join(' '));
  else message(chat,`Оберіть чергу для цього чату.${saved.groups!==null?` Зараз: ${saved.groups.join(', ')||'усі групи'}.`:''}`,{replyMarkup:keyboard});
 }
 async function processUpdates(updates) {
  await locked(async()=>{
   for(const update of updates) {
    if(!Number.isSafeInteger(update.update_id)||update.update_id<state.offset)continue;
    const incoming=update.message||update.callback_query?.message;
    const chat=incoming?.chat?.id;
    const text=(update.callback_query?.data||update.message?.text||'').trim();
    const [rawCommand,...args]=text.split(/\s+/);
    const [command,target]=rawCommand.toLowerCase().split('@');
    if(chat!==undefined&&text&&(!target||target===state.username?.toLowerCase())) {
     if(['group','supergroup'].includes(incoming.chat.type)){
      await processGroupCommand(update,incoming,text,command,args);
      state.offset=update.update_id+1;
      continue;
     }
     if(incoming.chat.type&&incoming.chat.type!=='private'){
      state.offset=update.update_id+1;
      continue;
     }
     const key=String(chat);
     const subscription=state.subscriptions[key]??={groups:null,enabled:false};
     if(update.callback_query)enqueue({type:'callback',chat:key,callbackId:update.callback_query.id});
     if(update.callback_query&&text.startsWith('group:')) {
      selectGroup(key,subscription,text.slice('group:'.length),incoming.message_id??null);
     } else if(command==='/stop') {
      subscription.enabled=false;
      state.queue=state.queue.filter(event=>event.chat!==key||event.type==='callback');
      message(key,'Сповіщення вимкнено. /start — увімкнути знову.',{replyMarkup:{remove_keyboard:true}});
     } else if(command==='/start') {
      subscription.enabled=true;
      message(key,subscription.groups===null?'Вітаю! Оберіть свою групу. Я запам’ятаю її та надсилатиму оновлені графіки картинками.':`Вітаю! Ваша група: ${subscription.groups.length?subscription.groups.join(', '):'усі'}. Сповіщення увімкнено.`,{replyMarkup:subscription.groups===null?keyboard:{remove_keyboard:true}});
      if(subscription.groups!==null)enqueueSchedule(key,subscription,getSnapshot());
     } else if(command==='/group') {
      if(args.length)selectGroup(key,subscription,args.join(' '));
      else message(key,`Оберіть групу.${subscription.groups!==null?` Зараз: ${subscription.groups.length?subscription.groups.join(', '):'усі групи'}.`:''}`,{replyMarkup:keyboard});
     } else if(command==='/schedule') {
      if(subscription.groups===null)message(key,'Спочатку оберіть свою групу.',{replyMarkup:keyboard});
      else enqueueSchedule(key,subscription,getSnapshot());
     } else if(allGroups.includes(text)||text==='Усі групи')selectGroup(key,subscription,text);
     else message(key,'/group — обрати групу\n/schedule — отримати графіки\n/stop — вимкнути сповіщення',{replyMarkup:subscription.groups===null?keyboard:{remove_keyboard:true}});
    }
    // Offset and command effects are committed together, before acknowledging updates.
    state.offset=update.update_id+1;
   }
   await persist();
  });
 }
 async function notify(oldSnapshot,nextSnapshot) {
  await locked(async()=>{
   const old=unwrap(oldSnapshot),next=unwrap(nextSnapshot);
   const dates=scheduleDates(now());
   for(const [chat,subscription] of Object.entries(state.subscriptions)) {
    if(!subscription.enabled||subscription.groups===null)continue;
    const selected=subscription.groups.length?subscription.groups:allGroups;
    const oldAlert=semanticAlert(alertOf(oldSnapshot)),nextAlert=semanticAlert(alertOf(nextSnapshot));
    // Freshness timestamps are not announcements. Unknown source status must not
    // be interpreted as an explicit end to an emergency.
    if(nextAlert.active!==null&&(oldAlert.active===true||nextAlert.active===true)&&digest(oldAlert)!==digest(nextAlert)) {
     const alert=alertOf(nextSnapshot);
     message(chat,alert?.active?`⚠ Екстрені відключення\n${alert.text||alert.message||'ДТЕК повідомив про екстрені відключення. Плановий графік може не діяти.'}${link}`:`Повідомлення ДТЕК про екстрені відключення оновлено.${link}`);
    }
    for(const day of next?.days||[]) {
     if(!dates.includes(day.date))continue;
     const before=old?.days?.find(before=>before.date===day.date);
     const changed=selected.filter(group=>digest(before?.groups?.[group]??null)!==digest(day.groups?.[group]??null));
     if(!changed.length)continue;
     photo(chat,day,before,nextSnapshot,subscription.groups,`⚡ Графік ДТЕК оновлено · ${day.date}\nЗмінилися групи: ${changed.join(', ')}`);
    }
   }
   await persist();
  });
  void flush().catch(()=>console.warn('Telegram queue could not be saved; will retry (credentials omitted).'));
 }
 async function send(event) {
  if(event.type==='callback')return api('answerCallbackQuery',{callback_query_id:event.callbackId,...(event.text?{text:event.text,show_alert:true}:{})});
  if(event.type==='edit')return api('editMessageText',{chat_id:event.chat,message_id:event.messageId,text:event.text,reply_markup:event.replyMarkup});
  if(event.type==='message')return api('sendMessage',{chat_id:event.chat,text:event.text.slice(0,4096),...(event.replyMarkup?{reply_markup:event.replyMarkup}:{})});
  const image=await renderImage({day:event.day,previousDay:event.previousDay,selectedGroups:event.selectedGroups,region:event.region,emergency:event.emergency,now:now()});
  const body=new FormData();body.append('chat_id',event.chat);body.append('caption',event.caption.slice(0,1024));
  body.append('photo',new Blob([image],{type:'image/png'}),`dtek-${event.day.date}.png`);
  return api('sendPhoto',body,{multipart:true,timeout:45000});
 }
 function flush() {
  if(flushing)return flushing;
  flushing=(async()=>{
   const pending=await locked(()=>state.queue.filter(event=>!event.retryAt||event.retryAt<=Date.now()).map(event=>clone(event)));
   for(const event of pending) {
    // A concurrent /stop or /group may have removed a queued image.
    if(!await locked(()=>state.queue.some(item=>item.id===event.id)))continue;
    try {
     await send(event);
     await locked(async()=>{state.queue=state.queue.filter(item=>item.id!==event.id);await persist();});
    } catch(error) {
     await locked(async()=>{
      const item=state.queue.find(item=>item.id===event.id);if(!item)return;
      if(error.code===403) {
       if(state.subscriptions[event.chat])state.subscriptions[event.chat].enabled=false;
       state.queue=state.queue.filter(item=>item.chat!==event.chat);
      } else if((event.type==='callback'||event.type==='edit')&&error.code===400)state.queue=state.queue.filter(item=>item.id!==event.id);
      else {item.attempts++;item.retryAt=Date.now()+Math.max(Number(error.retryAfter)||0,Math.min(3600,15*2**Math.min(item.attempts,8)))*1000;}
      await persist();
     });
     console.warn('Telegram delivery deferred; will retry (credentials omitted).');
    }
   }
  })().finally(()=>{flushing=null;});
  return flushing;
 }
 async function pollOnce({timeout=25}={}) {
  const offset=await locked(()=>state.offset);
  const updates=await api('getUpdates',{offset,timeout,allowed_updates:['message','callback_query']},{timeout:(timeout+10)*1000});
  if(Array.isArray(updates)&&updates.length)await processUpdates(updates);
  await flush();
 }
 async function run() {
  let nextIdentityAttemptAt=0;
  while(running) {
   if(!state.username&&Date.now()>=nextIdentityAttemptAt) {
    nextIdentityAttemptAt=Date.now()+Math.max(1,identityRetryMs);
    try {
     const identity=await api('getMe',{});
     await locked(async()=>{state.username=identity.username||null;await persist();});
     await api('setMyCommands',{commands:[{command:'start',description:'Увімкнути сповіщення'},{command:'group',description:'Обрати свою групу'},{command:'schedule',description:'Графіки на сьогодні та завтра'},{command:'stop',description:'Вимкнути сповіщення'}]}).catch(()=>{});
    } catch {if(running)console.warn('Telegram bot identity unavailable; will retry (credentials omitted).');}
   }
   if(!running)break;
   try {await pollOnce();}
   catch {if(running)console.warn('Telegram polling unavailable; will retry (credentials omitted).');}
   if(running)await new Promise(resolve=>{retryResolve=resolve;retryTimer=setTimeout(()=>{retryResolve=null;retryTimer=null;resolve();},1000);retryTimer.unref?.();});
  }
 }
 return {
  enabled:true,getUsername:()=>state.username,
  start(){if(!running){running=true;loopPromise=run();}},
  async stop(){running=false;for(const controller of controllers)controller.abort();if(retryTimer){clearTimeout(retryTimer);retryTimer=null;retryResolve?.();retryResolve=null;}await Promise.allSettled([loopPromise,flushing].filter(Boolean));await serial;},
  notify,flush,pollOnce
 };
}
