import SwiftUI

struct TrafficView: View {
    @Environment(AppModel.self) private var model
    @State private var messages: [Message] = []
    @State private var summary: Summary?
    @State private var search = ""
    @State private var state = ""
    @State private var kind = ""
    @State private var page = 0
    @State private var selection: Message.ID?
    @State private var sort = [KeyPathComparator(\Message.createdAt, order: .reverse)]
    @State private var error: Error?
    static let pageSize = 100

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                stat("Messages", Fmt.num(summary?.messages), "arrow.up.arrow.down")
                stat("Bytes", Fmt.bytes(summary?.bytes), "externaldrive")
                stat("Avg delivery", Fmt.duration(summary?.avgDeliveryMs), "timer")
                stat("Failed", Fmt.num(summary?.failed), "exclamationmark.triangle")
                Spacer()
                breakdown
            }
            .padding(14)
            Divider()
            HStack {
                TextField("Search content or id…", text: $search).textFieldStyle(.roundedBorder).frame(maxWidth: 280)
                Picker("Kind", selection: $kind) {
                    Text("All kinds").tag("")
                    ForEach(["request", "answer", "ask", "reply", "message", "notice"], id: \.self) { Text($0).tag($0) }
                }.frame(width: 150)
                Picker("State", selection: $state) {
                    Text("All states").tag("")
                    ForEach(["pending", "deferred", "sending", "delivered", "answered", "failed", "cancelled"], id: \.self) { Text($0).tag($0) }
                }.frame(width: 160)
                Spacer()
                Menu("Export", systemImage: "square.and.arrow.up") {
                    Button("CSV…") { Exporter.save(model: model, path: "/api/export?what=messages&format=csv&range=\(model.range.rawValue)", name: "blueaibridge-messages.csv") }
                    Button("JSON…") { Exporter.save(model: model, path: "/api/export?what=messages&format=json&range=\(model.range.rawValue)", name: "blueaibridge-messages.json") }
                }.fixedSize()
            }
            .padding(10)
            if let error { ErrorBanner(error: error) { Task { await load() } }.padding(.horizontal, 10) }
            HSplitView {
                Table(messages, selection: $selection, sortOrder: $sort) {
                    TableColumn("Time", value: \.createdAt) { m in Text(Fmt.ago(m.createdAt)).foregroundStyle(.secondary).help(Fmt.dateTime(m.createdAt)) }.width(min: 80, ideal: 90)
                    TableColumn("Message", value: \.id) { m in Text("\(m.id)\(m.linkId.map { " · \($0)" } ?? "")").font(.caption.monospaced()) }.width(min: 90, ideal: 110)
                    TableColumn("Direction") { m in
                        HStack(spacing: 4) { AppBadge(endpoint: m.from); Image(systemName: "arrow.right").font(.caption2); if let t = m.to { AppBadge(endpoint: t) } else { Pill(text: "pending", color: Palette.warning) } }
                    }.width(min: 170, ideal: 190)
                    TableColumn("Kind", value: \.kind) { m in if let d = m.decision { DecisionBadge(decision: d.decision) } else { Text(m.kind) } }.width(min: 70, ideal: 120)
                    TableColumn("Channel") { m in Text(m.channel ?? "—").foregroundStyle(.secondary) }.width(min: 60, ideal: 70)
                    TableColumn("State", value: \.state) { m in StateBadge(state: m.state) }.width(min: 80, ideal: 95)
                    TableColumn("Size", value: \.bytes) { m in Text(Fmt.bytes(m.bytes)).monospacedDigit() }.width(min: 55, ideal: 70)
                    TableColumn("Latency") { m in Text(Fmt.duration(m.latencyMs)).monospacedDigit().foregroundStyle(.secondary) }.width(min: 55, ideal: 70)
                    TableColumn("Preview") { m in Text(m.decision?.note ?? m.body).lineLimit(1).foregroundStyle(.secondary) }
                }
                .onChange(of: sort) { messages.sort(using: sort) }
                .frame(minWidth: 600)

                if let id = selection, let m = messages.first(where: { $0.id == id }) {
                    MessageInspector(message: m).frame(minWidth: 320, idealWidth: 400, maxWidth: 560)
                }
            }
            HStack {
                Text("Page \(page + 1)").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Previous") { page -= 1 }.disabled(page == 0)
                Button("Next") { page += 1 }.disabled(messages.count < Self.pageSize)
            }.padding(8)
        }
        .reload(on: "\(model.range)|\(search)|\(state)|\(kind)|\(page)", model) {
            try? await Task.sleep(nanoseconds: 200_000_000)
            await load()
        }
    }

    func load() async {
        let since = Int((Date().timeIntervalSince1970 - model.range.seconds) * 1000)
        let q = search.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        do {
            async let m: MessagesResponse = model.broker.get("/api/messages?since=\(since)&limit=\(Self.pageSize)&offset=\(page * Self.pageSize)&state=\(state)&kind=\(kind)&q=\(q)")
            async let s: Summary = model.broker.get("/api/summary?range=\(model.range.rawValue)")
            messages = try await m.messages.sorted(using: sort)
            summary = try await s
            error = nil
        } catch { self.error = error }
    }

    func stat(_ label: String, _ value: String, _ icon: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Label(label, systemImage: icon).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.title3.weight(.bold)).monospacedDigit()
        }.frame(minWidth: 100, alignment: .leading)
    }

    var breakdown: some View {
        let dirs = summary?.byDirection ?? []
        let total = max(1, dirs.map(\.bytes).reduce(0, +))
        return VStack(alignment: .trailing, spacing: 4) {
            ForEach(dirs, id: \.self) { d in
                HStack(spacing: 6) {
                    Text("\(Fmt.appName(d.from == "bridge" ? nil : d.from)) → \(d.to == "?" ? "pending" : Fmt.appName(d.to))").font(.caption)
                    Capsule().fill(d.from == "claude" ? Palette.claudeToGpt : d.from == "codex" ? Palette.gptToClaude : Palette.bridge)
                        .frame(width: max(4, 120 * CGFloat(d.bytes) / CGFloat(total)), height: 6)
                    Text("\(Fmt.bytes(d.bytes)) · \(d.messages)").font(.caption.monospacedDigit()).foregroundStyle(.secondary).frame(width: 110, alignment: .trailing)
                }
            }
        }
    }
}

struct MessageInspector: View {
    let message: Message
    @Environment(AppModel.self) private var model
    var body: some View {
        let m = message
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack { Text(m.id).font(.title3.monospaced().weight(.semibold)); StateBadge(state: m.state); Spacer()
                    if let l = m.linkId { Button("Open conversation") { model.open(.conversations, link: l) } }
                }
                Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 6) {
                    GridRow { Text("From").foregroundStyle(.secondary); AppBadge(endpoint: m.from, showId: true) }
                    GridRow { Text("To").foregroundStyle(.secondary); if let t = m.to { AppBadge(endpoint: t, showId: true) } else { Text("—") } }
                    GridRow { Text("Kind").foregroundStyle(.secondary); Text("\(m.kind) · round \(m.round)") }
                    GridRow { Text("Channel").foregroundStyle(.secondary); Text(m.channel ?? "—") }
                    GridRow { Text("Size").foregroundStyle(.secondary); Text(Fmt.bytes(m.bytes)) }
                    GridRow { Text("Created").foregroundStyle(.secondary); Text(Fmt.dateTime(m.createdAt)) }
                    GridRow { Text("Delivered").foregroundStyle(.secondary); Text(m.deliveredAt.map { "\(Fmt.dateTime($0)) (\(Fmt.duration(m.latencyMs)))" } ?? "—") }
                    GridRow { Text("Attempts").foregroundStyle(.secondary); Text("\(m.attempts)") }
                    if let e = m.error { GridRow { Text("Error").foregroundStyle(.secondary); Text(e).foregroundStyle(Palette.critical) } }
                }.font(.callout).textSelection(.enabled)
                Divider()
                if let d = m.decision { DecisionView(decision: d) } else { MarkdownText(text: m.body) }
            }.padding(16)
        }
        .background(Color(nsColor: .controlBackgroundColor))
    }
}
