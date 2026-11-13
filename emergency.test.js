import test from 'node:test';
import assert from 'node:assert/strict';
import {extractEmergency} from './emergency.js';

const page=body=>`<html><main class="discon_schedule">${body}</main><script>DisconSchedule.fact = {"data":{}}; if ($('#modal-attention').length) MicroModal.show('modal-attention');</script></html>`;
const modal=body=>`<div id="modal-attention" class="modal" aria-hidden="true"><div class="modal__container"><h2>Увага!</h2><div class="modal__body">${body}</div><button>Закрити</button></div></div>`;

test('does not mistake FAQ, scripts, templates or standard schedule hints for a current emergency',()=>{
 const body='<p>Чим відрізняються екстрені відключення?</p><div class="discon-schedule-alert">Екстрені відключення</div><template>'+modal('Екстрені відключення')+'</template><div id="modal-attention" hidden>Екстрені відключення</div><script>const sample = '+JSON.stringify(modal('Екстрені відключення'))+';</script>';
 assert.deepEqual(extractEmergency(page(body)),{active:false,message:null,areas:[]});
});

test('extracts published attention announcement and preserves district text',()=>{
 const result=extractEmergency(page(modal('<p>У <strong>Одеському та Подільському районах</strong> введені екстрені відключення.</p><p>Графіки не діють.&nbsp;Стежте за повідомленнями.</p>')));
 assert.equal(result.active,true);
 assert.equal(result.message,'Увага! У Одеському та Подільському районах введені екстрені відключення. Графіки не діють. Стежте за повідомленнями.');
 assert.deepEqual(result.areas,['Одеському та Подільському районах']);
 assert.doesNotMatch(result.message,/Закрити/);
});

test('non-emergency announcements and explicit cancellation do not activate the banner',()=>{
 for(const text of ['Тривають технічні роботи на сайті.','Екстрені відключення скасовано.','Скасовано екстрені відключення.','Екстрені відключення не застосовуються.','Відбій екстрених відключень.']) {
  assert.equal(extractEmergency(page(modal(text))).active,false);
 }
});

test('unknown or truncated response is not treated as a confirmed clear status',()=>{
 for(const html of ['', '<html>Access denied</html>', '<div id="modal-attention"><p>Екстрені відключення']) {
  assert.equal(extractEmergency(html).active,null);
 }
});

test('cancellation for one district never hides an active declaration for another',()=>{
 for(const text of [
  'У Одеському районі введені екстрені відключення, у Подільському районі екстрені відключення скасовано.',
  'Екстрені відключення скасовано у Подільському районі. У Одеському районі введено екстрені відключення.',
  'У Подільському районі скасовано екстрені відключення; у Одеському районі відключення тривають.',
  'У Одеському районі екстрені відключення тривають, але у Подільському районі скасовано екстрені відключення.'
 ]) {
  const result=extractEmergency(page(modal(text)));
  assert.equal(result.active,true,text);
  assert.ok(result.message.includes(text));
 }
});

test('restored scheduled operation does not look like an active emergency declaration',()=>{
 assert.equal(extractEmergency(page(modal('Екстрені відключення скасовано. Графіки знову діють.'))).active,false);
});

test('decodes numeric entities and excludes hidden template copy',()=>{
 const result=extractEmergency(page(modal('<p>Екстрені відключення в Одесі &#8212; графіки не діють.</p><p hidden>Старий текст</p><p style="display: none">Інший район</p>')));
 assert.equal(result.message,'Увага! Екстрені відключення в Одесі — графіки не діють.');
});
