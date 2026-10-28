# PDF Tiện Ích

Bộ công cụ xử lý PDF miễn phí, chạy hoàn toàn trên trình duyệt (file không bị tải lên máy chủ).
Lấy cảm hứng từ Smallpdf, giao diện tiếng Việt, tự co giãn trên điện thoại, máy tính bảng và laptop.

**Dùng thử:** https://baophan1512.github.io/my-pdf-tool/

## Các công cụ

| Nhóm | Công cụ |
| --- | --- |
| Sắp xếp | Gộp PDF, Tách PDF, Xóa trang, Trích xuất trang, Sắp xếp trang, Xoay PDF |
| Nén | Nén PDF (4 mức) |
| Chuyển đổi | PDF sang Ảnh (JPG/PNG), Ảnh sang PDF, Lấy chữ từ PDF, hướng dẫn Office ↔ PDF và AI |
| Chỉnh sửa | Sửa chữ PDF (sửa trực tiếp chữ có sẵn, thanh định dạng kiểu Word với 16 phông tiếng Việt), Chú thích (chữ, bút vẽ, tô sáng, khung, che trắng, ảnh), Đánh số trang, Watermark, Cắt lề, Che thông tin |
| Ký tên | Vẽ / gõ / tải ảnh chữ ký, thêm ngày, thêm chữ |
| Bảo mật | Khóa PDF bằng mật khẩu, Mở khóa PDF, Làm phẳng PDF |

## Cấu trúc

- `index.html`, `css/style.css`: khung trang và giao diện.
- `js/app.js`: điều hướng, trang chủ, luồng Tải lên → Tùy chọn → Tải xuống.
- `js/tools.js`: danh sách công cụ và cách xử lý của từng công cụ.
- `js/editor.js`: trình chỉnh sửa trang (sửa chữ, ký tên, chú thích, che thông tin).
- `js/formatbar.js`: thanh định dạng chữ kiểu Word (phông, cỡ, màu, đậm/nghiêng/gạch chân, căn lề).
- `js/compress.js`: nén ảnh bên trong PDF.
- `js/core.js`: hàm dùng chung.
- `vendor/`: thư viện mã nguồn mở được lưu kèm (pdf-lib và fontkit bản @cantoo, PDF.js, JSZip, SortableJS, 16 phông Google Fonts có tiếng Việt).

Không cần cài đặt hay build: đây là trang tĩnh, GitHub Pages phục vụ trực tiếp từ nhánh `main`.
Chạy thử trên máy: `python3 -m http.server` trong thư mục này rồi mở http://localhost:8000.
