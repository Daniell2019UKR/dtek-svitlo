import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import http from 'node:http';

const server=http.createServer(async(req,res)=>{
 try {
  const path=new URL(req.url,'http://localhost').pathname;
  const files={'/':'index.html','/app.js':'app.js','/dates.js':'dates.js','/style.css':'style.css'};
  if(!files[path]) {res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html; charset=utf-8'});
  res.end(await readFile(new URL(`../public/${files[path]}`,import.meta.url)));
 } catch {res.writeHead(500);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
server.unref();
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
try {
 const page=await browser.newPage({viewport:{width:1280,height:1000}});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.clock.install({time:new Date('2026-11-13T20:15:00Z')});
 const groups=Object.fromEntries(Array.from({length:12},(_,i)=>[
  `${Math.floor(i/2)+1}.${i%2+1}`,Array.from({length:48},(_,slot)=>slot%12<5?false:true)
 ]));
 let fixture={region:'o',source:'https://www.dtek-oem.com.ua/ua/shutdowns',
  current:{days:['2026-11-13','2026-11-14'].map(date=>({date,groups})),retainedDates:[]},
  previous:{days:['2026-11-13','2026-11-14'].map(date=>({date,groups:Object.fromEntries(Object.keys(groups).map(group=>[group,Array(48).fill(true)]))}))},
  emergency:{active:false,message:null,areas:[],checkedAt:'2026-11-13T20:15:00Z'},
  api:{refreshIntervalSeconds:120,nextRefreshAt:'2026-11-13T20:17:00Z',endpoint:'/api/v1/schedules'},
  telegramEnabled:true,telegramUsername:'dtekschedule_bot',
  checkedAt:'2026-11-13T20:15:00Z',lastSuccess:'2026-11-13T20:15:00Z'};
 await page.route('**/api/schedule',route=>route.fulfill({json:fixture}));
 await page.goto(process.env.UI_URL||`http://127.0.0.1:${server.address().port}`);
 await page.waitForSelector('.track');
 assert.deepEqual(await page.locator('h2').allTextContents(),['Сьогодні · 13 листопада','Завтра · 14 листопада']);
 assert.equal(await page.locator('.track').count(),24);
 assert.equal(await page.locator('.now').count(),12);
 assert.equal(await page.locator('.change-outline').count(),96);
 assert.equal(await page.locator('.change-outline').first().evaluate(el=>getComputedStyle(el).borderTopStyle),'solid');
 assert.equal(await page.locator('.change-outline').first().evaluate(el=>getComputedStyle(el).borderTopColor),'rgb(87, 255, 141)');
 await mkdir('artifacts',{recursive:true});
 await page.screenshot({path:'artifacts/two-days-desktop.png',fullPage:true});
 await page.selectOption('#group','2.1');
 assert.equal(await page.locator('.track').count(),2);
 assert.deepEqual(await page.locator('.group').allTextContents(),['2.1 •','2.1 •']);
 await page.reload();await page.waitForSelector('.track');
 assert.equal(await page.locator('#group').inputValue(),'2.1');
 assert.equal(await page.locator('.track').count(),2);
 assert.equal(await page.locator('a[href="https://github.com/Daniell2019UKR/dtek-svitlo"]').count(),1);
 assert.equal(await page.locator('#telegram a').getAttribute('href'),'https://t.me/dtekschedule_bot');
 assert.match(await page.locator('#api-status').textContent(),/21:17|22:17/);
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.equal(await page.locator('.scroll').evaluateAll(elements=>elements.every(el=>el.scrollWidth<=el.clientWidth)),true);
 assert.ok(await page.locator('.interval-pill.off').first().isVisible());
 await page.setViewportSize({width:320,height:700});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'artifacts/two-days-mobile.png',fullPage:true});

 fixture.emergency={active:true,message:'У Одеському та Подільському районах введені екстрені відключення. <script>alert(1)</script>',areas:['Одеському та Подільському районах'],checkedAt:'2026-11-13T20:15:00Z'};
 await page.reload();await page.waitForSelector('#emergency:not([hidden])');
 assert.match(await page.locator('#emergency-message').textContent(),/Одеському та Подільському/);
 assert.equal(await page.locator('#emergency script').count(),0);
 assert.match(await page.locator('#badge').textContent(),/Екстрені/);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 fixture.emergency.message='У Одеському та Подільському районах введені екстрені відключення.';
 await page.reload();await page.waitForSelector('#emergency:not([hidden])');
 await page.screenshot({path:'artifacts/emergency-mobile.png',fullPage:true});
 fixture.emergency.stale=true;
 await page.reload();await page.waitForSelector('#emergency:not([hidden])');
 assert.match(await page.locator('#emergency-status').textContent(),/Актуальність зараз не підтверджено/);
 fixture.emergency.stale=false;
 fixture.error='Не вдалося отримати графік';
 fixture.emergency.kind='unplanned';
 await page.reload();await page.waitForSelector('#emergency:not([hidden])');
 assert.match(await page.locator('#emergency-title').textContent(),/Аварійні/);
 assert.match(await page.locator('#emergency-status').textContent(),/Перевірено/);
 fixture.error=null;fixture.emergency={active:false,message:null,areas:[]};

 fixture.current.retainedDates=['2026-11-13'];
 await page.reload();await page.waitForSelector('.cached');
 assert.match(await page.locator('#badge').textContent(),/збережені/);
 fixture.current.days=fixture.current.days.slice(0,1);
 await page.reload();await page.waitForSelector('.empty');
 assert.match(await page.locator('.empty').textContent(),/на завтра/);

 fixture.current.days=['2026-11-13','2026-11-14'].map(date=>({date,groups}));
 fixture.current.retainedDates=[];
 await page.reload();await page.waitForSelector('.track');
 await page.clock.setFixedTime(new Date('2026-11-13T22:00:00Z'));
 await page.clock.runFor(30000);
 assert.deepEqual(await page.locator('h2').allTextContents(),['Сьогодні · 14 листопада','Завтра · 15 листопада']);
 assert.equal(await page.locator('.track').count(),1);
 assert.match(await page.locator('.empty').textContent(),/на завтра/);
 assert.deepEqual(errors,[]);
 console.log('UI passed: both dates, persistent group filter, GitHub/bot links, mobile layout without horizontal scrolling, emergency and stale warning, cached/unpublished days, Kyiv midnight; no browser errors.');
} finally {await browser.close();server.close();}
