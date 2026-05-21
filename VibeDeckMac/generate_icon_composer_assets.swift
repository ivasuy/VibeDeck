#!/usr/bin/env swift
import Foundation

let outputDir = CommandLine.arguments.count > 1
    ? URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
    : URL(fileURLWithPath: "VibeDeckMac/icon_composer", isDirectory: true)

try FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)

let backgroundSVG = """
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" fill="none">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1024" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#1e1b4b"/>
      <stop offset="100%" stop-color="#2a2566"/>
    </linearGradient>
  </defs>

  <rect width="1024" height="1024" fill="url(#bg)"/>
</svg>
"""

let foregroundSVG = """
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" fill="none">
  <path d="M 214 462 L 614 462 L 754 362 L 354 362 Z" fill="#a5b4fc"/>
  <path d="M 214 562 L 614 562 L 754 462 L 354 462 Z" fill="#818cf8"/>
  <path d="M 214 662 L 614 662 L 754 562 L 354 562 Z" fill="#6366f1"/>
</svg>
"""

let readme = """
# Icon Composer Source

These files are the source layers for VibeDeckMac's macOS icon workflow, updated to match `dashboard/public/icon.svg`.

Files:
- `01-background.svg`: deep indigo rounded-square chrome from the new VibeDeck app icon.
- `02-mark.svg`: the stacked deck foreground mark from the new VibeDeck app icon.

Recommended import flow:
1. Open `Icon Composer.app` from Xcode.
2. Create a new icon document.
3. Drag `01-background.svg` and `02-mark.svg` into the canvas in that order.
4. Preview the macOS variant and tune material/specular settings if needed.
5. Save the result as `VibeDeckMac/VibeDeckMac/AppIcon.icon`.
6. Keep the target app icon name set to `AppIcon` and rebuild VibeDeckMac.
"""

try backgroundSVG.write(to: outputDir.appendingPathComponent("01-background.svg"), atomically: true, encoding: .utf8)
try foregroundSVG.write(to: outputDir.appendingPathComponent("02-mark.svg"), atomically: true, encoding: .utf8)

for oldForegroundName in ["02-wave.svg", "02-bolt.svg"] {
    let oldForeground = outputDir.appendingPathComponent(oldForegroundName)
    if FileManager.default.fileExists(atPath: oldForeground.path) {
        try FileManager.default.removeItem(at: oldForeground)
    }
}

if outputDir.lastPathComponent != "Assets" {
    try readme.write(to: outputDir.appendingPathComponent("README.md"), atomically: true, encoding: .utf8)
}

print("Created: \(outputDir.path)/01-background.svg")
print("Created: \(outputDir.path)/02-mark.svg")
if outputDir.lastPathComponent != "Assets" {
    print("Created: \(outputDir.path)/README.md")
}
