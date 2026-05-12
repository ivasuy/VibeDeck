#!/usr/bin/env swift
import AppKit
import CoreGraphics

func createWavePath(in rect: CGRect) -> NSBezierPath {
    let path = NSBezierPath()
    let svgWidth: CGFloat = 360
    let svgHeight: CGFloat = 180
    let padding: CGFloat = rect.width * 0.10
    let drawRect = rect.insetBy(dx: padding, dy: padding)
    let scale = min(drawRect.width / svgWidth, drawRect.height / svgHeight)
    let ox = drawRect.minX + (drawRect.width - svgWidth * scale) / 2
    let oy = drawRect.minY + (drawRect.height - svgHeight * scale) / 2

    func p(_ x: CGFloat, _ y: CGFloat) -> NSPoint {
        NSPoint(x: ox + x * scale, y: oy + (svgHeight - y) * scale)
    }

    path.move(to: p(42, 96))
    path.curve(to: p(108, 94), controlPoint1: p(60, 96), controlPoint2: p(82, 95))
    path.curve(to: p(124, 74), controlPoint1: p(116, 93), controlPoint2: p(120, 88))
    path.line(to: p(146, 36))
    path.curve(to: p(158, 24), controlPoint1: p(150, 29), controlPoint2: p(154, 24))
    path.curve(to: p(170, 40), controlPoint1: p(162, 24), controlPoint2: p(166, 30))
    path.line(to: p(196, 102))
    path.curve(to: p(208, 122), controlPoint1: p(200, 112), controlPoint2: p(204, 122))
    path.curve(to: p(220, 104), controlPoint1: p(212, 122), controlPoint2: p(216, 114))
    path.line(to: p(242, 54))
    path.curve(to: p(264, 0), controlPoint1: p(250, 34), controlPoint2: p(258, 8))
    path.curve(to: p(280, 50), controlPoint1: p(270, 0), controlPoint2: p(274, 24))
    path.line(to: p(302, 92))
    path.curve(to: p(316, 116), controlPoint1: p(306, 106), controlPoint2: p(310, 116))
    path.curve(to: p(330, 96), controlPoint1: p(322, 116), controlPoint2: p(326, 108))
    path.line(to: p(344, 70))
    path.curve(to: p(360, 94), controlPoint1: p(348, 62), controlPoint2: p(354, 86))

    return path
}

func generateMenuBarIcon(size: Int) -> NSImage {
    let image = NSImage(size: NSSize(width: size, height: size))
    image.lockFocus()

    // Transparent background - no fill
    let rect = NSRect(x: 0, y: 0, width: size, height: size)

    // Template image: macOS tints this from the status bar appearance.
    NSColor.black.setFill()
    let wavePath = createWavePath(in: rect)
    wavePath.lineWidth = max(1.8, rect.width * 0.12)
    wavePath.lineCapStyle = .round
    wavePath.lineJoinStyle = .round
    wavePath.stroke()

    image.unlockFocus()
    return image
}

func savePNG(_ image: NSImage, to path: String) {
    guard let tiff = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiff),
          let png = bitmap.representation(using: .png, properties: [:]) else {
        print("Failed: \(path)")
        return
    }
    try! png.write(to: URL(fileURLWithPath: path))
    print("Created: \(path)")
}

let outputDir = CommandLine.arguments.count > 1
    ? CommandLine.arguments[1]
    : "VibeDeckMac/VibeDeckMac/Assets.xcassets/MenuBarIcon.imageset"

try? FileManager.default.createDirectory(atPath: outputDir, withIntermediateDirectories: true)

savePNG(generateMenuBarIcon(size: 18), to: "\(outputDir)/menubar_18.png")
savePNG(generateMenuBarIcon(size: 36), to: "\(outputDir)/menubar_36.png")
print("Done!")
