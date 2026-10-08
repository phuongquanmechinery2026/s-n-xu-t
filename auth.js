/* ================================================================
   auth.js - Dang ky / Dang nhap / Quan ly nguoi dung / Lich su chinh sua
   (cho ban web chay Node tren Render). Chua co tai khoan chu nao thi
   MOI THU GIU NGUYEN nhu cu (khong khoa ai). Nguoi dau tien dang ky la CHU.
   Tuong thich Node 8+.
   ================================================================ */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

module.exports = function (ctx) {
  const HOUR = 3600000, DAY = 86400000;
  let UC = null, SC = null;
  function users() { if (!UC) UC = ctx.loadColl('users'); return UC; }
  function sessions() { if (!SC) SC = ctx.loadColl('sessions'); return SC; }
  function saveUsers() { ctx.saveColl('users', users()); }
  function saveSessions() { ctx.saveColl('sessions', sessions()); }
  function invalidate() { UC = null; SC = null; }
  function authOn() { const U = users(); return Object.keys(U).some(function (k) { return U[k] && U[k].role === 'owner'; }); }

  /* ---------- tien ich ---------- */
  function hashPw(pw, salt) { return crypto.pbkdf2Sync(String(pw), salt, 120000, 32, 'sha256').toString('hex'); }
  function hashPin(pin, salt) { return crypto.pbkdf2Sync(String(pin), salt, 60000, 32, 'sha256').toString('hex'); }
  function newSalt() { return crypto.randomBytes(16).toString('hex'); }
  function safeEq(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }
  function sha(t) { return crypto.createHash('sha256').update(String(t)).digest('hex'); }
  function stripD(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D'); }
  function nameKey(s) { return stripD(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function ipOf(req) { const x = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(); return x || (req.socket && req.socket.remoteAddress) || '?'; }
  function vnDate(t) { return new Date((t || Date.now()) + 7 * HOUR).toISOString().slice(0, 10); }

  const COMMON = ['12345678', '123456789', '1234567890', 'password1', 'matkhau1', 'matkhau123', 'abc12345', 'qwerty123', 'admin123', 'admin1234', 'phuongquan1', 'phuongquan123', '11111111', '00000000', 'iloveyou1'];
  function validUsername(u) { return /^[a-z0-9][a-z0-9._]{2,19}$/.test(u); }
  function pwProblem(pw, username) {
    pw = String(pw || '');
    if (pw.length < 8) return 'Mật khẩu tối thiểu 8 ký tự.';
    if (pw.length > 100) return 'Mật khẩu quá dài (tối đa 100 ký tự).';
    if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Mật khẩu cần có cả chữ và số.';
    if (username && pw.toLowerCase() === username) return 'Mật khẩu không được trùng tên đăng nhập.';
    if (COMMON.indexOf(pw.toLowerCase()) >= 0) return 'Mật khẩu này quá dễ đoán, hãy chọn mật khẩu khác.';
    return '';
  }
  function cleanName(n) { return String(n || '').replace(/[<>"\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40); }

  /* ---------- chong do mat khau (bo nho) ---------- */
  const fails = {};
  function failsOf(key) { const now = Date.now(); const a = (fails[key] || []).filter(function (t) { return now - t < 10 * 60000; }); fails[key] = a; return a; }
  function addFail(key) { failsOf(key).push(Date.now()); const ks = Object.keys(fails); if (ks.length > 4000) ks.slice(0, 2000).forEach(function (k) { delete fails[k]; }); }
  function tooMany(req, username) { return failsOf('i:' + ipOf(req)).length >= 40 || failsOf('u:' + ipOf(req) + ':' + username).length >= 6 || failsOf('n:' + username).length >= 20; }
  function noteFail(req, username) { addFail('i:' + ipOf(req)); addFail('u:' + ipOf(req) + ':' + username); addFail('n:' + username); }

  /* ---------- phien dang nhap ---------- */
  function tokenOf(req) {
    const h = String(req.headers['authorization'] || '');
    let m = /^Bearer\s+([A-Za-z0-9_-]{20,120})$/.exec(h);
    if (m) return m[1];
    const x = String(req.headers['x-auth-token'] || '');
    if (/^[A-Za-z0-9_-]{20,120}$/.test(x)) return x;
    if (req.method === 'GET') { m = /[?&]_t=([A-Za-z0-9_-]{20,120})/.exec(req.url || ''); if (m) return m[1]; }
    return '';
  }
  function createSession(username, remember, req) {
    const token = crypto.randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    const S = sessions(), now = Date.now();
    Object.keys(S).forEach(function (k) { if (!S[k] || S[k].exp < now) delete S[k]; });
    const mine = Object.keys(S).filter(function (k) { return S[k].u === username; }).sort(function (a, b) { return S[a].created - S[b].created; });
    while (mine.length >= 8) delete S[mine.shift()];
    S[sha(token)] = { u: username, created: now, exp: now + (remember ? 30 * DAY : 12 * HOUR), ua: String(req.headers['user-agent'] || '').slice(0, 80) };
    saveSessions();
    return token;
  }
  function dropSessions(username, exceptHash) {
    const S = sessions(); let n = 0;
    Object.keys(S).forEach(function (k) { if (S[k] && S[k].u === username && k !== exceptHash) { delete S[k]; n++; } });
    if (n) saveSessions();
  }
  function sessionOf(req) {
    const t = tokenOf(req); if (!t) return null;
    const rec = sessions()[sha(t)]; if (!rec || rec.exp < Date.now()) return null;
    const u = users()[rec.u]; if (!u || u.status !== 'active') return null;
    return { username: u.username, name: u.name, role: u.role, _h: sha(t) };
  }
  function pub(u) { return { username: u.username, name: u.name, role: u.role, status: u.status, createdAt: u.createdAt, lastLogin: u.lastLogin || 0, createdBy: u.createdBy || '' }; }

  /* ---------- lich su chinh sua (nhat ky) ---------- */
  const SKIP = /^(sessions|users|ai_usage|ai_settings|zalo_log|zalo_meta|draw_cache|meta|electric|cokhi|vtimg)/;
  const GROUP = { orders: 'Đơn hàng', tasks: 'Công việc', purchase: 'Đề nghị mua', issues: 'Chi phí', xuathang: 'Xuất hàng', users: 'Tài khoản', auth: 'Đăng nhập' };
  const FIELD = { qty: 'SL', status: 'Trạng thái', supplier: 'NCC', note: 'Ghi chú', unit: 'ĐVT', spec: 'Quy cách', name: 'Tên', reqDate: 'Ngày cần', issuedTo: 'Cấp cho', requirement: 'Yêu cầu', qc: 'QC', cluster: 'Cụm', who: 'Người làm', team: 'Tổ', date: 'Ngày', start: 'Bắt đầu', prio: 'Ưu tiên', title: 'Tiêu đề', dept: 'Bộ phận', code: 'Mã', customerInfo: 'Khách hàng', no: 'STT', by: 'Người đề nghị', needDate: 'Cần trước ngày', orderId: 'Đơn', section: 'Cụm' };
  const ROWS = { materials: 'VT', items: 'Hạng mục', lines: 'Dòng', progress: 'Tiến độ' };
  const IGNORE = { updatedAt: 1, selfTestMark: 1, savedAt: 1, _rev: 1, at: 1, ts: 1, pdfRaw: 1, progressSnapshots: 1 };
  const MAXLINES = 14;
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function fv(v) { if (v == null || v === '') return '(trống)'; const s = (typeof v === 'object') ? JSON.stringify(v) : String(v); return s.length > 40 ? s.slice(0, 40) + '…' : s; }
  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
  function rowName(r) { return String(r.name || r.title || r.id || r.no || '?').slice(0, 40); }
  function rowKey(r) { return String(r.id || '') + '|' + String(r.no || '') + '|' + String(r.name || r.title || '') + '|' + String(r.spec || ''); }
  function scalarDiff(a, b, tag, out) {
    const ks = {}; Object.keys(a || {}).concat(Object.keys(b || {})).forEach(function (k) { ks[k] = 1; });
    Object.keys(ks).forEach(function (k) {
      if (IGNORE[k]) return;
      const x = a ? a[k] : undefined, y = b ? b[k] : undefined;
      if (same(x, y)) return;
      if (typeof x === 'object' && x !== null || typeof y === 'object' && y !== null) { out.push(tag + (FIELD[k] || k) + ' đã thay đổi'); return; }
      out.push(tag + (FIELD[k] || k) + ': ' + fv(x) + ' → ' + fv(y));
    });
  }
  function rowsDiff(label, A, B, out) {
    A = A || []; B = B || [];
    if (!A.every(isObj) || !B.every(isObj)) { if (!same(A, B)) out.push(label + ' đã thay đổi'); return; }
    const pool = {}; A.forEach(function (r, i) { const k = rowKey(r); (pool[k] = pool[k] || []).push(i); });
    const usedA = {}, addedB = [], matched = [];
    B.forEach(function (r, j) {
      const q = pool[rowKey(r)];
      if (q && q.length) { const i = q.shift(); usedA[i] = 1; matched.push([i, j]); return; }
      addedB.push(j);
    });
    matched.forEach(function (pr) { if (!same(A[pr[0]], B[pr[1]])) scalarDiff(A[pr[0]], B[pr[1]], label + ' "' + rowName(B[pr[1]]) + '": ', out); });
    const remA = []; A.forEach(function (r, i) { if (!usedA[i]) remA.push(i); });
    // ghep dong bi doi ten theo STT / id
    const pairs = [], remB = [];
    addedB.forEach(function (j) {
      const r = B[j], id = String(r.id || r.no || ''); let hit = -1;
      if (id) for (let t = 0; t < remA.length; t++) { const o = A[remA[t]]; if (String(o.id || o.no || '') === id) { hit = t; break; } }
      if (hit >= 0) { pairs.push([remA[hit], j]); remA.splice(hit, 1); } else remB.push(j);
    });
    pairs.forEach(function (pr) { scalarDiff(A[pr[0]], B[pr[1]], label + ' "' + rowName(B[pr[1]]) + '": ', out); });
    remB.forEach(function (j) { out.push('Thêm ' + label + ' "' + rowName(B[j]) + '"' + (B[j].qty != null && B[j].qty !== '' ? ' (SL ' + fv(B[j].qty) + ')' : '')); });
    remA.forEach(function (i) { out.push('Xóa ' + label + ' "' + rowName(A[i]) + '"'); });
  }
  function summarize(before, after) {
    const out = [];
    if (!isObj(before) || !isObj(after)) { if (!same(before, after)) out.push('Nội dung đã thay đổi'); return out; }
    const ks = {}; Object.keys(before).concat(Object.keys(after)).forEach(function (k) { ks[k] = 1; });
    Object.keys(ks).forEach(function (k) {
      if (IGNORE[k]) return;
      const x = before[k], y = after[k];
      if (same(x, y)) return;
      if (Array.isArray(x) || Array.isArray(y)) rowsDiff(ROWS[k] || k, x, y, out);
      else if (isObj(x) || isObj(y)) out.push((FIELD[k] || k) + ' đã thay đổi');
      else out.push((FIELD[k] || k) + ': ' + fv(x) + ' → ' + fv(y));
    });
    if (!same(before.progressSnapshots, after.progressSnapshots) && !out.length) out.push('Chụp tiến độ');
    return out;
  }
  function labelOf(c, id, doc) {
    const d = isObj(doc) ? doc : {};
    if (c === 'orders') return 'Đơn ' + (d.code || id) + (d.customerInfo ? ' — ' + String(d.customerInfo).slice(0, 50) : '');
    if (c === 'tasks') return String(d.title || id).slice(0, 80);
    return String(id) + (d.note ? ' — ' + String(d.note).slice(0, 50) : (d.by ? ' — ' + String(d.by).slice(0, 30) : ''));
  }
  function auditFile(t) { return path.join(ctx.DATA_DIR, 'audit-' + vnDate(t).slice(0, 7) + '.jsonl'); }
  function actorOf(req) { const s = req && req.nmsxUser; return s ? { u: s.username, n: s.name } : { u: '', n: '' }; }
  function writeAudit(e) {
    try { fs.appendFileSync(auditFile(e.t), JSON.stringify(e) + '\n', 'utf8'); } catch (er) {}
  }
  // goi tu server.js sau moi lan ghi 1 tai lieu
  function record(req, c, id, before, after) {
    if (!authOn() || SKIP.test(c)) return;
    let op, ch = [];
    if (before == null && after != null) { op = 'tạo'; } else if (after == null) { op = 'xóa'; } else {
      ch = summarize(before, after); if (!ch.length) return; op = 'sửa';
      if (ch.length > MAXLINES) { const more = ch.length - MAXLINES; ch = ch.slice(0, MAXLINES); ch.push('… và ' + more + ' thay đổi khác'); }
    }
    const a = actorOf(req);
    writeAudit({ t: Date.now(), u: a.u, n: a.n, op: op, c: c, id: String(id), lb: labelOf(c, id, after != null ? after : before), ch: ch });
  }
  function recordBulk(req, c, beforeAll, afterAll) {
    if (!authOn() || SKIP.test(c)) return;
    const ids = {}; Object.keys(beforeAll || {}).concat(Object.keys(afterAll || {})).forEach(function (k) { ids[k] = 1; });
    const changed = Object.keys(ids).filter(function (k) { return !same((beforeAll || {})[k], (afterAll || {})[k]); });
    if (!changed.length) return;
    if (changed.length > 40) {
      const a = actorOf(req);
      writeAudit({ t: Date.now(), u: a.u, n: a.n, op: 'ghi đè', c: c, id: '*', lb: 'Ghi đè hàng loạt ' + changed.length + ' mục', ch: [] });
      return;
    }
    changed.forEach(function (k) { record(req, c, k, (beforeAll || {})[k], (afterAll || {})[k]); });
  }
  function adminLog(req, op, target, text) {
    const a = actorOf(req);
    writeAudit({ t: Date.now(), u: a.u, n: a.n, op: op, c: 'users', id: target, lb: 'Tài khoản ' + target, ch: text ? [text] : [] });
  }
  function readAudit(q) {
    const files = fs.readdirSync(ctx.DATA_DIR).filter(function (f) { return /^audit-\d{4}-\d{2}\.jsonl$/.test(f); }).sort().reverse();
    const limit = Math.max(1, Math.min(300, parseInt(q.limit, 10) || 100)), offset = Math.max(0, parseInt(q.offset, 10) || 0);
    const needle = stripD(q.q || '').toLowerCase().trim();
    const from = q.from ? Date.parse(q.from + 'T00:00:00+07:00') : 0, to = q.to ? Date.parse(q.to + 'T23:59:59.999+07:00') : 0;
    const items = []; let skipped = 0, more = false;
    outer: for (let fi = 0; fi < files.length; fi++) {
      let lines; try { lines = fs.readFileSync(path.join(ctx.DATA_DIR, files[fi]), 'utf8').split('\n'); } catch (e) { continue; }
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i]) continue;
        let e; try { e = JSON.parse(lines[i]); } catch (er) { continue; }
        if (from && e.t < from) break outer;
        if (to && e.t > to) continue;
        if (q.u && e.u !== q.u) continue;
        if (q.c && e.c !== q.c) continue;
        if (needle && stripD(e.lb + ' ' + e.id + ' ' + (e.ch || []).join(' ') + ' ' + e.n + ' ' + e.u).toLowerCase().indexOf(needle) < 0) continue;
        if (skipped < offset) { skipped++; continue; }
        if (items.length >= limit) { more = true; break outer; }
        items.push(e);
      }
    }
    return { items: items, more: more };
  }

  /* ---------- API /api/auth/* ---------- */
  async function bodyJson(req) { try { const t = await ctx.readBody(req); return t.trim() ? JSON.parse(t) : {}; } catch (e) { return {}; } }
  function err(res, status, msg, code) { ctx.sendJson(res, status, { ok: false, error: msg, code: code || '' }); return true; }
  function ownerOf(req) { const s = req.nmsxUser || sessionOf(req); return s && s.role === 'owner' ? s : null; }

  async function handle(req, res, u, p, method) {
    const send = function (o) { ctx.sendJson(res, 200, o); return true; };
    if (p === '/api/auth/status' && method === 'GET') {
      return send({ ok: true, hasOwner: authOn() });
    }
    if (p === '/api/auth/me' && method === 'GET') {
      if (!authOn()) return send({ ok: true, auth: false });
      const s = sessionOf(req);
      if (!s) return err(res, 401, 'Cần đăng nhập', 'login');
      return send({ ok: true, auth: true, user: { username: s.username, name: s.name, role: s.role } });
    }
    if (p === '/api/auth/register' && method === 'POST') {
      const b = await bodyJson(req);
      const username = String(b.username || '').trim().toLowerCase(), name = cleanName(b.name), pw = String(b.password || '');
      if (failsOf('reg:' + ipOf(req)).length >= 8) return err(res, 429, 'Đăng ký quá nhiều lần, vui lòng thử lại sau.');
      if (name.length < 2) return err(res, 400, 'Nhập họ và tên (từ 2 ký tự).');
      if (!validUsername(username)) return err(res, 400, 'Tên đăng nhập 3–20 ký tự: chữ thường không dấu, số, dấu chấm hoặc gạch dưới (bắt đầu bằng chữ/số).');
      const pr = pwProblem(pw, username); if (pr) return err(res, 400, pr);
      if (pw !== String(b.password2 == null ? pw : b.password2)) return err(res, 400, 'Hai lần nhập mật khẩu không giống nhau.');
      const U = users();
      if (U[username]) { addFail('reg:' + ipOf(req)); return err(res, 409, 'Tên đăng nhập này đã có người dùng, hãy chọn tên khác.'); }
      const nk = nameKey(name);
      if (Object.keys(U).some(function (k) { return nameKey(U[k].name) === nk; })) return err(res, 409, 'Họ tên này đã có tài khoản. Nếu là bạn, hãy đăng nhập; nếu trùng tên người khác, thêm tên đệm/biệt danh.');
      const first = !authOn();
      const salt = newSalt();
      U[username] = { username: username, name: name, salt: salt, hash: hashPw(pw, salt), role: first ? 'owner' : 'user', status: first ? 'active' : 'pending', createdAt: Date.now(), lastLogin: first ? Date.now() : 0 };
      saveUsers(); addFail('reg:' + ipOf(req));
      if (first) { const token = createSession(username, true, req); return send({ ok: true, owner: true, token: token, user: { username: username, name: name, role: 'owner' } }); }
      return send({ ok: true, pending: true });
    }
    if (p === '/api/auth/login' && method === 'POST') {
      const b = await bodyJson(req);
      const username = String(b.username || '').trim().toLowerCase(), pw = String(b.password || '');
      if (tooMany(req, username)) return err(res, 429, 'Nhập sai quá nhiều lần. Vui lòng đợi 10 phút rồi thử lại.');
      const usr = users()[username];
      const ok = usr && safeEq(hashPw(pw, usr.salt), usr.hash);
      if (!ok) { noteFail(req, username); return err(res, 401, 'Sai tên đăng nhập hoặc mật khẩu.'); }
      if (usr.status === 'pending') return err(res, 403, 'Tài khoản đang chờ chủ nhà máy duyệt. Vui lòng quay lại sau.', 'pending');
      if (usr.status !== 'active') return err(res, 403, 'Tài khoản đã bị khóa. Liên hệ chủ nhà máy.', 'blocked');
      usr.lastLogin = Date.now(); saveUsers();
      const token = createSession(username, !!b.remember, req);
      req.nmsxUser = { username: usr.username, name: usr.name, role: usr.role };
      writeAudit({ t: Date.now(), u: usr.username, n: usr.name, op: 'đăng nhập', c: 'auth', id: username, lb: 'Đăng nhập', ch: [] });
      return send({ ok: true, token: token, user: { username: usr.username, name: usr.name, role: usr.role } });
    }
    if (p === '/api/auth/logout' && method === 'POST') {
      const t = tokenOf(req); if (t) { const S = sessions(); if (S[sha(t)]) { delete S[sha(t)]; saveSessions(); } }
      return send({ ok: true });
    }
    if (p === '/api/auth/owner-reset' && method === 'POST') {
      // Chu quen mat khau: dung ma PIN chu da dat trong "Han muc AI"
      const b = await bodyJson(req);
      if (failsOf('pin:' + ipOf(req)).length >= 5) return err(res, 429, 'Nhập sai quá nhiều lần. Vui lòng đợi 10 phút.');
      const cfg = (ctx.loadColl('ai_settings').cfg) || {};
      if (!cfg.ownerHash) return err(res, 400, 'Chưa đặt mã PIN chủ nên chưa dùng được cách này.');
      if (!safeEq(hashPin(String(b.pin || ''), cfg.ownerSalt), cfg.ownerHash)) { addFail('pin:' + ipOf(req)); return err(res, 401, 'Mã PIN chủ không đúng.'); }
      const U = users(); const owner = Object.keys(U).filter(function (k) { return U[k].role === 'owner'; })[0];
      if (!owner) return err(res, 400, 'Chưa có tài khoản chủ.');
      const pr = pwProblem(b.password, owner); if (pr) return err(res, 400, pr);
      const salt = newSalt(); U[owner].salt = salt; U[owner].hash = hashPw(b.password, salt); U[owner].status = 'active';
      saveUsers(); dropSessions(owner);
      writeAudit({ t: Date.now(), u: owner, n: U[owner].name, op: 'đặt lại mật khẩu', c: 'users', id: owner, lb: 'Tài khoản ' + owner, ch: ['Đặt lại bằng mã PIN chủ'] });
      return send({ ok: true, username: owner });
    }

    // ---- cac duong duoi day can dang nhap ----
    const me = sessionOf(req);
    if (!me) return err(res, 401, 'Cần đăng nhập', 'login');
    req.nmsxUser = me;

    if (p === '/api/auth/password' && method === 'POST') {
      const b = await bodyJson(req); const usr = users()[me.username];
      if (!safeEq(hashPw(String(b.old || ''), usr.salt), usr.hash)) return err(res, 400, 'Mật khẩu hiện tại không đúng.');
      const pr = pwProblem(b.password, me.username); if (pr) return err(res, 400, pr);
      const salt = newSalt(); usr.salt = salt; usr.hash = hashPw(b.password, salt); saveUsers();
      dropSessions(me.username, me._h);
      return send({ ok: true });
    }

    // ---- chi CHU ----
    if (me.role !== 'owner') return err(res, 403, 'Chỉ chủ nhà máy mới dùng được chức năng này.');
    if (p === '/api/auth/users' && method === 'GET') {
      const U = users(), S = sessions(), now = Date.now();
      const list = Object.keys(U).map(function (k) { const o = pub(U[k]); o.online = Object.keys(S).some(function (h) { return S[h].u === k && S[h].exp > now; }); return o; });
      list.sort(function (a, b) { return (a.role === 'owner' ? 0 : a.status === 'pending' ? 1 : 2) - (b.role === 'owner' ? 0 : b.status === 'pending' ? 1 : 2) || a.name.localeCompare(b.name); });
      return send({ ok: true, users: list });
    }
    if (p === '/api/auth/users' && method === 'POST') { // chu tao san tai khoan cho nhan vien
      const b = await bodyJson(req);
      const username = String(b.username || '').trim().toLowerCase(), name = cleanName(b.name);
      if (name.length < 2) return err(res, 400, 'Nhập họ và tên (từ 2 ký tự).');
      if (!validUsername(username)) return err(res, 400, 'Tên đăng nhập 3–20 ký tự: chữ thường không dấu, số, dấu chấm hoặc gạch dưới.');
      const pr = pwProblem(b.password, username); if (pr) return err(res, 400, pr);
      const U = users(); if (U[username]) return err(res, 409, 'Tên đăng nhập này đã có.');
      const nk = nameKey(name); if (Object.keys(U).some(function (k) { return nameKey(U[k].name) === nk; })) return err(res, 409, 'Họ tên này đã có tài khoản.');
      const salt = newSalt();
      U[username] = { username: username, name: name, salt: salt, hash: hashPw(b.password, salt), role: 'user', status: 'active', createdAt: Date.now(), lastLogin: 0, createdBy: me.username };
      saveUsers(); adminLog(req, 'tạo tài khoản', username, 'Chủ tạo tài khoản cho "' + name + '"');
      return send({ ok: true });
    }
    const m = p.match(/^\/api\/auth\/users\/([a-z0-9._]+)\/(approve|block|unblock|reset|delete)$/);
    if (m && method === 'POST') {
      const U = users(), target = U[m[1]], act = m[2];
      if (!target) return err(res, 404, 'Không tìm thấy tài khoản.');
      if (target.role === 'owner') return err(res, 400, 'Không thể thao tác trên tài khoản chủ.');
      if (act === 'approve') { target.status = 'active'; saveUsers(); adminLog(req, 'duyệt', target.username, 'Duyệt tài khoản "' + target.name + '"'); return send({ ok: true }); }
      if (act === 'block') { target.status = 'blocked'; saveUsers(); dropSessions(target.username); adminLog(req, 'khóa', target.username, 'Khóa tài khoản "' + target.name + '"'); return send({ ok: true }); }
      if (act === 'unblock') { target.status = 'active'; saveUsers(); adminLog(req, 'mở khóa', target.username, 'Mở khóa tài khoản "' + target.name + '"'); return send({ ok: true }); }
      if (act === 'reset') {
        const b = await bodyJson(req); const pr = pwProblem(b.password, target.username); if (pr) return err(res, 400, pr);
        const salt = newSalt(); target.salt = salt; target.hash = hashPw(b.password, salt); saveUsers(); dropSessions(target.username);
        adminLog(req, 'đặt lại mật khẩu', target.username, 'Đặt lại mật khẩu cho "' + target.name + '"'); return send({ ok: true });
      }
      if (act === 'delete') {
        const nm = target.name; delete U[target.username]; saveUsers(); dropSessions(target.username);
        adminLog(req, 'xóa tài khoản', m[1], 'Xóa tài khoản "' + nm + '"'); return send({ ok: true });
      }
    }
    if (p === '/api/auth/audit' && method === 'GET') {
      const q = {}; u.searchParams.forEach(function (v, k) { q[k] = v; });
      const r = readAudit(q); r.ok = true; r.groups = GROUP;
      return send(r);
    }
    return false;
  }

  // Cho phep / chan 1 yeu cau /api/* (goi trong server.js truoc khi xu ly)
  function allow(req, p, method) {
    if (!authOn()) return { ok: true };
    if (p === '/api/ping' || p === '/api/zalo/webhook' || p.indexOf('/api/auth/') === 0) return { ok: true };
    const s = sessionOf(req);
    if (!s) return { ok: false, status: 401, error: 'Cần đăng nhập' };
    req.nmsxUser = s;
    if (p === '/api/export' || p === '/api/import') { if (s.role !== 'owner') return { ok: false, status: 403, error: 'Chỉ chủ nhà máy' }; }
    const m = p.match(/^\/api\/(?:coll|doc|rev)\/([^/]+)/);
    if (m) {
      if (/^(users|sessions)$/.test(m[1])) return { ok: false, status: 403, error: 'Không được phép' };
      if (m[1] === 'ai_settings' && s.role !== 'owner') return { ok: false, status: 403, error: 'Chỉ chủ nhà máy' };
    }
    return { ok: true };
  }

  /* ---------- trang dang nhap ---------- */
  const LOGIN_HTML = fs.readFileSync(path.join(__dirname, 'login.html'), 'utf8');

  return {
    handle: handle, allow: allow, record: record, recordBulk: recordBulk, sessionOf: sessionOf, authOn: authOn,
    invalidate: invalidate, clone: clone, loginHtml: function () { return Buffer.from(LOGIN_HTML, 'utf8'); }
  };
};
