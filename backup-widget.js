/* ================================================================
   backup-widget.js — thanh sao lưu nhỏ ở góc dưới trái, CHỈ dùng cho
   bản chạy trên web (Render). Bản chạy trên máy (server.ps1) đã tự
   sao lưu vào thư mục backups\ nên không cần thanh này.
   ================================================================ */
(function () {
  'use strict';
  function ready(fn) {
    if (document.body) fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }
  ready(function () {
    var bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:99999;display:flex;' +
      'align-items:center;gap:8px;background:#1b2733;padding:8px 10px;border-radius:10px;' +
      'box-shadow:0 4px 16px rgba(0,0,0,.35);font:13px/1.3 system-ui,-apple-system,sans-serif;';
    bar.innerHTML =
      '<button id="nmsxDlBackup" type="button" style="background:#2d3f52;color:#fff;border:none;' +
      'border-radius:6px;padding:7px 11px;cursor:pointer;font:inherit;">⬇ Tải sao lưu</button>' +
      '<label style="background:#2d3f52;color:#fff;border-radius:6px;padding:7px 11px;cursor:pointer;">' +
      '⬆ Nạp từ file<input type="file" id="nmsxUlBackup" accept="application/json" style="display:none;"></label>' +
      '<span id="nmsxBkStatus" style="color:#9fb2c4;"></span>';
    document.body.appendChild(bar);

    function setStatus(s) { var el = document.getElementById('nmsxBkStatus'); if (el) el.textContent = s; }

    document.getElementById('nmsxDlBackup').addEventListener('click', function () {
      setStatus('Đang tải…');
      fetch('/api/export').then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.blob();
      }).then(function (blob) {
        var a = document.createElement('a');
        var url = URL.createObjectURL(blob);
        a.href = url;
        a.download = 'nmsx-sao-luu-' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        setStatus('Đã tải xong ✓');
      }).catch(function (e) { setStatus('Lỗi: ' + e.message); });
    });

    document.getElementById('nmsxUlBackup').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      if (!window.confirm('Nạp file này sẽ GHI ĐÈ toàn bộ dữ liệu đang có trên bản web. Tiếp tục?')) {
        e.target.value = ''; return;
      }
      setStatus('Đang nạp…');
      var reader = new FileReader();
      reader.onload = function () {
        fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: reader.result })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function () { setStatus('Đã nạp xong ✓ — tải lại trang…'); setTimeout(function () { location.reload(); }, 1200); })
          .catch(function (e) { setStatus('Lỗi: ' + e.message); });
      };
      reader.readAsText(f);
      e.target.value = '';
    });
  });
})();
