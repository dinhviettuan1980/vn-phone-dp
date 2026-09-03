# PhoneIntel iOS — Caller ID cho iPhone cá nhân

App SwiftUI + CallKit Call Directory Extension. Không cài từ App Store —
build và cài trực tiếp lên iPhone của bạn qua Xcode.

## Cách hoạt động

iOS **không** cho app truy cập mạng lúc có cuộc gọi đến — mọi nhãn tên phải
nạp sẵn trên máy trước đó. Vì vậy:

1. App chính gọi `GET /api/v1/export/call-directory` để tải toàn bộ danh
   sách số + nhãn, lưu vào **App Group container** (thư mục dùng chung giữa
   app và extension).
2. App gọi `CXCallDirectoryManager.reloadExtension(...)` để báo iOS nạp lại.
3. Extension (`CallDirectoryHandler`) chạy trong tiến trình riêng của iOS,
   đọc dữ liệu đã lưu, gọi `addIdentificationEntry(...)` cho từng số.
4. Khi có cuộc gọi đến (hoặc xem lịch sử cuộc gọi), iOS tự hiển thị
   **"Tra Số VN: <nhãn>"** cạnh số điện thoại — hoàn toàn do iOS xử lý,
   không cần app đang chạy.

## Build & cài lên iPhone (Apple ID cá nhân, miễn phí)

```bash
brew install xcodegen   # nếu chưa có
cd apps/ios
xcodegen generate
open PhoneIntel.xcodeproj
```

Trong Xcode:

1. Chọn target **PhoneIntel** → tab **Signing & Capabilities** → mục
   **Team**, chọn Apple ID cá nhân của bạn (Xcode → Settings → Accounts để
   thêm nếu chưa có). Lặp lại cho target **PhoneIntelCallDirectory**.
2. Nếu Xcode báo lỗi App Groups chưa đăng ký: bấm nút để Xcode tự tạo (free
   account vẫn tạo được App Group).
3. Cắm iPhone qua cáp, chọn máy làm **Destination** (góc trên bên trái).
4. Bấm **Run** (▶). Lần đầu, iPhone sẽ hỏi **"Untrusted Developer"** —
   vào **Cài đặt → Cài đặt chung → VPN & Quản lý thiết bị**, tin cậy Apple
   ID của bạn, rồi mở lại app.
5. Trong app, bấm **"Đồng bộ dữ liệu ngay"** để tải danh sách lần đầu.
6. Vào **Cài đặt → Điện thoại → Chặn cuộc gọi & Nhận diện**, bật công tắc
   **Tra Số VN**.

## Giới hạn của chữ ký Apple ID miễn phí

- App tự hết hạn sau **7 ngày** — cần cắm cáp mở lại trong Xcode và bấm Run
  lần nữa (không cần build lại từ đầu, chỉ re-sign, vài giây).
- Nếu muốn khỏi lặp lại việc này: cần Apple Developer Program trả phí
  ($99/năm), cấp certificate 1 năm.

## Đồng bộ dữ liệu

Không có nền tự động (background refresh) trong bản demo này — mở app và
bấm "Đồng bộ dữ liệu ngay" theo nhu cầu. Có thể thêm `BGAppRefreshTask` để
tự đồng bộ định kỳ nếu cần (chưa làm ở bản này).

## Cấu hình

- API export: `https://vn-phone.tuandv.id.vn/api/v1/export/call-directory`
  (sửa trong `PhoneIntel/App/SyncService.swift` nếu deploy nơi khác).
- Bundle ID: `id.vn.tuandv.phoneintel` (app), `id.vn.tuandv.phoneintel.CallDirectory` (extension).
- App Group: `group.id.vn.tuandv.phoneintel` — phải khớp giữa `project.yml`
  và cả 2 file `.entitlements`.
