import Foundation

/// One caller-ID entry, matching the API's /api/v1/export/call-directory shape.
struct DirectoryEntry: Codable {
    let phoneDigits: String
    let label: String

    enum CodingKeys: String, CodingKey {
        case phoneDigits, label
    }
}

struct DirectorySnapshot: Codable {
    let entries: [DirectoryEntry]
    let syncedAt: Date
}

/// Reads/writes the synced directory to the App Group container so both the
/// main app (which fetches from the API) and the Call Directory Extension
/// (which iOS runs in a separate sandboxed process, no network access during
/// an incoming call) see the same data.
enum SharedDirectoryStore {
    static let appGroupId = "group.id.vn.tuandv.phoneintel"
    private static let fileName = "directory-snapshot.json"

    private static var fileURL: URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroupId)?
            .appendingPathComponent(fileName)
    }

    static func save(_ snapshot: DirectorySnapshot) throws {
        guard let url = fileURL else {
            throw NSError(domain: "SharedDirectoryStore", code: 1, userInfo: [NSLocalizedDescriptionKey: "App Group container not found"])
        }
        let data = try JSONEncoder().encode(snapshot)
        try data.write(to: url, options: .atomic)
    }

    static func load() -> DirectorySnapshot? {
        guard let url = fileURL, let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(DirectorySnapshot.self, from: data)
    }
}
