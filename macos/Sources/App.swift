// BlueAIBridge for macOS: a native window with the full monitoring and
// management UI, plus a menu-bar icon that stays when the window is closed.

import SwiftUI
import AppKit

@main
struct BlueAIBridgeApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @State private var model = AppModel()

    var body: some Scene {
        Window("BlueAIBridge", id: "main") {
            ContentView()
                .environment(model)
                .frame(minWidth: 1000, minHeight: 640)
                .onAppear { model.start(); NSApp.setActivationPolicy(.regular) }
                .onDisappear { NSApp.setActivationPolicy(.accessory) }
        }
        .defaultSize(width: 1360, height: 880)
        .windowToolbarStyle(.unified)
        .commands {
            CommandGroup(replacing: .newItem) {}
            CommandMenu("Go") {
                ForEach(Array(Page.allCases.enumerated()), id: \.element) { i, p in
                    Button(p.title) { model.page = p }.keyboardShortcut(KeyEquivalent(Character("\(i + 1)")), modifiers: .command)
                }
            }
            CommandGroup(after: .toolbar) {
                Button("Reload") { model.tick += 1 }.keyboardShortcut("r", modifiers: .command)
                Button("Open Web Dashboard") { model.broker.openWebDashboard() }.keyboardShortcut("o", modifiers: [.command, .shift])
            }
        }

        MenuBarExtra {
            MenuBarContent().environment(model)
        } label: {
            Image(systemName: menuIcon)
                .task { model.start() }
        }
        .menuBarExtraStyle(.window)
    }

    var menuIcon: String {
        if model.health == nil { return "bubble.left.and.bubble.right" }
        return (model.summary?.failed ?? 0) > 0 ? "exclamationmark.bubble.fill" : "bubble.left.and.bubble.right.fill"
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // started at login: only the menu-bar icon, no window
        if CommandLine.arguments.contains("--background") {
            NSApp.setActivationPolicy(.accessory)
            DispatchQueue.main.async { NSApp.windows.filter { $0.identifier?.rawValue.contains("main") == true || $0.title == "BlueAIBridge" }.forEach { $0.close() } }
        }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}

// MARK: - main window

struct ContentView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        NavigationSplitView {
            List(selection: $model.page) {
                Section("Monitor") { ForEach(Page.allCases.filter(\.isMonitor)) { sidebarRow($0) } }
                Section("Manage") { ForEach(Page.allCases.filter { !$0.isMonitor }) { sidebarRow($0) } }
            }
            .navigationSplitViewColumnWidth(min: 200, ideal: 220, max: 280)
            .safeAreaInset(edge: .bottom) { sidebarFooter }
        } detail: {
            detail
                .navigationTitle(model.page?.title ?? "BlueAIBridge")
                .navigationSubtitle(subtitle)
                .toolbar { toolbar }
        }
        .overlay(alignment: .bottomTrailing) { toastView }
    }

    func sidebarRow(_ p: Page) -> some View {
        Label(p.title, systemImage: p.icon)
            .badge(p == .conversations ? (model.summary?.openLinks ?? 0) : 0)
            .tag(p)
    }

    var subtitle: String {
        switch model.connection {
        case .live: "Live"
        case .connecting: "Connecting…"
        case .down: "Broker not running"
        }
    }

    @ViewBuilder var detail: some View {
        if model.connection == .down && model.health == nil {
            offline
        } else {
            switch model.page ?? .overview {
            case .overview: OverviewView()
            case .conversations: ConversationsView()
            case .traffic: TrafficView()
            case .activity: ActivityView()
            case .chats: ChatsView()
            case .clients: ClientsView()
            case .health: HealthView()
            case .settings: SettingsPage()
            }
        }
    }

    var offline: some View {
        ContentUnavailableView {
            Label("The broker isn't running", systemImage: "bolt.horizontal.circle")
        } description: {
            Text(model.broker.cli() == nil
                 ? "BlueAIBridge isn't installed yet. In its folder run: node dist/src/cli.js install"
                 : "It starts on its own when a chat uses BlueAIBridge, or keeps running with the background service.")
        } actions: {
            if model.broker.cli() != nil { Button("Start broker") { model.startBroker() }.buttonStyle(.borderedProminent) }
        }
    }

    @ToolbarContentBuilder var toolbar: some ToolbarContent {
        @Bindable var model = model
        ToolbarItemGroup(placement: .primaryAction) {
            if model.page == .overview || model.page == .traffic {
                Picker("Range", selection: $model.range) { ForEach(TimeRange.allCases) { Text($0.rawValue).tag($0) } }
                    .pickerStyle(.segmented).help("Time range")
            }
            Button { model.tick += 1 } label: { Label("Reload", systemImage: "arrow.clockwise") }.help("Reload (⌘R)")
            Button { model.broker.openWebDashboard(model.page?.rawValue ?? "") } label: { Label("Open in browser", systemImage: "safari") }.help("Open the web dashboard")
        }
    }

    var sidebarFooter: some View {
        VStack(alignment: .leading, spacing: 4) {
            Divider()
            HStack(spacing: 6) {
                Circle().fill(model.connection == .live ? Palette.good : model.connection == .down ? Palette.critical : Color.secondary).frame(width: 7, height: 7)
                Text(model.connection == .live ? "Broker connected" : model.connection == .down ? "Broker unreachable" : "Connecting…").font(.caption)
            }
            if let h = model.health, let v = h.version {
                Text("v\(v) · port \(String(h.port ?? 0))\(h.startedAt.map { " · up \(Fmt.duration(Date().timeIntervalSince1970 * 1000 - $0))" } ?? "")").font(.caption2).foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 14).padding(.bottom, 10)
    }

    @ViewBuilder var toastView: some View {
        if let t = model.toast {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: t.isError ? "xmark.octagon.fill" : "checkmark.circle.fill").foregroundStyle(t.isError ? Palette.critical : Palette.good)
                VStack(alignment: .leading, spacing: 2) {
                    Text(t.title).fontWeight(.semibold)
                    if let b = t.body { Text(b).font(.caption).foregroundStyle(.secondary) }
                }
                Button { model.toast = nil } label: { Image(systemName: "xmark") }.buttonStyle(.borderless)
            }
            .padding(12)
            .frame(maxWidth: 380, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 12).fill(.regularMaterial).shadow(radius: 10))
            .padding(20)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }
}

// MARK: - menu bar

struct MenuBarContent: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow
    @State private var links: [Link] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Avatar(app: nil, size: 28)
                VStack(alignment: .leading, spacing: 1) {
                    Text("BlueAIBridge").font(.headline)
                    HStack(spacing: 5) {
                        Circle().fill(model.health != nil ? Palette.good : Color.secondary).frame(width: 7, height: 7)
                        Text(model.health.map { "Running · v\($0.version ?? "?") · port \(String($0.port ?? 0))" } ?? "Broker not running").font(.caption).foregroundStyle(.secondary)
                    }
                }
                Spacer()
            }
            if let s = model.summary {
                Grid(horizontalSpacing: 8, verticalSpacing: 8) {
                    GridRow { tile("Messages · 24h", Fmt.num(s.messages)); tile("Data", Fmt.bytes(s.bytes)) }
                    GridRow { tile("Open links", Fmt.num(s.openLinks)); tile("Failed", Fmt.num(s.failed), s.failed > 0 ? Palette.critical : .primary) }
                }
                VStack(alignment: .leading, spacing: 5) {
                    Text("Recent conversations").font(.caption).foregroundStyle(.secondary)
                    if links.isEmpty { Text("None yet").font(.caption).foregroundStyle(.tertiary) }
                    ForEach(links) { l in
                        Button { show(.conversations, link: l.id) } label: {
                            HStack(spacing: 6) {
                                Text(l.id).font(.caption.monospaced()).foregroundStyle(.secondary)
                                Text(l.title).font(.caption).lineLimit(1)
                                Spacer(minLength: 0)
                                if let d = l.lastMessage?.decision { Image(systemName: d.approved ? "checkmark.seal.fill" : "exclamationmark.triangle.fill").foregroundStyle(d.approved ? Palette.good : Palette.warning).font(.caption) }
                            }
                        }.buttonStyle(.plain)
                    }
                }
            } else if model.broker.cli() != nil {
                Button("Start broker") { model.startBroker() }
            }
            Divider()
            HStack {
                Button("Open BlueAIBridge") { show(.overview) }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                Button("Health") { show(.health) }
                Spacer()
                Button("Quit") { NSApp.terminate(nil) }
            }.controlSize(.small)
        }
        .padding(14)
        .frame(width: 330)
        .task(id: model.tick) {
            if let r: LinksResponse = try? await model.broker.get("/api/links?limit=5") { links = r.links }
        }
    }

    func tile(_ label: String, _ value: String, _ color: Color = .primary) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.system(size: 17, weight: .semibold, design: .rounded)).monospacedDigit().foregroundStyle(color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05)))
    }

    func show(_ page: Page, link: String? = nil) {
        model.open(page, link: link)
        NSApp.setActivationPolicy(.regular)
        openWindow(id: "main")
        NSApp.activate(ignoringOtherApps: true)
    }
}
