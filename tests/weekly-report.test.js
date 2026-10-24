'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const report = require('../report');
const base = '2026-10-26';
function order(id, due, status) {
  return { id: id, code: id, items: [{ name: 'Máy thử ' + id, status: status || 'ĐANG SẢN XUẤT' }], sched: { ship: due }, materials: [{ name: 'KHONG_DUOC_DANG_VAT_TU' }] };
}
async function main() {
  const orders = {
    warehouseOnly: { id: 'NX', code: 'NX', customerInfo: 'Vật tư nhà xưởng', items: [], materials: [{ name: 'Kho' }] },
    late: order('2026-101', '2026-10-20'),
    soon: order('2026-102', '2026-10-29'),
    later: order('2026-103', '2026-12-20'),
    undated: order('2026-104', ''),
    delivered: order('2026-105', '2026-10-29', 'ĐÃ GIAO'),
    held: Object.assign(order('2026-106', '2026-10-29'), { hold: { since: '2026-10-20' } })
  };
  const d = report.buildData(orders, {}, base);
  assert.deepStrictEqual(d.P.map(p => p.code), ['2026-102']);
  assert.strictEqual(d.pending.length, 4);
  assert.strictEqual(d.over, 1);
  assert.strictEqual(d.held, 1);
  const m = report.messages(d);
  ['2026-101', '2026-102', '2026-103', '2026-104'].forEach(code => assert(m.tin2.includes(code)));
  assert(!m.tin2.includes('2026-105'));
  assert(!m.tin2.includes('KHONG_DUOC_DANG_VAT_TU'));
  assert(!d.pending.some(p => p.code === 'NX'));
  assert(m.tin2.includes('chưa có ngày giao'));
  const png = report.dashboardPng(d);
  assert.strictEqual(png.readUInt32BE(16), 1080);
  let calls = [], failText = true, failPhoto = false;
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', b => { body += b; }); req.on('end', () => {
      const msg = JSON.parse(body); calls.push({ method: req.url, msg: msg });
      const bad = (req.url.endsWith('/sendPhoto') && failPhoto) || (req.url.endsWith('/sendMessage') && failText);
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: !bad }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const saved = { token: process.env.ZALO_BOT_TOKEN, url: process.env.ZALO_API_BASE };
  process.env.ZALO_BOT_TOKEN = 'test-only';
  process.env.ZALO_API_BASE = 'http://127.0.0.1:' + server.address().port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pq-week-'));
  const db = { orders: orders, tasks: {}, zalo_meta: { remind: { week: {} } } };
  const intervals = [], nativeInterval = global.setInterval;
  global.setInterval = function (fn, ms) { const h = nativeInterval(fn, ms); intervals.push(h); return h; };
  let api;
  try { api = require('../zalo')({ DATA_DIR: dir, loadColl: k => db[k] || {}, saveColl: (k, v) => { db[k] = v; } }); }
  finally { global.setInterval = nativeInterval; intervals.forEach(clearInterval); }
  try {
    const material = { name: 'Bạc đạn 22214', qty: 4, unit: 'cái' };
    const stock = api._test.stockFor(material, [{ c: '22214', n: 'Bạc đạn 22214', u: 'cái', q: 2, wh: 'Kho Cơ khí' }]);
    assert.strictEqual(stock.st, 'thieu');
    assert.strictEqual(stock.shortage, 2);
    const item = Object.assign({}, material, { stock: stock });
    assert(api._test.stockLine(item).includes('cần thêm 2'));
    assert(api._test.buyLine({ items: [item] }).includes('thủ kho'));
    assert(api._test.buyLine({ items: [item] }).includes('@Chú 9'));
    const enough = api._test.stockFor(material, [{ c: '22214', n: 'Bạc đạn 22214', u: 'cái', q: 8, wh: 'Kho Cơ khí' }]);
    assert.strictEqual(enough.st, 'co');
    assert(!api._test.buyLine({ items: [{ stock: enough }] }).includes('@Chú 9'));
    assert.strictEqual(api._test.stockFor(material, []), null);
    assert.strictEqual(api._test.stockFor(material, [{ c: '22215', n: 'Bạc đạn 22215', q: 8 }]).st, 'khong');
    const chunks = api._test.reportChunks(('x'.repeat(1600) + '\n').repeat(8));
    assert(chunks.length > 1 && chunks.every(t => t.length <= 1700));
    await assert.rejects(api._test.weekSend('test-group', true), /lỗi tin chữ/);
    assert.strictEqual(db.zalo_meta.remind.week.delivery.photo, true);
    assert.strictEqual(db.zalo_meta.remind.week.delivery.parts, 0);
    failText = false;
    const sent = await api._test.weekSend('test-group', true);
    assert(sent.parts >= 2);
    assert.strictEqual(calls.filter(c => c.method.endsWith('/sendPhoto')).length, 1);
    const before = calls.length;
    await api._test.weekSend('test-group', true);
    assert.strictEqual(calls.length, before);
    failPhoto = true;
    await assert.rejects(api._test.weekSend('another-test-group', true), /ảnh báo cáo/);
    assert.strictEqual(db.zalo_meta.remind.week.delivery.parts, 0);
    console.log('PASS: pending/overdue/undated/exclusion, PNG, long messages, failed text/photo and resumable delivery');
  } finally {
    server.close();
    if (saved.token === undefined) delete process.env.ZALO_BOT_TOKEN; else process.env.ZALO_BOT_TOKEN = saved.token;
    if (saved.url === undefined) delete process.env.ZALO_API_BASE; else process.env.ZALO_API_BASE = saved.url;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
