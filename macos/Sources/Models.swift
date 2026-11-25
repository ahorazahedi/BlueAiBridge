// Wire models for the broker's HTTP API (same shapes the web dashboard uses).

import Foundation

/// Any JSON value (event payloads are free-form).
enum JSONValue: Decodable, Hashable, CustomStringConvertible {
    case string(String), number(Double), bool(Bool), object([String: JSONValue]), array([JSONValue]), null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    var description: String {
        switch self {
        case .string(let s): return s
        case .number(let n): return n.rounded() == n ? String(Int(n)) : String(n)
        case .bool(let b): return b ? "true" : "false"
        case .null: return "—"
        case .array(let a): return a.map(\.description).joined(separator: ", ")
        case .object(let o): return o.map { "\($0.key): \($0.value)" }.sorted().joined(separator: ", ")
        }
    }
    var string: String? { if case .string(let s) = self { return s }; return nil }
    var number: Double? { if case .number(let n) = self { return n }; return nil }
    var bool: Bool? { if case .bool(let b) = self { return b }; return nil }
}

struct Endpoint: Codable, Hashable {
    let app: String
    let id: String
    var key: String { "\(app):\(id)" }
    var appName: String { app == "claude" ? "Claude" : "ChatGPT" }
}

struct Health: Decodable { let ok: Bool; let version: String?; let pid: Int?; let port: Int?; let startedAt: Double? }

struct DirectionRow: Decodable, Hashable { let from: String; let to: String; let messages: Int; let bytes: Int }
struct ChannelRow: Decodable, Hashable { let channel: String; let messages: Int; let bytes: Int }

struct Summary: Decodable {
    let range: String
    let messages: Int
    let bytes: Int
    let failed: Int
    let avgDeliveryMs: Double?
    let avgReviewMs: Double?
    let openLinks: Int
    let pending: Int
    let autosOn: Int
    let clients: Int
    let decisions: [String: Int]
    let byChannel: [ChannelRow]
    let byDirection: [DirectionRow]
    let version: String
    let startedAt: Double
}

struct SeriesPoint: Decodable, Identifiable, Hashable {
    let t: Double
    let claudeToChatgpt: Int
    let chatgptToClaude: Int
    let bridge: Int
    let bytes: Int
    let failed: Int
    var id: Double { t }
    var date: Date { Date(timeIntervalSince1970: t / 1000) }
    var total: Int { claudeToChatgpt + chatgptToClaude + bridge }
}
struct Series: Decodable { let bucketMs: Double; let points: [SeriesPoint] }

struct Decision: Decodable, Hashable {
    let decision: String
    let note: String
    let blocking: [String]
    let nits: [String]
    var approved: Bool { decision == "approved" }
}

struct Message: Decodable, Identifiable, Hashable {
    let id: String
    let linkId: String?
    let kind: String
    let from: Endpoint?
    let to: Endpoint?
    let body: String
    let decision: Decision?
    let round: Int
    let state: String
    let channel: String?
    let attempts: Int
    let error: String?
    let deferReason: String?
    let bytes: Int
    let createdAt: Double
    let deliveredAt: Double?
    let answeredAt: Double?
    var latencyMs: Double? { deliveredAt.map { $0 - createdAt } }
}

struct Link: Decodable, Identifiable, Hashable {
    let id: String
    let kind: String
    let reviewKind: String?
    let status: String
    let requester: Endpoint
    let reviewer: Endpoint?
    let joinCode: String?
    let delivery: String
    let round: Int
    let paths: [String]
    let title: String
    let ownInitiative: Bool
    let fingerprints: [String: String]
    let createdAt: Double
    let updatedAt: Double
    let closedAt: Double?
    let closeReason: String?
    // list-only extras
    let messageCount: Int?
    let lastMessage: Message?
}
struct LinksResponse: Decodable { let links: [Link] }

struct ClientInfo: Decodable, Identifiable, Hashable {
    let app: String
    let id: String
    let surface: String
    let cwd: String?
    let title: String?
    let hostId: String?
    let firstSeen: Double
    let lastSeen: Double
    let listening: Bool?
    var endpoint: Endpoint { Endpoint(app: app, id: id) }
}
struct ClientsResponse: Decodable { let clients: [ClientInfo] }

struct BridgeEvent: Decodable, Identifiable, Hashable {
    let id: Int
    let ts: Double
    let type: String
    let linkId: String?
    let messageId: String?
    let actor: String?
    let bytes: Int
    let data: [String: JSONValue]
}
struct EventsResponse: Decodable { let events: [BridgeEvent] }

struct LinkDetail: Decodable {
    let link: Link
    let messages: [Message]
    let events: [BridgeEvent]
    let requester: ClientInfo?
    let reviewer: ClientInfo?
}

struct MessagesResponse: Decodable { let messages: [Message] }

struct InstallClient: Decodable, Identifiable, Hashable { let id: String; let name: String; let detected: Bool; let path: String? }
struct InstallTarget: Decodable, Identifiable {
    let id: String
    let name: String
    let installed: Bool
    let partial: Bool
    let details: [String: JSONValue]
    let clients: [InstallClient]
}
struct RuntimeInfo: Decodable { let installed: Bool; let version: String?; let path: String; let upToDate: Bool }
struct InstallStatus: Decodable { let version: String; let runtime: RuntimeInfo; let targets: [InstallTarget] }
struct InstallStep: Decodable, Hashable { let target: String; let ok: Bool; let message: String }
struct InstallResult: Decodable { let ok: Bool; let action: String; let steps: [InstallStep]; let backupDir: String? }

struct Check: Decodable, Hashable { let group: String; let name: String; let status: String; let detail: String; let fix: String? }
struct DoctorResult: Decodable { let checks: [Check]; let ok: Bool; let summary: [String: Int] }

struct ChatSummary: Decodable, Identifiable, Hashable {
    let app: String
    let id: String
    let title: String
    let cwd: String?
    let updatedAt: Double
    let size: Int
    var key: String { "\(app):\(id)" }
}
struct ChatsResponse: Decodable { let chats: [ChatSummary]; let complete: Bool; let total: Int }
struct ChatMessage: Decodable, Hashable { let role: String; let text: String; let ts: Double?; let cut: Bool? }
struct ChatPage: Decodable {
    let app: String
    let id: String
    let title: String
    let cwd: String?
    let total: Int
    let start: Int
    let end: Int
    let messages: [ChatMessage]
    let nextCursor: String?
    let notes: [String]
}

struct Limits: Decodable {
    struct Window: Decodable { let usedPercent: Double; let resetsAt: Double? }
    let blocked: Bool
    let resetsAt: Double?
    let primary: Window?
    let secondary: Window?
    let credits: Bool
}
struct LimitsResponse: Decodable { let limits: Limits? }

struct BridgeConfig: Codable, Equatable {
    var port: Int
    var delivery: String
    var autoReviews: String
    var openClosedApps: String
    var readChatsInReviewers: String
    var maxRounds: Int
    var chatgptModel: String
    var chatgptEffort: String
    var claudeModel: String
    var headlessTimeoutSec: Int
    var retentionDays: Int
    var includeDiff: Bool
}
struct ConfigResponse: Decodable { let config: BridgeConfig; let file: String? }
struct RulesResponse: Decodable { let rules: String; let file: String? }
struct PruneResult: Decodable { let links: Int; let events: Int }
struct Empty: Decodable {}
