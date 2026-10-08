/* ================================================================
   zalo.js - Nhan yeu cau xuat hang tu Zalo Bot (nhom vat tu), AI doc tin nhan + anh.
   ----------------------------------------------------------------
   Duoc server.js goi:  const zalo = require('./zalo.js')({ loadColl, saveColl, readBody, sendJson, sendBytes, DATA_DIR });
                        if (await zalo.handle(req, res, u, p, method)) return;
   Bien moi truong (dat trong Render > Environment, KHONG ghi vao code):
     ZALO_BOT_TOKEN        token cua bot Zalo
     ZALO_WEBHOOK_SECRET   chuoi >= 8 ky tu, Zalo gui kem moi tin (header X-Bot-Api-Secret-Token)
     ANTHROPIC_API_KEY     khoa AI (neu thieu: chi tach dong bang quy tac, khong ton tien)
     AI_MODEL              mac dinh claude-sonnet-5-5
     PUBLIC_URL            mac dinh https://chetao.onrender.com
     ZALO_API_BASE         mac dinh https://bot-api.zaloplatforms.com
   Code viet tuong thich Node 12 tro len (khong dung ?. va ??).
   ================================================================ */
'use strict';
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

module.exports = function (ctx) {
  const DATA_DIR = ctx.DATA_DIR;
  const IMG_DIR = path.join(DATA_DIR, 'zalo_img');
  try { fs.mkdirSync(IMG_DIR, { recursive: true }); } catch (e) {}

  function env(k, d) { const v = process.env[k]; return (v && String(v).trim()) ? String(v).trim() : d; }
  function cfg() {
    return {
      token: env('ZALO_BOT_TOKEN', ''),
      secret: env('ZALO_WEBHOOK_SECRET', ''),
      aiKey: env('ANTHROPIC_API_KEY', ''),
      model: env('AI_MODEL', 'claude-sonnet-5-5'),
      publicUrl: env('PUBLIC_URL', 'https://chetao.onrender.com').replace(/\/+$/, ''),
      apiBase: env('ZALO_API_BASE', 'https://bot-api.zaloplatforms.com').replace(/\/+$/, ''),
      aiBase: env('ANTHROPIC_API_BASE', 'https://api.anthropic.com').replace(/\/+$/, ''),
      aiMock: env('AI_MOCK', '') === '1'
    };
  }

  /* ---------------- HTTP helper (https/http, Node 12) ---------------- */
  function request(urlStr, opt) {
    opt = opt || {};
    return new Promise(function (resolve, reject) {
      let u;
      try { u = new URL(urlStr); } catch (e) { return reject(e); }
      const lib = u.protocol === 'http:' ? http : https;
      const body = opt.body == null ? null : (Buffer.isBuffer(opt.body) ? opt.body : Buffer.from(String(opt.body), 'utf8'));
      const headers = Object.assign({}, opt.headers || {});
      if (body) headers['Content-Length'] = body.length;
      const req = lib.request({
        method: opt.method || 'GET', hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443),
        path: u.pathname + u.search, headers: headers, timeout: opt.timeout || 30000
      }, function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (opt.redirects == null ? 3 : opt.redirects) > 0) {
          res.resume();
          return resolve(request(new URL(res.headers.location, urlStr).toString(), Object.assign({}, opt, { redirects: (opt.redirects == null ? 3 : opt.redirects) - 1 })));
        }
        const chunks = []; let size = 0; const cap = opt.maxBytes || 12 * 1024 * 1024;
        res.on('data', function (c) { size += c.length; if (size > cap) { req.destroy(new Error('Phan hoi qua lon')); return; } chunks.push(c); });
        res.on('end', function () { resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }); });
        res.on('error', reject);
      });
      req.on('timeout', function () { req.destroy(new Error('Het gio cho')); });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }
  function jsonOf(r) { try { return JSON.parse(r.body.toString('utf8')); } catch (e) { return null; } }

  /* ---------------- Zalo Bot API ---------------- */
  function zaloCall(method, payload) {
    const c = cfg();
    if (!c.token) return Promise.reject(new Error('Chua co ZALO_BOT_TOKEN'));
    return request(c.apiBase + '/bot' + c.token + '/' + method, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}), timeout: 20000
    }).then(function (r) { return { status: r.status, data: jsonOf(r), raw: r.body.toString('utf8').slice(0, 400) }; });
  }
  function sendText(chatId, text) {
    if (!chatId || !cfg().token) return Promise.resolve(null);
    return zaloCall('sendMessage', { chat_id: String(chatId), text: String(text).slice(0, 1900) }).catch(function (e) { return { error: String(e && e.message || e) }; });
  }

  /* ---------------- Xu ly tin Zalo gui toi ---------------- */
  function findPhotoUrl(o, depth) {
    depth = depth || 0;
    if (!o || depth > 4) return '';
    if (typeof o === 'string') return '';
    if (Array.isArray(o)) { for (let i = 0; i < o.length; i++) { const r = typeof o[i] === 'string' && /^https?:\/\//i.test(o[i]) ? o[i] : findPhotoUrl(o[i], depth + 1); if (r) return r; } return ''; }
    const keys = Object.keys(o);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i], v = o[k];
      if (/avatar|icon|sticker/i.test(k)) continue;
      if (typeof v === 'string' && /^https?:\/\//i.test(v) && /photo|image|img|picture|thumb|file|url|link/i.test(k)) return v;
    }
    for (let j = 0; j < keys.length; j++) {
      const v2 = o[keys[j]];
      if (v2 && typeof v2 === 'object' && !/avatar|from|sender|chat/i.test(keys[j])) { const r2 = findPhotoUrl(v2, depth + 1); if (r2) return r2; }
    }
    return '';
  }
  function extract(body) {
    const upd = (body && body.result && typeof body.result === 'object') ? body.result : (body || {});
    const msg = (upd.message && typeof upd.message === 'object') ? upd.message : upd;
    const from = msg.from || msg.sender || {};
    const chat = msg.chat || {};
    const text = typeof msg.text === 'string' ? msg.text : (typeof msg.caption === 'string' ? msg.caption : '');
    const photo = findPhotoUrl(msg);
    const mid = String(msg.message_id || msg.msg_id || msg.id || upd.event_id || '') || '';
    return {
      event: String(upd.event_name || upd.event || ''),
      chatId: String(chat.id || msg.chat_id || from.id || ''),
      chatType: String(chat.chat_type || chat.type || ''),
      fromId: String(from.id || from.user_id || ''),
      fromName: String(from.display_name || from.name || from.username || '').trim(),
      text: text.replace(/\r/g, '').trim(),
      photoUrl: photo,
      messageId: mid
    };
  }

  /* ---------------- Tach dong bang quy tac (khong AI) ---------------- */
  const RULES = require('./rules.js');
  function ruleParse(text) { return RULES.parseMessage(text); }

  /* ---------------- AI doc tin nhan + anh ---------------- */
  const SCHEMA = {
    type: 'object',
    properties: {
      is_request: { type: 'boolean' },
      intent: { type: 'string', enum: ['mua', 'xuat', 'hoi', 'khac'] },
      need_date: { type: 'string' },
      order_code: { type: 'string' },
      requester: { type: 'string' },
      note: { type: 'string' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' }, spec: { type: 'string' }, qty: { type: 'number' }, unit: { type: 'string' }, order_code: { type: 'string' }, need_date: { type: 'string' }, spare: { type: 'boolean' }
          },
          required: ['name', 'spec', 'qty', 'unit', 'order_code', 'need_date', 'spare'], additionalProperties: false
        }
      }
    },
    required: ['is_request', 'intent', 'need_date', 'order_code', 'requester', 'note', 'items'], additionalProperties: false
  };
  function activeOrdersText() {
    const O = ctx.loadColl('orders'); const rows = [];
    Object.keys(O).forEach(function (id) {
      const o = O[id]; if (!o || o.legacy || !o.code) return;
      const its = (o.items || []).filter(function (i) { return i && String(i.name || '').trim(); });
      if (its.length && its.every(function (i) { return i.status === 'ĐÃ GIAO'; })) return;
      const dd = (o.progressSnapshots || []).map(function (sn) { return sn && sn.deliveryDate; }).filter(Boolean).sort()[0] || '9999';
      const cust = String(o.customerInfo || '').split('\n')[0].replace(/\s+/g, ' ').slice(0, 28);
      rows.push({ d: dd, t: o.code + '|' + (its[0] ? String(its[0].name).replace(/\s+/g, ' ').slice(0, 36) : '') + '|' + cust });
    });
    rows.sort(function (a, b) { return a.d < b.d ? -1 : 1; });
    return rows.slice(0, 40).map(function (r) { return r.t; }).join('\n');
  }
  function mediaTypeOf(buf) {
    if (buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8) return 'image/jpeg';
    if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
    if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
    if (buf.length > 3 && buf.slice(0, 3).toString() === 'GIF') return 'image/gif';
    return '';
  }
  function priceOf(model) {
    if (/haiku/.test(model)) return { i: 1, o: 5 };
    if (/opus-5-5/.test(model)) return { i: 4, o: 20 };
    if (/opus|fable|mythos/.test(model)) return { i: 5, o: 25 };
    return { i: 2, o: 10 };
  }
  function aiParse(text, imageBuf) {
    const c = cfg();
    if (c.aiMock) return Promise.resolve({ result: ruleParse(text), usage: { input: 0, output: 0, usd: 0 }, model: 'mock' });
    if (!c.aiKey) return Promise.reject(new Error('Chua co ANTHROPIC_API_KEY'));
    const content = [];
    const mt = imageBuf ? mediaTypeOf(imageBuf) : '';
    if (imageBuf && mt) content.push({ type: 'image', source: { type: 'base64', media_type: mt, data: imageBuf.toString('base64') } });
    content.push({ type: 'text', text: (text ? 'Tin nhắn:\n' + text : 'Tin nhắn không có chữ, chỉ có ảnh.') + (imageBuf && !mt ? '\n(Ảnh không đọc được định dạng.)' : '') });
    const system = 'Bạn là trợ lý kho và mua hàng của Nhà máy Phương Quân (cơ khí và điện). Hôm nay là ' + vnToday() + '. Nhân viên nhắn tin Zalo (kèm ảnh nếu có) để YÊU CẦU MUA vật tư (đặt mua, nhờ người đi mua) hoặc YÊU CẦU XUẤT vật tư có sẵn từ kho. ' +
      'intent: "mua" nếu nhờ mua / đề xuất mua / đặt mua / đặt hàng / mua giúp; "xuat" nếu xin lấy / xuất từ kho; "hoi" nếu chỉ hỏi còn hàng / có trong kho không; "khac" nếu là tin thường (chào hỏi, trao đổi, không đòi mua hay xuất). Tuyệt đối không coi tin thường là yêu cầu. Dòng tiêu đề kiểu "CÔNG TY … - MS : 2026-232 - TĐ : 23/10/2026" nghĩa là MS = mã công trình, TĐ = ngày tiến độ giao của cả công trình (KHÔNG phải ngày cần hàng). Dòng nằm dưới chữ "mua dự phòng"/"DP"/"dự phòng" thì spare = true (vật tư mua dự phòng), còn lại spare = false. need_date: hạn cần hàng dạng YYYY-MM-DD nếu tin nhắn nói (ví dụ "cần ngày 20/10", "trước thứ 6"), không có thì chuỗi rỗng; mỗi vật tư cũng có need_date riêng (giống hạn chung nếu không khác). ' +
      'Hãy trích danh sách vật tư: name (tên vật tư, giữ nguyên chữ nhân viên viết), spec (quy cách/kích thước nếu có, không có thì chuỗi rỗng), qty (số lượng là số; không rõ thì 0), unit (đơn vị: cái, bộ, mét, cây, tấm, kg…; không rõ thì rỗng), order_code (mã công trình của dòng đó nếu rõ). ' +
      'Nếu một dòng nhắc TÊN KHÁCH (ví dụ "htx thượng nhật", "cty vitech") thì order_code của dòng đó là mã công trình của khách đó trong danh sách bên dưới — KHÔNG lấy mã của dòng khác. order_code ở cấp trên là mã công trình chung của yêu cầu (dạng 2026-187, 2026-DL09…). Chỉ dùng mã có trong danh sách công trình đang làm bên dưới; nếu tin nhắn nhắc tên khách hoặc tên máy thì chọn mã tương ứng; không chắc thì để rỗng. ' +
      'requester: tên người cần nhận hàng nếu tin nhắn nói rõ, không thì rỗng. note: ghi chú ngắn (hạn cần, nơi giao…) nếu có. ' +
      'is_request = false nếu tin nhắn không phải yêu cầu xuất vật tư (chào hỏi, hỏi thăm…). Tách mỗi vật tư thành một dòng; các thông số như đường kính, kích thước, số rãnh… đi vào spec. Ghi chú thêm như "thay thế cho…" đi vào note. Không bịa thêm vật tư không có trong tin/ảnh. Trả lời đúng định dạng JSON yêu cầu.\n\nDanh sách công trình đang làm (mã | hạng mục | khách):\n' + activeOrdersText();
    const payload = {
      model: c.model, max_tokens: 3000,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: content }],
      output_config: /haiku/.test(c.model) ? { format: { type: 'json_schema', schema: SCHEMA } } : { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } }
    };
    return request(c.aiBase + '/v1/messages', {
      method: 'POST', timeout: 90000,
      headers: { 'content-type': 'application/json', 'x-api-key': c.aiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      const j = jsonOf(r);
      if (r.status !== 200 || !j) throw new Error('AI loi HTTP ' + r.status + ': ' + r.body.toString('utf8').slice(0, 300));
      if (j.stop_reason === 'refusal') throw new Error('AI tu choi doc noi dung nay');
      let txt = '';
      (j.content || []).forEach(function (b) { if (b && b.type === 'text') txt += b.text; });
      txt = txt.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
      let out; try { out = JSON.parse(txt); } catch (e) { throw new Error('AI tra loi khong phai JSON'); }
      const u = j.usage || {}; const pr = priceOf(c.model);
      const inTok = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) * 1.25 + (u.cache_read_input_tokens || 0) * 0.1;
      const usd = (inTok * pr.i + (u.output_tokens || 0) * pr.o) / 1e6;
      return { result: out, usage: { input: u.input_tokens || 0, output: u.output_tokens || 0, usd: Math.round(usd * 100000) / 100000 }, model: c.model };
    });
  }

  /* ---------------- Luu yeu cau ---------------- */
  function nextId() {
    const X = ctx.loadColl('xuathang'); const y = new Date().getFullYear(); let mx = 0;
    Object.keys(X).forEach(function (id) { const m = /^XH-(\d{4})-(\d+)$/.exec(id); if (m && +m[1] === y) mx = Math.max(mx, +m[2]); });
    return 'XH-' + y + '-' + ('00' + (mx + 1)).slice(-3);
  }
  function orderIdByCode(code) {
    if (!code) return '';
    const O = ctx.loadColl('orders'); const k = String(code).toUpperCase().replace(/\s+/g, '');
    const ids = Object.keys(O);
    for (let i = 0; i < ids.length; i++) { const o = O[ids[i]]; if (o && String(o.code || '').toUpperCase().replace(/\s+/g, '') === k && o.dept !== 'dien') return ids[i]; }
    for (let j = 0; j < ids.length; j++) { const o2 = O[ids[j]]; if (o2 && String(o2.code || '').toUpperCase().replace(/\s+/g, '') === k) return ids[j]; }
    return '';
  }
  function normItems(res, topCode) {
    return (res.items || []).map(function (it) {
      const code = String(it.order_code || (it.who ? '' : topCode) || '').trim();
      return { name: String(it.name || '').trim(), spec: String(it.spec || '').trim(), qty: (typeof it.qty === 'number' && isFinite(it.qty) && it.qty > 0) ? it.qty : '', unit: String(it.unit || '').trim(), orderCode: code, orderId: orderIdByCode(code), needDate: /^\d{4}-\d{2}-\d{2}$/.test(String(it.need_date || '')) ? String(it.need_date) : '', spare: !!it.spare, who: String(it.who || '').slice(0, 80), fallback: String(it.fallback || '').trim(), note: String(it.note || '').slice(0, 120) };
    }).filter(function (it) { return it.name; });
  }
  function saveDoc(id, patch, replace) {
    const X = ctx.loadColl('xuathang');
    X[id] = replace ? patch : Object.assign(X[id] || {}, patch);
    ctx.saveColl('xuathang', X);
    return X[id];
  }
  function logRaw(body, note) {
    try {
      const L = ctx.loadColl('zalo_log'); const k = String(Date.now());
      L[k] = { at: Date.now(), note: note || '', body: JSON.parse(JSON.stringify(body || {})) };
      const ks = Object.keys(L).sort(); while (ks.length > 40) delete L[ks.shift()];
      ctx.saveColl('zalo_log', L);
    } catch (e) {}
  }
  function addUsage(usd, ok) {
    try {
      const M = ctx.loadColl('zalo_meta'); const U = M.usage || { calls: 0, usd: 0, fails: 0, month: {} };
      const mk = new Date().toISOString().slice(0, 7);
      U.calls += 1; U.usd = Math.round((U.usd + (usd || 0)) * 100000) / 100000; if (!ok) U.fails += 1;
      U.month[mk] = Math.round(((U.month[mk] || 0) + (usd || 0)) * 100000) / 100000;
      M.usage = U; ctx.saveColl('zalo_meta', M);
    } catch (e) {}
  }
  // Han muc tien AI moi thang (USD), mac dinh 5; dat AI_MONTH_CAP_USD=0 de bo han muc. Gioi han 60 luot AI moi gio de chong lam dung.
  function capOf() { const v = process.env.AI_MONTH_CAP_USD; return (v == null || String(v).trim() === '') ? 5 : (Number(v) || 0); }
  let aiTimes = [];
  function rateOk() { const now = Date.now(); aiTimes = aiTimes.filter(function (t) { return now - t < 3600000; }); if (aiTimes.length >= 60) return false; aiTimes.push(now); return true; }
  function monthSpend() { const M = ctx.loadColl('zalo_meta'); const U = M.usage; return (U && U.month && U.month[new Date().toISOString().slice(0, 7)]) || 0; }

  /* ---------------- HAN MUC AI THEO NGAY / THEO NGUOI (chu = khong gioi han) ---------------- */
  function roundU(x) { return Math.round(x * 100000) / 100000; }
  function aiCfg() {
    const M = ctx.loadColl('ai_settings'); const c = M.cfg || {};
    c.limits = Object.assign({ zaloPerDay: 30, drawPerDay: 0, dayUsdCap: 1 }, c.limits || {});
    c.people = c.people || {}; c.ownerZalo = c.ownerZalo || [];
    return c;
  }
  function aiCfgSave(c) { const M = ctx.loadColl('ai_settings'); M.cfg = c; ctx.saveColl('ai_settings', M); }
  function hashPin(pin, salt) { return crypto.pbkdf2Sync(String(pin), salt, 60000, 32, 'sha256').toString('hex'); }
  let pinFails = [];
  function pinOk(pin) {
    const c = aiCfg(); if (!c.ownerHash || !pin) return false;
    const now = Date.now(); pinFails = pinFails.filter(function (t) { return now - t < 600000; });
    if (pinFails.length >= 8) return false;
    const ok = safeEq(hashPin(pin, c.ownerSalt), c.ownerHash);
    if (!ok) pinFails.push(now);
    return ok;
  }
  // Chua dat PIN chu -> chua co "chu": tam coi moi nguoi nhu chu (van bi tran thang), UI nhac dat PIN
  function authSession(req) { return ctx.authOn && ctx.authOn() && ctx.sessionOf ? ctx.sessionOf(req) : null; }
  function ownerMode(req) {
    const as = authSession(req);
    if (as && as.role === 'owner') return true;
    if (ctx.authOn && ctx.authOn()) { const c1 = aiCfg(); return !!c1.ownerHash && pinOk(String(req.headers['x-owner-pin'] || '')); }
    const c = aiCfg(); if (!c.ownerHash) return true; return pinOk(String(req.headers['x-owner-pin'] || ''));
  }
  function identOfReq(req) {
    const as = authSession(req);
    if (as) return { key: 'w:' + (stripD(as.name).replace(/[^a-z0-9]/g, '') || 'khach'), name: as.name };
    let name = ''; try { name = decodeURIComponent(String(req.headers['x-user-name'] || '')).trim().slice(0, 60); } catch (e) {}
    return { key: 'w:' + (stripD(name).replace(/[^a-z0-9]/g, '') || 'khach'), name: name || '(chưa nhập tên)' };
  }
  function isOwnerZalo(id) { const c = aiCfg(); return !c.ownerHash || (!!id && c.ownerZalo.indexOf(String(id)) >= 0); }
  function usageLoad() { const U = ctx.loadColl('ai_usage'); const d = vnToday(); if (!U[d]) U[d] = { date: d, usd: 0, ownerUsd: 0, by: {} }; return { U: U, day: U[d] }; }
  function usageAdd(ident, kind, usd, owner) {
    const L = usageLoad(), day = L.day;
    const b = day.by[ident.key] = day.by[ident.key] || { name: ident.name, msgs: 0, draws: 0, usd: 0 };
    b.name = ident.name || b.name; b.owner = !!owner;
    if (kind === 'msg' || kind === 'ask') b.msgs += 1; else if (kind === 'draw') b.draws += 1;
    if (kind === 'ask') b.asks = (b.asks || 0) + 1;
    day.kinds = day.kinds || {}; day.kinds[kind] = roundU((day.kinds[kind] || 0) + (usd || 0));
    b.usd = roundU(b.usd + (usd || 0));
    if (owner) day.ownerUsd = roundU(day.ownerUsd + (usd || 0)); else day.usd = roundU(day.usd + (usd || 0));
    const ks = Object.keys(L.U).sort(); while (ks.length > 62) delete L.U[ks.shift()];
    ctx.saveColl('ai_usage', L.U);
  }
  function gate(kind, ident, owner) {
    if (owner) return { ok: true };
    const c = aiCfg(), p = c.people[ident.key] || {}, lim = c.limits, L = usageLoad(), b = L.day.by[ident.key] || { msgs: 0, draws: 0 };
    if (kind === 'msg') {
      const mx = p.zaloPerDay != null ? p.zaloPerDay : lim.zaloPerDay;
      if (b.msgs >= mx) return { ok: false, reason: 'Hôm nay đã dùng hết ' + mx + ' lượt AI của "' + (ident.name || 'bạn') + '"' };
    } else {
      const mx = p.drawPerDay != null ? p.drawPerDay : lim.drawPerDay;
      if (!(mx > 0)) return { ok: false, reason: 'Tài khoản "' + (ident.name || '') + '" chưa được cấp quyền đọc bản vẽ bằng AI. Nhờ anh Quốc cấp quyền.' };
      if (b.draws >= mx) return { ok: false, reason: 'Hôm nay đã đọc hết ' + mx + ' bản vẽ được cấp' };
    }
    if (lim.dayUsdCap > 0 && L.day.usd >= lim.dayUsdCap) return { ok: false, reason: 'Hôm nay công ty đã dùng hết hạn mức AI trong ngày (' + lim.dayUsdCap + ' USD)' };
    return { ok: true };
  }
  // Tin qua ngan / khong co so, khong co tu khoa vat tu -> khong goi AI (mien phi)
  function looksLikeRequest(text, hasPhoto) {
    if (hasPhoto) return true;
    const t = stripD(String(text || '')).replace(/@\S+/g, ' ').trim();
    if (t.length < 8) return false;
    if (/\d/.test(t)) return true;
    return /(mua|dat |can |lay |xuat|cap |giup|them|bo sung|thieu|het )/.test(t);
  }
  function seenZalo() {
    const L = ctx.loadColl('zalo_log'), seen = {}, out = [];
    Object.keys(L).sort().reverse().forEach(function (k) {
      const b = L[k] && L[k].body || {}; const r = b.result && typeof b.result === 'object' ? b.result : b; const m = (r.message && typeof r.message === 'object') ? r.message : r;
      const f = m.from || m.sender || {}; const id = String(f.id || f.user_id || '');
      if (id && !seen[id]) { seen[id] = 1; out.push({ id: id, name: String(f.display_name || f.name || '').trim() }); }
    });
    return out.slice(0, 40);
  }
  function numIn(v, lo, hi, d) { const n = Number(v); return (isFinite(n) && n >= lo && n <= hi) ? n : d; }

  function seenBefore(mid) {
    if (!mid) return false;
    const M = ctx.loadColl('zalo_meta'); const S = M.seen || [];
    if (S.indexOf(mid) >= 0) return true;
    S.push(mid); while (S.length > 300) S.shift(); M.seen = S; ctx.saveColl('zalo_meta', M);
    return false;
  }
  function downloadPhoto(url, id) {
    return request(url, { timeout: 25000, maxBytes: 8 * 1024 * 1024 }).then(function (r) {
      if (r.status !== 200 || !r.body.length || !mediaTypeOf(r.body)) throw new Error('Khong tai duoc anh (HTTP ' + r.status + ')');
      fs.writeFileSync(path.join(IMG_DIR, id + '.img'), r.body);
      return r.body;
    });
  }
  function itemLine(it, i) {
    return (i + 1) + '. ' + it.name + (it.spare ? ' (dự phòng)' : '') + (it.spec ? ' (' + it.spec + ')' : '') + (it.qty ? ' x ' + it.qty : '') + (it.unit ? ' ' + it.unit : '') + stockLine(it);
  }
  function summaryText(doc) {
    const n = (doc.items || []).length;
    if (doc.intent === 'khac' || doc.status === 'ignored') return '';
    if (doc.intent === 'hoi') {
      if (!n) return '';
      let t = 'Tra cứu tồn kho:';
      doc.items.slice(0, 8).forEach(function (it, i) { t += '\n' + (i + 1) + '. ' + it.name + (it.stock ? stockLine(it).replace(/^ → /, ' — ') : ' — chưa có dữ liệu kho'); });
      return t;
    }
    if (doc.status === 'applied' && doc.applied) {
      let t = 'Đã ghi ĐỀ XUẤT MUA ' + doc.id + ' (' + n + ' mục) vào VT:';
      (doc.items || []).slice(0, 8).forEach(function (it, i) { t += '\n' + itemLine(it, i); });
      t += '\nCông trình: ' + (doc.orderCode || (doc.items[0] && doc.items[0].orderCode) || '') + '. Đã lập phiếu đề nghị mua ' + doc.applied.purchaseId + ' (chờ duyệt).';
      return t;
    }
    if (doc.intent === 'mua' && n && !(doc.items || []).every(function (it) { return it.orderId; })) return 'Đã đọc đề xuất MUA ' + doc.id + ' nhưng chưa rõ công trình nào. Anh/chị nhắn lại kèm mã đơn (ví dụ 2026-191), hoặc thủ kho chọn công trình trên web.';
    const kind = doc.intent === 'mua' ? 'MUA' : (doc.intent === 'xuat' ? 'XUẤT KHO' : 'chưa rõ MUA hay XUẤT');
    let t = 'Đã nhận yêu cầu ' + kind + ' ' + doc.id + (n ? ' gồm ' + n + ' mục:' : ': chưa đọc được mục nào, thủ kho sẽ xem tin gốc.');
    (doc.items || []).slice(0, 8).forEach(function (it, i) { t += '\n' + itemLine(it, i); });
    if (n > 8) t += '\n… và ' + (n - 8) + ' mục nữa';
    if (doc.orderCode) t += '\nCông trình: ' + doc.orderCode;
    return t + '\nChờ thủ kho xử lý.';
  }


  /* ---------------- HOI NHANH BANG AI (chi tra loi tu du lieu nha may) ---------------- */
  function askSnapshot(q) {
    const O = ctx.loadColl('orders'), T = ctx.loadColl('tasks'), P = ctx.loadColl('purchase');
    const ord = [], mats = [];
    Object.keys(O).forEach(function (id) {
      const o = O[id]; if (!o || o.legacy) return;
      const its = (o.items || []).filter(function (i) { return i && String(i.name || '').trim(); });
      if (its.length && its.every(function (i) { return i.status === 'ĐÃ GIAO'; })) return;
      let due = ''; (o.progressSnapshots || []).forEach(function (sn) { if (sn && sn.deliveryDate && (!due || sn.deliveryDate < due)) due = sn.deliveryDate; });
      let have = 0, need = 0;
      (o.materials || []).forEach(function (m) {
        if (!m || isSec(m) || !String(m.name || '').trim()) return;
        if (/da co|da nhan|da mua|nhap kho|du kho/.test(stripD(m.status || ''))) have++;
        else { need++; if (mats.length < 240) mats.push((o.code || id) + ': ' + String(m.name).replace(/\s+/g, ' ').slice(0, 70) + (m.spec ? ' ' + m.spec : '') + ' | ' + (m.qty != null ? m.qty : '') + ' ' + (m.unit || '') + ' | ' + (m.status || 'chưa xem') + (m.reqDate ? ' | cần ' + m.reqDate : '') + (m.supplier ? ' | NCC ' + m.supplier : '')); }
      });
      ord.push((o.code || id) + (o.dept === 'dien' ? ' [Điện]' : ' [Cơ khí]') + ' | ' + String(o.customerInfo || '').replace(/\s+/g, ' ').slice(0, 60) + ' | giao ' + (due ? due.slice(0, 10) : '?') + ' | hạng mục: ' + its.map(function (i) { return String(i.name).slice(0, 30) + '(' + (i.status || '-') + ')'; }).join('; ').slice(0, 220) + ' | VT: đã có ' + have + ', cần ' + need);
    });
    const tasks = [];
    Object.keys(T).forEach(function (id) { const x = T[id]; if (x && x.status !== 'Xong' && tasks.length < 120) tasks.push((x.code || '') + ': ' + String(x.title || '').slice(0, 70) + ' | ' + (x.who || 'chưa có người') + (x.team ? ' (' + x.team + ')' : '') + (x.date ? ' | hạn ' + x.date : '') + ' | ' + (x.status || '')); });
    const prs = Object.keys(P).sort().slice(-15).map(function (id) { const x = P[id]; return id + ' | ' + (x.status || '') + ' | ' + (x.date || '') + ' | ' + ((x.lines || []).length) + ' dòng | ' + (x.by || ''); });
    let stock = [];
    try { stock = RULES.stockMatch(q, '', khoRows()).slice(0, 6).map(function (x) { return x.n + ' | tồn ' + x.q + ' ' + (x.u || '') + ' | ' + x.wh; }); } catch (e) {}
    return 'ĐƠN ĐANG LÀM (' + ord.length + '):\n' + ord.join('\n') + '\n\nVẬT TƯ CẦN MUA / CHƯA CÓ (' + mats.length + ' dòng đầu):\n' + mats.join('\n') + '\n\nVIỆC ĐANG MỞ (' + tasks.length + '):\n' + tasks.join('\n') + '\n\nPHIẾU ĐỀ NGHỊ MUA GẦN ĐÂY:\n' + prs.join('\n') + (stock.length ? '\n\nTỒN KHO LIÊN QUAN ĐẾN CÂU HỎI:\n' + stock.join('\n') : '');
  }
  function aiAsk(q, history) {
    const c = cfg();
    if (c.aiMock) return Promise.resolve({ answer: '[thử] ' + q, usage: { input: 0, output: 0, usd: 0 } });
    if (!c.aiKey) return Promise.reject(new Error('Chua co ANTHROPIC_API_KEY'));
    const msgs = [];
    (Array.isArray(history) ? history : []).slice(-6).forEach(function (h) {
      const role = h && h.role === 'assistant' ? 'assistant' : 'user'; const text = String((h && h.text) || '').slice(0, 800);
      if (!text) return;
      if (!msgs.length && role !== 'user') return;
      if (msgs.length && msgs[msgs.length - 1].role === role) { msgs[msgs.length - 1].content += '\n' + text; return; }
      msgs.push({ role: role, content: text });
    });
    if (msgs.length && msgs[msgs.length - 1].role === 'user') msgs.pop();
    msgs.push({ role: 'user', content: q });
    const sys = 'Bạn là trợ lý hỏi đáp của Nhà máy Phương Quân (cơ khí và điện), trả lời cho anh Quốc (chủ) và nhân viên. Hôm nay là ' + vnToday() + '. Chỉ dựa vào DỮ LIỆU NHÀ MÁY bên dưới; không bịa; nếu dữ liệu không có thì nói rõ "không có trong dữ liệu". Trả lời tiếng Việt, ngắn gọn, đi thẳng vào ý, dạng gạch đầu dòng nếu có nhiều mục, kèm số liệu. Khi nhắc đơn thì viết mã dạng 2026-187. Không dùng bảng markdown.';
    const payload = { model: c.model, max_tokens: 900, system: [{ type: 'text', text: sys }, { type: 'text', text: 'DỮ LIỆU NHÀ MÁY (lúc này):\n' + askSnapshot(q).slice(0, 60000), cache_control: { type: 'ephemeral' } }], messages: msgs };
    return request(c.aiBase + '/v1/messages', { method: 'POST', timeout: 60000, headers: { 'content-type': 'application/json', 'x-api-key': c.aiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(payload) }).then(function (r) {
      const j = jsonOf(r);
      if (r.status !== 200 || !j) throw new Error('AI loi HTTP ' + r.status + ': ' + r.body.toString('utf8').slice(0, 200));
      let txt = ''; (j.content || []).forEach(function (b2) { if (b2 && b2.type === 'text') txt += b2.text; });
      const u = j.usage || {}; const pr = priceOf(c.model);
      const inTok = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) * 1.25 + (u.cache_read_input_tokens || 0) * 0.1;
      return { answer: txt.trim() || '(AI không trả lời)', usage: { input: u.input_tokens || 0, output: u.output_tokens || 0, usd: Math.round(((inTok * pr.i + (u.output_tokens || 0) * pr.o) / 1e6) * 100000) / 100000 } };
    });
  }

  /* ---------------- Yeu cau MUA: tu dien vao VT cua don + lap phieu de nghi mua ---------------- */
  function stripD(x) { return String(x == null ? '' : x).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase(); }
  function vnToday() { return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10); }
  function keysOf(o) {
    const seen = {};
    return (o.materials || []).map(function (m) {
      const base = o.id + '|' + stripD(m.name || '') + '|' + stripD(m.spec || '');
      seen[base] = (seen[base] || 0) + 1;
      return base + '|' + seen[base];
    });
  }
  function isSec(m) { return !!(m && (m.section === true || (m.no && /^[IVXLC]+$/.test(String(m.no)) && !m.qty && !m.unit))); }
  function nextPrId(P) {
    const y = new Date().getFullYear(); let mx = 0;
    Object.keys(P).forEach(function (id) { const m = /^DN-(\d{4})-(\d+)$/.exec(id); if (m && +m[1] === y) mx = Math.max(mx, +m[2]); });
    return 'DN-' + y + '-' + ('00' + (mx + 1)).slice(-3);
  }
  /* ---------------- Doan cong trinh theo TEN KHACH ("htx thuong nhat" -> 2026-076) ---------------- */
  const CUST_STOP = ['htx', 'hop', 'tac', 'xa', 'cty', 'cong', 'ty', 'tnhh', 'cp', 'co', 'phan', 'so', 'nha', 'may', 'mr', 'anh', 'chi', 'ong', 'ba'];
  const ELEC_RX = /(bien tan|mccb|aptomat|contactor|khoi dong tu|role|relay|plc|hmi|tu dien|nut nhan|den bao|cap dien|day dien|cam bien|encoder)/;
  function resolveHint(it) {
    const ws = stripD(it.who || '').replace(/[^a-z0-9]+/g, ' ').split(' ').filter(function (w) { return w.length >= 2 && CUST_STOP.indexOf(w) < 0; });
    if (!ws.length) return null;
    const O = ctx.loadColl('orders'); let hits = [];
    Object.keys(O).forEach(function (id) {
      const o = O[id]; if (!o || o.legacy) return;
      const hay = stripD((o.customerInfo || '') + ' ' + (o.items || []).map(function (i) { return (i && i.name) || ''; }).join(' '));
      if (ws.every(function (w) { return hay.indexOf(w) >= 0; })) hits.push(o);
    });
    if (!hits.length) return null;
    const elec = ELEC_RX.test(stripD(String(it.name || '') + ' ' + String(it.spec || '')));
    const byDept = hits.filter(function (o) { return elec ? o.dept === 'dien' : o.dept !== 'dien'; });
    if (byDept.length) hits = byDept;
    if (hits.length > 1) {
      const live = hits.filter(function (o) { const its = (o.items || []).filter(function (i) { return i && String(i.name || '').trim(); }); return !(its.length && its.every(function (i) { return i.status === 'ĐÃ GIAO'; })); });
      if (live.length) hits = live;
    }
    if (hits.length > 1) { // hoa nhau: chon don co vat tu giong ten vat tu dang xin
      const qw = stripD(String(it.name || '')).replace(/[^a-z0-9]+/g, ' ').split(' ').filter(function (w) { return w.length >= 3; });
      const sc = hits.map(function (o) { const mh = stripD((o.materials || []).map(function (m) { return (m && m.name) || ''; }).join(' ')); return qw.filter(function (w) { return mh.indexOf(w) >= 0; }).length; });
      const mx = Math.max.apply(null, sc);
      if (mx > 0 && sc.filter(function (x) { return x === mx; }).length === 1) return { pick: hits[sc.indexOf(mx)] };
      return { cands: hits.map(function (o) { return o.code || o.id; }) };
    }
    return hits.length === 1 ? { pick: hits[0] } : null;
  }
  function resolveItems(doc) {
    (doc.items || []).forEach(function (it) {
      if (it.orderId) return;
      const r = it.who ? resolveHint(it) : null;
      if (r && r.pick) { it.orderCode = r.pick.code || r.pick.id; it.orderId = r.pick.id; it.hintResolved = true; }
      else if (r && r.cands) { it.hintCands = r.cands.slice(0, 6); }          // khach co nhieu don: de thu kho chon, KHONG tu lay ma chung
      else if (it.fallback) { it.orderCode = it.fallback; it.orderId = orderIdByCode(it.fallback); }
    });
    if (doc.parse && doc.parse.by === 'rule') {
      const allId = doc.items.length > 0 && doc.items.every(function (i) { return i.orderId; });
      const okAll = doc.intent === 'mua' && allId && doc.items.every(function (i) { return i.qty > 0; }) && !doc.parse.unsure;
      doc.parse.level = okAll ? 'cao' : 'thap';
      if (allId) doc.parse.notes = (doc.parse.notes || []).filter(function (n) { return n.indexOf('chưa rõ công trình') < 0; });
    }
  }

  /* ---------------- Ton kho (so sanh co / khong) ---------------- */
  function khoRows() {
    const K = ctx.loadColl('kho'); let rows = [];
    ['cokhi', 'dien'].forEach(function (k) { const d = K[k]; if (d && d.rows) { const wh = d.name || (k === 'dien' ? 'Kho Tổ Điện' : 'Kho Cơ Khí'); d.rows.forEach(function (r) { rows.push({ c: r.c, n: r.n, u: r.u, q: r.q, wh: wh }); }); } });
    return rows;
  }
  function stockFor(it, rows) {
    if (!rows || !rows.length) return null;
    const c = RULES.stockMatch(it.name, it.spec, rows);
    const have = c.filter(function (x) { return x.q > 0; });
    return { st: have.length ? 'co' : (c.length ? 'het' : 'khong'), c: c.slice(0, 2).map(function (x) { return { c: x.c, n: x.n, u: x.u, q: x.q, wh: x.wh }; }) };
  }
  function attachStock(doc) {
    const rows = khoRows(); doc.khoRows = rows.length;
    (doc.items || []).forEach(function (it) { it.stock = stockFor(it, rows); });
  }
  function stockLine(it) {
    const s = it.stock; if (!s) return '';
    if (s.st === 'khong') return ' → kho: không thấy';
    const b = s.c[0]; const tag = b ? (b.n + ' · ' + b.q + ' ' + (b.u || '') + ' (' + String(b.wh || '').replace(/^Kho\s*/i, '') + ')') : '';
    return s.st === 'co' ? ' → kho CÓ: ' + tag : ' → kho hết: ' + tag;
  }
  function applyBuy(doc, itemsOverride) {
    const items = (itemsOverride || doc.items || []).filter(function (it) { return it && String(it.name || '').trim(); }).map(function (it) {
      if (it.spare && !/d[ựu] ph[òo]ng/i.test(it.name)) it = Object.assign({}, it, { name: String(it.name).trim() + ' (dự phòng)' });
      return it;
    });
    if (!items.length) throw new Error('Chua co dong vat tu nao');
    items.forEach(function (it) { if (!it.orderId) throw new Error('Dong "' + it.name + '" chua co cong trinh'); });
    const O = ctx.loadColl('orders'); const P = ctx.loadColl('purchase');
    items.forEach(function (it) { if (!O[it.orderId]) throw new Error('Khong thay don ' + it.orderId); });
    const when = new Date(Date.now() + 7 * 3600 * 1000).toISOString();
    const stamp = when.slice(8, 10) + '/' + when.slice(5, 7) + ' ' + when.slice(11, 16);
    const who = doc.fromName || doc.requester || 'Zalo';
    const touched = {}; const plines = []; const applied = { at: Date.now(), orders: [], purchaseId: '' };
    items.forEach(function (it) {
      const o = O[it.orderId];
      o.materials = o.materials || [];
      const qty = (it.qty === '' || it.qty == null || !isFinite(Number(it.qty))) ? null : Number(it.qty);
      const need = it.needDate || doc.needDate || '';
      const noteTxt = (it.spare ? 'DỰ PHÒNG · ' : '') + 'Zalo ' + who + ' ' + stamp + (doc.note ? ' - ' + doc.note : '') + (it.note ? ' - ' + it.note : '');
      let rec = touched[o.id]; if (!rec) { rec = touched[o.id] = { orderId: o.id, added: [], updated: [] }; applied.orders.push(rec); }
      let idx = -1;
      for (let i = 0; i < o.materials.length; i++) { const m = o.materials[i]; if (m && !isSec(m) && stripD(String(m.name || '').trim()) === stripD(String(it.name).trim())) { idx = i; break; } }
      if (idx >= 0) {
        const m = o.materials[idx];
        rec.updated.push({ name: m.name, spec: m.spec || '', prev: { status: m.status == null ? null : m.status, qty: m.qty == null ? null : m.qty, note: m.note == null ? null : m.note, reqDate: m.reqDate == null ? null : m.reqDate, reqSrc: m.reqSrc == null ? null : m.reqSrc } });
        m.status = 'Yêu cầu đặt';
        if ((m.qty == null || m.qty === '') && qty) m.qty = qty;
        m.note = m.note ? (m.note + ' | ' + noteTxt) : noteTxt;
        if (need && !m.reqDate) { m.reqDate = need; m.reqSrc = 'app'; }
      } else {
        const nm = { no: '', name: String(it.name).trim(), spec: String(it.spec || '').trim() || null, unit: String(it.unit || '').trim() || null, qty: qty || null, status: 'Yêu cầu đặt', supplier: null, issuedTo: null, note: noteTxt, reqDate: need || null, reqSrc: need ? 'app' : null, fromZalo: doc.id };
        o.materials.push(nm);
        rec.added.push({ name: nm.name, spec: nm.spec || '' });
      }
    });
    items.forEach(function (it) {
      const o = O[it.orderId]; const ks = keysOf(o); let key = '', idx = -1;
      for (let i = o.materials.length - 1; i >= 0; i--) { if (stripD(String(o.materials[i].name || '').trim()) === stripD(String(it.name).trim())) { idx = i; break; } }
      if (idx >= 0) key = ks[idx];
      plines.push({ key: key, orderId: o.id, code: o.code || '', name: String(it.name).trim(), spec: String(it.spec || '').trim(), unit: String(it.unit || '').trim(), qty: (it.qty === '' || it.qty == null || !isFinite(Number(it.qty))) ? null : Number(it.qty) });
    });
    const first = O[items[0].orderId];
    const prId = nextPrId(P);
    const needAll = doc.needDate || (items.map(function (it) { return it.needDate; }).filter(Boolean).sort()[0]) || '';
    P[prId] = { id: prId, dept: first && first.dept === 'dien' ? 'dien' : 'cokhi', date: vnToday(), by: who, supplier: '', needDate: needAll, note: 'Tu dong tu Zalo ' + doc.id + (doc.note ? ' - ' + doc.note : ''), status: 'Chờ duyệt', at: Date.now(), lines: plines, fromZalo: doc.id };
    ctx.saveColl('orders', O); ctx.saveColl('purchase', P);
    applied.purchaseId = prId;
    doc.applied = applied; doc.status = 'applied'; doc.items = items;
    return doc;
  }
  function undoBuy(doc) {
    const a = doc.applied; if (!a) throw new Error('Yeu cau nay chua duoc tu dien');
    const O = ctx.loadColl('orders'); const P = ctx.loadColl('purchase');
    (a.orders || []).forEach(function (rec) {
      const o = O[rec.orderId]; if (!o || !o.materials) return;
      (rec.added || []).forEach(function (ad) {
        const i = o.materials.findIndex(function (m) { return m && m.fromZalo === doc.id && stripD(m.name) === stripD(ad.name); });
        if (i >= 0) o.materials.splice(i, 1);
      });
      (rec.updated || []).forEach(function (up) {
        const m = o.materials.find(function (x) { return x && !isSec(x) && stripD(String(x.name || '').trim()) === stripD(String(up.name || '').trim()); });
        if (m) { Object.keys(up.prev).forEach(function (k) { m[k] = up.prev[k]; }); }
      });
    });
    if (a.purchaseId && P[a.purchaseId]) { if (P[a.purchaseId].status === 'Chờ duyệt') delete P[a.purchaseId]; else P[a.purchaseId].status = 'Huỷ'; }
    ctx.saveColl('orders', O); ctx.saveColl('purchase', P);
    doc.status = 'undone'; doc.undoneAt = Date.now();
    return doc;
  }


  /* ---------------- DOC BAN VE (PDF / anh) bang AI -> bang boc tach + danh sach cum cho TD ---------------- */
  const DRAW_SCHEMA = {
    type: 'object',
    properties: {
      title: { type: 'string' },
      machine_type: { type: 'string' },
      pages: { type: 'array', items: { type: 'object', properties: { page: { type: 'number' }, kind: { type: 'string', enum: ['liet_ke', 'dien_giai', 'khac'] }, title: { type: 'string' } }, required: ['page', 'kind', 'title'], additionalProperties: false } },
      steel: { type: 'array', items: { type: 'object', properties: { profile: { type: 'string' }, code: { type: 'string' }, length_mm: { type: 'number' }, qty: { type: 'number' }, page: { type: 'number' }, conf: { type: 'number' }, note: { type: 'string' } }, required: ['profile', 'code', 'length_mm', 'qty', 'page', 'conf', 'note'], additionalProperties: false } },
      steel_recap: { type: 'array', items: { type: 'object', properties: { profile: { type: 'string' }, bars_stated: { type: 'number' }, page: { type: 'number' } }, required: ['profile', 'bars_stated', 'page'], additionalProperties: false } },
      plates: { type: 'array', items: { type: 'object', properties: { thickness_mm: { type: 'number' }, width_mm: { type: 'number' }, length_mm: { type: 'number' }, qty: { type: 'number' }, nham: { type: 'boolean' }, code: { type: 'string' }, page: { type: 'number' }, conf: { type: 'number' }, note: { type: 'string' } }, required: ['thickness_mm', 'width_mm', 'length_mm', 'qty', 'nham', 'code', 'page', 'conf', 'note'], additionalProperties: false } },
      parts: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, spec: { type: 'string' }, qty: { type: 'number' }, unit: { type: 'string' }, page: { type: 'number' }, conf: { type: 'number' }, note: { type: 'string' } }, required: ['name', 'spec', 'qty', 'unit', 'page', 'conf', 'note'], additionalProperties: false } },
      components: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, spec: { type: 'string' }, qty: { type: 'number' }, kind: { type: 'string', enum: ['gia_cong', 'lap_rap', 'khac'] }, page: { type: 'number' } }, required: ['name', 'spec', 'qty', 'kind', 'page'], additionalProperties: false } }
    },
    required: ['title', 'machine_type', 'pages', 'steel', 'steel_recap', 'plates', 'parts', 'components'], additionalProperties: false
  };
  const DRAW_SYSTEM = 'Bạn là kỹ sư dự toán vật tư cơ khí của Nhà máy Phương Quân. Nhiệm vụ: đọc bản vẽ gia công (PDF hoặc ảnh) và bóc tách vật tư CHÍNH XÁC để mua hàng và lập việc sản xuất. Quy tắc bắt buộc:\n' +
    '1. Đọc từng trang. Ghi vào pages: kind = "liet_ke" nếu trang có bảng khối lượng / bảng chi tiết / ghi chú liệt kê vật tư (VD "HH10-12 x 3950 x 2 cây", "tôn 10mm x 4 tấm"); "dien_giai" nếu chỉ là hình vẽ diễn giải; "khac" cho trang bìa, tiêu chuẩn.\n' +
    '2. Chỉ lấy số liệu ở trang/khung LIỆT KÊ. KHÔNG suy diễn kích thước từ hình vẽ để tạo danh sách.\n' +
    '3. steel (thép hình/thép hộp): mỗi dòng cắt một thanh: profile chuẩn hóa (I250, I150, U80, U200, V50 cho thép góc L50x50x5, "Hộp 30x60", "Hộp 30x30"…), code (mã chi tiết nếu có, không có thì chuỗi rỗng), length_mm, qty (nếu ghi "x 2 cây đối xứng" thì qty = 2), page, conf, note.\n' +
    '4. steel_recap: các con số TỔNG mà bản vẽ tự ghi (VD "I250 x 17 cây") để đối chiếu; không cộng hộ.\n' +
    '5. plates (tôn/bản mã): thickness_mm, width_mm và length_mm (0 nếu bản vẽ không ghi), qty (số tấm/chi tiết), nham = true nếu tôn nhám / chống trượt / caro, code, page, conf, note.\n' +
    '6. parts: vật tư mua hoặc chi tiết khác (motor, hộp giảm tốc, vòng bi, gối đỡ, nhông, xích, puly, dây curoa, bu lông…): name, spec, qty, unit, page, conf, note.\n' +
    '7. components: các cụm / chi tiết CHÍNH cần gia công hoặc lắp ráp để lập danh sách việc sản xuất (VD "Trục chính", "Khung đỡ", "Lô chủ động", "Vỏ máy", "Cầu thang"): name, spec (mô tả sơ bộ ngắn: kích thước / vật liệu), qty, kind (gia_cong | lap_rap | khac), page. Gộp chi tiết giống nhau, không liệt kê từng bu lông.\n' +
    '8. KHÔNG bịa. Chữ/số không rõ: bỏ dòng đó hoặc cho conf thấp (< 0.5) và nêu lý do trong note. conf: 1.0 = đọc rất rõ, 0.7 = hơi mờ, dưới 0.5 = đoán.\n' +
    '9. Dùng đơn vị mm cho kích thước. Giữ nguyên mã chi tiết như bản vẽ ghi. Trả lời đúng định dạng JSON yêu cầu, tiếng Việt cho mọi chữ mô tả.';

  function drawCall(contentBlock, fileName, extra) {
    const c = cfg();
    if (c.aiMock) return Promise.resolve({ result: drawMock(), usage: { input: 0, output: 0, usd: 0 }, model: 'mock' });
    if (!c.aiKey) return Promise.reject(new Error('Chưa có ANTHROPIC_API_KEY trên Render'));
    const effort = env('DRAW_EFFORT', 'medium');
    const payload = {
      model: env('DRAW_MODEL', c.model), max_tokens: 24000,
      system: [{ type: 'text', text: DRAW_SYSTEM }],
      messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: 'Bản vẽ: ' + fileName + '. Hãy đọc toàn bộ các trang và bóc tách theo đúng quy tắc.' + (extra || '') }] }],
      output_config: /haiku/.test(env('DRAW_MODEL', c.model)) ? { format: { type: 'json_schema', schema: DRAW_SCHEMA } } : { effort: effort, format: { type: 'json_schema', schema: DRAW_SCHEMA } }
    };
    return request(c.aiBase + '/v1/messages', {
      method: 'POST', timeout: 900000, maxBytes: 32 * 1024 * 1024,
      headers: { 'content-type': 'application/json', 'x-api-key': c.aiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      const j = jsonOf(r);
      if (r.status !== 200 || !j) throw new Error('AI lỗi HTTP ' + r.status + ': ' + r.body.toString('utf8').slice(0, 300));
      if (j.stop_reason === 'refusal') throw new Error('AI từ chối đọc nội dung này');
      if (j.stop_reason === 'max_tokens') throw new Error('Bản vẽ quá dài, AI chưa đọc hết. Hãy tách file thành vài phần.');
      let txt = ''; (j.content || []).forEach(function (b) { if (b && b.type === 'text') txt += b.text; });
      txt = txt.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
      let out; try { out = JSON.parse(txt); } catch (e) { throw new Error('AI trả lời không phải JSON'); }
      const u = j.usage || {}; const pr = priceOf(payload.model);
      const inTok = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) * 1.25 + (u.cache_read_input_tokens || 0) * 0.1;
      return { result: out, usage: { input: u.input_tokens || 0, output: u.output_tokens || 0, usd: Math.round(((inTok * pr.i + (u.output_tokens || 0) * pr.o) / 1e6) * 100000) / 100000 }, model: payload.model };
    });
  }
  function drawMock() {
    return {
      title: 'KHUNG CẤP LIỆU MÁY ÉP VIÊN (mẫu thử)', machine_type: 'Khung thép',
      pages: [{ page: 1, kind: 'dien_giai', title: 'Tổng thể' }, { page: 3, kind: 'liet_ke', title: 'Khung đỡ chính I250' }, { page: 19, kind: 'liet_ke', title: 'Sàn, bậc, chiếu nghỉ' }],
      steel: [
        { profile: 'I250', code: 'HH10-10', length_mm: 4984, qty: 3, page: 3, conf: 0.95, note: '' },
        { profile: 'I250', code: 'HH10-11', length_mm: 4984, qty: 1, page: 3, conf: 0.9, note: '' },
        { profile: 'I250', code: 'HH10-13', length_mm: 3950, qty: 2, page: 4, conf: 0.55, note: 'ghi x 2 cây đối xứng, bảng tổng ghi 1' },
        { profile: 'U80', code: 'HH10-25', length_mm: 1207, qty: 1, page: 9, conf: 0.9, note: '' },
        { profile: 'Hộp 30x60', code: '', length_mm: 5800, qty: 13, page: 26, conf: 0.8, note: '' }
      ],
      steel_recap: [{ profile: 'I250', bars_stated: 17, page: 2 }, { profile: 'U80', bars_stated: 6, page: 2 }],
      plates: [
        { thickness_mm: 3, width_mm: 7688, length_mm: 1202, qty: 2, nham: true, code: '', page: 17, conf: 0.85, note: '' },
        { thickness_mm: 10, width_mm: 0, length_mm: 0, qty: 4, nham: false, code: 'BM1', page: 5, conf: 0.6, note: 'không ghi kích thước' }
      ],
      parts: [{ name: 'Bu lông M16', spec: 'x 60', qty: 48, unit: 'bộ', page: 6, conf: 0.8, note: '' }],
      components: [
        { name: 'Khung đỡ chính I250', spec: 'I250 dài 4984, 12 thanh', qty: 1, kind: 'gia_cong', page: 3 },
        { name: 'Sàn tôn nhám 3mm', spec: '7688 x 1202', qty: 2, kind: 'gia_cong', page: 17 },
        { name: 'Cầu thang 2 vế', spec: 'U200, bậc tôn nhám', qty: 1, kind: 'lap_rap', page: 19 },
        { name: 'Lan can', spec: 'Hộp 30x60 / 30x30', qty: 1, kind: 'gia_cong', page: 26 }
      ]
    };
  }
  // Gop ket qua 2 lan doc: dong trung khop -> tin cay cao; dong lech so luong / chi co 1 ben -> danh dau can kiem
  function nz(x) { return stripD0(String(x == null ? '' : x)).replace(/[^a-z0-9]/g, ''); }
  function stripD0(x) { return String(x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u0111/gi, 'd').toLowerCase(); }
  function mergeDraw(A, B) {
    if (!B) {
      ['steel', 'plates', 'parts'].forEach(function (k) { (A[k] || []).forEach(function (r) { r.check = (r.conf < 0.7) ? 'thap' : ''; }); });
      A.passes = 1; return A;
    }
    const out = JSON.parse(JSON.stringify(A)); out.passes = 2;
    const keyOf = {
      steel: function (r) { return nz(r.code) ? nz(r.code) + '|' + nz(r.profile) : nz(r.profile) + '|' + Math.round(r.length_mm); },
      plates: function (r) { return Math.round(r.thickness_mm * 10) + '|' + Math.round(r.width_mm) + '|' + Math.round(r.length_mm) + '|' + (r.nham ? 'n' : '') + '|' + nz(r.code); },
      parts: function (r) { return nz(r.name) + '|' + nz(r.spec); }
    };
    ['steel', 'plates', 'parts'].forEach(function (k) {
      const mapB = {}; (B[k] || []).forEach(function (r) { const kk = keyOf[k](r); (mapB[kk] = mapB[kk] || []).push(r); });
      const used = {};
      (out[k] || []).forEach(function (r) {
        const kk = keyOf[k](r), cand = mapB[kk] && mapB[kk].shift();
        if (!cand) { r.check = 'chi1'; r.conf = Math.min(r.conf, 0.5); r.note = (r.note ? r.note + ' · ' : '') + 'lần đọc 2 không thấy dòng này'; return; }
        used[kk] = 1;
        if (Math.abs(cand.qty - r.qty) > 1e-9) { r.check = 'lech'; r.conf = Math.min(r.conf, cand.conf, 0.5); r.note = (r.note ? r.note + ' · ' : '') + 'lần 1 đọc SL ' + r.qty + ', lần 2 đọc SL ' + cand.qty; r.alt_qty = cand.qty; }
        else { r.check = (r.conf < 0.7 || cand.conf < 0.7) ? 'thap' : ''; r.conf = Math.min(r.conf, cand.conf); }
      });
      Object.keys(mapB).forEach(function (kk) { mapB[kk].forEach(function (r) { r.check = 'chi1'; r.conf = Math.min(r.conf, 0.5); r.note = (r.note ? r.note + ' · ' : '') + 'chỉ lần đọc 2 thấy dòng này'; out[k].push(r); }); });
    });
    // cum chinh: hop 2 lan (theo ten)
    const seen = {}; (out.components || []).forEach(function (r) { seen[nz(r.name)] = 1; });
    (B.components || []).forEach(function (r) { if (!seen[nz(r.name)]) { seen[nz(r.name)] = 1; out.components.push(r); } });
    return out;
  }
  const DRAW_JOBS = {};
  function newJobId() { return 'DR-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function gcJobs() { const now = Date.now(); Object.keys(DRAW_JOBS).forEach(function (k) { if (now - DRAW_JOBS[k].at > 3 * 3600 * 1000) delete DRAW_JOBS[k]; }); }
  async function drawRun(job, block, name, careful) {
    try {
      const capUsd = capOf();
      if (capUsd && monthSpend() >= capUsd) throw new Error('Đã dùng hết hạn mức AI tháng này (' + capUsd + ' USD). Nâng AI_MONTH_CAP_USD trên Render nếu cần.');
      job.stage = careful ? 'Đang đọc lần 1/2…' : 'Đang đọc…';
      const p1 = await drawCall(block, name, '');
      addUsage(p1.usage.usd, true);
      let p2 = null, usd = p1.usage.usd;
      if (careful) {
        job.stage = 'Đang đọc lần 2/2 để đối chiếu…';
        p2 = await drawCall(block, name, ' Đây là lần đọc kiểm tra độc lập: đọc lại từng trang từ đầu, cẩn thận từng con số.');
        addUsage(p2.usage.usd, true); usd += p2.usage.usd;
      }
      job.result = mergeDraw(p1.result, p2 && p2.result);
      job.usd = Math.round(usd * 10000) / 10000; job.model = p1.model; job.status = 'done'; job.stage = 'Xong';
      usageAdd(job.ident || { key: 'w:khach', name: '' }, 'draw', job.usd, !!job.owner);
      try { const dc = ctx.loadColl('draw_cache'); dc[job.hash] = { at: Date.now(), name: job.name, result: job.result }; const ks = Object.keys(dc).sort(function (a, b) { return dc[a].at - dc[b].at; }); while (ks.length > 25) delete dc[ks.shift()]; ctx.saveColl('draw_cache', dc); } catch (e2) {}
    } catch (e) { job.status = 'error'; job.error = String((e && e.message) || e); addUsage(0, false); }
  }

  let chain = Promise.resolve();
  function processMessage(x) {
    chain = chain.then(function () { return processOne(x); }).catch(function () {});
    return chain;
  }
  async function processOne(x) {
    const id = nextId();
    const doc = { id: id, at: Date.now(), status: 'draft', source: 'zalo', fromName: x.fromName, fromId: x.fromId, chatId: x.chatId, chatType: x.chatType, text: x.text, hasPhoto: !!x.photoUrl, messageId: x.messageId, items: [], orderCode: '', orderId: '', note: '', ai: null, aiError: '', dept: 'cokhi' };
    saveDoc(id, doc, true);
    let imgBuf = null;
    if (x.photoUrl) {
      try { imgBuf = await downloadPhoto(x.photoUrl, id); doc.photoSaved = true; } catch (e) { doc.photoError = String(e && e.message || e); }
    }
    await analyse(doc, imgBuf, { key: 'z:' + (x.fromId || 'khach'), name: x.fromName || '' }, isOwnerZalo(x.fromId));
    saveDoc(id, doc, true);
    const reply = summaryText(doc);
    if (reply) await sendText(x.chatId, reply);
  }
  // Doc noi dung bang AI (neu co khoa va chua vuot tran thang), khong thi dung quy tac
  async function analyse(doc, imgBuf, ident, owner) {
    const c = cfg(); let parsed = null; ident = ident || { key: 'w:khach', name: '' };
    const capUsd = capOf();
    if (c.aiKey || c.aiMock) {
      const g = gate('msg', ident, owner);
      if (!looksLikeRequest(doc.text, !!imgBuf || !!doc.hasPhoto)) { doc.aiError = ''; doc.skipAi = true; }
      else if (capUsd && monthSpend() >= capUsd) { doc.aiError = 'Da dung het han muc AI thang nay (' + capUsd + ' USD), dung quy tac thay the.'; }
      else if (!g.ok) { doc.aiError = g.reason + ' — hệ thống chỉ tách dòng đơn giản, thủ kho xử lý.'; }
      else if (!rateOk()) { doc.aiError = 'Qua nhieu luot doc AI trong 1 gio, dung quy tac thay the.'; }
      else {
        try {
          const r = await aiParse(doc.text, imgBuf);
          parsed = r.result; doc.ai = { model: r.model, input: r.usage.input, output: r.usage.output, usd: r.usage.usd, at: Date.now() };
          addUsage(r.usage.usd, true); usageAdd(ident, 'msg', r.usage.usd, owner); doc.aiError = '';
        } catch (e) { doc.aiError = String(e && e.message || e); addUsage(0, false); }
      }
    } else doc.aiError = 'Chua co khoa AI - dung quy tac tach dong.';
    if (!parsed) parsed = ruleParse(doc.text);
    doc.orderCode = String(parsed.order_code || '').trim();
    doc.orderId = orderIdByCode(doc.orderCode);
    doc.items = normItems(parsed, doc.orderCode);
    doc.note = String(parsed.note || '').trim();
    doc.intent = (['mua', 'xuat', 'hoi', 'chua_ro', 'khac'].indexOf(parsed.intent) >= 0) ? parsed.intent : (doc.items.length ? 'chua_ro' : 'khac');
    if (!doc.items.length && !String(doc.text || '').trim() && doc.hasPhoto && doc.intent === 'khac') doc.intent = 'chua_ro';
    if (parsed.parse) doc.parse = parsed.parse;
    else {
      // AI doc xong -> doi chieu voi bo quy tac: chi "tin cay cao" (tu dien) khi 2 ben doc giong nhau
      const ru = ruleParse(doc.text || '');
      const sig = function (arr) { return (arr || []).map(function (i) { return (Number(i.qty) || 0) + '|' + String(i.order_code || i.orderCode || '').toUpperCase() + '|' + (i.spare ? 1 : 0); }).sort().join(','); };
      const hasText = String(doc.text || '').trim().length > 0;
      const agree = hasText && ru.items.length === doc.items.length && sig(ru.items) === sig(doc.items);
      doc.parse = { by: 'ai', level: agree ? 'cao' : 'thap', notes: [] };
      if (agree) doc.parse.notes.push('AI và quy tắc đọc giống nhau');
      else if (!hasText) doc.parse.notes.push('tin chỉ có ảnh — thủ kho kiểm tra trước khi điền');
      else doc.parse.notes.push('AI đọc ' + doc.items.length + ' dòng, quy tắc đọc ' + ru.items.length + ' dòng, hai bên khác nhau — kiểm tra trước khi điền');
      if (!agree && hasText && ru.items.length) doc.altItems = ru.items.slice(0, 12).map(function (i) { return { name: i.name, qty: i.qty, unit: i.unit, order_code: i.order_code, spare: !!i.spare, note: i.note || '' }; });
    }
    doc.notRequest = doc.intent === 'khac';
    if (doc.intent === 'khac') doc.status = 'ignored'; else if (doc.intent === 'hoi') doc.status = 'answered';
    resolveItems(doc);
    attachStock(doc);
    doc.needDate = /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.need_date || '')) ? String(parsed.need_date) : '';
    if (parsed.requester && !doc.requester) doc.requester = String(parsed.requester).trim();
    // Yeu cau MUA do AI doc va xac dinh duoc cong trinh -> tu dien vao VT + lap de nghi mua
    if (doc.intent === 'mua' && (doc.parse && doc.parse.level === 'cao') && doc.status !== 'applied' && doc.items.length && doc.items.every(function (it) { return it.orderId && it.qty > 0; })) {
      try { applyBuy(doc); } catch (e) { doc.aiError = (doc.aiError ? doc.aiError + ' | ' : '') + 'Khong tu dien duoc: ' + String((e && e.message) || e); }
    }
    return doc;
  }

  /* ---------------- Cac duong /api/zalo/* ---------------- */
  function safeEq(a, b) {
    const A = Buffer.from(String(a || '')), B = Buffer.from(String(b || ''));
    if (A.length !== B.length) return false;
    try { return crypto.timingSafeEqual(A, B); } catch (e) { return false; }
  }
  async function handle(req, res, u, p, method) {
    if (p.indexOf('/api/zalo/') !== 0) return false;
    const c = cfg();

    if (p === '/api/zalo/webhook' && method === 'POST') {
      if (!c.secret || !safeEq(req.headers['x-bot-api-secret-token'], c.secret)) { ctx.sendJson(res, 403, { ok: false, error: 'forbidden' }); return true; }
      const raw = await ctx.readBody(req);
      if (raw.length > 1024 * 1024) { ctx.sendJson(res, 413, { ok: false }); return true; }
      let body = {}; try { body = JSON.parse(raw); } catch (e) {}
      ctx.sendJson(res, 200, { ok: true });   // tra loi ngay, xu ly sau (Zalo cho toi da 30 giay)
      try {
        const x = extract(body);
        logRaw(body, x.event);
        if (!(x.text || x.photoUrl) || !x.chatId) return true;
        if (x.event && !/message/i.test(x.event)) return true;
        if (seenBefore(x.messageId)) return true;
        processMessage(x);
      } catch (e) {}
      return true;
    }

    if (p === '/api/zalo/status' && method === 'GET') {
      const out = {
        ok: true, tokenSet: !!c.token, secretSet: c.secret.length >= 8, aiSet: !!c.aiKey || c.aiMock, model: c.model, publicUrl: c.publicUrl,
        webhookUrl: c.publicUrl + '/api/zalo/webhook', capUsd: capOf()
      };
      const M = ctx.loadColl('zalo_meta'); out.usage = M.usage || { calls: 0, usd: 0, fails: 0, month: {} }; out.monthUsd = monthSpend();
      if (c.token) {
        try { const me = await zaloCall('getMe', {}); out.me = me.data && (me.data.result || me.data); out.meStatus = me.status; } catch (e) { out.meError = String(e && e.message || e); }
        try { const wi = await zaloCall('getWebhookInfo', {}); out.webhook = wi.data && (wi.data.result || wi.data); } catch (e) { out.webhookError = String(e && e.message || e); }
      }
      ctx.sendJson(res, 200, out); return true;
    }

    if (p === '/api/zalo/register-webhook' && method === 'POST') {
      if (!c.token) { ctx.sendJson(res, 400, { ok: false, error: 'Chua co ZALO_BOT_TOKEN tren Render' }); return true; }
      if (c.secret.length < 8) { ctx.sendJson(res, 400, { ok: false, error: 'ZALO_WEBHOOK_SECRET phai tu 8 ky tu' }); return true; }
      try {
        const r = await zaloCall('setWebhook', { url: c.publicUrl + '/api/zalo/webhook', secret_token: c.secret });
        ctx.sendJson(res, 200, { ok: r.status === 200, zaloStatus: r.status, zalo: r.data || r.raw });
      } catch (e) { ctx.sendJson(res, 500, { ok: false, error: String(e && e.message || e) }); }
      return true;
    }

    let m;
    if ((m = p.match(/^\/api\/zalo\/img\/([A-Za-z0-9\-]+)$/)) && method === 'GET') {
      const f = path.join(IMG_DIR, m[1] + '.img');
      let b = null; try { b = fs.readFileSync(f); } catch (e) {}
      if (!b) { ctx.sendBytes(res, 404, 'text/plain', Buffer.from('no image')); return true; }
      ctx.sendBytes(res, 200, mediaTypeOf(b) || 'application/octet-stream', b); return true;
    }

    // Doc lai bang AI (nut "Doc lai bang AI" tren trang Yeu cau xuat hang); body tuy chon: {text}
    if ((m = p.match(/^\/api\/zalo\/reparse\/([A-Za-z0-9\-]+)$/)) && method === 'POST') {
      const X = ctx.loadColl('xuathang'); const doc = X[m[1]];
      if (!doc) { ctx.sendJson(res, 404, { ok: false, error: 'khong thay yeu cau' }); return true; }
      if (doc.status === 'applied') { ctx.sendJson(res, 400, { ok: false, error: 'Hay hoan tac phan da dien vao VT truoc khi doc lai' }); return true; }
      let b = {}; try { b = JSON.parse((await ctx.readBody(req)) || '{}'); } catch (e) {}
      if (typeof b.text === 'string') doc.text = b.text;
      let imgBuf = null; try { imgBuf = fs.readFileSync(path.join(IMG_DIR, doc.id + '.img')); } catch (e) {}
      await analyse(doc, imgBuf, identOfReq(req), ownerMode(req));
      saveDoc(doc.id, doc, true);
      ctx.sendJson(res, 200, { ok: true, doc: doc }); return true;
    }

    // ---- Han muc AI: /api/zalo/ai/settings (GET xem, POST luu - chi chu), /api/zalo/ai/owner (dat / doi / kiem tra PIN chu) ----
    if (p === '/api/zalo/ai/settings' && method === 'GET') {
      const c = aiCfg(), ident = identOfReq(req), owner = ownerMode(req), L = usageLoad();
      const me = L.day.by[ident.key] || { msgs: 0, draws: 0 }, pp = c.people[ident.key] || {};
      const ownEff = !!c.ownerHash || !!(ctx.authOn && ctx.authOn());
      const out = { ok: true, ownerSet: ownEff, owner: owner && ownEff, limits: c.limits,
        you: { key: ident.key, name: ident.name, msgsToday: me.msgs, drawsToday: me.draws, msgMax: pp.zaloPerDay != null ? pp.zaloPerDay : c.limits.zaloPerDay, drawMax: pp.drawPerDay != null ? pp.drawPerDay : c.limits.drawPerDay },
        dayUsd: L.day.usd, ownerDayUsd: L.day.ownerUsd, monthUsd: monthSpend(), capUsd: capOf() };
      if (owner && ownEff) {
        out.people = c.people; out.ownerZalo = c.ownerZalo; out.todayBy = L.day.by; out.seen = seenZalo();
        out.history = Object.keys(L.U).sort().slice(-14).map(function (k) { return { date: k, usd: L.U[k].usd, ownerUsd: L.U[k].ownerUsd }; });
      }
      ctx.sendJson(res, 200, out); return true;
    }
    if (p === '/api/zalo/ai/owner' && method === 'POST') {
      let b = {}; try { b = JSON.parse((await ctx.readBody(req)) || '{}'); } catch (e) {}
      const c = aiCfg(), action = String(b.action || '');
      if (action === 'check') { ctx.sendJson(res, 200, { ok: pinOk(String(b.pin || '')) }); return true; }
      const np = String(b.newPin || '');
      if (np.length < 4 || np.length > 40) { ctx.sendJson(res, 400, { ok: false, error: 'PIN phải từ 4 ký tự trở lên' }); return true; }
      if (action === 'set' && c.ownerHash) { ctx.sendJson(res, 400, { ok: false, error: 'Đã có PIN chủ — dùng chức năng đổi PIN' }); return true; }
      if (action === 'change' && !pinOk(String(b.pin || ''))) { ctx.sendJson(res, 403, { ok: false, error: 'PIN hiện tại không đúng' }); return true; }
      if (action !== 'set' && action !== 'change') { ctx.sendJson(res, 400, { ok: false, error: 'Sai thao tác' }); return true; }
      c.ownerSalt = crypto.randomBytes(16).toString('hex'); c.ownerHash = hashPin(np, c.ownerSalt); aiCfgSave(c);
      ctx.sendJson(res, 200, { ok: true }); return true;
    }
    if (p === '/api/zalo/ai/settings' && method === 'POST') {
      const c = aiCfg();
      if (!((c.ownerHash || (ctx.authOn && ctx.authOn())) && ownerMode(req))) { ctx.sendJson(res, 403, { ok: false, error: 'Chỉ chủ mới sửa được hạn mức' }); return true; }
      let b = {}; try { b = JSON.parse((await ctx.readBody(req)) || '{}'); } catch (e) {}
      const L0 = b.limits || {};
      c.limits = { zaloPerDay: numIn(L0.zaloPerDay, 0, 1000, c.limits.zaloPerDay), drawPerDay: numIn(L0.drawPerDay, 0, 100, c.limits.drawPerDay), dayUsdCap: numIn(L0.dayUsdCap, 0, 1000, c.limits.dayUsdCap) };
      const people = {}; Object.keys(b.people || {}).slice(0, 80).forEach(function (k) { const v = b.people[k] || {}; if (!/^[wz]:[A-Za-z0-9_\-]{1,60}$/.test(k)) return; people[k] = { name: String(v.name || '').slice(0, 60) }; if (v.zaloPerDay !== '' && v.zaloPerDay != null) people[k].zaloPerDay = numIn(v.zaloPerDay, 0, 1000, c.limits.zaloPerDay); if (v.drawPerDay !== '' && v.drawPerDay != null) people[k].drawPerDay = numIn(v.drawPerDay, 0, 100, 0); });
      c.people = people;
      c.ownerZalo = (Array.isArray(b.ownerZalo) ? b.ownerZalo : []).map(String).filter(function (x) { return /^[A-Za-z0-9_\-]{1,60}$/.test(x); }).slice(0, 10);
      aiCfgSave(c); ctx.sendJson(res, 200, { ok: true }); return true;
    }

    // ---- Chi phi AI (chi chu): /api/zalo/ai/usage ----
    if (p === '/api/zalo/ai/usage' && method === 'GET') {
      const c = aiCfg();
      if (!((c.ownerHash || (ctx.authOn && ctx.authOn())) && ownerMode(req))) { ctx.sendJson(res, 403, { ok: false, error: 'Chỉ chủ mới xem được chi phí AI' }); return true; }
      const M = ctx.loadColl('zalo_meta'); const U0 = M.usage || {}; const L = usageLoad();
      const days = Object.keys(L.U).sort().slice(-30).map(function (k) { return { date: k, usd: L.U[k].usd, ownerUsd: L.U[k].ownerUsd, kinds: L.U[k].kinds || {} }; });
      ctx.sendJson(res, 200, { ok: true, month: monthSpend(), monthKey: new Date().toISOString().slice(0, 7), cap: capOf(), calls: U0.calls || 0, fails: U0.fails || 0, total: U0.usd || 0, model: cfg().model, days: days, today: L.day, monthTable: U0.month || {} });
      return true;
    }
    // ---- Hoi nhanh bang AI: /api/zalo/ask {q, history} ----
    if (p === '/api/zalo/ask' && method === 'POST') {
      let b = {}; try { b = JSON.parse((await ctx.readBody(req)) || '{}'); } catch (e) {}
      const q = String(b.q || '').trim().slice(0, 600);
      if (!q) { ctx.sendJson(res, 400, { ok: false, error: 'Chưa có câu hỏi' }); return true; }
      const c0 = cfg(); if (!c0.aiKey && !c0.aiMock) { ctx.sendJson(res, 200, { ok: false, error: 'noai' }); return true; }
      const ident = identOfReq(req), owner = ownerMode(req);
      const g = gate('msg', ident, owner); if (!g.ok) { ctx.sendJson(res, 200, { ok: false, error: g.reason, limit: true }); return true; }
      const capUsd = capOf(); if (capUsd && monthSpend() >= capUsd) { ctx.sendJson(res, 200, { ok: false, error: 'Đã dùng hết hạn mức AI tháng này (' + capUsd + ' USD)', limit: true }); return true; }
      if (!rateOk()) { ctx.sendJson(res, 200, { ok: false, error: 'Hỏi quá nhiều trong 1 giờ, thử lại sau', limit: true }); return true; }
      try {
        const r = await aiAsk(q, b.history);
        addUsage(r.usage.usd, true); usageAdd(ident, 'ask', r.usage.usd, owner);
        ctx.sendJson(res, 200, { ok: true, answer: r.answer, usd: owner ? r.usage.usd : undefined });
      } catch (e) { addUsage(0, false); ctx.sendJson(res, 200, { ok: false, error: String((e && e.message) || e) }); }
      return true;
    }

    // ---- Doc ban ve: /api/zalo/draw/start (POST {name,mime,data(base64),careful}) va /api/zalo/draw/job/<id> (GET) ----
    if (p === '/api/zalo/draw/start' && method === 'POST') {
      let b = {}; try { b = JSON.parse(await ctx.readBody(req)); } catch (e) {}
      const mime = String(b.mime || ''), data = String(b.data || '');
      if (!data || data.length > 30 * 1024 * 1024) { ctx.sendJson(res, 400, { ok: false, error: 'File trống hoặc lớn quá 22MB' }); return true; }
      if (!/^(application\/pdf|image\/(jpeg|png|webp|gif))$/.test(mime)) { ctx.sendJson(res, 400, { ok: false, error: 'Chỉ nhận PDF hoặc ảnh (JPG/PNG/WEBP)' }); return true; }
      const c0 = cfg(); if (!c0.aiKey && !c0.aiMock) { ctx.sendJson(res, 400, { ok: false, error: 'Chưa có ANTHROPIC_API_KEY trên Render' }); return true; }
      const ident = identOfReq(req), owner = ownerMode(req), g = gate('draw', ident, owner);
      if (!g.ok) { ctx.sendJson(res, 403, { ok: false, error: g.reason }); return true; }
      const capUsd0 = capOf(); if (capUsd0 && monthSpend() >= capUsd0) { ctx.sendJson(res, 403, { ok: false, error: 'Đã dùng hết hạn mức AI tháng này (' + capUsd0 + ' USD).' }); return true; }
      gcJobs();
      const hash = crypto.createHash('sha256').update(data).update(b.careful ? '2' : '1').digest('hex').slice(0, 32);
      const job = { id: newJobId(), at: Date.now(), status: 'running', stage: 'Bắt đầu', name: String(b.name || 'ban-ve').slice(0, 120), ident: ident, owner: owner, hash: hash };
      DRAW_JOBS[job.id] = job;
      const cache = ctx.loadColl('draw_cache');
      if (cache[hash] && cache[hash].result) { job.result = cache[hash].result; job.usd = 0; job.model = 'cache'; job.status = 'done'; job.stage = 'Đã đọc trước đó (lấy lại kết quả, không tốn tiền)'; ctx.sendJson(res, 200, { ok: true, jobId: job.id, cached: true }); return true; }
      const block = mime === 'application/pdf' ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: data } } : { type: 'image', source: { type: 'base64', media_type: mime, data: data } };
      drawRun(job, block, job.name, !!b.careful);
      ctx.sendJson(res, 200, { ok: true, jobId: job.id }); return true;
    }
    if ((m = p.match(/^\/api\/zalo\/draw\/job\/([A-Za-z0-9\-]+)$/)) && method === 'GET') {
      const job = DRAW_JOBS[m[1]];
      if (!job) { ctx.sendJson(res, 404, { ok: false, error: 'Không thấy lượt đọc này (máy chủ có thể vừa khởi động lại) — bấm đọc lại' }); return true; }
      ctx.sendJson(res, 200, { ok: true, status: job.status, stage: job.stage, error: job.error || '', result: job.status === 'done' ? job.result : null, usd: job.usd || 0, model: job.model || '', secs: Math.round((Date.now() - job.at) / 1000) }); return true;
    }

    // Dien vao VT + lap de nghi mua (nut tren web, sau khi chon cong trinh): body {items?}
    if ((m = p.match(/^\/api\/zalo\/apply\/([A-Za-z0-9\-]+)$/)) && method === 'POST') {
      const X = ctx.loadColl('xuathang'); const doc = X[m[1]];
      if (!doc) { ctx.sendJson(res, 404, { ok: false, error: 'khong thay yeu cau' }); return true; }
      if (doc.status === 'applied') { ctx.sendJson(res, 400, { ok: false, error: 'Da dien roi' }); return true; }
      let b = {}; try { b = JSON.parse((await ctx.readBody(req)) || '{}'); } catch (e) {}
      try { applyBuy(doc, Array.isArray(b.items) ? b.items : null); saveDoc(doc.id, doc, true); ctx.sendJson(res, 200, { ok: true, doc: doc }); }
      catch (e) { ctx.sendJson(res, 400, { ok: false, error: String((e && e.message) || e) }); }
      return true;
    }
    if ((m = p.match(/^\/api\/zalo\/undo\/([A-Za-z0-9\-]+)$/)) && method === 'POST') {
      const X = ctx.loadColl('xuathang'); const doc = X[m[1]];
      if (!doc) { ctx.sendJson(res, 404, { ok: false, error: 'khong thay yeu cau' }); return true; }
      try { undoBuy(doc); saveDoc(doc.id, doc, true); ctx.sendJson(res, 200, { ok: true, doc: doc }); }
      catch (e) { ctx.sendJson(res, 400, { ok: false, error: String((e && e.message) || e) }); }
      return true;
    }

    // Tao yeu cau thu tu giao dien web (vi du dan tin Zalo vao): {text, fromName}
    if (p === '/api/zalo/manual' && method === 'POST') {
      let b = {}; try { b = JSON.parse((await ctx.readBody(req)) || '{}'); } catch (e) {}
      const text = String(b.text || '').slice(0, 4000).trim();
      if (!text) { ctx.sendJson(res, 400, { ok: false, error: 'thieu noi dung' }); return true; }
      const id = nextId();
      const doc = { id: id, at: Date.now(), status: 'draft', source: 'web', fromName: String(b.fromName || '').slice(0, 80), text: text, items: [], orderCode: '', orderId: '', note: '', ai: null, aiError: '', dept: 'cokhi' };
      saveDoc(id, doc, true);
      await analyse(doc, null, identOfReq(req), ownerMode(req)); saveDoc(id, doc, true);
      ctx.sendJson(res, 200, { ok: true, doc: doc }); return true;
    }

    ctx.sendJson(res, 404, { ok: false, error: 'Not found' });
    return true;
  }

  return { handle: handle, _test: { ruleParse: ruleParse, extract: extract, findPhotoUrl: findPhotoUrl, mediaTypeOf: mediaTypeOf } };
};
