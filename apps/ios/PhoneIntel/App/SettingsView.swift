import SwiftUI

/// Matches the API's GET /api/v1/settings/suppressed-numbers entry shape.
struct SuppressionEntry: Codable, Identifiable {
    let phoneNormalized: String
    let reason: String?
    let createdAt: String

    var id: String { phoneNormalized }

    enum CodingKeys: String, CodingKey {
        case phoneNormalized = "phone_normalized"
        case reason
        case createdAt = "created_at"
    }
}

/// "Don't label this number" settings -- lets the phone's owner silence a
/// KNOWN number (a crawled identity, or a spam-flagged one) without deleting
/// the underlying data. A suppressed number is dropped from
/// /export/call-directory server-side, so after this triggers a re-sync it
/// simply disappears from CallKit's directory and the call shows exactly
/// like an unknown number -- same as Truecaller letting you mute a
/// contact's caller-ID banner. Reads the known-numbers list from the same
/// App Group snapshot the extension uses (SharedDirectoryStore) instead of
/// a separate API call, since the main app already has it after syncing.
@MainActor
final class SettingsViewModel: ObservableObject {
    static let suppressionURL = URL(string: "https://vn-phone.tuandv.id.vn/api/v1/settings/suppressed-numbers")!

    @Published var knownNumbers: [DirectoryEntry] = []
    @Published var suppressed: Set<String> = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let syncService = SyncService()

    func loadKnownNumbers() {
        knownNumbers = (SharedDirectoryStore.load()?.entries ?? []).sorted { $0.label < $1.label }
    }

    func loadSuppressed() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let (data, response) = try await URLSession.shared.data(from: Self.suppressionURL)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                throw URLError(.badServerResponse)
            }
            struct ListResponse: Decodable { let entries: [SuppressionEntry] }
            let decoded = try JSONDecoder().decode(ListResponse.self, from: data)
            suppressed = Set(decoded.entries.map { $0.phoneNormalized })
            errorMessage = nil
        } catch {
            errorMessage = "Không tải được danh sách số đã tắt thông báo."
        }
    }

    func isSuppressed(_ phoneDigits: String) -> Bool {
        suppressed.contains("+\(phoneDigits)")
    }

    func toggle(_ phoneDigits: String, on: Bool) async {
        let phoneE164 = "+\(phoneDigits)"
        do {
            if on {
                var request = URLRequest(url: Self.suppressionURL)
                request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.httpBody = try JSONEncoder().encode(["phone_raw": phoneE164])
                let (_, response) = try await URLSession.shared.data(for: request)
                guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                    throw URLError(.badServerResponse)
                }
                suppressed.insert(phoneE164)
            } else {
                let encoded = phoneE164.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? phoneE164
                var request = URLRequest(url: Self.suppressionURL.appendingPathComponent(encoded))
                request.httpMethod = "DELETE"
                let (_, response) = try await URLSession.shared.data(for: request)
                guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                    throw URLError(.badServerResponse)
                }
                suppressed.remove(phoneE164)
            }
            errorMessage = nil
            // Re-fetch the export + reload the extension so the change takes
            // effect on the next incoming call, not just on next manual sync.
            await syncService.sync()
        } catch {
            errorMessage = "Không cập nhật được, thử lại sau."
        }
    }
}

struct SettingsView: View {
    @StateObject private var viewModel = SettingsViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Số đã bật sẽ KHÔNG còn hiện tên/cảnh báo khi gọi đến nữa -- xuất hiện như số lạ bình thường. Dữ liệu định danh/báo cáo của số đó vẫn được giữ nguyên, chỉ là ẩn đi.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                if viewModel.knownNumbers.isEmpty {
                    Text("Chưa có số nào đã biết — bấm Đồng bộ dữ liệu ở màn hình chính trước.")
                        .foregroundStyle(.secondary)
                } else {
                    Section("Số đã biết") {
                        ForEach(viewModel.knownNumbers) { entry in
                            Toggle(isOn: Binding(
                                get: { viewModel.isSuppressed(entry.phoneDigits) },
                                set: { newValue in Task { await viewModel.toggle(entry.phoneDigits, on: newValue) } }
                            )) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(entry.label)
                                    Text("+\(entry.phoneDigits)")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }

                if let error = viewModel.errorMessage {
                    Text(error).foregroundStyle(.red).font(.footnote)
                }
            }
            .navigationTitle("Tắt thông báo theo số")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Đóng") { dismiss() }
                }
            }
            .task {
                viewModel.loadKnownNumbers()
                await viewModel.loadSuppressed()
            }
            .overlay {
                if viewModel.isLoading {
                    ProgressView()
                }
            }
        }
    }
}

#Preview {
    SettingsView()
}
