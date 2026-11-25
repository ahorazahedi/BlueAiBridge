import SwiftUI
import Charts

struct OverviewView: View {
    @Environment(AppModel.self) private var model
    @State private var summary: Summary?
    @State private var series: Series?
    @State private var links: [Link] = []
    @State private var limits: Limits?
    @State private var error: Error?
    @State private var hover: SeriesPoint?

    var body: some View {
        PageScroll {
            if let error { ErrorBanner(error: error) { Task { await load() } } }
            kpis
            HStack(alignment: .top, spacing: 16) {
                Card("Traffic", subtitle: "Messages through the bridge, by direction") {
                    legend
                } content: { trafficChart.frame(height: 240) }
                    .frame(maxWidth: .infinity)
                Card("Data flow", subtitle: "Last \(model.range.rawValue)") { flow }
                    .frame(width: 340)
            }
            HStack(alignment: .top, spacing: 16) {
                Card("Recent conversations", padded: false) {
                    Button("View all") { model.open(.conversations) }.buttonStyle(.link)
                } content: { recent }
                    .frame(maxWidth: .infinity)
                VStack(spacing: 16) {
                    Card("Review verdicts", subtitle: "\(approved + changes) in the last \(model.range.rawValue)") { verdicts }
                    Card("ChatGPT usage", subtitle: "Codex rate-limit windows") { usage }
                    Card("Live activity", padded: false) {
                        Button("All") { model.open(.activity) }.buttonStyle(.link)
                    } content: { feed }
                }
                .frame(width: 340)
            }
        }
        .reload(on: model.range, model) { await load() }
        .task { if let r: LimitsResponse = try? await model.broker.get("/api/limits", timeout: 20) { limits = r.limits } }
    }

    func load() async {
        do {
            async let s: Summary = model.broker.get("/api/summary?range=\(model.range.rawValue)")
            async let p: Series = model.broker.get("/api/series?range=\(model.range.rawValue)")
            async let l: LinksResponse = model.broker.get("/api/links?limit=8")
            summary = try await s
            series = try await p
            links = try await l.links
            error = nil
        } catch { self.error = error }
    }

    var approved: Int { summary?.decisions["approved"] ?? 0 }
    var changes: Int { summary?.decisions["changes_requested"] ?? 0 }

    // MARK: KPIs

    var kpis: some View {
        let s = summary
        return LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 6), spacing: 12) {
            KPI(label: "Messages", value: Fmt.num(s?.messages), icon: "bubble.left.and.text.bubble.right", hint: s.map { "\($0.pending) waiting to be delivered" })
            KPI(label: "Data transferred", value: Fmt.bytes(s?.bytes), icon: "externaldrive.connected.to.line.below", hint: "Requests, answers, messages")
            KPI(label: "Open conversations", value: Fmt.num(s?.openLinks), icon: "link", hint: s.map { "\($0.autosOn) auto mode\($0.autosOn == 1 ? "" : "s") on" })
            KPI(label: "Avg review time", value: Fmt.duration(s?.avgReviewMs), icon: "timer", hint: s.map { "delivery \(Fmt.duration($0.avgDeliveryMs))" })
            KPI(label: "Failure rate", value: s.map { $0.messages == 0 ? "0%" : "\(Int((Double($0.failed) / Double($0.messages) * 100).rounded()))%" } ?? "—", icon: "exclamationmark.triangle",
                hint: s.map { $0.failed == 0 ? "No failed deliveries" : "\($0.failed) failed deliveries" }, hintColor: (s?.failed ?? 0) > 0 ? Palette.critical : .secondary)
            KPI(label: "Active chats", value: Fmt.num(s?.clients), icon: "person.2", hint: "Seen in this range")
        }
    }

    // MARK: traffic chart (stacked bars, hover tooltip)

    struct Bar: Identifiable { let id: String; let start: Date; let end: Date; let series: String; let y0: Double; let y1: Double }
    static let seriesNames = ["Claude → ChatGPT", "ChatGPT → Claude", "BlueAIBridge notices"]

    var points: [SeriesPoint] {
        guard let s = series else { return [] }
        // fill empty buckets so the axis is continuous
        let bucket = s.bucketMs
        let now = Date().timeIntervalSince1970 * 1000
        let first = ((now - model.range.seconds * 1000) / bucket).rounded(.down) * bucket
        let map = Dictionary(s.points.map { ($0.t, $0) }, uniquingKeysWith: { a, _ in a })
        var out: [SeriesPoint] = []
        var t = first
        while t <= now {
            out.append(map[t] ?? SeriesPoint(t: t, claudeToChatgpt: 0, chatgptToClaude: 0, bridge: 0, bytes: 0, failed: 0))
            t += bucket
        }
        return out
    }

    /// Stacked segments per bucket, built by hand: bucket-wide bars, a surface gap between segments.
    func bars(_ pts: [SeriesPoint]) -> [Bar] {
        let bucket = (series?.bucketMs ?? 60_000) / 1000
        let maxTotal = Double(max(1, pts.map(\.total).max() ?? 1))
        let gap = maxTotal * 0.012
        return pts.flatMap { p -> [Bar] in
            let start = p.date.addingTimeInterval(bucket * 0.12)
            let end = p.date.addingTimeInterval(bucket * 0.88)
            var acc = 0.0
            var out: [Bar] = []
            for (i, v) in [p.claudeToChatgpt, p.chatgptToClaude, p.bridge].enumerated() where v > 0 {
                let y0 = acc + (acc > 0 ? gap : 0)
                acc += Double(v)
                out.append(Bar(id: "\(p.t)-\(i)", start: start, end: end, series: Self.seriesNames[i], y0: y0, y1: acc))
            }
            return out
        }
    }

    func barMark(_ b: Bar) -> some ChartContent {
        let x0: PlottableValue<Date> = .value("From", b.start)
        let x1: PlottableValue<Date> = .value("To", b.end)
        let y0: PlottableValue<Double> = .value("Messages", b.y0)
        let y1: PlottableValue<Double> = .value("Messages", b.y1)
        let series: PlottableValue<String> = .value("Direction", b.series)
        return RectangleMark(xStart: x0, xEnd: x1, yStart: y0, yEnd: y1).foregroundStyle(by: series).cornerRadius(2)
    }

    var trafficChart: some View {
        let pts = points
        let bucketSec = (series?.bucketMs ?? 60_000) / 1000
        return Chart {
            ForEach(bars(pts)) { b in barMark(b) }
            if let h = hover {
                RuleMark(x: .value("Time", h.date.addingTimeInterval(bucketSec / 2))).foregroundStyle(.secondary.opacity(0.3))
                    .annotation(position: .top, overflowResolution: .init(x: .fit, y: .disabled)) { tooltip(h) }
            }
        }
        .chartForegroundStyleScale(domain: Self.seriesNames, range: [Palette.claudeToGpt, Palette.gptToClaude, Palette.bridge])
        .chartLegend(.hidden)
        .chartXScale(domain: (pts.first?.date ?? Date()) ... (pts.last?.date.addingTimeInterval(bucketSec) ?? Date()))
        .chartYAxis { AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) { _ in AxisGridLine().foregroundStyle(.secondary.opacity(0.15)); AxisValueLabel() } }
        .chartOverlay { proxy in
            GeometryReader { geo in
                Rectangle().fill(.clear).contentShape(Rectangle())
                    .onContinuousHover { phase in
                        switch phase {
                        case .active(let loc):
                            guard let plot = proxy.plotFrame else { return }
                            if let d: Date = proxy.value(atX: loc.x - geo[plot].origin.x) {
                                hover = pts.last { $0.date <= d }
                            }
                        case .ended: hover = nil
                        }
                    }
            }
        }
    }

    func tooltip(_ p: SeriesPoint) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(p.date.formatted(date: .abbreviated, time: .shortened)).font(.caption.weight(.semibold))
            row(Self.seriesNames[0], p.claudeToChatgpt, Palette.claudeToGpt)
            row(Self.seriesNames[1], p.chatgptToClaude, Palette.gptToClaude)
            row(Self.seriesNames[2], p.bridge, Palette.bridge)
            Divider()
            HStack { Text("Data").foregroundStyle(.secondary); Spacer(); Text(Fmt.bytes(p.bytes)).monospacedDigit() }.font(.caption)
            if p.failed > 0 { HStack { Text("Failed"); Spacer(); Text("\(p.failed)") }.font(.caption).foregroundStyle(Palette.critical) }
        }
        .padding(10)
        .frame(width: 210)
        .background(RoundedRectangle(cornerRadius: 8).fill(.regularMaterial).shadow(radius: 6))
    }

    func row(_ label: String, _ v: Int, _ c: Color) -> some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 2).fill(c).frame(width: 9, height: 9)
            Text(label)
            Spacer()
            Text("\(v)").fontWeight(.semibold).monospacedDigit()
        }.font(.caption)
    }

    var legend: some View {
        HStack(spacing: 12) {
            ForEach(Array(zip(Self.seriesNames, [Palette.claudeToGpt, Palette.gptToClaude, Palette.bridge])), id: \.0) { name, c in
                HStack(spacing: 5) { RoundedRectangle(cornerRadius: 2).fill(c).frame(width: 10, height: 10); Text(name) }
            }
        }.font(.caption).foregroundStyle(.secondary)
    }

    // MARK: flow

    var flow: some View {
        let dirs = summary?.byDirection ?? []
        let c2g = dirs.filter { $0.from == "claude" }.reduce((0, 0)) { ($0.0 + $1.messages, $0.1 + $1.bytes) }
        let g2c = dirs.filter { $0.from == "codex" }.reduce((0, 0)) { ($0.0 + $1.messages, $0.1 + $1.bytes) }
        let channels = (summary?.byChannel ?? []).filter { $0.channel != "none" }
        let maxC = max(1, channels.map(\.messages).max() ?? 1)
        return VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                node("Claude", "claude", "Code tab · CLI")
                VStack(spacing: 10) {
                    arrow("\(c2g.0) msgs · \(Fmt.bytes(c2g.1))", Palette.claudeToGpt, right: true)
                    arrow("\(g2c.0) msgs · \(Fmt.bytes(g2c.1))", Palette.gptToClaude, right: false)
                }
                node("ChatGPT", "codex", "Desktop · CLI")
            }
            Divider()
            ForEach(channels, id: \.channel) { c in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(Fmt.channelLabel(c.channel)).font(.caption)
                        Spacer()
                        Text("\(c.messages)").font(.caption.weight(.semibold)).monospacedDigit()
                        Text(Fmt.bytes(c.bytes)).font(.caption).foregroundStyle(.secondary)
                    }
                    ProgressView(value: Double(c.messages), total: Double(maxC))
                        .tint(c.channel == "headless" ? Palette.gptToClaude : c.channel == "note" ? Palette.bridge : Palette.claudeToGpt)
                }
            }
        }
    }

    func node(_ name: String, _ app: String, _ sub: String) -> some View {
        VStack(spacing: 4) {
            Avatar(app: app, size: 30)
            Text(name).font(.callout.weight(.semibold))
            Text(sub).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
        }
        .frame(width: 88).padding(.vertical, 10)
        .background(RoundedRectangle(cornerRadius: 10).strokeBorder(Color(nsColor: .separatorColor)))
    }

    func arrow(_ label: String, _ c: Color, right: Bool) -> some View {
        VStack(spacing: 2) {
            Text(label).font(.caption2).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.8)
            HStack(spacing: 0) {
                if !right { Image(systemName: "arrowtriangle.left.fill").font(.system(size: 7)) }
                Rectangle().frame(height: 2.5)
                if right { Image(systemName: "arrowtriangle.right.fill").font(.system(size: 7)) }
            }.foregroundStyle(c)
        }
    }

    // MARK: recent, verdicts, usage, feed

    var recent: some View {
        Group {
            if links.isEmpty {
                EmptyStateView(icon: "bubble.left.and.bubble.right", title: "No conversations yet", message: "Ask from Claude Code: “Ask ChatGPT to review this change”, or from ChatGPT: “Ask Claude for a second opinion”.").padding(.vertical, 20)
            } else {
                VStack(spacing: 0) {
                    ForEach(links) { l in
                        Button { model.open(.conversations, link: l.id) } label: { LinkRow(link: l) }.buttonStyle(.plain)
                        Divider()
                    }
                }
            }
        }
    }

    var verdicts: some View {
        let total = approved + changes
        return VStack(alignment: .leading, spacing: 10) {
            if total == 0 { Text("No verdicts yet.").font(.caption).foregroundStyle(.secondary) } else {
                GeometryReader { g in
                    HStack(spacing: 2) {
                        if approved > 0 { Rectangle().fill(Palette.good).frame(width: max(4, (g.size.width - 2) * CGFloat(approved) / CGFloat(total))) }
                        if changes > 0 { Rectangle().fill(Palette.warningMark) }
                    }.clipShape(RoundedRectangle(cornerRadius: 4))
                }.frame(height: 12)
            }
            HStack { Label("Approved", systemImage: "checkmark.seal.fill").foregroundStyle(Palette.good); Spacer(); Text("\(approved)").bold() }.font(.callout)
            HStack { Label("Changes requested", systemImage: "exclamationmark.triangle.fill").foregroundStyle(Palette.warning); Spacer(); Text("\(changes)").bold() }.font(.callout)
        }
    }

    var usage: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let l = limits {
                if l.blocked { Pill(text: "Limit reached — reviews wait for the reset", icon: "exclamationmark.octagon.fill", color: Palette.critical) }
                window("Primary window", l.primary)
                window("Secondary window", l.secondary)
            } else {
                Text("Not available (ChatGPT Desktop not installed or not signed in).").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder func window(_ label: String, _ w: Limits.Window?) -> some View {
        if let w {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(label).font(.caption)
                    Spacer()
                    Text("\(Int(w.usedPercent))% used").font(.caption.weight(.semibold)).monospacedDigit()
                    if let r = w.resetsAt { Text("· resets \(Fmt.ago(r))").font(.caption).foregroundStyle(.secondary) }
                }
                ProgressView(value: min(100, w.usedPercent), total: 100).tint(w.usedPercent >= 90 ? Palette.critical : w.usedPercent >= 70 ? Palette.warningMark : Palette.claudeToGpt)
            }
        }
    }

    var feed: some View {
        let evs = model.events.filter { !$0.type.hasPrefix("tool.") && $0.type != "client.seen" && $0.type != "message.created" }.prefix(7)
        return VStack(spacing: 0) {
            if evs.isEmpty { Text("Waiting for activity…").font(.caption).foregroundStyle(.secondary).padding(14) }
            ForEach(Array(evs)) { e in
                EventRow(event: e, compact: true)
                Divider()
            }
        }
    }
}

/// One conversation in a list.
struct LinkRow: View {
    let link: Link
    var selected = false
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                Text(link.id).font(.caption.monospaced()).foregroundStyle(.secondary)
                Pill(text: Fmt.kindLabel(link.kind) + (link.reviewKind == "plan" ? " · plan" : ""), filled: false)
                Spacer()
                Text(Fmt.ago(link.updatedAt)).font(.caption).foregroundStyle(.secondary)
            }
            Text(link.title.isEmpty ? "(untitled)" : link.title).font(.callout.weight(.semibold)).lineLimit(1)
            HStack(spacing: 5) {
                AppBadge(endpoint: link.requester)
                Image(systemName: "arrow.right").font(.caption2).foregroundStyle(.secondary)
                if let r = link.reviewer { AppBadge(endpoint: r) } else { Pill(text: link.joinCode.map { "code \($0)" } ?? "pending", color: Palette.warning) }
                Spacer()
                if let d = link.lastMessage?.decision { DecisionBadge(decision: d.decision) } else { StateBadge(state: link.status) }
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .contentShape(Rectangle())
        .background(selected ? Palette.brand.opacity(0.1) : .clear)
    }
}
