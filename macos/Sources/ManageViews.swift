import SwiftUI

// MARK: - Chat library

struct ChatsView: View {
    @Environment(AppModel.self) private var model
    @State private var chats: [ChatSummary] = []
    @State private var total = 0
    @State private var app = ""
    @State private var search = ""
    @State private var error: Error?

    var body: some View {
        @Bindable var model = model
        HSplitView {
            VStack(spacing: 0) {
                VStack(spacing: 8) {
                    TextField("Find a chat by name or id…", text: $search).textFieldStyle(.roundedBorder)
                    HStack {
                        Picker("", selection: $app) { Text("Both apps").tag(""); Text("Claude").tag("claude"); Text("ChatGPT").tag("codex") }.pickerStyle(.segmented).labelsHidden()
                        Text("\(total)").font(.caption).foregroundStyle(.secondary)
                    }
                }.padding(10)
                Divider()
                if let error { ErrorBanner(error: error).padding(8) }
                List(chats, selection: $model.selectedChat) { c in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack {
                            Pill(text: c.app == "claude" ? "Claude" : "ChatGPT", color: Palette.app(c.app))
                            Spacer()
                            Text("\(Fmt.ago(c.updatedAt)) · \(Fmt.bytes(c.size))").font(.caption).foregroundStyle(.secondary)
                        }
                        Text(c.title).font(.callout.weight(.semibold)).lineLimit(2)
                        if let cwd = c.cwd { Text(cwd).font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle) }
                    }.padding(.vertical, 4).tag(c.key)
                }
            }
            .frame(minWidth: 300, idealWidth: 360, maxWidth: 460)
            Group {
                if let key = model.selectedChat, let i = key.firstIndex(of: ":") {
                    ChatReader(app: String(key[..<i]), id: String(key[key.index(after: i)...]))
                } else {
                    EmptyStateView(icon: "books.vertical", title: "Read any local chat", message: "Every Claude Code session and ChatGPT/Codex thread on this Mac, read-only.")
                }
            }.frame(minWidth: 480, maxWidth: .infinity, maxHeight: .infinity)
        }
        .task(id: "\(app)|\(search)") {
            try? await Task.sleep(nanoseconds: 250_000_000)
            let q = search.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
            do {
                let r: ChatsResponse = try await model.broker.get("/api/chats?limit=200&app=\(app)&q=\(q)", timeout: 60)
                chats = r.chats
                total = r.total
                error = nil
            } catch { self.error = error }
        }
    }
}

struct ChatReader: View {
    let app: String
    let id: String
    @Environment(AppModel.self) private var model
    @State private var pages: [ChatPage] = []
    @State private var tools = false
    @State private var loading = false
    @State private var error: Error?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Pill(text: app == "claude" ? "Claude Code session" : "ChatGPT thread", color: Palette.app(app))
                    Text(id).font(.caption.monospaced()).foregroundStyle(.secondary).textSelection(.enabled)
                    Spacer()
                    Toggle("Show tool steps", isOn: $tools).toggleStyle(.checkbox)
                }
                Text(pages.last?.title ?? " ").font(.title3.weight(.semibold))
                if let p = pages.last, let cwd = p.cwd { Label("\(cwd) · \(p.total) messages", systemImage: "folder").font(.caption).foregroundStyle(.secondary) }
                ForEach(pages.last?.notes ?? [], id: \.self) { Text($0).font(.caption).foregroundStyle(.secondary) }
            }.padding(16)
            Divider()
            if let error { ErrorBanner(error: error) { Task { await load(nil) } }.padding(10) }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    if let c = pages.first?.nextCursor {
                        Button { Task { await load(c) } } label: { Label("Load older messages (\(pages.first?.start ?? 0) more)", systemImage: "arrow.up") }
                            .frame(maxWidth: .infinity).disabled(loading)
                    }
                    ForEach(Array(pages.flatMap(\.messages).enumerated()), id: \.offset) { _, m in
                        if m.role == "tool" {
                            Label(m.text, systemImage: "terminal").font(.caption.monospaced()).foregroundStyle(.secondary).padding(.leading, 46)
                        } else {
                            HStack(alignment: .top, spacing: 10) {
                                if m.role == "user" { Spacer(minLength: 60) } else { Avatar(app: app) }
                                VStack(alignment: .leading, spacing: 6) {
                                    HStack {
                                        Text(m.role == "user" ? (m.text.hasPrefix("CLAUDE:") || m.text.hasPrefix("CHATGPT:") ? "Bridge message" : "User") : Fmt.appName(app)).font(.callout.weight(.semibold))
                                        if let ts = m.ts { Text(Fmt.dateTime(ts)).font(.caption).foregroundStyle(.secondary) }
                                        if m.cut == true { Pill(text: "cut at 25k chars", color: Palette.warning) }
                                    }
                                    MarkdownText(text: m.text)
                                }
                                .padding(12)
                                .frame(maxWidth: 860, alignment: .leading)
                                .background(RoundedRectangle(cornerRadius: 14).fill(m.role == "user" ? Palette.brand.opacity(0.08) : Color(nsColor: .controlBackgroundColor)))
                                if m.role == "user" { Avatar(app: nil) } else { Spacer(minLength: 60) }
                            }
                        }
                    }
                    if loading && pages.isEmpty { ProgressView().frame(maxWidth: .infinity) }
                }.padding(20)
            }.background(Color(nsColor: .windowBackgroundColor))
        }
        .task(id: "\(app):\(id):\(tools)") { pages = []; await load(nil) }
    }

    func load(_ cursor: String?) async {
        loading = true
        defer { loading = false }
        let enc = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        do {
            let p: ChatPage = try await model.broker.get("/api/chats/\(app)/\(enc)?\(cursor.map { "cursor=\($0)&" } ?? "")\(tools ? "tools=1" : "")", timeout: 60)
            if cursor != nil { pages.insert(p, at: 0) } else { pages = [p] }
            error = nil
        } catch { self.error = error }
    }
}

// MARK: - Clients & install

struct ClientsView: View {
    @Environment(AppModel.self) private var model
    @State private var status: InstallStatus?
    @State private var clients: [ClientInfo] = []
    @State private var error: Error?
    @State private var busy: String?
    @State private var result: InstallResult?
    @State private var confirm: ConfirmAction?

    static let desc: [String: String] = [
        "claude": "MCP server (user scope), 7 hooks and the tool permission, for Claude Desktop's Code tab and the Claude Code CLI.",
        "codex": "MCP server in ~/.codex/config.toml and 3 hooks in ~/.codex/hooks.json, for ChatGPT Desktop and the Codex CLI.",
        "service": "Keeps the broker running in the background and restarts it if it stops.",
        "menubar": "This app, in ~/Applications: the window you're looking at plus the menu-bar icon. Starts at login.",
    ]
    static let icon: [String: String] = ["claude": "asterisk", "codex": "circle.hexagongrid", "service": "bolt.fill", "menubar": "macwindow"]

    var body: some View {
        PageScroll {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Install BlueAIBridge into each app, see what is detected on this Mac, and every chat that has used the bridge.").foregroundStyle(.secondary)
                }
                Spacer()
                if let busy { ProgressView().controlSize(.small); Text(busy).font(.caption) }
                Button("Uninstall all", systemImage: "trash", role: .destructive) { ask("uninstall", "all", "Uninstall everything") }
                Button("Install all", systemImage: "square.and.arrow.down") { ask("install", "all", "Install everything") }.buttonStyle(.borderedProminent)
            }
            if let error { ErrorBanner(error: error) { Task { await load() } } }
            if let s = status {
                let ok = s.runtime.installed && s.runtime.upToDate
                HStack {
                    Image(systemName: ok ? "checkmark.seal.fill" : "exclamationmark.triangle.fill").foregroundStyle(ok ? Palette.good : Palette.warning)
                    Text("Runtime \(s.runtime.installed ? "v\(s.runtime.version ?? "?")" : "not installed")").fontWeight(.semibold)
                    Text(s.runtime.path).font(.caption.monospaced()).foregroundStyle(.secondary)
                    if s.runtime.installed && !s.runtime.upToDate { Text("· this build is v\(s.version)").font(.caption) }
                    Spacer()
                    Button(s.runtime.installed ? "Reinstall" : "Install") { ask("install", "runtime", "Update the runtime") }
                }
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 10).fill((ok ? Palette.good : Palette.warning).opacity(0.08)))
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 16), GridItem(.flexible(), spacing: 16)], spacing: 16) {
                    ForEach(s.targets) { t in targetCard(t) }
                }
            }
            if let r = result {
                Card("Last \(r.action)", subtitle: r.backupDir.map { "Backups: \($0)" }) {
                    Button("Dismiss") { result = nil }.buttonStyle(.link)
                } content: {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(r.steps, id: \.self) { st in
                            Label { Text("**\(st.target)** — \(st.message)").textSelection(.enabled) } icon: {
                                Image(systemName: st.ok ? "checkmark.circle.fill" : "xmark.octagon.fill").foregroundStyle(st.ok ? Palette.good : Palette.critical)
                            }.font(.callout)
                        }
                    }
                }
            }
            Card("Chats seen by the bridge", subtitle: "Every Claude session and ChatGPT thread that used BlueAIBridge", padded: false) {
                if clients.isEmpty { EmptyStateView(icon: "person.2", title: "No chats yet", message: "Chats show up the first time they use a BlueAIBridge tool.").padding() }
                else {
                    Table(clients) {
                        TableColumn("Chat") { c in HStack { AppBadge(endpoint: c.endpoint, showId: true); if let t = c.title { Text(t).lineLimit(1) } } }.width(min: 200, ideal: 300)
                        TableColumn("Where") { c in Pill(text: c.surface, filled: false) }.width(70)
                        TableColumn("Folder") { c in Text(c.cwd ?? "—").font(.caption.monospaced()).lineLimit(1).truncationMode(.middle) }
                        TableColumn("Listening") { c in
                            if let l = c.listening { Pill(text: l ? "listening" : "not open", icon: l ? "dot.radiowaves.left.and.right" : nil, color: l ? Palette.good : .secondary) } else { Text("n/a").foregroundStyle(.secondary) }
                        }.width(90)
                        TableColumn("Last seen") { c in Text(Fmt.ago(c.lastSeen)).foregroundStyle(.secondary) }.width(100)
                        TableColumn("") { c in Button("Read chat") { model.open(.chats, chat: c.endpoint.key) }.buttonStyle(.link) }.width(70)
                    }
                    .frame(minHeight: 260)
                }
            }
        }
        .reload(on: "clients", model) { await load() }
        .confirmationDialog(confirm?.title ?? "", isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }), presenting: confirm) { c in
            Button(c.button, role: c.destructive ? .destructive : nil) { Task { await c.run() } }
        } message: { c in Text(c.message) }
    }

    func load() async {
        do {
            async let s: InstallStatus = model.broker.get("/api/install")
            async let c: ClientsResponse = model.broker.get("/api/clients")
            status = try await s
            clients = try await c.clients
            error = nil
        } catch { self.error = error }
    }

    func ask(_ action: String, _ target: String, _ label: String) {
        let msg = action == "uninstall"
            ? "This removes BlueAIBridge from \(target == "all" ? "every app, the background service and this app" : target). Every changed file is backed up first to ~/.blueaibridge/backups; your history stays.\(target == "all" || target == "service" ? " This window loses its connection once the background service stops." : "")"
            : "This changes your app configuration for \(target == "all" ? "Claude Code, ChatGPT/Codex, the background service and this app" : target). Every file is backed up first. Restart Claude Desktop and ChatGPT Desktop afterwards; ChatGPT asks you to trust the new hooks once."
        confirm = ConfirmAction(title: "\(label)?", message: msg, button: label, destructive: action == "uninstall") {
            busy = "\(action == "install" ? "Installing" : "Uninstalling") \(target)…"
            defer { busy = nil }
            do {
                let r: InstallResult = try await model.broker.post("/api/install", ["target": target, "action": action])
                result = r
                model.notify(r.ok ? "\(label) done" : "\(label) finished with problems", r.ok && action == "install" ? "Restart Claude Desktop and ChatGPT Desktop to load it." : nil, error: !r.ok)
                await load()
            } catch { model.notify("\(label) failed", error.localizedDescription, error: true) }
        }
    }

    func targetCard(_ t: InstallTarget) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                RoundedRectangle(cornerRadius: 10)
                    .fill(t.id == "claude" ? Palette.claude : t.id == "codex" ? Palette.gpt : t.id == "service" ? Palette.brand : Color.gray)
                    .frame(width: 40, height: 40)
                    .overlay(Image(systemName: Self.icon[t.id] ?? "app").foregroundStyle(.white).font(.system(size: 17, weight: .bold)))
                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        Text(t.name).font(.headline)
                        if t.installed { Pill(text: "Installed", icon: "checkmark", color: Palette.good) }
                        else if t.partial { Pill(text: "Partly installed", icon: "exclamationmark", color: Palette.warning) }
                        else { Pill(text: "Not installed") }
                    }
                    Text(Self.desc[t.id] ?? "").font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            ForEach(t.clients) { c in
                HStack {
                    Circle().fill(c.detected ? Palette.good : Color.secondary.opacity(0.4)).frame(width: 7, height: 7)
                    Text(c.name).font(.callout)
                    Spacer()
                    Text(c.detected ? "detected" : "not found on this Mac").font(.caption).foregroundStyle(.secondary)
                }
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 7).fill(Color.primary.opacity(0.04)))
                .help(c.path ?? "")
            }
            let details = t.details.filter { !["plist", "app"].contains($0.key) }.sorted { $0.key < $1.key }
            if !details.isEmpty {
                HStack { ForEach(details, id: \.key) { k, v in Pill(text: "\(k): \(v)", color: v.bool == false ? Palette.warning : .secondary, filled: false) } }
            }
            HStack {
                Spacer()
                if t.installed || t.partial { Button("Uninstall", systemImage: "trash", role: .destructive) { ask("uninstall", t.id, "Uninstall \(t.name)") } }
                Button(t.installed ? "Reinstall" : "Install", systemImage: "square.and.arrow.down") { ask("install", t.id, "\(t.installed ? "Reinstall" : "Install") \(t.name)") }
                    .buttonStyle(.borderedProminent)
            }.disabled(busy != nil)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color(nsColor: .controlBackgroundColor)))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color(nsColor: .separatorColor).opacity(0.6)))
    }
}

// MARK: - Health

struct HealthView: View {
    @Environment(AppModel.self) private var model
    @State private var result: DoctorResult?
    @State private var loading = false
    @State private var error: Error?

    var body: some View {
        PageScroll {
            HStack {
                Text("Every piece BlueAIBridge relies on, checked live, with a fix for each problem. Nothing is changed by a check.").foregroundStyle(.secondary)
                Spacer()
                Button { Task { await run() } } label: { Label("Run checks again", systemImage: "arrow.clockwise") }.disabled(loading)
            }
            if let error { ErrorBanner(error: error) { Task { await run() } } }
            HStack(spacing: 12) {
                KPI(label: "Overall", value: result.map { $0.ok ? "Healthy" : "Needs attention" } ?? (loading ? "Checking…" : "—"), icon: "stethoscope", valueColor: result.map { $0.ok ? Palette.good : Palette.critical } ?? .primary)
                KPI(label: "Passing", value: "\(result?.summary["ok"] ?? 0)", icon: "checkmark.circle")
                KPI(label: "Warnings", value: "\(result?.summary["warn"] ?? 0)", icon: "exclamationmark.triangle")
                KPI(label: "Problems", value: "\(result?.summary["fail"] ?? 0)", icon: "xmark.octagon")
            }
            ForEach(groups, id: \.0) { group, checks in
                Card(group, padded: false) {
                    let ok = checks.filter { $0.status == "ok" }.count
                    Pill(text: "\(ok)/\(checks.count) ok", color: checks.contains { $0.status == "fail" } ? Palette.critical : checks.contains { $0.status == "warn" } ? Palette.warning : Palette.good)
                } content: {
                    VStack(spacing: 0) {
                        ForEach(checks, id: \.self) { c in
                            HStack(alignment: .top, spacing: 10) {
                                Image(systemName: c.status == "ok" ? "checkmark.circle.fill" : c.status == "warn" ? "exclamationmark.triangle.fill" : "xmark.octagon.fill")
                                    .foregroundStyle(c.status == "ok" ? Palette.good : c.status == "warn" ? Palette.warning : Palette.critical)
                                Text(c.name).fontWeight(.semibold).frame(width: 190, alignment: .leading)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(c.detail).textSelection(.enabled)
                                    if let f = c.fix { Text("→ \(f)").font(.caption).foregroundStyle(.secondary) }
                                }
                                Spacer()
                            }
                            .font(.callout)
                            .padding(.horizontal, 16).padding(.vertical, 9)
                            Divider()
                        }
                    }
                }
            }
        }
        .task { await run() }
    }

    var groups: [(String, [Check])] {
        var order: [String] = []
        var map: [String: [Check]] = [:]
        for c in result?.checks ?? [] {
            if map[c.group] == nil { order.append(c.group) }
            map[c.group, default: []].append(c)
        }
        return order.map { ($0, map[$0]!) }
    }

    func run() async {
        loading = true
        defer { loading = false }
        do { result = try await model.broker.get("/api/doctor", timeout: 90); error = nil } catch { self.error = error }
    }
}

// MARK: - Settings

struct SettingsPage: View {
    @Environment(AppModel.self) private var model
    @State private var saved: BridgeConfig?
    @State private var draft: BridgeConfig?
    @State private var file = ""
    @State private var rules = ""
    @State private var savedRules = ""
    @State private var rulesFile = ""
    @State private var error: Error?
    @State private var confirmPrune = false

    var body: some View {
        PageScroll {
            HStack {
                Text("Stored in \(file)").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Discard") { draft = saved }.disabled(draft == saved)
                Button("Save changes", systemImage: "checkmark") { Task { await save() } }.buttonStyle(.borderedProminent).disabled(draft == saved)
            }
            if let error { ErrorBanner(error: error) { Task { await load() } } }
            if draft != nil {
                Card("Behaviour") { form }
            }
            Card("Your rules", subtitle: "Standing instructions every linked chat receives from your own file (never from the other agent). Up to 8,000 characters.") {
                Button("Save rules") { Task { await saveRules() } }.disabled(rules == savedRules)
            } content: {
                VStack(alignment: .leading, spacing: 6) {
                    TextEditor(text: $rules).font(.system(.callout, design: .monospaced)).frame(minHeight: 150)
                        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color(nsColor: .separatorColor)))
                    HStack { Text(rulesFile).font(.caption.monospaced()).foregroundStyle(.secondary); Spacer(); Text("\(rules.count) / 8000").font(.caption.monospacedDigit()).foregroundStyle(rules.count > 8000 ? Palette.critical : .secondary) }
                }
            }
            Card("Maintenance") {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Delete old history now").fontWeight(.semibold)
                        Text("Removes closed conversations and events older than \(draft?.retentionDays ?? 30) days. This also runs automatically every 6 hours.").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Prune now", role: .destructive) { confirmPrune = true }
                }
                Divider().padding(.vertical, 8)
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Web dashboard").fontWeight(.semibold)
                        Text("The same dashboard in your browser (used on Windows and Linux).").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Open in browser", systemImage: "safari") { model.broker.openWebDashboard() }
                }
            }
        }
        .task { await load() }
        .confirmationDialog("Delete old history?", isPresented: $confirmPrune) {
            Button("Delete", role: .destructive) {
                Task {
                    do {
                        let r: PruneResult = try await model.broker.post("/api/maintenance/prune")
                        model.notify("History pruned", "\(r.links) conversations and \(r.events) events removed.")
                    } catch { model.notify("Prune failed", error.localizedDescription, error: true) }
                }
            }
        } message: { Text("Closed conversations and events older than \(draft?.retentionDays ?? 30) days are deleted permanently.") }
    }

    @ViewBuilder var form: some View {
        let b = Binding(get: { draft! }, set: { draft = $0 })
        VStack(alignment: .leading, spacing: 4) {
            field("Default delivery", "Visible puts messages into the other app's chat window; headless runs its CLI in the background and returns the answer. Auto uses visible when the app is installed.") {
                Picker("", selection: b.delivery) { Text("Auto").tag("auto"); Text("Visible").tag("visible"); Text("Headless").tag("headless") }.pickerStyle(.segmented).labelsHidden().frame(width: 260)
            }
            field("Auto mode reviews", "Key moments: the agent asks at the moments that matter, checked at the end of each turn. Every turn: each turn goes to the reviewer automatically.") {
                Picker("", selection: b.autoReviews) { Text("Key moments").tag("key-moments"); Text("Every turn").tag("every-turn") }.pickerStyle(.segmented).labelsHidden().frame(width: 260)
            }
            field("When the other app is closed", "Ask: the agent asks you before opening ChatGPT or a Claude session. Always: open it without asking.") {
                Picker("", selection: b.openClosedApps) { Text("Ask me").tag("ask"); Text("Always open").tag("always") }.pickerStyle(.segmented).labelsHidden().frame(width: 260)
            }
            field("Reading reviewer chats", "Whether a chat may read another chat that is currently reviewing for someone.") {
                Picker("", selection: b.readChatsInReviewers) { Text("Refuse").tag("deny"); Text("Allow").tag("allow") }.pickerStyle(.segmented).labelsHidden().frame(width: 260)
            }
            field("Emergency stop", "Rounds without approval before the fix loop stops and the agent must ask you.") {
                Stepper(value: b.maxRounds, in: 1...100) { Text("\(b.wrappedValue.maxRounds) rounds").monospacedDigit() }
            }
            field("ChatGPT reviewer model", "Model for new ChatGPT reviewer chats (id or picker name). Empty: the app's default.") {
                TextField("default", text: b.chatgptModel).frame(width: 260)
            }
            field("ChatGPT reasoning effort", "low, medium, high… Empty: the model's default.") { TextField("default", text: b.chatgptEffort).frame(width: 260) }
            field("Claude headless model", "Model for headless Claude runs (e.g. opus, sonnet). Empty: Claude's default.") { TextField("default", text: b.claudeModel).frame(width: 260) }
            field("Headless time limit", "How long a background run may take before it is given up.") {
                Stepper(value: b.headlessTimeoutSec, in: 60...7200, step: 60) { Text("\(b.wrappedValue.headlessTimeoutSec / 60) minutes").monospacedDigit() }
            }
            field("Paste diffs into requests", "Off: reviewers read the changes themselves with the commands given (smaller messages).") { Toggle("", isOn: b.includeDiff).labelsHidden().toggleStyle(.switch) }
            field("History retention", "Closed conversations and events older than this are deleted.") {
                Stepper(value: b.retentionDays, in: 1...365) { Text("\(b.wrappedValue.retentionDays) days").monospacedDigit() }
            }
            Divider()
            field("Broker port", "Port on 127.0.0.1. Takes effect after the broker restarts.") {
                TextField("", value: b.port, format: .number.grouping(.never)).frame(width: 100)
            }
        }
    }

    func field<C: View>(_ label: String, _ help: String, @ViewBuilder _ control: () -> C) -> some View {
        HStack(alignment: .top, spacing: 24) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).fontWeight(.semibold)
                Text(help).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }.frame(width: 300, alignment: .leading)
            control()
            Spacer()
        }.padding(.vertical, 6)
    }

    func load() async {
        do {
            let c: ConfigResponse = try await model.broker.get("/api/config")
            let r: RulesResponse = try await model.broker.get("/api/rules")
            saved = c.config; draft = c.config; file = c.file ?? ""
            rules = r.rules; savedRules = r.rules; rulesFile = r.file ?? ""
            error = nil
        } catch { self.error = error }
    }

    func save() async {
        guard let d = draft else { return }
        do {
            let r: ConfigResponse = try await model.broker.put("/api/config", json: try JSONEncoder().encode(d))
            saved = r.config; draft = r.config
            model.notify("Settings saved", "They apply to the next message.")
        } catch { model.notify("Not saved", error.localizedDescription, error: true) }
    }

    func saveRules() async {
        do {
            let r: RulesResponse = try await model.broker.put("/api/rules", json: try JSONSerialization.data(withJSONObject: ["rules": rules]))
            rules = r.rules; savedRules = r.rules
            model.notify("Rules saved", "Every linked chat gets them with its next prompt.")
        } catch { model.notify("Not saved", error.localizedDescription, error: true) }
    }
}
