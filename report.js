/* ================================================================
   report.js — BÁO CÁO TUẦN (sáng thứ Hai): tính dữ liệu + soạn 2 tin chữ + vẽ ảnh DASHBOARD TIẾN ĐỘ (PNG)
   Không dùng thư viện ngoài: tự vẽ ảnh bằng bộ chữ Source Sans Pro (SIL OFL) trong fontatlas.js, mã hóa PNG bằng zlib có sẵn của Node.
   ================================================================ */
'use strict';
const zlib = require('zlib');
const ATLAS = require('./fontatlas.js');

/* ---------- ngày ---------- */
function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function dm(iso) { return iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : ''; }
function diffDays(a, b) { return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000); }
function dow(iso) { return new Date(iso + 'T00:00:00Z').getUTCDay(); }   // 0=CN

/* ---------- dữ liệu ---------- */
function isoOf(v) { return v ? String(v).slice(0, 10) : ''; }
// tên khách gọn: bỏ "CÔNG TY TNHH / CP / HỘ KINH DOANH...", viết hoa chữ đầu mỗi từ
function shortCust(s) {
  s = String(s || '').split(/[\r\n]/)[0].replace(/[\s-]+$/, '').split(/\s-\s|-\s/)[0].trim();
  s = s.replace(/^(CÔNG TY|CTY)\s+(TNHH|CP|CỔ PHẦN)?\s*(MTV)?\s*/i, '').replace(/^(HỘ KINH DOANH|HKD|DNTN|TNHH|CP)\s+/i, '').trim();
  s = s.toLowerCase().replace(/(^|\s)(\S+)/g, function (m, a, w) { return a + (/^[a-z]{1,2}$/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)); });
  return s.slice(0, 40);
}
function buildData(orders, tasks, baseIso) {
  const end = addDays(baseIso, 13), G = {};   // gom Cơ khí + Điện cùng số đơn thành 1 công trình
  let held = 0; const heldCodes = {};
  Object.keys(orders || {}).forEach(function (id) {
    const o = orders[id]; if (!o || o.legacy || o.dept === 'dien') return;   // báo cáo chỉ theo Cơ khí (Điện hay cập nhật trễ)
    const its = (o.items || []).filter(function (i) { return i && String(i.name || '').trim(); });
    if (its.length && its.every(function (i) { return i.status === 'ĐÃ GIAO'; })) return;
    const code = o.code || o.id;
    if (o.hold && o.hold.since) { if (!heldCodes[code]) { heldCodes[code] = 1; held++; } return; }
    let sn = ''; (o.progressSnapshots || []).forEach(function (s) { const d = isoOf(s && s.deliveryDate); if (d && (!sn || d < sn)) sn = d; });
    const rec = { o: o, its: its, code: code, dien: o.dept === 'dien', eff: isoOf(o.sched && o.sched.ship) || sn, sn: sn };
    (G[code] = G[code] || []).push(rec);
  });
  const P = []; let over = 0;
  Object.keys(G).forEach(function (code) {
    const recs = G[code], main = recs.filter(function (r) { return !r.dien; })[0] || recs[0];
    // Cơ khí đổi lịch thì Điện đổi theo -> lấy lịch của Cơ khí làm chuẩn
    const eff = main.eff || (recs.filter(function (r) { return r.eff; })[0] || {}).eff || '';
    const o = main.o, its = main.its;
    let nIt = 0, nDone = 0, nWork = 0, tkOpen = 0, tkLate = 0; const who = {};
    recs.forEach(function (r) {
      nIt += r.its.length; nDone += r.its.filter(function (i) { return /XONG|GIAO/.test(i.status || ''); }).length; nWork += r.its.filter(function (i) { return i.status === 'ĐANG SẢN XUẤT'; }).length;
      Object.keys(tasks || {}).map(function (k) { return tasks[k]; }).filter(function (t) { return t && t.orderId === r.o.id && t.status !== 'Xong'; }).forEach(function (t) { tkOpen++; if (t.date && isoOf(t.date) < baseIso) tkLate++; if (t.who) who[t.who] = 1; });
    });
    const late = !!eff && eff < baseIso, allDone = nIt > 0 && nDone === nIt;
    if (late && !allDone) over++;                       // quá hạn mà chưa xong (không tạm dừng — đơn tạm dừng đã loại ở trên)
    if (!eff || eff > end || (late && allDone)) return;  // đã sản xuất xong thì không coi là trễ
    // tên thiết bị: đơn nhiều hạng mục -> lấy phần thiết bị trong "Khách - Thiết bị"; đơn 1 hạng mục -> tên hạng mục
    const cl = String(o.customerInfo || '').split(/[\r\n]+/).map(function (x) { return x.trim(); }).filter(Boolean);
    let equip = cl.length > 1 ? cl.slice(1).join(' ') : (cl[0] || '').split(/\s-\s|-\s/).slice(1).join(' - ');
    equip = equip.replace(/[…\.]+\s*$/, '').replace(/\s+/g, ' ').trim();
    const first = its.length ? String(its[0].name).replace(/\s+/g, ' ').trim().replace(/[:：]\s*$/, '') : '';
    const name = ((its.length > 1 && equip.length >= 4) ? equip : (first || equip || cl[0] || '')).split(' / ')[0].replace(/\s+/g, ' ').trim();
    const sc = (recs.filter(function (r) { return r.o.sched && r.o.sched.rev; })[0] || main).o.sched || {};
    P.push({ id: o.id, code: code, due: eff, name: name.slice(0, 70), cust: shortCust(o.customerInfo || (recs[0].o.customerInfo)),
      late: late, lateDays: late ? diffDays(baseIso, eff) : 0, nIt: nIt, nDone: nDone, nWork: nWork, rev: sc.rev || 0, orig: isoOf(sc.orig) || main.sn,
      tkOpen: tkOpen, tkLate: tkLate, who: Object.keys(who).sort() });
  });
  P.sort(function (a, b) { return a.due < b.due ? -1 : a.due > b.due ? 1 : (a.code < b.code ? -1 : 1); });
  return { base: baseIso, end: end, P: P, over: over, overCk: over, overDien: 0, held: held };
}

/* ---------- tin chữ: 1 tin tóm tắt lịch thử máy & xuất hàng (báo cáo vật tư làm sau) ---------- */
const WD = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
function messages(D) {
  const base = D.base, head = 'BÁO CÁO TIẾN ĐỘ TUẦN ' + dm(base) + ' (' + dm(base) + ' – ' + dm(D.end) + ')';
  const up = D.P.filter(function (p) { return !p.late; }), lt = D.P.filter(function (p) { return p.late; });
  const L = [head];
  if (!up.length) L.push('Không có công trình nào đến lịch thử máy & xuất hàng trong 2 tuần tới.');
  else {
    L.push('Lịch thử máy & xuất hàng 2 tuần tới (' + up.length + ' công trình):');
    let cur = '';
    up.forEach(function (p) {
      if (p.due !== cur) {
        cur = p.due; const nd = diffDays(p.due, base);
        L.push('', WD[dow(p.due)] + ' ' + dm(p.due) + (nd <= 0 ? ' — HÔM NAY' : (nd === 1 ? ' (ngày mai)' : '')));
      }
      L.push('• [' + p.code + '] ' + (p.cust ? p.cust + ' – ' : '') + p.name + ': thử máy & xuất hàng');
      if (p.rev && p.orig && p.orig !== p.due) L.push('   ⚠ ' + (p.due > p.orig ? 'DỜI LỊCH' : 'ĐỔI LỊCH') + ': từ ' + dm(p.orig) + ' sang ' + dm(p.due) + ' (lần ' + p.rev + ')');
      else if (p.rev) L.push('   ✓ Đã xác nhận lịch (lần ' + p.rev + ')');
    });
  }
  let tin2 = '';
  if (lt.length) {
    const M = ['⚠ QUÁ HẠN CHƯA XONG — chưa giao, không tạm dừng (' + lt.length + ' công trình):', ''];
    lt.slice().sort(function (a, b) { return b.lateDays - a.lateDays; }).forEach(function (p) {
      M.push('• [' + p.code + '] ' + (p.cust ? p.cust + ' – ' : '') + p.name + ': hạn ' + dm(p.due) + ' (' + WD[dow(p.due)] + '), trễ ' + p.lateDays + ' ngày · xong ' + p.nDone + '/' + p.nIt + ' hạng mục');
    });
    let more = 0; while (M.join('\n').length > 1750 && M.length > 4) { M.pop(); more++; }
    if (more) M.push('… và ' + more + ' công trình nữa (xem trên web, trang Kế hoạch).');
    tin2 = M.join('\n');
  }
  return { tin1: L.join('\n'), tin2: tin2 };
}

/* ---------- bộ vẽ ---------- */
let GLYPH = null;
function glyphs() { if (!GLYPH) GLYPH = zlib.inflateSync(Buffer.from(ATLAS.z, 'base64')); return GLYPH; }
function Canvas(w, h, bg) {
  this.w = w; this.h = h; this.d = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) { this.d[i * 3] = bg[0]; this.d[i * 3 + 1] = bg[1]; this.d[i * 3 + 2] = bg[2]; }
}
Canvas.prototype.px = function (x, y, c, a) {
  if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
  const i = (y * this.w + x) * 3, d = this.d;
  if (a >= 1) { d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; return; }
  d[i] = d[i] + (c[0] - d[i]) * a; d[i + 1] = d[i + 1] + (c[1] - d[i + 1]) * a; d[i + 2] = d[i + 2] + (c[2] - d[i + 2]) * a;
};
Canvas.prototype.rect = function (x, y, w, h, c, a) { x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h); for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.px(i, j, c, a == null ? 1 : a); };
// hình chữ nhật bo góc, có thể viền (stroke>0 chỉ vẽ viền)
Canvas.prototype.rrect = function (x, y, w, h, r, c, stroke, a) {
  r = Math.min(r, w / 2, h / 2); const cx = x + w / 2, cy = y + h / 2, hw = w / 2 - r, hh = h / 2 - r;
  for (let j = Math.floor(y) - 1; j <= Math.ceil(y + h); j++) for (let i = Math.floor(x) - 1; i <= Math.ceil(x + w); i++) {
    const px = i + 0.5 - cx, py = j + 0.5 - cy, qx = Math.abs(px) - hw, qy = Math.abs(py) - hh;
    const dist = Math.sqrt(Math.max(qx, 0) * Math.max(qx, 0) + Math.max(qy, 0) * Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    let cov = stroke ? Math.min(Math.max(0.5 - dist, 0), 1) * Math.min(Math.max(dist + stroke + 0.5, 0), 1) : Math.min(Math.max(0.5 - dist, 0), 1);
    if (cov > 0) this.px(i, j, c, cov * (a == null ? 1 : a));
  }
};
// hình quạt tròn (độ, 0 = hướng 3 giờ, chiều kim đồng hồ); a1>a0
Canvas.prototype.pie = function (cx, cy, R, a0, a1, c) {
  for (let j = Math.floor(cy - R) - 1; j <= Math.ceil(cy + R); j++) for (let i = Math.floor(cx - R) - 1; i <= Math.ceil(cx + R); i++) {
    const dx = i + 0.5 - cx, dy = j + 0.5 - cy, r = Math.sqrt(dx * dx + dy * dy); if (r > R + 1) continue;
    let ang = Math.atan2(dy, dx) * 180 / Math.PI; while (ang < a0) ang += 360; while (ang >= a0 + 360) ang -= 360;
    if (ang <= a1) this.px(i, j, c, Math.min(Math.max(R - r + 0.5, 0), 1));
  }
};
Canvas.prototype.disc = function (cx, cy, R, c) { this.pie(cx, cy, R, 0, 360, c); };
function fontOf(bold) { return ATLAS.fonts[bold ? 'b' : 'r']; }
Canvas.prototype.measure = function (str, size, bold) {
  const F = fontOf(bold), s = size / ATLAS.em; let w = 0;
  for (const ch of String(str)) { const g = F.g[ch] || F.g['?']; if (g) w += g[0] * s; }
  return w;
};
// vẽ chữ: y = mép trên dòng; anchor 'l' | 'c' | 'r'
Canvas.prototype.text = function (str, x, y, size, col, bold, anchor) {
  const F = fontOf(bold), s = size / ATLAS.em, G = glyphs(); str = String(str);
  if (anchor === 'c') x -= this.measure(str, size, bold) / 2; else if (anchor === 'r') x -= this.measure(str, size, bold);
  let pen = x;
  for (const ch of str) {
    const g = F.g[ch] || F.g['?']; if (!g) continue;
    const adv = g[0], ox = g[1], oy = g[2], w = g[3], h = g[4], off = g[5];
    if (off >= 0 && w > 0) {
      const gx = pen + ox * s, gy = y + oy * s, dw = Math.ceil(w * s) + 1, dh = Math.ceil(h * s) + 1;
      for (let dj = 0; dj < dh; dj++) for (let di = 0; di < dw; di++) {
        let acc = 0;
        for (let sj = 0; sj < 2; sj++) for (let si = 0; si < 2; si++) {
          const sx = (di + 0.25 + si * 0.5 + (Math.floor(gx) - gx)) / s - 0.5, sy = (dj + 0.25 + sj * 0.5 + (Math.floor(gy) - gy)) / s - 0.5;
          const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
          const at = function (xx, yy) { return (xx < 0 || yy < 0 || xx >= w || yy >= h) ? 0 : G[off + yy * w + xx]; };
          acc += (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
        }
        const a = acc / 4 / 255; if (a > 0.02) this.px(Math.floor(gx) + di, Math.floor(gy) + dj, col, Math.min(a, 1));
      }
    }
    pen += adv * s;
  }
  return pen - x;
};
Canvas.prototype.fit = function (str, size, bold, maxw) { str = String(str); if (this.measure(str, size, bold) <= maxw) return str; while (str.length > 1 && this.measure(str + '…', size, bold) > maxw) str = str.slice(0, -1); return str + '…'; };
let CRC = null;
function crc32(buf) { if (!CRC) { CRC = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); CRC[n] = c; } } let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
Canvas.prototype.png = function () {
  const w = this.w, h = this.h, raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; this.d.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const chunk = function (type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
};

/* ---------- ảnh DASHBOARD TIẾN ĐỘ ---------- */
const NAVY = [13, 40, 74], BLUE = [31, 95, 168], ORG = [214, 120, 20], RED = [205, 48, 48], GRN = [30, 140, 80], AMB = [176, 130, 0], GREY = [190, 200, 215], INK = [20, 40, 70], MUTE = [110, 125, 145], LINE = [215, 224, 236];
function urgency(n) { return n <= 0 ? [RED, 'HÔM NAY'] : (n <= 3 ? [ORG, 'còn ' + n + ' ngày'] : (n <= 7 ? [AMB, 'còn ' + n + ' ngày'] : [GRN, 'còn ' + n + ' ngày'])); }
function mix(c, k) { return [c[0] + (255 - c[0]) * k, c[1] + (255 - c[1]) * k, c[2] + (255 - c[2]) * k]; }
function dashboardPng(D) {
  const P = D.P, W = 1080, rows = Math.max(P.length, 1), H = 190 + 25 + 128 + 32 + 300 + 30 + 56 + 64 + rows * 96 + 40 + 120;
  const g = new Canvas(W, H, [244, 247, 251]);
  g.rect(0, 0, W, 190, NAVY);
  g.text('DASHBOARD TIẾN ĐỘ — TUẦN ' + dm(D.base), 48, 22, 54, [255, 255, 255], true);
  g.text('Lịch thử máy & xuất hàng 2 tuần tới + đơn quá hạn chưa xong', 48, 96, 34, [190, 215, 245], false);
  const wd = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'][dow(D.base)];
  g.text(wd + ' ' + D.base.slice(8, 10) + '/' + D.base.slice(5, 7) + '/' + D.base.slice(0, 4) + '  ·  ' + dm(D.base) + ' – ' + dm(D.end), 48, 140, 28, [255, 214, 120], true);
  const nIt = P.reduce(function (s, p) { return s + p.nIt; }, 0), nDone = P.reduce(function (s, p) { return s + p.nDone; }, 0), nWork = P.reduce(function (s, p) { return s + p.nWork; }, 0);
  const tile = function (x, y, big, small, col) { g.rrect(x, y, 240, 128, 18, [255, 255, 255]); g.rrect(x, y, 240, 128, 18, LINE, 2); g.text(String(big), x + 20, y + 8, 56, col, true); g.text(small, x + 20, y + 82, 23, MUTE, false); };
  let y = 215;
  tile(48, y, P.filter(function (p) { return !p.late; }).length, 'công trình 2 tuần tới', BLUE); tile(306, y, P.filter(function (p) { return diffDays(p.due, D.base) <= 0; }).length, 'giao hôm nay', RED);
  tile(564, y, nDone + '/' + nIt, 'hạng mục đã xong', GRN); tile(822, y, D.over, 'quá hạn chưa giao', [160, 40, 40]);
  y += 160;
  g.rrect(48, y, W - 96, 300, 18, [255, 255, 255]); g.rrect(48, y, W - 96, 300, 18, LINE, 2);
  g.text('Tình trạng hạng mục', 72, y + 14, 31, INK, true);
  const segs = [['Đang sản xuất', nWork, BLUE], ['Chưa sản xuất', Math.max(nIt - nDone - nWork, 0), GREY], ['Đã xong', nDone, GRN]], cx = 230, cy = y + 170, R = 100;
  if (nIt > 0) { let a0 = -90; segs.forEach(function (s) { if (s[1] > 0) { const a1 = a0 + 360 * s[1] / nIt; g.pie(cx, cy, R, a0, a1, s[2]); a0 = a1; } }); } else g.disc(cx, cy, R, GREY);
  g.disc(cx, cy, 62, [255, 255, 255]);
  g.text((nIt ? Math.round(100 * nDone / nIt) : 0) + '%', cx, cy - 24, 42, INK, true, 'c'); g.text('đã xong', cx, cy + 22, 20, MUTE, false, 'c');
  let ly = y + 90; segs.forEach(function (s) { g.rrect(420, ly + 6, 26, 26, 6, s[2]); g.text(s[0], 462, ly - 2, 29, INK, false); g.text(s[1] + '  (' + (nIt ? Math.round(100 * s[1] / nIt) : 0) + '%)', 820, ly - 2, 29, INK, true); ly += 60; });
  y += 330;
  g.text('Biểu đồ Gantt — tiến độ giao hàng', 48, y, 33, INK, true); y += 54;
  const gx0 = 330, gw = W - 48 - gx0, cw = gw / 14, gh = 70 + rows * 96 + 20;
  g.rrect(48, y, W - 96, gh, 18, [255, 255, 255]); g.rrect(48, y, W - 96, gh, 18, LINE, 2);
  for (let i = 0; i < 14; i++) {
    const day = addDays(D.base, i), x = gx0 + i * cw, w = dow(day);
    if (w === 0 || w === 6) g.rect(x, y + 40, cw, 20 + rows * 96, [240, 244, 249]);
    g.text(dm(day), x + cw / 2, y + 12, 15, MUTE, false, 'c');
  }
  let yy = y + 66;
  if (!P.length) g.text('Không có công trình nào đến hạn trong 2 tuần tới.', 70, yy + 20, 28, MUTE, false);
  P.forEach(function (p) {
    const nd = diffDays(p.due, D.base), col = urgency(nd)[0], span = Math.max(1, Math.min(14, nd + 1));
    g.text(p.code, 68, yy + 2, 23, BLUE, true);
    g.text(g.fit((p.cust ? p.cust + ' – ' : '') + p.name, 21, false, 240), 68, yy + 34, 21, [70, 85, 105], false);
    g.rrect(gx0, yy + 14, span * cw, 48, 10, mix(col, 0.55));
    const fw = p.nIt ? span * cw * (p.nDone / p.nIt) : 0; if (fw > 6) g.rrect(gx0, yy + 14, fw, 48, 10, col);
    const lab = (p.late ? 'QUÁ HẠN ' + p.lateDays + ' ngày (hạn ' + dm(p.due) + ')' : 'giao ' + dm(p.due)) + (p.rev ? ' · lần ' + p.rev + (p.orig ? ' (gốc ' + dm(p.orig) + ')' : '') : '') + ' · ' + p.nDone + '/' + p.nIt + ' xong';
    const lw = g.measure(lab, 20, true), lx = gx0 + span * cw + 12;
    if (lx + lw > W - 56) g.text(lab, gx0 + 12, yy + 22, 20, fw > lw * 0.7 ? [255, 255, 255] : [30, 40, 60], true); else g.text(lab, lx, yy + 22, 20, [30, 40, 60], true);
    yy += 96;
  });
  g.rect(gx0 + 0.5 * cw - 1, y + 36, 3, 30 + rows * 96, RED); g.text('hôm nay', gx0 + 0.5 * cw, yy + 8, 16, RED, true, 'c');
  y = yy + 50;
  g.text('Đang tạm dừng: ' + D.held + ' đơn   ·   Quá hạn chưa giao: ' + D.over + ' đơn', 48, y, 24, MUTE, true);
  g.text('Cơ khí + Điện tính chung 1 công trình · bot tự đăng 7:00 sáng thứ Hai.', 48, y + 38, 22, [130, 145, 165], false);
  const out = new Canvas(W, Math.min(H, y + 90), [244, 247, 251]); g.d.copy(out.d, 0, 0, out.w * out.h * 3);
  return out.png();
}

module.exports = { buildData: buildData, messages: messages, dashboardPng: dashboardPng, addDays: addDays };
