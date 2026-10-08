/* ================================================================
   rules.js - DOC TIN NHAN MUA/XUAT bang quy tac (khong can AI) + SO SANH TON KHO
   Dung cho zalo.js (may chu). Doan KHO-BEGIN..KHO-END cung duoc chep vao app.html.
   Tuong thich Node 8+.
   ================================================================ */
'use strict';

function stripD(x) { return String(x == null ? '' : x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u0111/gi, 'd').toLowerCase(); }

/*KHO-BEGIN*/
var KHO_STOP = {cai:1,bo:1,cay:1,tam:1,loai:1,hang:1,cho:1,va:1,the:1,thay:1,thep:1,x:1,mm:1,m:1,cm:1,kg:1,o:1,con:1,chiec:1,cty:1,cong:1,ty:1,dai:1,rong:1,day:1,phi:1,no:1,tron:1,ong:1};
function khoWords(s) {
  var t = stripD(s).replace(/[^a-z0-9]+/g, ' ').trim();
  return t ? t.split(' ') : [];
}
function khoCodes(words) { // ma ky hieu: co chu so, dai >= 4 (23228, h2328, kcly550...)
  return words.filter(function (w) { return /\d/.test(w) && w.length >= 4; });
}
// rows: [{c,n,u,q,wh}] ; tra ve toi da 3 dong gan nhat: [{c,n,u,q,wh,score}]
function stockMatch(name, spec, rows) {
  var qw = khoWords(String(name || '') + ' ' + String(spec || ''));
  if (!qw.length || !rows || !rows.length) return [];
  var qcodes = khoCodes(qw);
  var qtext = qw.filter(function (w) { return !/\d/.test(w) && w.length >= 3 && !KHO_STOP[w]; });
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r._w) { r._w = khoWords((r.c || '') + ' ' + (r.n || '')); r._s = r._w.join(''); }
    var rw = r._w, score = 0, tw = 0;
    if (qcodes.length) {
      var hit = 0;
      for (var a = 0; a < qcodes.length; a++) { if (rw.indexOf(qcodes[a]) >= 0 || (/^\d+$/.test(qcodes[a]) && r._s.indexOf(qcodes[a]) >= 0)) hit++; }
      if (hit === 0) continue;
      score = 2 + hit / qcodes.length;
      for (var b = 0; b < qtext.length; b++) { if (rw.indexOf(qtext[b]) >= 0) tw++; }
      score += qtext.length ? tw / qtext.length : 0;
    } else {
      var shared = 0;
      for (var d = 0; d < qtext.length; d++) { if (rw.indexOf(qtext[d]) >= 0) shared++; }
      var rtext = rw.filter(function (w) { return !/\d/.test(w) && w.length >= 3 && !KHO_STOP[w]; });
      var uni = qtext.length + rtext.length - shared;
      if (shared < 2 || !uni || shared / uni < 0.5) continue;
      score = shared / uni;
    }
    out.push({ c: r.c, n: r.n, u: r.u, q: r.q, wh: r.wh, score: Math.round(score * 100) / 100 });
  }
  out.sort(function (x, y) { return y.score - x.score || y.q - x.q; });
  return out.slice(0, 3);
}
/*KHO-END*/

/* ---------------- Doc tin nhan ---------------- */
const UNITS = 'cai|bo|m|met|cay|tam|kg|o|con|cuon|bao|can|lit|cap|chiec|soi|thanh|ong|hop|bich|tui|vien|doi|kien|tap|ram|thung|chai|lon|binh|bang|cum|dau|tay|goi';
const UNIT_RX = '(?:' + UNITS + ')';
const NUM = '(\\d+(?:[.,]\\d+)?)';
const VERBS = 'xuat kho|xuat hang|xuat|lay|mua|dat mua|dat hang|de xuat mua|de nghi mua|can mua';

function num(s) { const v = Number(String(s).replace(',', '.')); return isFinite(v) ? v : ''; }

function parseMessage(text) {
  const T = String(text || '').normalize('NFC').replace(/\r/g, '');
  const S = stripD(T);
  const reasons = [];
  /* --- loai tin (bo @mention, "san xuat", dong tieu de de khoi nham voi chu "xuat") --- */
  const S2 = S.replace(/@\s*bot\s+tro\s+li\s+san\s+xuat/g, ' ').replace(/@\S+/g, ' ').replace(/san xuat/g, ' ').replace(/\bms\b[^\n]*20\d{2}-(?:dl)?\d{2,3}[^\n]*/g, ' ');
  const cMua = (S2.match(/\b(de xuat mua|de nghi mua|dat mua|dat hang|xin mua|can mua|xem mua|mua giup|mua gium|mua ho|mua dum|mua them|mua du phong|bao gia|mua)\b/g) || []).length;
  const cXuat = (S2.match(/\b(xuat kho|xuat hang|xuat|lay ra|cap phat|cap cho|xin lay|cho lay|di lay|lay)\b/g) || []).length;
  const hoiTon = /\b(con khong|co khong|con hang khong|ton kho|kiem tra kho|con bao nhieu|co san khong)\b/.test(S2) ||
    (/\b(con|co)\b[^\n]*\b(khong|ko)\b\s*\??\s*$/m.test(S2) && !/\d+\s*(cai|cay|tam|bo|o|con|m|kg)\b/.test(S2));
  let intent = '';
  if (cMua > cXuat) { intent = 'mua'; reasons.push('có chữ "mua"'); }
  else if (cXuat > cMua) { intent = 'xuat'; reasons.push('có chữ "xuất/lấy"'); }
  else if (cMua && cXuat) { intent = S2.search(/\bmua\b/) < S2.search(/\b(xuat|lay)\b/) ? 'mua' : 'xuat'; reasons.push('vừa có "mua" vừa có "xuất", lấy từ đứng trước'); }
  /* --- ma cong trinh --- */
  const codes = []; const rxc = /\b(20\d{2}-(?:dl)?\d{2,3})\b/gi; let mc;
  while ((mc = rxc.exec(T))) { const c = mc[1].toUpperCase(); if (codes.indexOf(c) < 0) codes.push(c); }
  let top = '';
  const msm = /\bms\b[\s:\-–]*?(20\d{2}-(?:dl)?\d{2,3})/i.exec(T);
  if (msm) top = msm[1].toUpperCase(); else if (codes.length === 1) top = codes[0];
  /* --- tach dong --- */
  const items = []; let spareSec = false; let prev = null; let unsure = 0;
  const lines = T.split('\n');
  for (let li = 0; li < lines.length; li++) {
    let raw = lines[li].trim(); if (!raw) { spareSec = false; continue; }
    raw = raw.replace(/@\s*bot\s+tr[ợo]\s+l[ýíi]\s+s[aả]n\s+xu[aấ]t/ig, ' ').replace(/@[^\s@]+/g, ' ').replace(/ {2,}/g, ' ').trim();
    if (!raw) continue;
    let sd = stripD(raw);
    if (/\bms\b/.test(sd) && /20\d{2}-(dl)?\d{2,3}/.test(sd)) continue;                       // dong tieu de co "MS ... ma"
    if (/^(cong ty|ct |tnhh|cp |co phan|doanh nghiep)/.test(sd) && !/\t/.test(raw)) continue; // ten cong ty
    const cmd = sd.replace(/\b(xin|a|anh|chi|em|oi|nhe|nha|giup|gium|ho|dum|xem|vui long|nho|please)\b/g, ' ')
      .replace(/\b(mua|dat mua|dat hang|de xuat mua|de nghi mua|xuat kho|xuat|lay|can mua|mua them)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
    if (!cmd) continue;                                                                       // chi la cau lenh
    let lineSpare = false;
    if (/^[\-\+\*\u2022\s]*(?:mua\s+)?du phong\s*[:：]?\s*$/.test(sd)) { spareSec = true; continue; }
    if (/^[\-\+\*\u2022\s]*(?:mua\s+)?du phong\s*[:：]\s*\S/.test(sd)) { raw = raw.replace(/^[^:：]*[:：]\s*/, ''); lineSpare = true; }
    let rest0 = raw.replace(/^[\-\+\*\u2022]\s*/, '');
    const sd0 = stripD(rest0);
    const cp = new RegExp('^[^:\\n]{0,40}?\\b(?:' + VERBS + ')\\b[^:\\n]{0,40}?:\\s*(.+)$').exec(sd0);
    if (cp) rest0 = rest0.slice(rest0.length - cp[1].length);
    else {
      const cv = new RegExp('^(?:(?:anh|chi|em|a|c)\\s+)?(?:can|muon|xin|nho|cho)?\\s*(?:' + VERBS + ')\\s+(?:giup\\s+|gium\\s+|ho\\s+|dum\\s+)?(.+)$').exec(sd0);
      if (cv) rest0 = rest0.slice(rest0.length - cv[1].length);
    }
    const segs = rest0.split(/\s\+\s|;/);
    for (let si = 0; si < segs.length; si++) {
      const r = parseSeg(segs[si], prev, top, spareSec || lineSpare, items.length ? items[0].order_code : '');
      if (!r) continue;
      if (r.unsure) unsure++;
      items.push(r.item); prev = r.item;
    }
  }
  if (!intent && !hoiTon) { for (let k = items.length - 1; k >= 0; k--) { if (!(items[k].qty > 0)) items.splice(k, 1); } }
  const isReq = items.length > 0 || !!intent;
  if (!intent && hoiTon) {                                     // hoi ton kho: ten vat tu = cau hoi bo chu thua
    intent = 'hoi'; reasons.push('hỏi còn/có hàng không');
    items.length = 0;
    T.split('\n').forEach(function (ln) {
      const o = ln.replace(/@[^\s@]+/g, ' ').replace(/(^|\s)(còn|có|trong kho|tồn kho|không|ko|bao nhiêu|sẵn|hàng|kiểm tra|xem giúp|giúp)(?=\s|$|\?)/gi, ' ').replace(/[?!]/g, ' ').replace(/ {2,}/g, ' ').trim();
      if (o.length >= 3) items.push({ name: o, spec: '', qty: '', unit: '', order_code: '', spare: false, who: '' });
    });
  }
  if (!intent && items.length) { intent = 'chua_ro'; reasons.push('có danh sách vật tư nhưng không thấy chữ "mua" hay "xuất"'); }
  if (!intent) intent = 'khac';
  const allQty = items.length > 0 && items.every(function (it) { return it.qty > 0; });
  const allCode = items.length > 0 && items.every(function (it) { return it.order_code; });
  const notes = reasons.slice();
  if (items.length && intent !== 'hoi' && !allQty) notes.push('có dòng chưa rõ số lượng');
  if (items.length && intent !== 'hoi' && !allCode) notes.push('có dòng chưa rõ công trình');
  if (unsure) notes.push('có dòng đọc đoán (kiểm tra lại)');
  if (intent === 'mua' && !items.length) notes.push('chưa thấy dòng vật tư nào (có thể ở ảnh hoặc tin trước)');
  const level = (intent === 'mua' && allQty && allCode && !unsure) ? 'cao' : 'thap';
  return { is_request: isReq && intent !== 'khac', intent: intent, need_date: '', order_code: top, requester: '', items: items, note: '',
    parse: { by: 'rule', level: level, notes: notes } };
}

function parseSeg(seg0, prev, top, inSpare, firstCode) {
  let seg = String(seg0 || '').trim().replace(/^[\-\+\*\u2022\s]+/, '');
  if (!seg) return null;
  let sd = stripD(seg);
  let code = ''; const mcd = /\b(20\d{2}-(?:dl)?\d{2,3})\b/i.exec(seg);
  if (mcd) { code = mcd[1].toUpperCase(); seg = (seg.slice(0, mcd.index) + ' ' + seg.slice(mcd.index + mcd[0].length)).trim(); sd = stripD(seg); }
  let who = '';
  const mcty = /\b(?:cty|cong ty)\s+(.+)$/.exec(sd);
  if (mcty) { who = seg.slice(mcty.index).replace(/^\S+\s+(?=\S)/, '').trim(); seg = seg.slice(0, mcty.index).trim(); sd = stripD(seg); }
  let spare = !!inSpare;
  if (/(^|[\s,(\-])(dp|d\.p|du phong)([\s,)\-]|$)/.test(sd)) {
    spare = true;
    seg = seg.replace(/(^|[\s,(\-])(DP|dp|Dp|d\.p|d[ựu]\s*ph[òo]ng)(?=[\s,)\-]|$)/g, '$1').replace(/\(\s*\)/g, '').replace(/ {2,}/g, ' ').trim();
    sd = stripD(seg);
  }
  seg = seg.replace(/\s+(?:cho|vao|cua)(?:\s+(?:don|ct|cong trinh))?\s*$/i, '').replace(/\s+(?:don|ct|cong trinh)\s*$/i, '').replace(/[\s,;:\-–]+$/, '').trim();
  sd = stripD(seg);
  if (!seg) return null;
  const mk = function (name, spec, qty, unit, unsure) {
    return { unsure: !!unsure, item: { name: String(name).replace(/[\s,;:\-–]+$/, '').trim(), spec: String(spec || '').trim(), qty: qty, unit: String(unit || '').trim(), order_code: code || top || '', spare: spare, who: who } };
  };
  // "1 sua mn a lai" / "1" (them N cai cua vat tu truoc, cho don khac / du phong)
  let m = new RegExp('^' + NUM + '\\s*(.*)$').exec(sd);
  if (m && prev && !new RegExp('^' + UNIT_RX + '\\b').test(m[2] || '') && (code || spare || !m[2]) && Number(m[1].replace(',', '.')) < 1000) {
    const q = num(m[1]); const restOrig = seg.slice(seg.length - (m[2] || '').length).trim();
    if (q) return { unsure: true, item: { name: prev.name, spec: prev.spec, qty: q, unit: prev.unit, order_code: code || (spare ? (firstCode || prev.order_code) : prev.order_code), spare: spare, who: who || '', note: restOrig } };
  }
  // cot tab (dan tu sheet): ten \t\t DVT \t SL
  if (/\t/.test(seg)) {
    const cols = seg.split(/\t+/).map(function (c) { return c.trim(); }).filter(Boolean);
    if (cols.length >= 2 && /^\d+(?:[.,]\d+)?$/.test(cols[cols.length - 1])) {
      const q = num(cols[cols.length - 1]);
      const u = cols.length >= 3 ? cols[cols.length - 2] : '';
      const unitOk = /^[A-Za-zÀ-ỹ]{1,8}$/.test(u);
      return mk(cols[0], cols.slice(1, unitOk ? -2 : -1).join(' '), q, unitOk ? u : '');
    }
  }
  // "ten so luong 01 cay"
  m = new RegExp('^(.+?)\\s*(?:so luong|slg|sl)\\s*[:=]?\\s*' + NUM + '\\s*(' + UNIT_RX + ')?\\b(.*)$').exec(sd);
  if (m) { const L1 = m[1].length; const rest = seg.slice(seg.length - (m[4] || '').length).trim(); const up = m[3] ? sd.indexOf(m[3], L1 + m[2].length) : -1; return mk(seg.slice(0, L1), rest, num(m[2]), up >= 0 ? seg.slice(up, up + m[3].length) : ''); }
  // "ten x 5 cay (ghi chu)"   ('x 6m' dinh lien don vi do dai KHONG phai so luong)
  m = new RegExp('^(.+?)\\s*[x×]\\s*' + NUM + '\\s+(' + UNIT_RX + ')\\b\\s*(.*)$').exec(sd);
  if (m) { const L1 = m[1].length; const rest = seg.slice(seg.length - (m[4] || '').length).trim(); const up = sd.indexOf(m[3], L1 + m[2].length); return mk(seg.slice(0, L1), rest, num(m[2]), seg.slice(up, up + m[3].length)); }
  // "5 cay ten"
  m = new RegExp('^' + NUM + '\\s*(' + UNIT_RX + ')\\s+(.+)$').exec(sd);
  if (m) { const up = sd.indexOf(m[2], m[1].length); return mk(seg.slice(seg.length - m[3].length), '', num(m[1]), seg.slice(up, up + m[2].length)); }
  // "ten 5 cay"
  m = new RegExp('^(.+?)\\s+' + NUM + '\\s*(' + UNIT_RX + ')\\s*$').exec(sd);
  if (m) { const L1 = m[1].length; const up = sd.lastIndexOf(m[3]); return mk(seg.slice(0, L1), '', num(m[2]), seg.slice(up, up + m[3].length)); }
  // "ten x 5"  (khong don vi)
  m = /^(.+?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*$/.exec(sd);
  if (m) { return mk(seg.slice(0, m[1].length), '', num(m[2]), '', true); }
  if (seg.length < 3) return null;
  return mk(seg, '', '', '', false);
}

module.exports = { parseMessage: parseMessage, stockMatch: stockMatch, stripD: stripD, khoWords: khoWords };
