import test from 'node:test';
import assert from 'node:assert/strict';
import {schedulesResponse,compactDays} from './api.js';
const now=Date.parse('2026-11-13T20:00:00Z');
const snapshot={region:'o',current:{receivedAt:'2026-11-13T20:00:00Z',days:[{date:'2026-11-13',groups:{'1.1':Array(48).fill(true)}},{date:'2026-11-14',groups:{'1.1':Array(48).fill(false)}}]},checkedAt:'2026-11-13T20:00:00Z',lastSuccess:'2026-11-13T20:00:00Z',error:null,api:{refreshIntervalSeconds:120,nextRefreshAt:'2026-11-13T20:02:00Z'},emergency:{active:false},source:'https://example.test'};
const request=(query='',state=snapshot,extra={})=>schedulesResponse(new URL('http://local/api/v1/schedules'+query),state,{now,...extra});
test('cached API filters group/date without mutating saved state and publishes refresh metadata',()=>{
 const result=request('?date=2026-11-14&group=1.1');
 assert.equal(result.status,200);const json=JSON.parse(result.body);
 assert.equal(json.days.length,1);assert.equal(json.days[0].date,'2026-11-14');
 assert.equal(json.format,'compact');
 assert.deepEqual(json.days[0].schedules,[{groups:['1.1'],off:[['00:00','24:00']]}]);
 assert.equal(json.refreshIntervalSeconds,120);assert.equal(result.headers['Retry-After'],'120');
 assert.equal(snapshot.current.days.length,2);
});
test('API handles validation, missing dates, missing source data and stale cache',()=>{
 assert.equal(request('?date=2026-02-30').status,400);
 assert.equal(request('?group=9.9').status,400);
 assert.equal(request('?format=verbose').status,400);
 assert.equal(request('?date=2026-11-15').status,404);
 assert.equal(request('',{...snapshot,current:null}).status,503);
 const stale=request('',{...snapshot,error:'Upstream unavailable'});
 assert.equal(stale.status,200);assert.equal(JSON.parse(stale.body).stale,true);
 assert.match(stale.headers['Cache-Control'],/max-age=0/);
});

test('slots opt-in preserves the original group arrays and has its own ETag',()=>{
 const result=request('?format=slots');const json=JSON.parse(result.body);
 assert.equal(json.format,'slots');assert.deepEqual(json.days,snapshot.current.days);
 assert.notEqual(result.headers.ETag,request().headers.ETag);
});

const slotIndex=value=>{const [hour,minute]=value.split(':').map(Number);return hour*2+minute/30;};
function expand(day){
 const groups={};
 for(const schedule of day.schedules){
  const slots=Array(48).fill(true);
  for(const [field,value] of [['off',false],['unknown',null]]){
   for(const [start,end] of schedule[field]??[])slots.fill(value,slotIndex(start),slotIndex(end));
  }
  for(const group of schedule.groups)groups[group]=[...slots];
 }
 return {date:day.date,groups};
}

test('compact intervals losslessly encode on, off and unknown slots across day boundaries',()=>{
 const profiles=[Array(48).fill(true),Array(48).fill(false),Array(48).fill(null),
  Array.from({length:48},(_,i)=>i<2?null:i<7?false:i<24?true:i%3===0?null:i%3===1?false:true)];
 const day={date:'2026-11-14',groups:Object.fromEntries(profiles.map((slots,i)=>[`${i+1}.1`,slots]))};
 const [compact]=compactDays([day]);
 assert.deepEqual(expand(compact),day);
 assert.deepEqual(compact.schedules[0],{groups:['1.1'],off:[]});
 assert.deepEqual(compact.schedules[1].off,[['00:00','24:00']]);
 assert.deepEqual(compact.schedules[2].unknown,[['00:00','24:00']]);
 assert.deepEqual(compact.schedules[3].off[0],['01:00','03:30']);
});

test('identical complete profiles share one schedule and group filtering happens first',()=>{
 const slots=Array.from({length:48},(_,i)=>i>=16&&i<23?false:true);
 const day={date:'2026-11-14',groups:{'1.1':slots,'1.2':[...slots],'2.1':Array(48).fill(true)}};
 const custom={...snapshot,current:{...snapshot.current,days:[day]}};
 const json=JSON.parse(request('',custom).body);
 assert.deepEqual(json.days[0].schedules,[{groups:['1.1','1.2'],off:[['08:00','11:30']]},{groups:['2.1'],off:[]}]);
 assert.deepEqual(expand(json.days[0]),day);
 const filtered=JSON.parse(request('?group=1.2',custom).body);
 assert.deepEqual(filtered.days[0].schedules,[{groups:['1.2'],off:[['08:00','11:30']]}]);
});

test('missing and malformed slots are unknown rather than silently scheduled on',()=>{
 const [day]=compactDays([{date:'2026-11-14',groups:{'1.1':[true,false,'yes'], '1.2':undefined}}]);
 assert.deepEqual(day.schedules,[
  {groups:['1.1'],off:[['00:30','01:00']],unknown:[['01:00','24:00']]},
  {groups:['1.2'],off:[],unknown:[['00:00','24:00']]}
 ]);
});
test('ETag allows unchanged snapshot conditional requests',()=>{
 const initial=request();const subsequent=request('',snapshot,{ifNoneMatch:initial.headers.ETag});
 assert.equal(subsequent.status,304);assert.equal(subsequent.body,'');
});
