NHÀ MÁY SẢN XUẤT PHƯƠNG QUÂN — mã nguồn (13 tệp rời)
BUILD 2026-09-11a-may

Đây là 13 tệp rời (không nén, không thư mục con) cho dễ tải lên gitiho.

────────────────────────────────────────────────────────
DANH SÁCH 13 TỆP
────────────────────────────────────────────────────────
  1. app.html                 — toàn bộ giao diện + xử lý
  2. server.ps1               — máy chủ nhỏ chạy trên máy (cổng 8756)
  3. Mo Nha May.bat           — bấm đúp để MỞ app
  4. Dung Nha May.bat         — bấm đúp để TẮT app
  5. HƯỚNG DẪN.txt            — hướng dẫn dùng
  6. README.md                — trang chính GitHub hiển thị
  7. README-GITIHO.txt        — tệp này
  8. claude-shim.js           — cầu nối lưu dữ liệu   (thuộc thư mục _local\)
  9. icon.png                 — biểu tượng            (thuộc thư mục _local\)
 10. icon.ico                 — biểu tượng            (thuộc thư mục _local\)
 11. orders.json              — kho đơn hàng (đang rỗng) (thuộc thư mục data\)
 12. meta.json                — thông số (đang rỗng)     (thuộc thư mục data\)
 13. GIU-THU-MUC-NAY.txt      — tệp giữ chỗ              (thuộc thư mục data\)

────────────────────────────────────────────────────────
CÁCH CHẠY LẠI TRÊN 1 MÁY MỚI
────────────────────────────────────────────────────────
Cách A — nhanh: bỏ CẢ 13 tệp vào chung 1 thư mục rồi bấm đúp
  "Mo Nha May.bat". server.ps1 đã được sửa để tự tìm claude-shim.js
  ngay cạnh nó nếu không thấy thư mục _local\. Chạy được ngay.

Cách B — gọn gàng, giống bản gốc:
  - Tạo thư mục  _local\  → bỏ vào: claude-shim.js, icon.png, icon.ico
  - Tạo thư mục  data\    → bỏ vào: orders.json, meta.json, GIU-THU-MUC-NAY.txt
  - 6 tệp còn lại để ở ngoài cùng.
  - Bấm đúp "Mo Nha May.bat".

Trình duyệt sẽ mở  http://localhost:8756/

────────────────────────────────────────────────────────
KHÔNG GỒM (dữ liệu riêng — không đưa lên mạng)
────────────────────────────────────────────────────────
  - Đơn hàng thật (data\orders.json trên máy anh đang dùng)
  - Bản mirror Google Sheet Điện / Cơ khí (_local\electric.xlsx, cokhi.xlsx
    ~50 MB). Máy mới: mở tab "Sheets tham khảo" → tải .xlsx từ Google Sheet
    rồi thả vào ô nạp.

────────────────────────────────────────────────────────
TÍNH NĂNG MỚI BUILD NÀY
────────────────────────────────────────────────────────
  - Nút "Đồng bộ Sheet" NAY CHẠY ĐƯỢC trên app cài máy: đọc thẳng file
    _local\cokhi.xlsx, ghi đè thông tin + hạng mục + vật tư các đơn khớp mã,
    thêm đơn mới. Ghi 1 lần cả kho (không còn treo server).
  - Tab "Báo cáo tiến độ": xem theo Tuần / Tháng / Năm; thẻ số liệu; biểu đồ
    tròn; BIỂU ĐỒ GANTT tiến độ giao hàng.
  - Tab "Sheets tham khảo" gộp cả Sheet Điện và Sheet Cơ khí.
  - server.ps1: route ghi hàng loạt PUT /api/coll/<name>; tự tìm file phẳng.

────────────────────────────────────────────────────────
CẬP NHẬT 2026-09-11
────────────────────────────────────────────────────────
  - Đồng bộ lại 2 Sheet Google (Điện + Cơ khí) — bản mới nhất trong ngày.
  - Đã chạy "Đồng bộ Sheet" trên máy: 98 đơn hàng, 66 đơn cập nhật hạng mục /
    vật tư mới nhất từ Sheet Cơ khí.
