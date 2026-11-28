// App-wide state: connection, live events, navigation, and a debounced
// "something changed" counter views reload on.

import Foundation
import SwiftUI
import Observation

enum Page: String, CaseIterable, Identifiable, Hashable {
    case overview, conversations, traffic, activity, chats, clients, health, settings
    var id: String { rawValue }
    var title: String {
        switch self {
        case .overview: "Overview"
        case .conversations: "Conversations"
        case .traffic: "Traffic"
        case .activity: "Activity"
        case .chats: "Chat Library"
        case .clients: "Clients & Install"
        case .health: "Health"
        case .settings: "Settings"
        }
    }
    var icon: String {
        switch self {
        case .overview: "square.grid.2x2"
        case .conversations: "bubble.left.and.bubble.right"
        case .traffic: "arrow.up.arrow.down"
        case .activity: "waveform.path.ecg"
        case .chats: "books.vertical"
        case .clients: "desktopcomputer"
        case .health: "stethoscope"
        case .settings: "gearshape"
        }
    }
    var isMonitor: Bool { [.overview, .conversations, .traffic, .activity, .chats].contains(self) }
}

enum TimeRange: String, CaseIterable, Identifiable {
    case h1 = "1h", h6 = "6h", h24 = "24h", d7 = "7d", d30 = "30d"
    var id: String { rawValue }
    var seconds: Double {
        switch self { case .h1: 3600; case .h6: 21600; case .h24: 86400; case .d7: 604_800; case .d30: 2_592_000 }
    }
}

enum Connection { case connecting, live, down }

/// First-launch install of the bridge the app carries.
enum Setup { case none, running, failed }

@MainActor
@Observable
final class AppModel {
    var page: Page? = .overview
    var range: TimeRange = TimeRange(rawValue: UserDefaults.standard.string(forKey: "range") ?? "24h") ?? .h24 {
        didSet { UserDefaults.standard.set(range.rawValue, forKey: "range") }
    }
    var connection: Connection = .connecting
    var health: Health?
    var summary: Summary?
    var events: [BridgeEvent] = []
    /// bumps (debounced) when the broker reports a change; views reload on it
    var tick = 0
    var selectedLink: String?
    var selectedChat: String?
    var toast: Toast?
    var setup: Setup = .none
    var setupOutput: String?

    struct Toast: Identifiable, Equatable { let id = UUID(); let title: String; let body: String?; let isError: Bool }

    private var started = false
    private var debounce: Task<Void, Never>?
    let broker = Broker.shared

    func start() {
        guard !started else { return }
        started = true
        Task {
            if broker.needsSetup { await runSetup() }
            await refreshCore()
        }
        Task {
            for await e in broker.events() {
                switch e.type {
                case "_connected":
                    connection = .live
                    await refreshCore()
                case "_disconnected":
                    connection = .down
                    health = nil
                default:
                    events.insert(e, at: 0)
                    if events.count > 1500 { events.removeLast(events.count - 1500) }
                    bump()
                }
            }
        }
        Task {
            while true {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                await refreshCore()
            }
        }
    }

    private func bump() {
        debounce?.cancel()
        debounce = Task {
            try? await Task.sleep(nanoseconds: 350_000_000)
            if Task.isCancelled { return }
            tick += 1
            await refreshCore()
        }
    }

    func refreshCore() async {
        do {
            health = try await broker.get("/api/health", timeout: 3)
            summary = try? await broker.get("/api/summary?range=24h")
            if connection == .down { connection = .connecting }
            if events.isEmpty, let r: EventsResponse = try? await broker.get("/api/events?limit=300") { events = r.events }
        } catch {
            health = nil
            connection = .down
        }
    }

    func notify(_ title: String, _ body: String? = nil, error: Bool = false) {
        toast = Toast(title: title, body: body, isError: error)
        let id = toast?.id
        Task {
            try? await Task.sleep(nanoseconds: error ? 8_000_000_000 : 4_000_000_000)
            if toast?.id == id { toast = nil }
        }
    }

    func open(_ page: Page, link: String? = nil, chat: String? = nil) {
        if let link { selectedLink = link }
        if let chat { selectedChat = chat }
        self.page = page
    }

    /// Installs (or updates) the bridge bundled in the app, then reconnects.
    func runSetup() async {
        guard setup != .running else { return }
        setup = .running
        setupOutput = nil
        let r = await broker.setup()
        setupOutput = r.output
        // a step that can't apply here still leaves a working bridge (the broker then starts
        // on demand); only a missing runtime is a failure
        let installed = !broker.needsSetup
        setup = installed ? .none : .failed
        if installed && !r.ok {
            notify("BlueAIBridge is set up, with warnings", r.output.split(separator: "\n").filter { $0.hasPrefix("✖") }.joined(separator: "\n"), error: true)
        }
        if installed {
            // the LaunchAgent starts the broker; give it a moment, else start it ourselves
            func up() async -> Bool { let h: Health? = try? await broker.get("/api/health", timeout: 2); return h != nil }
            for _ in 0..<10 {
                if await up() { break }
                try? await Task.sleep(nanoseconds: 500_000_000)
            }
            if !(await up()) {
                broker.startBroker()
                try? await Task.sleep(nanoseconds: 1_500_000_000)
            }
        }
        await refreshCore()
    }

    func startBroker() {
        broker.startBroker()
        Task {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            await refreshCore()
        }
    }
}
