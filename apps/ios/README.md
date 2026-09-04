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

## Trạng thái hiện tại (2026-09-04)

**Đã cài thành công lên iPhone của Tuan** (iPhone 13 Pro Max), ký bằng
team trả phí **IMIP TECHNOLOGY AND SOLUTION CONSULTANCY JOINT STOCK
COMPANY** (`DEVELOPMENT_TEAM: GXSFH7K2X5` trong `project.yml`, Apple ID
`tuandv@gmail.com` có role Developer ở team này) — **không phải** Personal
Team miễn phí, nên **không bị giới hạn hết hạn 7 ngày**.

Toàn bộ build + cài + mở app đã làm qua dòng lệnh (`xcodebuild` +
`xcrun devicectl`), không cần mở Xcode GUI. Việc duy nhất còn lại luôn cần
thao tác tay trên máy (Apple bắt buộc, không tự động hoá được): bật
extension trong **Cài đặt → Điện thoại → Chặn cuộc gọi & Nhận diện → Tra
Số VN**.

**Lưu ý về signing đã thử qua** (để nhớ nếu cần build lại):
- Personal Team miễn phí của `tuan.dinhviet1980@gmail.com`: bị lỗi
  "missing Xcode-Token" (credential hết hạn trong keychain).
- Personal Team miễn phí của `tuandv@gmail.com`: bị lỗi "reached the
  maximum number of registered iPhone devices" (giới hạn ~3 thiết bị/năm
  của free account).
- → Chuyển sang team **IMIP** (trả phí, đã có sẵn quyền Developer) — build
  thành công ngay.

## Build & cài lên iPhone qua dòng lệnh (đã dùng thành công)

```bash
cd apps/ios
xcodegen generate

# Build cho thiết bị thật (thay device id bằng của bạn, xem qua `xcrun xctrace list devices`)
xcodebuild -project PhoneIntel.xcodeproj -scheme PhoneIntel \
  -destination 'id=<DEVICE_ID>' -allowProvisioningUpdates build

# Cài lên máy
APP_PATH="$(find ~/Library/Developer/Xcode/DerivedData -name PhoneIntel.app -path '*Debug-iphoneos*' | head -1)"
xcrun devicectl device install app --device <DEVICE_ID> "$APP_PATH"

# Mở app
xcrun devicectl device process launch --device <DEVICE_ID> id.vn.tuandv.phoneintel
```

Yêu cầu: `DEVELOPMENT_TEAM` trong `project.yml` phải là team ID hợp lệ mà
Apple ID đang đăng nhập trong Xcode (Settings → Apple Accounts) có quyền
truy cập — lấy team ID qua:
```bash
plutil -p ~/Library/Preferences/com.apple.dt.Xcode.plist | grep -B3 -A3 "<tên team>"
```

Nếu vẫn muốn làm qua Xcode GUI thay vì dòng lệnh: mở `PhoneIntel.xcodeproj`,
chọn target → **Signing & Capabilities** → chọn Team, cắm cáp, bấm Run (▶).
Lần đầu trên thiết bị mới, iPhone hỏi **"Untrusted Developer"** — vào
**Cài đặt → Cài đặt chung → VPN & Quản lý thiết bị** để tin cậy.

Sau khi cài: mở app, bấm **"Đồng bộ dữ liệu ngay"**, rồi vào **Cài đặt →
Điện thoại → Chặn cuộc gọi & Nhận diện**, bật **Tra Số VN**.

## Giới hạn của chữ ký Apple ID miễn phí (Personal Team)

Chỉ áp dụng nếu dùng Personal Team thay vì team trả phí như hiện tại:
- App tự hết hạn sau **7 ngày** — cần cắm cáp build lại (chỉ re-sign, vài giây).
- Giới hạn ~3 thiết bị đăng ký/năm, không tự gỡ được qua dòng lệnh.

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
