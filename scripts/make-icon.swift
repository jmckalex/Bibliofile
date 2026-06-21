// Renders the 📚 emoji (the Welcome-screen glyph) into a 1024×1024 macOS-style
// app icon — a warm rounded-rect with the Apple colour emoji centred on top.
// Regenerate with:  swift scripts/make-icon.swift build/icon.png
import AppKit
import Foundation

let px = 1024
let rep = NSBitmapImageRep(
  bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px,
  bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
  colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)!

let size = CGFloat(px)
// Rounded-rect plate with macOS-style padding + corner radius.
let inset: CGFloat = 92
let rect = NSRect(x: inset, y: inset, width: size - 2 * inset, height: size - 2 * inset)
let radius: CGFloat = (size - 2 * inset) * 0.225
let plate = NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)

// Warm "parchment" gradient so the colourful book spines pop.
let top = NSColor(srgbRed: 0.99, green: 0.97, blue: 0.92, alpha: 1)
let bottom = NSColor(srgbRed: 0.89, green: 0.82, blue: 0.69, alpha: 1)
NSGradient(starting: top, ending: bottom)!.draw(in: plate, angle: -90)

// Faint inner edge for a little definition.
NSColor(white: 0, alpha: 0.07).setStroke()
plate.lineWidth = 2
plate.stroke()

// The emoji, centred. Drawn with a system font so AppKit substitutes the Apple
// colour-emoji font for the glyph.
let emoji = "📚" as NSString
let fontSize: CGFloat = 580
let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: fontSize)]
let s = emoji.size(withAttributes: attrs)
emoji.draw(at: NSPoint(x: (size - s.width) / 2, y: (size - s.height) / 2 + fontSize * 0.04),
           withAttributes: attrs)

NSGraphicsContext.restoreGraphicsState()

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "build/icon.png"
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
print("wrote \(out) (\(px)×\(px))")
