import test from 'node:test';
import assert from 'node:assert/strict';
import {pushEvents} from './push.js';

const now=new Date('2026-11-14T18:00:00Z');
const today={date:'2026-11-14',groups:{'4.2':[true,false]}};
const tomorrow={date:'2026-11-15',groups:{'4.2':[true,false]}};
const before={region:'o',current:{days:[today]},emergency:{active:true,kind:'unplanned',message:'Зникло світло'}};

test('FCM routes a new schedule to its queue and ignores equivalent alerts',()=>{
 const after={...before,current:{days:[today,tomorrow]},emergency:{...before.emergency,message:'Зникло  світло'}};
 assert.deepEqual(pushEvents(before,after,now),[{
  topic:'schedule-o-4.2',region:'o',group:'4.2',type:'publication',body:'Додано графік на 15-11-2026 · черга 4.2'
 }]);
});

test('FCM sends regional alert clearance without emitting stale schedules',()=>{
 const after={...before,error:'offline',current:{days:[today,tomorrow]},emergency:{active:false}};
 assert.deepEqual(pushEvents(before,after,now),[{
  topic:'notice-o',region:'o',type:'clearance',body:'Оператор зняв попередження про відключення.'
 }]);
 assert.deepEqual(pushEvents(before,{...after,emergency:{active:false,stale:true}},now),[]);
});
