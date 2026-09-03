import Foundation
import CallKit

enum SyncError: LocalizedError {
    case network(Error)
    case badResponse
    case decoding(Error)
    case save(Error)
    case reload(Error)

    var errorDescription: String? {
        switch self {
        case .network: return "Không kết nối được tới máy chủ."
        case .badResponse: return "Máy chủ trả về lỗi."
        case .decoding: return "Dữ liệu trả về không đúng định dạng."
        case .save: return "Không lưu được dữ liệu vào App Group."
        case .reload(let err): return "Đồng bộ xong nhưng không nạp lại được extension: \(err.localizedDescription)"
        }
    }
}

@MainActor
final class SyncService: ObservableObject {
    // Change this if you deploy the API somewhere else.
    static let exportURL = URL(string: "https://vn-phone.tuandv.id.vn/api/v1/export/call-directory")!
    static let extensionBundleId = "id.vn.tuandv.phoneintel.CallDirectory"

    @Published var isSyncing = false
    @Published var lastSyncedAt: Date?
    @Published var lastEntryCount: Int?
    @Published var lastError: String?

    init() {
        if let snapshot = SharedDirectoryStore.load() {
            lastSyncedAt = snapshot.syncedAt
            lastEntryCount = snapshot.entries.count
        }
    }

    func sync() async {
        isSyncing = true
        lastError = nil
        defer { isSyncing = false }

        do {
            let entries = try await fetchEntries()
            let snapshot = DirectorySnapshot(entries: entries, syncedAt: Date())
            try saveSnapshot(snapshot)
            try await reloadExtension()

            lastSyncedAt = snapshot.syncedAt
            lastEntryCount = entries.count
        } catch let error as SyncError {
            lastError = error.errorDescription
        } catch {
            lastError = error.localizedDescription
        }
    }

    private struct ExportResponse: Decodable {
        let entries: [DirectoryEntry]
        let count: Int
    }

    private func fetchEntries() async throws -> [DirectoryEntry] {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(from: Self.exportURL)
        } catch {
            throw SyncError.network(error)
        }
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw SyncError.badResponse
        }
        do {
            return try JSONDecoder().decode(ExportResponse.self, from: data).entries
        } catch {
            throw SyncError.decoding(error)
        }
    }

    private func saveSnapshot(_ snapshot: DirectorySnapshot) throws {
        do {
            try SharedDirectoryStore.save(snapshot)
        } catch {
            throw SyncError.save(error)
        }
    }

    private func reloadExtension() async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            CXCallDirectoryManager.sharedInstance.reloadExtension(withIdentifier: Self.extensionBundleId) { error in
                if let error {
                    continuation.resume(throwing: SyncError.reload(error))
                } else {
                    continuation.resume()
                }
            }
        }
    }
}
