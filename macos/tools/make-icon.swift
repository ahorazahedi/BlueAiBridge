// Renders the BlueAIBridge app icon (blue squircle, white bridge) into an .iconset.
import AppKit

let out = CommandLine.arguments[1]
try? FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)

func render(_ px: Int) -> Data {
    let s = CGFloat(px)
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let inset = s * 0.1
    let rect = NSRect(x: inset, y: inset, width: s - inset * 2, height: s - inset * 2)
    let shape = NSBezierPath(roundedRect: rect, xRadius: rect.width * 0.225, yRadius: rect.width * 0.225)
    NSGraphicsContext.current?.saveGraphicsState()
    let shadow = NSShadow(); shadow.shadowBlurRadius = s * 0.03; shadow.shadowOffset = NSSize(width: 0, height: -s * 0.012); shadow.shadowColor = NSColor.black.withAlphaComponent(0.3); shadow.set()
    NSGradient(starting: NSColor(srgbRed: 0.27, green: 0.56, blue: 0.98, alpha: 1), ending: NSColor(srgbRed: 0.09, green: 0.27, blue: 0.80, alpha: 1))!.draw(in: shape, angle: -60)
    NSGraphicsContext.current?.restoreGraphicsState()
    NSColor.white.setStroke(); NSColor.white.setFill()
    let w = rect.width
    func p(_ x: CGFloat, _ y: CGFloat) -> NSPoint { NSPoint(x: rect.minX + w * x, y: rect.minY + w * y) }
    let arch = NSBezierPath(); arch.lineWidth = w * 0.065; arch.lineCapStyle = .round
    arch.move(to: p(0.17, 0.38)); arch.curve(to: p(0.83, 0.38), controlPoint1: p(0.30, 0.80), controlPoint2: p(0.70, 0.80)); arch.stroke()
    let deck = NSBezierPath(); deck.lineWidth = w * 0.05; deck.lineCapStyle = .round
    deck.move(to: p(0.12, 0.38)); deck.line(to: p(0.88, 0.38)); deck.stroke()
    for x in [0.34, 0.5, 0.66] as [CGFloat] {
        let h = NSBezierPath(); h.lineWidth = w * 0.035; h.lineCapStyle = .round
        let top: CGFloat = x == 0.5 ? 0.66 : 0.6
        h.move(to: p(x, 0.4)); h.line(to: p(x, top)); h.stroke()
    }
    for (x, c) in [(0.17, NSColor(srgbRed: 0.85, green: 0.47, blue: 0.34, alpha: 1)), (0.83, NSColor(srgbRed: 0.06, green: 0.64, blue: 0.5, alpha: 1))] as [(CGFloat, NSColor)] {
        let r = w * 0.085
        let dot = NSBezierPath(ovalIn: NSRect(x: p(x, 0.38).x - r, y: p(x, 0.38).y - r, width: r * 2, height: r * 2))
        NSColor.white.setFill(); dot.fill()
        let r2 = r * 0.62
        c.setFill(); NSBezierPath(ovalIn: NSRect(x: p(x, 0.38).x - r2, y: p(x, 0.38).y - r2, width: r2 * 2, height: r2 * 2)).fill()
    }
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

for (size, scales) in [(16, [1, 2]), (32, [1, 2]), (128, [1, 2]), (256, [1, 2]), (512, [1, 2])] {
    for sc in scales {
        let name = sc == 1 ? "icon_\(size)x\(size).png" : "icon_\(size)x\(size)@2x.png"
        try! render(size * sc).write(to: URL(fileURLWithPath: out).appendingPathComponent(name))
    }
}
