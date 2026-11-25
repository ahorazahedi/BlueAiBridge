// The local broker: where it is, how to call it, how to start it, and its
// live event stream (Server-Sent Events).

import Foundation
import AppKit

enum BrokerError: LocalizedError {
    case notRunning
    case http(Int, String)
    var errorDescription: String? {
        switch self {
        case .notRunning: return "The BlueAIBridge broker isn't running."
        case .http(let code, let body):
            if let d = body.data(using: .utf8), let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any], let e = j["error"] as? String { return e }
            return "HTTP \(code)"
        }
    }
}

final class Broker: @unchecked Sendable {
    static let shared = Broker()

    let root: URL = {
        if let custom = ProcessInfo.processInfo.environment["BLUE_AI_BRIDGE_HOME"] { return URL(fileURLWithPath: custom) }
        return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".blueaibridge")
    }()

    var port: Int {
        if let s = try? String(contentsOf: root.appendingPathComponent("data/broker.port"), encoding: .utf8),
           let p = Int(s.trimmingCharacters(in: .whitespacesAndNewlines)) { return p }
        return 7600
    }
    var token: String? {
        (try? String(contentsOf: root.appendingPathComponent("data/token"), encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    func url(_ path: String) -> URL { URL(string: "http://127.0.0.1:\(port)\(path)")! }

    private let decoder = JSONDecoder()
    private lazy var session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 30
        c.timeoutIntervalForResource = 600
        c.waitsForConnectivity = false
        return URLSession(configuration: c)
    }()

    func get<T: Decodable>(_ path: String, timeout: TimeInterval = 15) async throws -> T {
        try await send(path, method: "GET", body: nil, timeout: timeout)
    }
    func post<T: Decodable>(_ path: String, _ body: [String: Any] = [:], method: String = "POST", timeout: TimeInterval = 180) async throws -> T {
        try await send(path, method: method, body: try JSONSerialization.data(withJSONObject: body), timeout: timeout)
    }
    func put<T: Decodable>(_ path: String, json: Data) async throws -> T {
        try await send(path, method: "PUT", body: json, timeout: 30)
    }
    func raw(_ path: String) async throws -> Data {
        var req = request(path, method: "GET", timeout: 60)
        req.httpBody = nil
        let (data, resp) = try await session.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else { throw BrokerError.http(code, String(data: data, encoding: .utf8) ?? "") }
        return data
    }

    private func request(_ path: String, method: String, timeout: TimeInterval) -> URLRequest {
        var req = URLRequest(url: url(path))
        req.httpMethod = method
        req.timeoutInterval = timeout
        if let t = token { req.setValue("Bearer \(t)", forHTTPHeaderField: "Authorization") }
        return req
    }

    private func send<T: Decodable>(_ path: String, method: String, body: Data?, timeout: TimeInterval) async throws -> T {
        var req = request(path, method: method, timeout: timeout)
        if let body { req.httpBody = body; req.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        do {
            let (data, resp) = try await session.data(for: req)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            guard (200..<300).contains(code) else { throw BrokerError.http(code, String(data: data, encoding: .utf8) ?? "") }
            return try decoder.decode(T.self, from: data)
        } catch let e as URLError where [.cannotConnectToHost, .networkConnectionLost, .cannotFindHost, .notConnectedToInternet].contains(e.code) {
            throw BrokerError.notRunning
        }
    }

    // MARK: starting the broker

    /// node and the runtime CLI, as the installer recorded them
    func cli() -> (node: String, cli: String)? {
        let rt = root.appendingPathComponent("runtime/current")
        let cli = rt.appendingPathComponent("dist/src/cli.js").path
        guard FileManager.default.fileExists(atPath: cli) else { return nil }
        var node = (try? String(contentsOf: rt.appendingPathComponent("node-path"), encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if node.isEmpty || !FileManager.default.isExecutableFile(atPath: node) {
            node = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"].first { FileManager.default.isExecutableFile(atPath: $0) } ?? ""
        }
        return node.isEmpty ? nil : (node, cli)
    }

    func startBroker() {
        guard let c = cli() else { return }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: c.node)
        p.arguments = ["--no-warnings", c.cli, "broker"]
        p.currentDirectoryURL = root
        let log = root.appendingPathComponent("logs/broker.log")
        try? FileManager.default.createDirectory(at: log.deletingLastPathComponent(), withIntermediateDirectories: true)
        if !FileManager.default.fileExists(atPath: log.path) { FileManager.default.createFile(atPath: log.path, contents: nil) }
        if let h = try? FileHandle(forWritingTo: log) { h.seekToEndOfFile(); p.standardOutput = h; p.standardError = h }
        try? p.run()
    }

    /// The web dashboard (same data), for sharing a link or using a browser.
    func openWebDashboard(_ fragment: String = "") {
        guard let t = token, let url = URL(string: "http://127.0.0.1:\(port)/auth?token=\(t)") else { return }
        NSWorkspace.shared.open(url)
        if !fragment.isEmpty, let deep = URL(string: "http://127.0.0.1:\(port)/#/\(fragment)") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { NSWorkspace.shared.open(deep) }
        }
    }

    // MARK: live events

    /// Yields every bridge event as it happens; reconnects on its own, resuming after the last id.
    func events() -> AsyncStream<BridgeEvent> {
        AsyncStream { continuation in
            let task = Task.detached { [weak self] in
                var lastId = 0
                while !Task.isCancelled {
                    guard let self else { return }
                    do {
                        var req = self.request("/api/stream\(lastId > 0 ? "?afterId=\(lastId)" : "")", method: "GET", timeout: 3600)
                        req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                        let (bytes, resp) = try await self.session.bytes(for: req)
                        guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw BrokerError.notRunning }
                        continuation.yield(BridgeEvent.connected)
                        for try await line in bytes.lines {
                            guard line.hasPrefix("data: ") else { continue }
                            if let d = line.dropFirst(6).data(using: .utf8), let e = try? self.decoder.decode(BridgeEvent.self, from: d) {
                                lastId = max(lastId, e.id)
                                continuation.yield(e)
                            }
                        }
                    } catch {
                        continuation.yield(BridgeEvent.disconnected)
                    }
                    try? await Task.sleep(nanoseconds: 2_500_000_000)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

extension BridgeEvent {
    /// pseudo events for the connection state
    static let connected = BridgeEvent(id: -1, ts: 0, type: "_connected", linkId: nil, messageId: nil, actor: nil, bytes: 0, data: [:])
    static let disconnected = BridgeEvent(id: -2, ts: 0, type: "_disconnected", linkId: nil, messageId: nil, actor: nil, bytes: 0, data: [:])
}
