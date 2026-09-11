# Nhà Máy Sản Xuất Phương Quân — bản chạy trên máy

App quản lý sản xuất, chạy **hoàn toàn trên máy tính Windows** (không cần mạng, không cần đăng nhập).

BUILD: `2026-09-11a-may`

## Chạy

1. Tải hết các file trong repo về **một thư mục**.
2. Bấm đúp **`Mo Nha May.bat`**.
3. Trình duyệt mở `http://localhost:8756/`.
4. Tắt: bấm đúp **`Dung Nha May.bat`** (hoặc đóng cửa sổ đen).

Chi tiết xem **`HƯỚNG DẪN.txt`** và **`README-GITIHO.txt`**.

## File trong repo

| File | Việc |
|---|---|
| `app.html` | toàn bộ giao diện + xử lý |
| `server.ps1` | máy chủ nhỏ trên máy (cổng 8756) |
| `claude-shim.js` | cầu nối lưu dữ liệu |
| `Mo Nha May.bat` / `Dung Nha May.bat` | mở / tắt app |
| `icon.png`, `icon.ico` | biểu tượng |
| `orders.json`, `meta.json` | kho dữ liệu (rỗng — app tự tạo khi dùng) |
| `HƯỚNG DẪN.txt`, `README-GITIHO.txt` | hướng dẫn |

Tất cả file nằm **phẳng** ở thư mục gốc, không có thư mục con.

> Không kèm 96+ đơn hàng thật và 2 file Google Sheet mirror (~50 MB) — đó là dữ liệu riêng.
