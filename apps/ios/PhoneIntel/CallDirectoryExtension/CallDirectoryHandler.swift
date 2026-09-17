import CallKit

/// Runs in a separate sandboxed process with no network access. iOS invokes
/// this whenever the extension needs (re)loading -- either because the main
/// app called CXCallDirectoryManager.reloadExtension, or periodically in the
/// background. Either way, all data must already be sitting in the App
/// Group container (written by SyncService in the main app).
final class CallDirectoryHandler: CXCallDirectoryProvider {
    override func beginRequest(with context: CXCallDirectoryExtensionContext) {
        context.delegate = self

        guard let snapshot = SharedDirectoryStore.load() else {
            context.completeRequest()
            return
        }

        // Apple requires ALL blocking entries added first (in ascending
        // order), THEN all identification entries (in their own ascending
        // order) -- the two lists cannot be interleaved for a full reload.
        addAllBlockingEntries(from: snapshot, to: context)
        addAllIdentificationEntries(from: snapshot, to: context)

        context.completeRequest()
    }

    /// Opt-in (server-side setting, off by default -- see
    /// services/appSettings.ts): a call from one of these numbers never
    /// rings at all, straight to voicemail. Empty unless the owner enabled
    /// auto-blocking in the app's Settings screen.
    private func addAllBlockingEntries(from snapshot: DirectorySnapshot, to context: CXCallDirectoryExtensionContext) {
        let sorted = snapshot.blockedDigits.sorted { (Int64($0) ?? 0) < (Int64($1) ?? 0) }
        for digits in sorted {
            guard let phoneNumber = CXCallDirectoryPhoneNumber(digits) else { continue }
            context.addBlockingEntry(withNextSequentialPhoneNumber: phoneNumber)
        }
    }

    /// Personal-scale directory (tens to low thousands of entries) -- always
    /// provide the full current snapshot rather than implementing
    /// incremental add/remove deltas. Apple's own extension template does
    /// the same for this data size.
    private func addAllIdentificationEntries(from snapshot: DirectorySnapshot, to context: CXCallDirectoryExtensionContext) {
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
