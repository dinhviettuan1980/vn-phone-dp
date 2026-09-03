import CallKit

/// Runs in a separate sandboxed process with no network access. iOS invokes
/// this whenever the extension needs (re)loading -- either because the main
/// app called CXCallDirectoryManager.reloadExtension, or periodically in the
/// background. Either way, all data must already be sitting in the App
/// Group container (written by SyncService in the main app).
final class CallDirectoryHandler: CXCallDirectoryProvider {
    override func beginRequest(with context: CXCallDirectoryExtensionContext) {
        context.delegate = self

        addAllIdentificationEntries(to: context)

        context.completeRequest()
    }

    /// Personal-scale directory (tens to low thousands of entries) -- always
    /// provide the full current snapshot rather than implementing
    /// incremental add/remove deltas. Apple's own extension template does
    /// the same for this data size.
    private func addAllIdentificationEntries(to context: CXCallDirectoryExtensionContext) {
        guard let snapshot = SharedDirectoryStore.load() else { return }

        // CXCallDirectoryExtensionContext requires entries added in strictly
        // ascending numeric order for a full (non-incremental) reload.
        let sorted = snapshot.entries.sorted {
            (Int64($0.phoneDigits) ?? 0) < (Int64($1.phoneDigits) ?? 0)
        }

        for entry in sorted {
            guard let phoneNumber = CXCallDirectoryPhoneNumber(entry.phoneDigits) else { continue }
            context.addIdentificationEntry(withNextSequentialPhoneNumber: phoneNumber, label: entry.label)
        }
    }
}

extension CallDirectoryHandler: CXCallDirectoryExtensionContextDelegate {
    func requestFailed(for extensionContext: CXCallDirectoryExtensionContext, withError error: Error) {
        // No UI surface here (runs headless in iOS's process) -- nothing
        // actionable to do beyond letting the system's own error reporting
        // (visible in Settings > Phone > Call Blocking & Identification)
        // surface it.
    }
}
