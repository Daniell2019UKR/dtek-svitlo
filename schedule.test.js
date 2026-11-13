import test from 'node:test';
import assert from 'node:assert/strict';
import {normalize, mergeSchedules, scrape} from './schedule.js';
import {scheduleDates, currentSlot, outageHours} from './public/dates.js';
test('DTEK half-hour states and unknown hours',()=>{
 const [day]=normalize({data:{1794520800:{'GPV1.1':{'1':'yes','2':'no','3':'first','4':'second'}}}});
 assert.deepEqual(day.groups['1.1'].slice(0,10),[true,true,false,false,false,true,true,false,null,null]);
 assert.equal(day.groups['1.1'].length,48);assert.equal(Object.keys(day.groups).length,12);
});
test('missing data must not replace last good schedule',()=>{assert.throws(()=>normalize({data:{}}));});
import {extractFact} from './schedule.js';
test('extracts fact JSON without consuming following scripts',()=>{
 assert.deepEqual(extractFact('DisconSchedule.fact = {"data":{},"update":"brace } and \\\" quote"}; other = {};'),{data:{},update:'brace } and " quote'});
 assert.equal(extractFact('<html>unavailable</html>'),null);
});

const evening = new Date('2026-11-13T20:15:00Z'); // 22:15 Kyiv
const rawDay = state => ({'GPV1.1':Object.fromEntries(Array.from({length:24},(_,i)=>[i+1,state]))});
const timestamp = date => Date.parse(`${date}T00:00:00+02:00`)/1000;
const twoDays = () => normalize({data:{
 [timestamp('2026-11-14')]:rawDay('no'),
 [timestamp('2026-11-13')]:rawDay('yes')
}});

test('parses today and tomorrow independently in calendar order',()=>{
 const days=twoDays();
 assert.deepEqual(days.map(d=>d.date),['2026-11-13','2026-11-14']);
 assert.deepEqual(days[0].groups['1.1'],Array(48).fill(true));
 assert.deepEqual(days[1].groups['1.1'],Array(48).fill(false));
 assert.deepEqual(mergeSchedules(days,[],evening),{days,retainedDates:[]});
});

test('tomorrow-only response keeps saved today, without mutating it',()=>{
 const saved=twoDays();const snapshot=JSON.stringify(saved);
 const next=mergeSchedules([saved[1]],saved,evening);
 assert.deepEqual(next.days,saved);
 assert.deepEqual(next.retainedDates,['2026-11-13']);
 assert.equal(JSON.stringify(saved),snapshot);
 assert.deepEqual(mergeSchedules([saved[1]],[],evening).days,[saved[1]]);
});

test('unpublished placeholders and malformed dates do not overwrite saved data',()=>{
 const incoming=normalize({data:{
  [timestamp('2026-11-13')]:rawDay('unknown'),
  [timestamp('2026-11-14')]:rawDay('no'),
  invalid:rawDay('yes'),
  '9999999999999999999':rawDay('yes')
 }});
 assert.deepEqual(incoming.map(d=>d.date),['2026-11-14']);
 assert.deepEqual(mergeSchedules(incoming,twoDays(),evening).retainedDates,['2026-11-13']);
 assert.throws(()=>normalize({data:{[timestamp('2026-11-13')]:rawDay('unknown')}}));
});

test('fresh today replaces saved today and clears retained flag',()=>{
 const saved=twoDays();
 const fresh=normalize({data:{[timestamp('2026-11-13')]:rawDay('no')}});
 const result=mergeSchedules(fresh,saved,evening);
 assert.deepEqual(result.days[0],fresh[0]);
 assert.deepEqual(result.retainedDates,['2026-11-14']);
 assert.deepEqual(mergeSchedules(twoDays(),result.days,evening).retainedDates,[]);
});

test('midnight promotes tomorrow and drops expired dates',()=>{
 const saved=twoDays();const midnight=new Date('2026-11-13T22:00:00Z');
 assert.deepEqual(scheduleDates(new Date('2026-11-13T21:59:59Z')),['2026-11-13','2026-11-14']);
 assert.deepEqual(scheduleDates(midnight),['2026-11-14','2026-11-15']);
 const incoming=normalize({data:{[timestamp('2026-11-15')]:rawDay('yes')}});
 assert.deepEqual(mergeSchedules(incoming,saved,midnight).days.map(d=>d.date),['2026-11-14','2026-11-15']);
 assert.throws(()=>mergeSchedules([saved[0]],saved,midnight));
});

test('Kyiv date window works across year boundaries and both DST transitions',()=>{
 for (const [instant,dates] of [
  ['2026-12-31T22:00:00Z',['2027-01-01','2027-01-02']],
  ['2026-03-28T22:30:00Z',['2026-03-29','2026-03-30']],
  ['2026-10-24T21:30:00Z',['2026-10-25','2026-10-26']]
 ]) assert.deepEqual(scheduleDates(new Date(instant)),dates);
});

test('remaining outage counts only the unelapsed part of the current slot',()=>{
 assert.equal(currentSlot(evening),44.5);
 assert.equal(outageHours(Array(48).fill(false),44.5),1.75);
 assert.equal(outageHours(Array(48).fill(false)),24);
 assert.equal(outageHours([null,true,false],2.5),0.25);
});

test('browser fallback preserves an emergency-only page without fact data',async()=>{
 let closed=false,waited=false;
 const html='<div id="modal-attention"><p>У Одеському районі введені екстрені відключення.</p></div>';
 const browserType={launch:async()=>({
  newPage:async()=>({goto:async()=>{},content:async()=>html,evaluate:async()=>null,waitForFunction:async()=>{waited=true;throw Error('No fact');}}),
  close:async()=>{closed=true;}
 })};
 const result=await scrape('o',{fetchImpl:async()=>new Response('dynamic shell'),browserType});
 assert.equal(result.emergency.active,true);assert.deepEqual(result.days,[]);
 assert.equal(closed,true);assert.equal(waited,false);
});
