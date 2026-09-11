/* ================================================================
   claude-shim.js  —  Cầu nối "kho dữ liệu" cho bản chạy trên máy
   ----------------------------------------------------------------
   App gốc lưu dữ liệu qua window.claude.use('db') (chỉ chạy khi mở
   trong claude.ai). Bản này thay bằng 1 server nhỏ chạy ngay trên
   máy anh (server.ps1) — dữ liệu nằm trong thư mục data\ của app.
   API giữ nguyên y hệt nên KHÔNG phải sửa 1 dòng nào của app gốc.
   ================================================================ */
(function () {
  "use strict";

  var BASE = ""; // cùng gốc với trang (http://localhost:8756)

  function req(method, path, body) {
    var opt = { method: method, headers: {}, cache: "no-store" };
    if (body !== undefined) {
      opt.headers["Content-Type"] = "application/json";
      opt.body = JSON.stringify(body);
    }
    return fetch(BASE + path, opt).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          var e = new Error(t || ("HTTP " + r.status));
          e.code = "http_" + r.status;
          throw e;
        });
      }
      if (r.status === 204) return null;
      var ct = r.headers.get("content-type") || "";
      return ct.indexOf("json") >= 0 ? r.json() : r.text();
    });
  }

  function enc(s) { return encodeURIComponent(String(s)); }

  function makeSnap(id, data) {
    var has = data !== null && data !== undefined;
    return {
      id: id,
      exists: has,
      data: function () { return has ? data : undefined; }
    };
  }

  function makeQuerySnap(docsObj) {
    var ids = Object.keys(docsObj || {});
    var arr = ids.map(function (k) { return makeSnap(k, docsObj[k]); });
    return {
      docs: arr,
      size: arr.length,
      empty: arr.length === 0,
      forEach: function (fn) { arr.forEach(fn); }
    };
  }

  function docRef(coll, id) {
    return {
      get: function () {
        return req("GET", "/api/doc/" + enc(coll) + "/" + enc(id)).then(function (res) {
          return makeSnap(id, res && res.exists ? res.data : null);
        });
      },
      set: function (data) {
        return req("PUT", "/api/doc/" + enc(coll) + "/" + enc(id) + "?mode=set", data);
      },
      update: function (data) {
        return req("PUT", "/api/doc/" + enc(coll) + "/" + enc(id) + "?mode=update", data);
      },
      delete: function () {
        return req("DELETE", "/api/doc/" + enc(coll) + "/" + enc(id));
      }
    };
  }

  function collRef(coll) {
    return {
      doc: function (id) { return docRef(coll, id); },
      // Ghi hàng loạt trong 1 request (thay cả collection, hoặc mode:'merge'
      // để trộn theo id). Dùng cho "Đồng bộ Sheet".
      setAll: function (docsObj, opts) {
        var m = (opts && opts.merge) ? "merge" : "replace";
        return req("PUT", "/api/coll/" + enc(coll) + "?mode=" + m, docsObj || {});
      },
      get: function () {
        return req("GET", "/api/coll/" + enc(coll)).then(function (res) {
          return makeQuerySnap(res && res.docs);
        });
      },
      onSnapshot: function (onNext, onError) {
        var stopped = false, lastRev = -1, timer = null;
        function loop() {
          if (stopped) return;
          req("GET", "/api/rev/" + enc(coll)).then(function (r) {
            if (stopped || !r) return;
            if (r.rev !== lastRev) {
              return req("GET", "/api/coll/" + enc(coll)).then(function (res) {
                if (stopped) return;
                lastRev = res.rev;
                try { onNext(makeQuerySnap(res.docs)); } catch (e) {}
              });
            }
          }).catch(function (e) {
            if (!stopped && onError) { try { onError(e); } catch (_) {} }
          }).then(function () {
            if (!stopped) timer = setTimeout(loop, 2000);
          });
        }
        loop();
        return function () { stopped = true; if (timer) clearTimeout(timer); };
      }
    };
  }

  var adapter = { collection: function (name) { return collRef(name); } };

  // Kiểm tra server có sống không TRƯỚC khi trả adapter cho app.
  var ready = req("GET", "/api/ping")
    .then(function () { return adapter; })
    .catch(function () { return null; });

  window.claude = {
    use: function (name) {
      if (name === "db") return ready;
      // 'mcp' (đồng bộ Google Sheet) không có ở bản chạy máy — app tự báo nhẹ.
      return Promise.resolve(null);
    }
  };
})();
