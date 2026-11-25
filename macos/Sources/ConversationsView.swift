import SwiftUI

struct ConversationsView: View {
    @Environment(AppModel.self) private var model
    @State private var links: [Link] = []
    @State private var status = "all"
    @State private var kind = ""
    @State private var search = ""
    @State private var error: Error?
    @State private var loaded = false

    var body: some View {
        @Bindable var model = model
        HSplitView {
            VStack(spacing: 0) {
                VStack(spacing: 8) {
                    TextField("Search topic or link id (L12)…", text: $search).textFieldStyle(.roundedBorder)
                    HStack {
                        Picker("", selection: $status) {
                            Text("All").tag("all"); Text("Active").tag("active"); Text("Closed").tag("closed")
                        }.pickerStyle(.segmented).labelsHidden()
                        Picker("", selection: $kind) {
                            Text("All kinds").tag(""); Text("Reviews").tag("review"); Text("Auto mode").tag("auto"); Text("Turn reviews").tag("turn"); Text("Questions").tag("ask")
                        }.labelsHidden().frame(width: 120)
                    }
                }.padding(10)
                Divider()
                if let error { ErrorBanner(error: error) { Task { await load() } }.padding(8) }
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(links) { l in
                            Button { model.selectedLink = l.id } label: { LinkRow(link: l, selected: model.selectedLink == l.id) }.buttonStyle(.plain)
                            Divider()
                        }
                    }
                }
                .overlay { if !loaded { ProgressView() } else if links.isEmpty && error == nil { EmptyStateView(icon: "bubble.left.and.bubble.right", title: "No conversations", message: search.isEmpty ? "They appear here as soon as one chat asks the other." : "Nothing matches.") } }
            }
            .frame(minWidth: 320, idealWidth: 370, maxWidth: 480)

            Group {
                if let id = model.selectedLink { LinkDetailView(id: id) } else { EmptyStateView(icon: "bubble.left.and.bubble.right", title: "Select a conversation") }
            }
            .frame(minWidth: 480, maxWidth: .infinity, maxHeight: .infinity)
        }
        .reload(on: "\(status)|\(kind)|\(search)", model) {
            try? await Task.sleep(nanoseconds: 200_000_000)
            await load()
        }
    }

    func load() async {
        let st = status == "active" ? "open,waiting_join,answered" : status == "closed" ? "closed" : ""
        let q = search.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        do {
            let r: LinksResponse = try await model.broker.get("/api/links?limit=300&status=\(st)&kind=\(kind)&q=\(q)")
            links = r.links
            error = nil
            loaded = true
            if model.selectedLink == nil { model.selectedLink = links.first?.id }
        } catch { self.error = error }
    }
}

struct LinkDetailView: View {
    let id: String
    @Environment(AppModel.self) private var model
    @State private var detail: LinkDetail?
    @State private var error: Error?
    @State private var tab = "thread"
    @State private var confirm: ConfirmAction?

    var body: some View {
        VStack(spacing: 0) {
            if let error { ErrorBanner(error: error) { Task { await load() } }.padding(10) }
            if let d = detail {
                header(d)
                Divider()
                Picker("", selection: $tab) {
                    Text("Conversation").tag("thread"); Text("Events (\(d.events.count))").tag("events"); Text("Details").tag("details")
                }.pickerStyle(.segmented).labelsHidden().padding(10).frame(maxWidth: 420)
                Divider()
                switch tab {
                case "events":
                    List(d.events) { EventRow(event: $0).listRowInsets(EdgeInsets()) }.listStyle(.plain)
                case "details":
                    ScrollView { details(d).padding(20).frame(maxWidth: .infinity, alignment: .leading) }
                default:
                    ScrollViewReader { proxy in
                        ScrollView {
                            LazyVStack(spacing: 14) {
                                ForEach(d.messages) { m in
                                    MessageBubble(message: m, requesterKey: d.link.requester.key) { await load() }.id(m.id)
                                }
                            }.padding(20)
                        }
                        .background(Color(nsColor: .windowBackgroundColor))
                        .onAppear { proxy.scrollTo(d.messages.last?.id, anchor: .bottom) }
                        .onChange(of: d.messages.count) { proxy.scrollTo(d.messages.last?.id, anchor: .bottom) }
                    }
                }
            } else if error == nil {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .reload(on: id, model) { await load() }
        .confirmationDialog(confirm?.title ?? "", isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }), presenting: confirm) { c in
            Button(c.button, role: c.destructive ? .destructive : nil) { Task { await c.run() } }
        } message: { c in Text(c.message) }
    }

    func load() async {
        do { detail = try await model.broker.get("/api/links/\(id)"); error = nil } catch { self.error = error }
    }

    func header(_ d: LinkDetail) -> some View {
        let l = d.link
        let last = d.messages.last { $0.decision != nil }
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text(l.id).font(.callout.monospaced()).foregroundStyle(.secondary)
                Pill(text: Fmt.kindLabel(l.kind) + (l.reviewKind.map { " · \($0)" } ?? ""), filled: false)
                StateBadge(state: l.status)
                DecisionBadge(decision: last?.decision?.decision)
                Pill(text: "round \(l.round)")
                Pill(text: l.delivery)
                Spacer()
                Button { Task { await load() } } label: { Image(systemName: "arrow.clockwise") }.buttonStyle(.borderless).help("Refresh")
                if l.status != "closed" {
                    Button("Close link", systemImage: "xmark.circle", role: .destructive) {
                        confirm = ConfirmAction(title: "Close \(l.id)?", message: "Messages not handed over yet are cancelled, and a late answer is refused. The chats themselves aren't changed.", button: "Close link", destructive: true) {
                            do {
                                let _: Empty = try await model.broker.post("/api/links/\(l.id)/close")
                                model.notify("\(l.id) closed")
                                await load()
                            } catch { model.notify("Couldn't close", error.localizedDescription, error: true) }
                        }
                    }
                }
            }
            Text(l.title.isEmpty ? "(untitled)" : l.title).font(.title3.weight(.semibold)).lineLimit(2).textSelection(.enabled)
            HStack(spacing: 6) {
                AppBadge(endpoint: l.requester, showId: true)
                if let t = d.requester?.title { Text("“\(t.prefix(40))”").font(.caption).foregroundStyle(.secondary) }
                Text("asked").font(.caption).foregroundStyle(.secondary)
                Image(systemName: "arrow.right").font(.caption).foregroundStyle(.secondary)
                if let r = l.reviewer { AppBadge(endpoint: r, showId: true) } else { Pill(text: l.joinCode.map { "waiting for code \($0)" } ?? "reviewer created on first delivery", color: Palette.warning) }
                Spacer()
                Text("\(d.messages.count) messages · \(Fmt.bytes(d.messages.reduce(0) { $0 + $1.bytes })) · started \(Fmt.dateTime(l.createdAt))").font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(16)
    }

    @ViewBuilder func details(_ d: LinkDetail) -> some View {
        let l = d.link
        Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 8) {
            row("Link", l.id)
            row("Kind", "\(Fmt.kindLabel(l.kind))\(l.reviewKind.map { " (\($0))" } ?? "")\(l.ownInitiative ? " · agent's own initiative" : "")")
            row("Requester", "\(l.requester.key)\(d.requester.map { " · \($0.surface)" } ?? "")")
            row("Reviewer", l.reviewer.map { "\($0.key)\(d.reviewer.map { " · \($0.surface)" } ?? "")" } ?? "—")
            row("Delivery", l.delivery)
            GridRow {
                Text("Paths").foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 3) {
                    if l.paths.isEmpty { Text("—") }
                    ForEach(l.paths, id: \.self) { p in
                        HStack { Image(systemName: "folder"); Text(p).font(.caption.monospaced()); if let f = l.fingerprints[p] { Text(String(f.prefix(10))).font(.caption.monospaced()).foregroundStyle(.secondary) } }
                    }
                }
            }
            row("Created", Fmt.dateTime(l.createdAt))
            row("Updated", Fmt.dateTime(l.updatedAt))
            if let c = l.closedAt { row("Closed", "\(Fmt.dateTime(c)) — \(l.closeReason ?? "")") }
        }
        .textSelection(.enabled)
        HStack {
            Button("Requester's full chat", systemImage: "books.vertical") { model.open(.chats, chat: l.requester.key) }
            if let r = l.reviewer { Button("Reviewer's full chat", systemImage: "books.vertical") { model.open(.chats, chat: r.key) } }
        }.padding(.top, 12)
    }

    func row(_ k: String, _ v: String) -> some View {
        GridRow { Text(k).foregroundStyle(.secondary); Text(v) }
    }
}

struct MessageBubble: View {
    let message: Message
    let requesterKey: String
    var reload: () async -> Void
    @Environment(AppModel.self) private var model
    @State private var expanded = false

    var body: some View {
        let m = message
        if m.from == nil {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "point.3.connected.trianglepath.dotted").foregroundStyle(Palette.brand)
                VStack(alignment: .leading, spacing: 3) {
                    Text("BlueAIBridge notice · \(Fmt.time(m.createdAt)) → \(Fmt.appName(m.to?.app))").font(.caption).foregroundStyle(.secondary)
                    Text(m.body).font(.callout).textSelection(.enabled)
                }
                Spacer()
                StateBadge(state: m.state)
            }
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 10).fill(Palette.brand.opacity(0.07)))
        } else {
            let right = m.from?.key != requesterKey
            HStack(alignment: .top, spacing: 10) {
                if right { Spacer(minLength: 60) } else { Avatar(app: m.from?.app) }
                bubble
                if right { Avatar(app: m.from?.app) } else { Spacer(minLength: 60) }
            }
        }
    }

    var bubble: some View {
        let m = message
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Text(Fmt.appName(m.from?.app)).font(.callout.weight(.semibold))
                Text(label).font(.caption).foregroundStyle(.secondary)
                Text(m.id).font(.caption.monospaced()).foregroundStyle(.secondary)
                if m.round > 1 { Text("round \(m.round)").font(.caption).foregroundStyle(.secondary) }
                Text("· \(Fmt.time(m.createdAt))").font(.caption).foregroundStyle(.secondary)
                Spacer(minLength: 12)
                StateBadge(state: m.state)
                if let c = m.channel { Pill(text: c, filled: false) }
                Text(Fmt.bytes(m.bytes)).font(.caption).foregroundStyle(.secondary)
                if let lat = m.latencyMs { Text(Fmt.duration(lat)).font(.caption).foregroundStyle(.secondary).help("Delivery latency") }
                Button { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(copyText, forType: .string) } label: { Image(systemName: "doc.on.doc") }
                    .buttonStyle(.borderless).help("Copy")
            }
            if let d = m.decision {
                DecisionView(decision: d)
            } else {
                let long = m.kind == "request" && m.body.count > 1200 && !expanded
                MarkdownText(text: long ? String(m.body.prefix(1200)) + "…" : m.body)
                if long { Button("Show full request (\(Fmt.bytes(m.bytes)))") { expanded = true }.buttonStyle(.link) }
            }
            if let problem = m.state == "failed" ? m.error : (m.deferReason ?? m.error) {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(m.state == "failed" ? Palette.critical : Palette.warning)
                    Text(problem).font(.caption)
                    Spacer()
                    if m.state == "failed" || m.state == "deferred" {
                        Button("Retry now", systemImage: "arrow.clockwise") {
                            Task {
                                do {
                                    let _: Empty = try await model.broker.post("/api/messages/\(m.id)/retry")
                                    model.notify("Retrying \(m.id)")
                                    await reload()
                                } catch { model.notify("Retry failed", error.localizedDescription, error: true) }
                            }
                        }.controlSize(.small)
                    }
                }
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 8).fill((m.state == "failed" ? Palette.critical : Palette.warning).opacity(0.1)))
            }
        }
        .padding(12)
        .frame(maxWidth: 900, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color(nsColor: .controlBackgroundColor)))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Color(nsColor: .separatorColor).opacity(0.6)))
    }

    var label: String {
        switch message.kind {
        case "request": "asked for a review"
        case "answer": "answered"
        case "ask": "asked"
        case "reply": "replied"
        case "message": "wrote"
        default: message.kind
        }
    }

    var copyText: String {
        guard let d = message.decision else { return message.body }
        var s = [d.approved ? "[APPROVED]" : "[CHANGES REQUESTED]", "", d.note]
        if !d.blocking.isEmpty { s += ["", "Must fix:"] + d.blocking.map { "- \($0)" } }
        if !d.nits.isEmpty { s += ["", "Nits:"] + d.nits.map { "- \($0)" } }
        return s.joined(separator: "\n")
    }
}

struct DecisionView: View {
    let decision: Decision
    var body: some View {
        let c = decision.approved ? Palette.good : Palette.warning
        VStack(alignment: .leading, spacing: 8) {
            Label(decision.approved ? "Approved" : "Changes requested", systemImage: decision.approved ? "checkmark.seal.fill" : "exclamationmark.triangle.fill")
                .font(.callout.weight(.semibold)).foregroundStyle(c)
            MarkdownText(text: decision.note)
            if !decision.blocking.isEmpty { list("MUST FIX", decision.blocking) }
            if !decision.nits.isEmpty { list("NITS", decision.nits) }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10).fill(c.opacity(0.09)))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(c.opacity(0.3)))
    }

    func list(_ title: String, _ items: [String]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption2.weight(.bold)).foregroundStyle(.secondary)
            ForEach(items, id: \.self) { i in
                HStack(alignment: .firstTextBaseline, spacing: 6) { Text("•"); MarkdownText(text: i) }
            }
        }
    }
}
