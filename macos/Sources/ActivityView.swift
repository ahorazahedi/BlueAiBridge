import SwiftUI
import UniformTypeIdentifiers

struct EventRow: View {
    let event: BridgeEvent
    var compact = false
    @Environment(AppModel.self) private var model

    var body: some View {
        let d = Self.describe(event)
        HStack(spacing: 10) {
            Text(Fmt.time(event.ts)).font(.caption.monospacedDigit()).foregroundStyle(.secondary).frame(width: compact ? 62 : 74, alignment: .leading)
            Image(systemName: d.icon).foregroundStyle(d.color).frame(width: 16)
            Text(d.text).font(compact ? .caption : .callout).lineLimit(compact ? 1 : 2).frame(maxWidth: .infinity, alignment: .leading)
            if !compact {
                if event.bytes > 0 { Text(Fmt.bytes(event.bytes)).font(.caption).foregroundStyle(.secondary) }
                if let l = event.linkId { Button("Open \(l)") { model.open(.conversations, link: l) }.buttonStyle(.link).font(.caption) }
            }
        }
        .padding(.horizontal, 14).padding(.vertical, compact ? 6 : 8)
    }

    static func who(_ k: String?) -> String { Fmt.appName(k?.split(separator: ":").first.map(String.init)) }

    static func describe(_ e: BridgeEvent) -> (icon: String, color: Color, text: String) {
        let d = e.data
        let s = { (k: String) in d[k]?.description ?? "" }
        switch e.type {
        case "message.created": return ("bubble.left", .secondary, "\(who(e.actor)) → \(who(d["to"]?.string)): new \(s("kind")) \(e.messageId ?? "")")
        case "review.answered":
            if d["decision"]?.string == "approved" { return ("checkmark.seal.fill", Palette.good, "\(who(e.actor)) approved \(e.linkId ?? "") (round \(s("round")))") }
            if d["decision"]?.string == "changes_requested" { return ("exclamationmark.triangle.fill", Palette.warning, "\(who(e.actor)) requested changes on \(e.linkId ?? ""): \(s("blocking")) must-fix") }
            return ("bubble.left", .secondary, "\(who(e.actor)) answered \(e.linkId ?? "")")
        case "ask.answered": return ("text.bubble", .secondary, "\(who(e.actor)) answered a question (\(e.linkId ?? ""))")
        case "delivery.started": return ("arrow.up.circle", Palette.brand, "Sending \(e.messageId ?? "") to \(who(e.actor)) (\(s("channel")))")
        case "delivery.done": return ("checkmark.circle.fill", Palette.good, "Delivered \(e.messageId ?? "") to \(who(e.actor)) (\(s("channel")))")
        case "delivery.deferred": return ("clock", Palette.warning, "\(e.messageId ?? "") waits: \(s("reason"))")
        case "delivery.retry": return ("arrow.clockwise", Palette.warning, "Retrying \(e.messageId ?? "") (attempt \(s("attempts"))): \(s("error").prefix(120))")
        case "delivery.failed": return ("xmark.octagon.fill", Palette.critical, "Delivery of \(e.messageId ?? "") failed: \(s("error").prefix(160))")
        case "link.created": return ("link", Palette.brand, "\(who(e.actor)) opened \(e.linkId ?? "") (\(s("kind")), \(s("delivery")))\(d["title"]?.string.map { ": \($0.prefix(80))" } ?? "")")
        case "link.joined": return ("person.badge.plus", Palette.brand, "\(who(e.actor)) joined \(e.linkId ?? "") with a code")
        case "link.closed": return ("link.badge.plus", .secondary, "\(e.linkId ?? "") closed: \(s("reason"))")
        case "auto.on": return ("bolt.fill", Palette.brand, "\(who(e.actor)) turned auto mode on (\(d["everyTurn"]?.bool == true ? "every turn" : "key moments"))")
        case "auto.off": return ("bolt.slash", .secondary, "\(who(e.actor)) turned auto mode off")
        case "auto.guard": return ("hand.raised.fill", Palette.warning, "End-of-turn check stopped \(who(e.actor)): unapproved changes")
        case "client.seen": return ("person.crop.circle.badge.plus", .secondary, "New chat: \(who(e.actor)) (\(s("surface")))")
        case "client.stop_failure": return ("xmark.octagon", Palette.critical, "\(who(e.actor)) stopped with an API error")
        case "client.permission_prompt": return ("hand.raised", Palette.warning, "\(who(e.actor)) waits for a tool approval")
        case "broker.started": return ("power", Palette.good, "Broker started (pid \(s("pid")), v\(s("version")))")
        case "broker.error": return ("exclamationmark.octagon", Palette.critical, "Broker error in \(s("what")): \(s("error").prefix(160))")
        case "install.install": return ("square.and.arrow.down", .secondary, "Installed \(s("target"))")
        case "install.uninstall": return ("trash", .secondary, "Uninstalled \(s("target"))")
        default: return ("circle", .secondary, "\(e.type)\(e.linkId.map { " · \($0)" } ?? "")\(e.messageId.map { " · \($0)" } ?? "")")
        }
    }
}

struct ActivityView: View {
    @Environment(AppModel.self) private var model
    @State private var filter = "all"
    @State private var paused = false
    @State private var frozen: [BridgeEvent] = []

    static let filters: [(String, String, (String) -> Bool)] = [
        ("all", "All", { _ in true }),
        ("messages", "Messages", { $0.hasPrefix("message.") || $0.hasPrefix("review.") || $0.hasPrefix("ask.") }),
        ("delivery", "Delivery", { $0.hasPrefix("delivery.") || $0.hasPrefix("app.") }),
        ("links", "Links", { $0.hasPrefix("link.") || $0.hasPrefix("auto.") }),
        ("errors", "Errors", { $0.contains("failed") || $0.contains("error") || $0.contains("retry") || $0.contains("stop_failure") }),
        ("system", "System", { t in ["broker.", "install.", "client.", "rules.", "config.", "maintenance.", "chat."].contains { t.hasPrefix($0) } }),
    ]

    var body: some View {
        let source = paused ? frozen : model.events
        let match = Self.filters.first { $0.0 == filter }!.2
        let shown = source.filter { match($0.type) }
        VStack(spacing: 0) {
            HStack {
                Picker("Filter", selection: $filter) { ForEach(Self.filters, id: \.0) { Text($0.1).tag($0.0) } }
                    .pickerStyle(.segmented).labelsHidden().frame(maxWidth: 520)
                Spacer()
                Text("\(shown.count) events").font(.caption).foregroundStyle(.secondary)
                Button(paused ? "Resume" : "Pause", systemImage: paused ? "play.fill" : "pause.fill") {
                    if !paused { frozen = model.events }
                    paused.toggle()
                }
                Button("Export…", systemImage: "square.and.arrow.up") { Exporter.save(model: model, path: "/api/export?what=events&format=csv&range=7d", name: "blueaibridge-events.csv") }
            }
            .padding(12)
            Divider()
            if shown.isEmpty {
                EmptyStateView(icon: "waveform.path.ecg", title: "No events yet", message: "Events appear here live as chats use the bridge.")
            } else {
                List(shown) { e in EventRow(event: e).listRowInsets(EdgeInsets()) }
                    .listStyle(.plain)
            }
        }
    }
}

/// Save an export from the broker with a native save panel.
enum Exporter {
    @MainActor
    static func save(model: AppModel, path: String, name: String) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = name
        panel.allowedContentTypes = name.hasSuffix(".json") ? [.json] : [.commaSeparatedText]
        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task {
            do {
                let data = try await model.broker.raw(path)
                try data.write(to: url)
                model.notify("Exported", url.lastPathComponent)
            } catch { model.notify("Export failed", error.localizedDescription, error: true) }
        }
    }
}
