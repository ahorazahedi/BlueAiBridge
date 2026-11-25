// Shared building blocks: palette, formatting, badges, cards, states, markdown.

import SwiftUI

// MARK: - palette (validated categorical order: blue, orange, aqua; status colors reserved)

enum Palette {
    static func dyn(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(nsColor: NSColor(name: nil) { a in
            NSColor(hex: a.bestMatch(from: [.darkAqua, .vibrantDark]) != nil ? dark : light)
        })
    }
    static let claudeToGpt = dyn(0x2A78D6, 0x3987E5)
    static let gptToClaude = dyn(0xEB6834, 0xD95926)
    static let bridge = dyn(0x1BAF7A, 0x199E70)
    static let good = dyn(0x0CA30C, 0x22C55E)
    static let warning = dyn(0xB77900, 0xFAB219)
    static let warningMark = Color(nsColor: NSColor(hex: 0xFAB219))
    static let critical = dyn(0xD03B3B, 0xF06A6A)
    static let claude = dyn(0xC15F3C, 0xE48A66)
    static let gpt = dyn(0x0F766E, 0x3CC2B1)
    static let brand = dyn(0x2563EB, 0x4F8DF5)
    static func app(_ a: String?) -> Color { a == "claude" ? claude : a == "codex" ? gpt : brand }
}

extension NSColor {
    convenience init(hex: UInt32) {
        self.init(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}

// MARK: - formatting

enum Fmt {
    static func bytes(_ n: Int?) -> String {
        guard let n else { return "—" }
        return ByteCountFormatter.string(fromByteCount: Int64(n), countStyle: .file)
    }
    static func num(_ n: Int?) -> String {
        guard let n else { return "—" }
        return n.formatted(.number.notation(n >= 10_000 ? .compactName : .automatic))
    }
    static func duration(_ ms: Double?) -> String {
        guard let ms else { return "—" }
        if ms < 1000 { return "\(Int(ms)) ms" }
        let s = ms / 1000
        if s < 60 { return String(format: s < 10 ? "%.1f s" : "%.0f s", s) }
        let m = Int(s / 60)
        if m < 60 { return "\(m)m \(Int(s) % 60)s" }
        return "\(m / 60)h \(m % 60)m"
    }
    static func date(_ ms: Double?) -> Date? { ms.map { Date(timeIntervalSince1970: $0 / 1000) } }
    static func ago(_ ms: Double?) -> String {
        guard let d = date(ms) else { return "—" }
        if abs(d.timeIntervalSinceNow) < 45 { return "just now" }
        return d.formatted(.relative(presentation: .named))
    }
    static func time(_ ms: Double?) -> String { date(ms)?.formatted(date: .omitted, time: .standard) ?? "—" }
    static func dateTime(_ ms: Double?) -> String { date(ms)?.formatted(date: .abbreviated, time: .shortened) ?? "—" }
    static func shortId(_ id: String) -> String { id.count > 14 ? "\(id.prefix(8))…\(id.suffix(4))" : id }
    static func appName(_ a: String?) -> String { a == "claude" ? "Claude" : a == "codex" ? "ChatGPT" : "BlueAIBridge" }
    static func kindLabel(_ k: String) -> String { ["review": "Review", "auto": "Auto mode", "ask": "Question", "turn": "Turn review"][k] ?? k }
    static func channelLabel(_ c: String) -> String {
        switch c {
        case "visible": "Visible (in the app's chat)"
        case "headless": "Headless (background CLI)"
        case "inline": "Inline (tool result)"
        case "note": "With the next prompt"
        default: c
        }
    }
}

// MARK: - badges

struct Pill: View {
    let text: String
    var icon: String? = nil
    var color: Color = .secondary
    var filled = true
    var body: some View {
        HStack(spacing: 4) {
            if let icon { Image(systemName: icon).font(.system(size: 9, weight: .bold)) }
            Text(text).font(.caption.weight(.semibold)).lineLimit(1)
        }
        .padding(.horizontal, 7).padding(.vertical, 2.5)
        .foregroundStyle(color)
        .background(Capsule().fill(filled ? color.opacity(0.13) : .clear))
        .overlay(Capsule().strokeBorder(filled ? .clear : color.opacity(0.35)))
    }
}

struct AppBadge: View {
    let endpoint: Endpoint?
    var showId = false
    var body: some View {
        if let e = endpoint {
            HStack(spacing: 4) {
                AppMark(app: e.app, size: 10)
                Text(e.appName).font(.caption.weight(.semibold))
                if showId { Text(Fmt.shortId(e.id)).font(.caption.monospaced()).opacity(0.75) }
            }
            .padding(.horizontal, 7).padding(.vertical, 2.5)
            .foregroundStyle(Palette.app(e.app))
            .background(Capsule().fill(Palette.app(e.app).opacity(0.13)))
            .help(e.key)
        } else {
            Pill(text: "BlueAIBridge", color: Palette.brand)
        }
    }
}

struct AppMark: View {
    let app: String
    var size: CGFloat = 14
    var body: some View {
        Image(systemName: app == "claude" ? "asterisk" : app == "codex" ? "circle.hexagongrid" : "point.3.connected.trianglepath.dotted")
            .font(.system(size: size, weight: .bold))
    }
}

struct Avatar: View {
    let app: String?
    var size: CGFloat = 32
    var body: some View {
        let grad: [Color] = app == "claude" ? [Color(nsColor: NSColor(hex: 0xD97757)), Color(nsColor: NSColor(hex: 0xB4532F))]
            : app == "codex" ? [Color(nsColor: NSColor(hex: 0x10A37F)), Color(nsColor: NSColor(hex: 0x0B6E57))]
            : [Color(nsColor: NSColor(hex: 0x3B82F6)), Color(nsColor: NSColor(hex: 0x1D4ED8))]
        RoundedRectangle(cornerRadius: size * 0.28)
            .fill(LinearGradient(colors: grad, startPoint: .topLeading, endPoint: .bottomTrailing))
            .frame(width: size, height: size)
            .overlay(AppMark(app: app ?? "bridge", size: size * 0.42).foregroundStyle(.white))
    }
}

struct StateBadge: View {
    let state: String
    var body: some View {
        let (label, icon, color): (String, String, Color) = {
            switch state {
            case "pending": ("Pending", "clock", .secondary)
            case "deferred": ("Waiting", "clock", Palette.warning)
            case "sending": ("Sending", "arrow.up.circle", Palette.brand)
            case "delivered": ("Delivered", "checkmark", Palette.good)
            case "answered": ("Answered", "checkmark.circle", Palette.good)
            case "failed": ("Failed", "xmark.octagon", Palette.critical)
            case "cancelled": ("Cancelled", "xmark", .secondary)
            case "open": ("Open", "circle.fill", Palette.brand)
            case "waiting_join": ("Waiting to join", "clock", Palette.warning)
            case "closed": ("Closed", "xmark", .secondary)
            default: (state, "circle", .secondary)
            }
        }()
        Pill(text: label, icon: icon, color: color)
    }
}

struct DecisionBadge: View {
    let decision: String?
    var body: some View {
        if decision == "approved" { Pill(text: "Approved", icon: "checkmark.seal.fill", color: Palette.good) }
        else if decision == "changes_requested" { Pill(text: "Changes requested", icon: "exclamationmark.triangle.fill", color: Palette.warning) }
    }
}

// MARK: - cards & states

struct Card<Content: View, Trailing: View>: View {
    var title: String?
    var subtitle: String?
    @ViewBuilder var trailing: () -> Trailing
    @ViewBuilder var content: () -> Content
    var padded = true

    init(_ title: String? = nil, subtitle: String? = nil, padded: Bool = true, @ViewBuilder trailing: @escaping () -> Trailing = { EmptyView() }, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.subtitle = subtitle
        self.padded = padded
        self.trailing = trailing
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if title != nil {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 2) {
                        if let title { Text(title).font(.headline) }
                        if let subtitle { Text(subtitle).font(.caption).foregroundStyle(.secondary) }
                    }
                    Spacer()
                    trailing()
                }
                .padding(.horizontal, 16).padding(.vertical, 12)
                Divider()
            }
            content().padding(padded ? 16 : 0).frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(RoundedRectangle(cornerRadius: 12).fill(Color(nsColor: .controlBackgroundColor)))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color(nsColor: .separatorColor).opacity(0.6)))
    }
}

struct KPI: View {
    let label: String
    let value: String
    var icon: String
    var hint: String? = nil
    var hintColor: Color = .secondary
    var valueColor: Color = .primary
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(label, systemImage: icon).font(.caption.weight(.medium)).foregroundStyle(.secondary)
            Text(value).font(.system(size: 24, weight: .bold, design: .rounded)).monospacedDigit().foregroundStyle(valueColor)
                .contentTransition(.numericText())
            Text(hint ?? " ").font(.caption).foregroundStyle(hintColor).lineLimit(1)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color(nsColor: .controlBackgroundColor)))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color(nsColor: .separatorColor).opacity(0.6)))
    }
}

struct EmptyStateView: View {
    let icon: String
    let title: String
    var message: String? = nil
    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: icon)
        } description: {
            if let message { Text(message) }
        }
    }
}

struct ErrorBanner: View {
    let error: Error
    var retry: (() -> Void)? = nil
    @Environment(AppModel.self) private var model
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.octagon.fill").foregroundStyle(Palette.critical)
            VStack(alignment: .leading, spacing: 2) {
                Text("Couldn't load this").font(.callout.weight(.semibold))
                Text(error.localizedDescription).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if case BrokerError.notRunning = error, model.broker.cli() != nil {
                Button("Start broker") { model.startBroker() }
            }
            if let retry { Button("Retry", action: retry) }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 10).fill(Palette.critical.opacity(0.08)))
    }
}

/// A page with a title bar row and scrolling content.
struct PageScroll<Content: View>: View {
    @ViewBuilder var content: () -> Content
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) { content() }
                .padding(20)
                .frame(maxWidth: 1500, alignment: .leading)
                .frame(maxWidth: .infinity)
        }
        .background(Color(nsColor: .windowBackgroundColor))
    }
}

// MARK: - markdown

/// Agent text: fenced code blocks (diff-colored), headings, lists and inline markdown.
struct MarkdownText: View {
    let text: String
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(blocks().enumerated()), id: \.offset) { _, b in
                switch b {
                case .code(let lines):
                    ScrollView(.horizontal, showsIndicators: false) {
                        VStack(alignment: .leading, spacing: 0) {
                            ForEach(Array(lines.enumerated()), id: \.offset) { _, l in
                                Text(l.isEmpty ? " " : l)
                                    .foregroundStyle(l.hasPrefix("+") && !l.hasPrefix("+++") ? Palette.good : l.hasPrefix("-") && !l.hasPrefix("---") ? Palette.critical : .primary)
                            }
                        }
                        .font(.system(size: 11.5, design: .monospaced))
                        .padding(10)
                    }
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05)))
                    .textSelection(.enabled)
                case .heading(let s):
                    Text(inline(s)).font(.callout.weight(.semibold)).padding(.top, 4)
                case .bullet(let s, let marker):
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(marker).foregroundStyle(.secondary)
                        Text(inline(s)).textSelection(.enabled)
                    }
                case .para(let s):
                    Text(inline(s)).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .font(.callout)
    }

    enum Block { case code([String]), heading(String), bullet(String, String), para(String) }

    func blocks() -> [Block] {
        var out: [Block] = []
        let lines = text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        var i = 0
        var para: [String] = []
        func flush() { if !para.isEmpty { out.append(.para(para.joined(separator: "\n"))); para = [] } }
        while i < lines.count {
            let l = lines[i]
            let t = l.trimmingCharacters(in: .whitespaces)
            if t.hasPrefix("```") {
                flush()
                var code: [String] = []
                i += 1
                while i < lines.count, !lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("```") { code.append(lines[i]); i += 1 }
                out.append(.code(code))
            } else if t.range(of: #"^#{1,4}\s+"#, options: .regularExpression) != nil {
                flush()
                out.append(.heading(t.replacingOccurrences(of: #"^#{1,4}\s+"#, with: "", options: .regularExpression)))
            } else if let r = t.range(of: #"^([-*•]|\d+[.)])\s+"#, options: .regularExpression) {
                flush()
                let marker = t[r].trimmingCharacters(in: .whitespaces)
                out.append(.bullet(String(t[r.upperBound...]), marker.first?.isNumber == true ? marker : "•"))
            } else if t.isEmpty {
                flush()
            } else {
                para.append(l)
            }
            i += 1
        }
        flush()
        return out
    }

    func inline(_ s: String) -> AttributedString {
        (try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(s)
    }
}

// MARK: - helpers

extension View {
    /// reload when the page appears, when `key` changes, and on live changes (debounced)
    func reload(on key: some Equatable, _ model: AppModel, _ action: @escaping () async -> Void) -> some View {
        self.task(id: "\(key)#\(model.tick)") { await action() }
    }
}

struct ConfirmAction: Identifiable {
    let id = UUID()
    let title: String
    let message: String
    let button: String
    let destructive: Bool
    let run: () async -> Void
}
