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

    let m;
    if ((m = p.match(/^\/api\/rev\/([^/]+)$/))) return sendJson(res, 200, { rev: getRev(m[1]) });

    if ((m = p.match(/^\/api\/coll\/([^/]+)$/))) {
      const c = m[1];
      if (method === 'GET') return sendJson(res, 200, { rev: getRev(c), docs: loadColl(c) });
      if (method === 'PUT') {
        const body = await readBody(req);
        const data = body.trim() ? JSON.parse(body) : {};
        const mode = u.searchParams.get('mode') || 'replace';
        if (mode === 'merge') { const cur = loadColl(c); Object.assign(cur, data); saveColl(c, cur); }
        else saveColl(c, data);
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
        if (Object.prototype.hasOwnProperty.call(data, id)) { delete data[id]; saveColl(c, data); }
        return sendBytes(res, 204, 'text/plain', Buffer.alloc(0));
      }
      if (method === 'PUT') {
        const body = await readBody(req);
        const patch = body.trim() ? JSON.parse(body) : {};
        const mode = u.searchParams.get('mode') || 'set';
        if (mode === 'update' && data[id] && typeof data[id] === 'object') Object.assign(data[id], patch);
        else data[id] = patch;
        saveColl(c, data);
        return sendBytes(res, 204, 'text/plain', Buffer.alloc(0));
      }
    }

    // Sao luu / phuc hoi toan bo kho du lieu — AN TOAN cho ban web khi
    // chua gan Persistent Disk (Render free co the mat dia bat cu luc nao
    // deploy lai). "backup-widget.js" goi 2 duong nay.
    if (p === '/api/export' && method === 'GET') {
      const names = fs.readdirSync(DATA_DIR).filter(function (f) { return f.endsWith('.json'); }).map(function (f) { return f.slice(0, -5); });
      const out = {};
      names.forEach(function (n) { out[n] = loadColl(n); });
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
      Object.keys(obj).forEach(function (n) { saveColl(n, obj[n] || {}); });
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
