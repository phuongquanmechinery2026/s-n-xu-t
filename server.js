#!/usr/bin/env node
/* ================================================================
   server.js — MAY CHU WEB cho "Nha May San Xuat Phuong Quan"
   ----------------------------------------------------------------
   Chay tren Render (Linux, khong PowerShell). Cung dung 1 API y het
   server.ps1 (ban chay tren may Windows) nen claude-shim.js va
   app.html giu nguyen, khong sua 1 dong nao.
   (File nay chi dung ky tu ASCII trong code de an toan moi moi truong.)
   ================================================================ */
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// Sheet Dien cong khai (khong can dang nhap) - Render tu tai truc tiep tu
// Google, khoi phai dua file .xlsx 48MB vao git. Sheet Co khi la rieng tu,
// KHONG the tai kieu nay (van phai tha file thu cong nhu truoc).
const ELECTRIC_SHEET_ID = '1wANQ2lRELrHSlTb5QcwQVOXEeqTZgCogv0iW6ptpCok';
function fetchToFile(url, destPath, redirectsLeft) {
  redirectsLeft = redirectsLeft == null ? 5 : redirectsLeft;
  return new Promise(function (resolve, reject) {
    https.get(url, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume();
        return resolve(fetchToFile(res.headers.location, destPath, redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' tu Google'));
      }
      const tmp = destPath + '.downloading';
      const out = fs.createWriteStream(tmp);
      let bytes = 0;
      res.on('data', function (c) { bytes += c.length; });
      res.pipe(out);
      out.on('finish', function () {
        out.close(function () {
          try { fs.renameSync(tmp, destPath); } catch (e) { return reject(e); }
          resolve(bytes);
        });
      });
      out.on('error', reject);
      res.on('error', reject);
    }).on('error', reject);
  });
}

const PORT = process.env.PORT || 8756;
const ROOT = __dirname;
// Mac dinh luu ngay canh code (mat khi Render deploy lai / doi host —
// dung nut "Tai sao luu" thuong xuyen). Neu co gan Persistent Disk tra
// phi, dat bien moi truong DATA_DIR=/data de du lieu khong bao gio mat.
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

function tryRead(p, enc) { try { return fs.readFileSync(p, enc); } catch (e) { return null; } }

const APP_HTML_RAW = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');
const APP_HTML = Buffer.from(
  APP_HTML_RAW.indexOf('</body></html>') >= 0
    ? APP_HTML_RAW.replace('</body></html>', '<script src="/backup-widget.js" defer></script>\n</body></html>')
    : APP_HTML_RAW + '<script src="/backup-widget.js" defer></script>',
  'utf8'
);
const SHIM_JS = fs.readFileSync(path.join(ROOT, 'claude-shim.js'));
const BACKUP_JS = tryRead(path.join(ROOT, 'backup-widget.js'));
const ICON_PNG = tryRead(path.join(ROOT, 'icon.png'));
const ICON_ICO = tryRead(path.join(ROOT, 'icon.ico'));

let revs = {};
function getRev(name) { if (!(name in revs)) revs[name] = 1; return revs[name]; }
function bumpRev(name) { revs[name] = getRev(name) + 1; }

function collPath(name) { return path.join(DATA_DIR, name + '.json'); }
function loadColl(name) {
  const f = collPath(name);
  const txt = tryRead(f, 'utf8');
  if (txt && txt.trim()) { try { return JSON.parse(txt); } catch (e) {} }
  return {};
}
function saveColl(name, obj) {
  const f = collPath(name);
  const txt = JSON.stringify(obj);
  fs.writeFileSync(f + '.tmp', txt, 'utf8');
  if (fs.existsSync(f)) { try { fs.copyFileSync(f, f + '.bak'); } catch (e) {} }
  fs.renameSync(f + '.tmp', f);
  try {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
    fs.writeFileSync(path.join(BACKUP_DIR, name + '-' + stamp + '.json'), txt, 'utf8');
    const keep = /^(electric|cokhi|vtimg)/.test(name) ? 4 : 30;
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(function (f2) { return f2.indexOf(name + '-') === 0 && f2.endsWith('.json'); })
      .map(function (f2) { return { f: f2, t: fs.statSync(path.join(BACKUP_DIR, f2)).mtimeMs }; })
      .sort(function (a, b) { return b.t - a.t; });
    files.slice(keep).forEach(function (x) { try { fs.unlinkSync(path.join(BACKUP_DIR, x.f)); } catch (e) {} });
  } catch (e) {}
  bumpRev(name);
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function sendBytes(res, status, type, bytes) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(bytes);
}
function sendText(res, status, s) { sendBytes(res, status, 'text/plain; charset=utf-8', s); }

function readBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    req.on('data', function (c) { chunks.push(c); });
    req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

// Zalo Bot: nhan yeu cau xuat hang tu nhom vat tu (xem zalo.js)
// Dang ky / dang nhap / lich su chinh sua (xem auth.js). Chua co tai khoan chu thi moi thu mo nhu cu.
const auth = require('./auth.js')({ loadColl: loadColl, saveColl: saveColl, readBody: readBody, sendJson: sendJson, sendBytes: sendBytes, DATA_DIR: DATA_DIR });
const zalo = require('./zalo.js')({ loadColl: loadColl, saveColl: saveColl, readBody: readBody, sendJson: sendJson, sendBytes: sendBytes, DATA_DIR: DATA_DIR, sessionOf: auth.sessionOf, authOn: auth.authOn });

// Lam sach chu trong vat tu truoc khi luu: chu tieng Viet chuan NFC, bo xuong dong trong o (copy tu Sheet hay co "\n" lam dinh chu: "80\ndày" -> "80dày")
function cleanOrderDoc(o) {
  if (!o || typeof o !== 'object' || !Array.isArray(o.materials)) return o;
  o.materials.forEach(function (m) {
    if (!m || typeof m !== 'object') return;
    ['name', 'spec', 'note', 'supplier', 'unit'].forEach(function (f) {
      if (typeof m[f] === 'string') { let v = m[f].normalize('NFC'); if (v.indexOf('\n') >= 0 || v.indexOf('\r') >= 0) v = v.replace(/\s*[\r\n]+\s*/g, ' ').replace(/ {2,}/g, ' ').trim(); m[f] = v; }
    });
  });
  return o;
}

const server = http.createServer(function (req, res) {
  Promise.resolve().then(async function () {
    const u = new URL(req.url, 'http://x');
    const p = decodeURIComponent(u.pathname);
    const method = req.method;

    if (p === '/' || p === '/index.html' || p === '/app.html') {
      return sendBytes(res, 200, 'text/html; charset=utf-8', APP_HTML);
    }
    if (p === '/_local/claude-shim.js' || p === '/claude-shim.js') {
      return sendBytes(res, 200, 'application/javascript; charset=utf-8', SHIM_JS);
    }
    if (p === '/backup-widget.js') {
      if (BACKUP_JS) return sendBytes(res, 200, 'application/javascript; charset=utf-8', BACKUP_JS);
      return sendText(res, 404, 'no backup-widget.js');
    }
    if (p === '/favicon.ico' || p === '/_local/icon.png') {
      if (ICON_PNG) return sendBytes(res, 200, 'image/png', ICON_PNG);
      return sendText(res, 404, 'no icon');
    }
    if (p === '/_local/icon.ico') {
      if (ICON_ICO) return sendBytes(res, 200, 'image/x-icon', ICON_ICO);
      return sendText(res, 404, 'no icon');
    }
    // Sheet Dien/Co khi (.xlsx) khong kem theo ban web (du lieu rieng) —
    // vao tab "Sheets tham khao" tha file .xlsx thu cong la duoc.
    if (p === '/_local/electric.xlsx' || p === '/_local/cokhi.xlsx') {
      const fn = path.basename(p);
      const f = path.join(ROOT, fn);
      const bytes = tryRead(f);
      if (bytes) return sendBytes(res, 200, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes);
      return sendText(res, 404, 'no sheet file');
    }

    if (p === '/login' || p === '/login/') return sendBytes(res, 200, 'text/html; charset=utf-8', auth.loginHtml());
    if (p.indexOf('/api/auth/') === 0) { if (await auth.handle(req, res, u, p, method)) return; }
    // Cong rieng cho Javis (tro li doc don moi tu Zalo roi them len web, danh dau VT da nhan).
    // KHONG XOA khoi nay khi sua server.js (da bi chep de mat 2 lan).
    // Khoa EXT_API_KEY tren Render (>= 16 ky tu); chua dat khoa thi cong nay tat.
    if (p.indexOf('/api/ext/') === 0) {
      const key = String(process.env.EXT_API_KEY || '').trim();
      const got = String(req.headers['x-ext-key'] || '');
      if (key.length < 16 || got.length !== key.length || !require('crypto').timingSafeEqual(Buffer.from(got), Buffer.from(key))) return sendJson(res, 403, { error: 'forbidden' });
      req.nmsxUser = { username: 'javis', name: 'Javis (trợ lí)' };
      let mx;
      if ((mx = p.match(/^\/api\/ext\/order\/([^/]+)$/)) && method === 'GET') {
        const O = loadColl('orders'); const id = decodeURIComponent(mx[1]);
        return sendJson(res, 200, { exists: Object.prototype.hasOwnProperty.call(O, id), data: O[id] || null });
      }
      if (p === '/api/ext/order' && method === 'POST') {
        const b = JSON.parse((await readBody(req)) || '{}'); const o = b.order;
        if (!o || typeof o !== 'object' || !/^(D-)?\d{4}-\d{2,4}[A-Za-z0-9-]*$/.test(String(o.id || '')) || !o.code) return sendJson(res, 400, { error: 'thieu id/code hop le' });
        const O = loadColl('orders');
        const old = Object.prototype.hasOwnProperty.call(O, o.id) ? O[o.id] : null;
        // replace chi cho don do chinh Javis tao (extBy hoac ghi chu 'Javis them'), khong dong toi don cua nguoi
        const mine = !!old && (old.extBy === 'javis' || /Javis thêm/.test(String(old.note || '')));
        if (old && !(b.replace && mine)) return sendJson(res, 409, { exists: true, id: o.id, replaceable: mine });
        o.extBy = 'javis'; cleanOrderDoc(o); O[o.id] = o; saveColl('orders', O);
        auth.record(req, 'orders', o.id, old, o);
        return sendJson(res, 200, { ok: true, id: o.id });
      }
      if (p === '/api/ext/material' && method === 'POST') {
        // Danh dau 1 dong VT: { orderId, index, name, status, noteAdd }. name phai khop dong do (chong lech dong).
        const b = JSON.parse((await readBody(req)) || '{}');
        const ok = ['Đã nhận', 'Đã có', 'Đã đặt', 'Đã đặt mua', 'Đang gia công'];
        if (ok.indexOf(b.status) < 0) return sendJson(res, 400, { error: 'status khong hop le' });
        const O = loadColl('orders'); const o = O[String(b.orderId || '')];
        if (!o) return sendJson(res, 404, { error: 'khong co don' });
        const m = (o.materials || [])[b.index];
        const nk = function (x) { return String(x || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim(); };
        if (!m || m.section || nk(m.name) !== nk(b.name)) return sendJson(res, 409, { error: 'dong VT khong khop', name: m ? m.name : null });
        const before = auth.clone(o);
        m.status = b.status;
        if (b.noteAdd) m.note = (m.note ? m.note + '; ' : '') + String(b.noteAdd).slice(0, 200);
        cleanOrderDoc(o); saveColl('orders', O);
        auth.record(req, 'orders', o.id, before, o);
        return sendJson(res, 200, { ok: true, id: o.id, material: m });
      }
      if (p === '/api/ext/chats' && method === 'GET') return sendJson(res, 200, { chats: zalo.ext.chats() });
      // Xem truoc bao cao tuan (thu Hai toi) de Javis lam demo cho chu duyet
      if (p === '/api/ext/week/preview' && method === 'GET') return sendJson(res, 200, zalo.ext.weekPreview());
      if (p === '/api/ext/week/preview.png' && method === 'GET') return sendBytes(res, 200, 'image/png', zalo.ext.weekPng());
      if (p === '/api/ext/notify' && method === 'POST') {
        const b = JSON.parse((await readBody(req)) || '{}');
        if (!b.chatId || !b.text) return sendJson(res, 400, { error: 'thieu chatId/text' });
        const r = await zalo.ext.send(b.chatId, b.text);
        return sendJson(res, 200, { ok: !!(r && !r.error && r.status === 200), zalo: r });
      }
      return sendJson(res, 404, { error: 'not found' });
    }
    if (p.indexOf('/api/') === 0) {
      const g = auth.allow(req, p, method);
      if (!g.ok) return sendJson(res, g.status, { error: g.error, needLogin: g.status === 401, perm: !!g.perm });
    }

    if (p === '/api/ping') return sendJson(res, 200, { ok: true, app: 'nmsx-pq', port: PORT, env: 'render' });

    // Tai lai Sheet Dien truc tiep tu Google (cong khai, khong can dang nhap)
    // xuong dung vi tri /_local/electric.xlsx tren may chu Render — de nut
    // "Nap tu file co san tren may chu" trong app hoat dong y het ban may.
    if (p === '/api/fetch-electric' && (method === 'POST' || method === 'GET')) {
      try {
        const bytes = await fetchToFile(
          'https://docs.google.com/spreadsheets/d/' + ELECTRIC_SHEET_ID + '/export?format=xlsx',
          path.join(ROOT, 'electric.xlsx')
        );
        return sendJson(res, 200, { ok: true, bytes: bytes });
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: String((e && e.message) || e) });
      }
    }

    if (p.indexOf('/api/zalo/') === 0) { if (await zalo.handle(req, res, u, p, method)) return; }

    let m;
    if ((m = p.match(/^\/api\/rev\/([^/]+)$/))) return sendJson(res, 200, { rev: getRev(m[1]) });

    if ((m = p.match(/^\/api\/coll\/([^/]+)$/))) {
      const c = m[1];
      if (method === 'GET') return sendJson(res, 200, { rev: getRev(c), docs: loadColl(c) });
      if (method === 'PUT') {
        const body = await readBody(req);
        const data = body.trim() ? JSON.parse(body) : {};
        if (c === 'orders') Object.keys(data).forEach(function (k) { cleanOrderDoc(data[k]); });
        { const dn = auth.canBulk(req, c); if (dn) return sendJson(res, 403, { error: dn, perm: true }); }
        const mode = u.searchParams.get('mode') || 'replace';
        const prev = auth.authOn() ? loadColl(c) : null;
        if (mode === 'merge') { const cur = loadColl(c); Object.assign(cur, data); saveColl(c, cur); if (prev) auth.recordBulk(req, c, prev, cur); }
        else { saveColl(c, data); if (prev) auth.recordBulk(req, c, prev, data); }
        return sendBytes(res, 204, 'text/plain', Buffer.alloc(0));
      }
    }

    if ((m = p.match(/^\/api\/doc\/([^/]+)\/(.+)$/))) {
      const c = m[1], id = m[2];
      const data = loadColl(c);
      if (method === 'GET') {
        const has = Object.prototype.hasOwnProperty.call(data, id);
        return sendJson(res, 200, { exists: has, data: has ? data[id] : null });
      }
      if (method === 'DELETE') {
        if (Object.prototype.hasOwnProperty.call(data, id)) { const old = data[id]; { const dn = auth.canWrite(req, c, id, old, null, 'DELETE'); if (dn) return sendJson(res, 403, { error: dn, perm: true }); } delete data[id]; saveColl(c, data); auth.record(req, c, id, old, null); }
        return sendBytes(res, 204, 'text/plain', Buffer.alloc(0));
      }
      if (method === 'PUT') {
        const body = await readBody(req);
        const patch = body.trim() ? JSON.parse(body) : {};
        if (c === 'orders') cleanOrderDoc(patch);
        const mode = u.searchParams.get('mode') || 'set';
        const before = auth.authOn() && data[id] != null ? auth.clone(data[id]) : null;
        if (auth.authOn()) { const ex = data[id] != null ? data[id] : null; const af = (mode === 'update' && ex && typeof ex === 'object') ? Object.assign({}, ex, patch) : patch; const dn = auth.canWrite(req, c, id, ex, af, 'PUT'); if (dn) return sendJson(res, 403, { error: dn, perm: true }); }
        if (mode === 'update' && data[id] && typeof data[id] === 'object') Object.assign(data[id], patch);
        else data[id] = patch;
        saveColl(c, data);
        auth.record(req, c, id, before, data[id]);
        return sendBytes(res, 204, 'text/plain', Buffer.alloc(0));
      }
    }

    // Sao luu / phuc hoi toan bo kho du lieu — AN TOAN cho ban web khi
    // chua gan Persistent Disk (Render free co the mat dia bat cu luc nao
    // deploy lai). "backup-widget.js" goi 2 duong nay.
    if (p === '/api/export' && method === 'GET') {
      const names = fs.readdirSync(DATA_DIR).filter(function (f) { return f.endsWith('.json'); }).map(function (f) { return f.slice(0, -5); });
      const out = {};
      names.forEach(function (n) { if (n !== 'sessions') out[n] = loadColl(n); });
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="nmsx-sao-luu-' + new Date().toISOString().slice(0, 10) + '.json"',
        'Cache-Control': 'no-store'
      });
      return res.end(JSON.stringify(out));
    }
    if (p === '/api/import' && method === 'POST') {
      const body = await readBody(req);
      const obj = JSON.parse(body);
      Object.keys(obj).forEach(function (n) { if (n !== 'sessions') saveColl(n, obj[n] || {}); });
      auth.invalidate();
      return sendJson(res, 200, { ok: true, collections: Object.keys(obj) });
    }

    sendText(res, 404, 'Not found');
  }).catch(function (e) {
    try { sendJson(res, 500, { error: String((e && e.message) || e) }); } catch (e2) {}
  });
});

server.listen(PORT, '0.0.0.0', function () {
  console.log('Nha May San Xuat Phuong Quan - web server dang chay tren cong ' + PORT);
  console.log('Du lieu luu tai: ' + DATA_DIR);
});
