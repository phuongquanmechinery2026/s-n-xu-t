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
  const UNIT_RE = '(cai|cái|bo|bộ|m|met|mét|cay|cây|tam|tấm|kg|o|ổ|con|cuon|cuộn|bao|can|lit|lít|cap|cặp|chiec|chiếc|sợi|soi|thanh|ống|ong|hộp|hop)';
  function ruleParse(text) {
    const items = []; let order = '';
    const mo = /(\d{4}-(?:DL)?\d{2,3})/i.exec(text || ''); if (mo) order = mo[1].toUpperCase();
    String(text || '').split(/\n|;/).forEach(function (raw) {
      let line = raw.replace(/^[\s\-\*\u2022\d]{0,4}[.)]\s*/, '').replace(/^[\s\-\*\u2022]+/, '').trim();
      if (!line || line.length < 3) return;
      if (/^(@\S+|xin chao|chào|cho anh|cho em|nhờ|nho|yêu cầu|yeu cau|xuất|xuat)\b[^\d]*$/i.test(line) && !/\d/.test(line)) return;
      let m;
      if ((m = new RegExp('^(.*?)\\s*[:\\-–]?\\s*[xX×]\\s*(\\d+[.,]?\\d*)\\s*' + UNIT_RE + '?\\s*$', 'i').exec(line))) {
        items.push({ name: m[1].trim(), spec: '', qty: Number(m[2].replace(',', '.')), unit: (m[3] || '').trim(), order_code: '' });
      } else if ((m = new RegExp('^(\\d+[.,]?\\d*)\\s*' + UNIT_RE + '\\s+(.+)$', 'i').exec(line))) {
        items.push({ name: m[3].trim(), spec: '', qty: Number(m[1].replace(',', '.')), unit: m[2].trim(), order_code: '' });
      } else if ((m = new RegExp('^(.+?)\\s+(\\d+[.,]?\\d*)\\s*' + UNIT_RE + '\\s*$', 'i').exec(line))) {
        items.push({ name: m[1].trim(), spec: '', qty: Number(m[2].replace(',', '.')), unit: m[3].trim(), order_code: '' });
      }
    });
    return { is_request: items.length > 0, order_code: order, requester: '', items: items, note: '' };
  }

  /* ---------------- AI doc tin nhan + anh ---------------- */
  const SCHEMA = {
    type: 'object',
    properties: {
      is_request: { type: 'boolean' },
      order_code: { type: 'string' },
      requester: { type: 'string' },
      note: { type: 'string' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' }, spec: { type: 'string' }, qty: { type: 'number' }, unit: { type: 'string' }, order_code: { type: 'string' }
          },
          required: ['name', 'spec', 'qty', 'unit', 'order_code'], additionalProperties: false
        }
      }
    },
    required: ['is_request', 'order_code', 'requester', 'note', 'items'], additionalProperties: false
  };
  function activeOrdersText() {
    const O = ctx.loadColl('orders'); const lines = [];
    Object.keys(O).forEach(function (id) {
      const o = O[id]; if (!o || o.legacy || !o.code) return;
      const its = (o.items || []).filter(function (i) { return i && String(i.name || '').trim(); });
      if (its.length && its.every(function (i) { return i.status === 'ĐÃ GIAO'; })) return;
      const cust = String(o.customerInfo || '').split('\n')[0].slice(0, 70);
      lines.push(o.code + ' | ' + (its[0] ? String(its[0].name).replace(/\s+/g, ' ').slice(0, 60) : '') + ' | ' + cust);
    });
    return lines.slice(0, 80).join('\n');
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
    const system = 'Bạn là trợ lý kho của Nhà máy Phương Quân (cơ khí và điện). Nhân viên nhắn tin Zalo (kèm ảnh nếu có) để YÊU CẦU XUẤT VẬT TƯ từ kho. ' +
      'Hãy trích danh sách vật tư cần xuất: name (tên vật tư, giữ nguyên chữ nhân viên viết), spec (quy cách/kích thước nếu có, không có thì chuỗi rỗng), qty (số lượng là số; không rõ thì 0), unit (đơn vị: cái, bộ, mét, cây, tấm, kg…; không rõ thì rỗng), order_code (mã công trình của dòng đó nếu rõ). ' +
      'order_code ở cấp trên là mã công trình chung của yêu cầu (dạng 2026-187, 2026-DL09…). Chỉ dùng mã có trong danh sách công trình đang làm bên dưới; nếu tin nhắn nhắc tên khách hoặc tên máy thì chọn mã tương ứng; không chắc thì để rỗng. ' +
      'requester: tên người cần nhận hàng nếu tin nhắn nói rõ, không thì rỗng. note: ghi chú ngắn (hạn cần, nơi giao…) nếu có. ' +
      'is_request = false nếu tin nhắn không phải yêu cầu xuất vật tư (chào hỏi, hỏi thăm…). Không bịa thêm vật tư không có trong tin/ảnh. Trả lời đúng định dạng JSON yêu cầu.\n\nDanh sách công trình đang làm (mã | hạng mục | khách):\n' + activeOrdersText();
    const payload = {
      model: c.model, max_tokens: 3000,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: content }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } }
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
      const code = String(it.order_code || topCode || '').trim();
      return { name: String(it.name || '').trim(), spec: String(it.spec || '').trim(), qty: (typeof it.qty === 'number' && isFinite(it.qty) && it.qty > 0) ? it.qty : '', unit: String(it.unit || '').trim(), orderCode: code, orderId: orderIdByCode(code) };
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
  function summaryText(doc) {
    const n = (doc.items || []).length;
    let t = 'Đã nhận yêu cầu ' + doc.id + (n ? ' gồm ' + n + ' mục:' : ': chưa đọc được mục nào, thủ kho sẽ xem tin gốc.');
    (doc.items || []).slice(0, 8).forEach(function (it, i) { t += '\n' + (i + 1) + '. ' + it.name + (it.spec ? ' (' + it.spec + ')' : '') + (it.qty ? ' x ' + it.qty : '') + (it.unit ? ' ' + it.unit : ''); });
    if (n > 8) t += '\n… và ' + (n - 8) + ' mục nữa';
    if (doc.orderCode) t += '\nCông trình: ' + doc.orderCode;
    return t + '\nChờ thủ kho duyệt.';
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
    await analyse(doc, imgBuf);
    saveDoc(id, doc, true);
    await sendText(x.chatId, summaryText(doc));
  }
  // Doc noi dung bang AI (neu co khoa va chua vuot tran thang), khong thi dung quy tac
  async function analyse(doc, imgBuf) {
    const c = cfg(); let parsed = null;
    const capUsd = capOf();
    if (c.aiKey || c.aiMock) {
      if (capUsd && monthSpend() >= capUsd) { doc.aiError = 'Da dung het han muc AI thang nay (' + capUsd + ' USD), dung quy tac thay the.'; }
      else if (!rateOk()) { doc.aiError = 'Qua nhieu luot doc AI trong 1 gio, dung quy tac thay the.'; }
      else {
        try {
          const r = await aiParse(doc.text, imgBuf);
          parsed = r.result; doc.ai = { model: r.model, input: r.usage.input, output: r.usage.output, usd: r.usage.usd, at: Date.now() };
          addUsage(r.usage.usd, true); doc.aiError = '';
        } catch (e) { doc.aiError = String(e && e.message || e); addUsage(0, false); }
      }
    } else doc.aiError = 'Chua co khoa AI - dung quy tac tach dong.';
    if (!parsed) parsed = ruleParse(doc.text);
    doc.notRequest = parsed.is_request === false && !(parsed.items && parsed.items.length);
    doc.orderCode = String(parsed.order_code || '').trim();
    doc.orderId = orderIdByCode(doc.orderCode);
    doc.items = normItems(parsed, doc.orderCode);
    doc.note = String(parsed.note || '').trim();
    if (parsed.requester && !doc.requester) doc.requester = String(parsed.requester).trim();
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
      let b = {}; try { b = JSON.parse((await ctx.readBody(req)) || '{}'); } catch (e) {}
      if (typeof b.text === 'string') doc.text = b.text;
      let imgBuf = null; try { imgBuf = fs.readFileSync(path.join(IMG_DIR, doc.id + '.img')); } catch (e) {}
      await analyse(doc, imgBuf);
      saveDoc(doc.id, doc, true);
      ctx.sendJson(res, 200, { ok: true, doc: doc }); return true;
    }

    // Tao yeu cau thu tu giao dien web (vi du dan tin Zalo vao): {text, fromName}
    if (p === '/api/zalo/manual' && method === 'POST') {
      let b = {}; try { b = JSON.parse((await ctx.readBody(req)) || '{}'); } catch (e) {}
      const text = String(b.text || '').slice(0, 4000).trim();
      if (!text) { ctx.sendJson(res, 400, { ok: false, error: 'thieu noi dung' }); return true; }
      const id = nextId();
      const doc = { id: id, at: Date.now(), status: 'draft', source: 'web', fromName: String(b.fromName || '').slice(0, 80), text: text, items: [], orderCode: '', orderId: '', note: '', ai: null, aiError: '', dept: 'cokhi' };
      saveDoc(id, doc, true);
      await analyse(doc, null); saveDoc(id, doc, true);
      ctx.sendJson(res, 200, { ok: true, doc: doc }); return true;
    }

    ctx.sendJson(res, 404, { ok: false, error: 'Not found' });
    return true;
  }

  return { handle: handle, _test: { ruleParse: ruleParse, extract: extract, findPhotoUrl: findPhotoUrl, mediaTypeOf: mediaTypeOf } };
};
