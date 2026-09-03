import SwiftUI

struct ContentView: View {
    @StateObject private var sync = SyncService()

    private var lastSyncedText: String {
        guard let date = sync.lastSyncedAt else { return "Chưa đồng bộ lần nào" }
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        formatter.locale = Locale(identifier: "vi_VN")
        return formatter.string(from: date)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Tra Số VN")
                            .font(.largeTitle.bold())
                        Text("Hiện tên tổ chức khi có cuộc gọi đến từ số đã biết (ngân hàng, fintech...).")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Lần đồng bộ gần nhất")
                            Spacer()
                            Text(lastSyncedText)
                                .foregroundStyle(.secondary)
                        }
                        if let count = sync.lastEntryCount {
                            HStack {
                                Text("Số điện thoại đã nạp")
                                Spacer()
                                Text("\(count)")
                                    .foregroundStyle(.secondary)
                            }
                        }
                        if let error = sync.lastError {
                            Text(error)
                                .foregroundStyle(.red)
                                .font(.footnote)
                        }
                    }
                    .padding()
                    .background(Color(.secondarySystemBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 12))

                    Button {
                        Task { await sync.sync() }
                    } label: {
                        HStack {
                            if sync.isSyncing {
                                ProgressView()
                            }
                            Text(sync.isSyncing ? "Đang đồng bộ…" : "Đồng bộ dữ liệu ngay")
                        }
                        .frame(maxWidth: .infinity)
                        .padding()
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(sync.isSyncing)

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Bật nhận diện cuộc gọi")
                            .font(.headline)
                        Text("1. Mở app **Cài đặt** (Settings)")
                        Text("2. Vào **Điện thoại** → **Chặn cuộc gọi & Nhận diện**")
                        Text("3. Bật công tắc **Tra Số VN**")
                        Text("Chỉ cần bật một lần. Sau đó mỗi lần đồng bộ trong app này sẽ tự cập nhật danh sách.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .padding()
                    .background(Color(.secondarySystemBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .padding()
            }
            .navigationBarHidden(true)
        }
        .task {
            await sync.sync()
        }
    }
}

#Preview {
    ContentView()
}
