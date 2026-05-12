#!/usr/bin/env swift
import Foundation

let canvasSize: Double = 1024
let roundedRectInset: Double = 48
let cornerRadius: Double = 220

func svgHeader() -> String {
    """
    <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" fill="none">
    """
}

func svgFooter() -> String {
    "</svg>\n"
}

let outputDir = CommandLine.arguments.count > 1
    ? URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
    : URL(fileURLWithPath: "VibeDeckMac/icon_composer", isDirectory: true)

try FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)

let backgroundSVG = """
\(svgHeader())
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1024" y2="1024" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#1e1b4b"/>
      <stop offset="60%" stop-color="#312e6a"/>
      <stop offset="100%" stop-color="#3b3686"/>
    </linearGradient>
    <linearGradient id="rim" x1="100" y1="80" x2="940" y2="920" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#a5b4fc"/>
      <stop offset="100%" stop-color="#6366f1"/>
    </linearGradient>
    <linearGradient id="card1" x1="260" y1="250" x2="760" y2="760" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#6366f1" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="#5b5fc7" stop-opacity="0.06"/>
    </linearGradient>
    <linearGradient id="card2" x1="240" y1="230" x2="792" y2="792" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#6366f1" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#5b5fc7" stop-opacity="0.08"/>
    </linearGradient>
  </defs>

  <rect x="\(Int(roundedRectInset))" y="\(Int(roundedRectInset))" width="\(Int(canvasSize - (roundedRectInset * 2)))" height="\(Int(canvasSize - (roundedRectInset * 2)))" rx="\(Int(cornerRadius))" fill="url(#bg)"/>
  <rect x="64" y="64" width="896" height="896" rx="204" fill="none" stroke="url(#rim)" stroke-opacity="0.12" stroke-width="3"/>

  <rect x="230" y="302" width="596" height="462" rx="42"
        fill="url(#card1)" stroke="#6366f1" stroke-opacity="0.12" stroke-width="3"
        transform="rotate(-2.5 528 533)"/>
  <rect x="208" y="278" width="620" height="486" rx="46"
        fill="url(#card2)" stroke="#818cf8" stroke-opacity="0.15" stroke-width="3"
        transform="rotate(0.8 518 521)"/>

  <line x1="230" y1="560" x2="806" y2="560"
        stroke="#6366f1" stroke-opacity="0.12" stroke-width="3"
        stroke-dasharray="8 12"/>
\(svgFooter())
"""

let foregroundSVG = """
\(svgHeader())
  <defs>
    <linearGradient id="wave" x1="180" y1="330" x2="862" y2="642" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#a5b4fc"/>
      <stop offset="45%" stop-color="#818cf8"/>
      <stop offset="100%" stop-color="#6366f1"/>
    </linearGradient>
    <linearGradient id="waveHi" x1="180" y1="362" x2="862" y2="602" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#d4d4ff"/>
      <stop offset="100%" stop-color="#a5b4fc"/>
    </linearGradient>
  </defs>

  <path d="M 170 536
           C 194 536, 222 534, 258 532
           C 282 530, 290 528, 306 504
           L 346 418
           C 354 400, 362 388, 374 388
           C 382 388, 390 398, 398 418
           L 454 560
           C 462 580, 470 596, 482 596
           C 490 596, 498 584, 506 564
           L 530 498
           C 550 450, 566 402, 582 354
           C 590 330, 598 310, 610 310
           C 622 310, 630 338, 638 370
           L 682 524
           C 690 552, 702 580, 718 580
           C 730 580, 738 560, 746 536
           L 770 474
           C 778 454, 786 442, 798 442
           C 806 442, 814 458, 818 478
           C 826 506, 838 530, 854 536
           C 862 540, 874 540, 886 540"
        stroke="#6366f1" stroke-opacity="0.25" stroke-width="28"
        stroke-linecap="round" stroke-linejoin="round"/>

  <path d="M 170 536
           C 194 536, 222 534, 258 532
           C 282 530, 290 528, 306 504
           L 346 418
           C 354 400, 362 388, 374 388
           C 382 388, 390 398, 398 418
           L 454 560
           C 462 580, 470 596, 482 596
           C 490 596, 498 584, 506 564
           L 530 498
           C 550 450, 566 402, 582 354
           C 590 330, 598 310, 610 310
           C 622 310, 630 338, 638 370
           L 682 524
           C 690 552, 702 580, 718 580
           C 730 580, 738 560, 746 536
           L 770 474
           C 778 454, 786 442, 798 442
           C 806 442, 814 458, 818 478
           C 826 506, 838 530, 854 536
           C 862 540, 874 540, 886 540"
        stroke="url(#wave)" stroke-width="13"
        stroke-linecap="round" stroke-linejoin="round"/>

  <path d="M 174 532
           C 198 532, 226 530, 262 528
           C 284 526, 292 522, 308 500
           L 348 414
           C 356 396, 364 384, 376 384
           C 384 384, 392 394, 400 414
           L 456 556
           C 464 576, 472 592, 484 592
           C 492 592, 500 580, 508 560
           L 532 494
           C 552 446, 568 398, 584 350
           C 592 326, 600 306, 612 306
           C 624 306, 632 334, 640 366
           L 684 520
           C 692 548, 704 576, 720 576
           C 732 576, 740 556, 748 532
           L 772 470
           C 780 450, 788 438, 800 438
           C 808 438, 816 454, 820 474
           C 828 502, 840 526, 856 532
           C 864 536, 876 536, 888 536"
        stroke="url(#waveHi)" stroke-opacity="0.52" stroke-width="5"
        stroke-linecap="round" stroke-linejoin="round"/>

  <circle cx="610" cy="306" r="16" fill="#a5b4fc" opacity="0.92"/>
  <circle cx="610" cy="306" r="8" fill="#ededff"/>
  <circle cx="482" cy="596" r="11" fill="#818cf8" opacity="0.65"/>
  <circle cx="482" cy="596" r="5" fill="#d4d4ff" opacity="0.82"/>
\(svgFooter())
"""

let readme = """
# Icon Composer Source

These files are the source layers for VibeDeckMac's macOS icon workflow, updated to match `dashboard/public/icon.svg`.

Files:
- `01-background.svg`: deep indigo rounded-square chrome and stacked deck cards.
- `02-wave.svg`: the VibeDeck waveform foreground layer.

Recommended import flow:
1. Open `Icon Composer.app` from Xcode.
2. Create a new icon document.
3. Drag `01-background.svg` and `02-wave.svg` into the canvas in that order.
4. Preview the macOS variant and tune material/specular settings if needed.
5. Save the result as `VibeDeckMac/VibeDeckMac/AppIcon.icon`.
6. Keep the target app icon name set to `AppIcon` and rebuild VibeDeckMac.
"""

try backgroundSVG.write(to: outputDir.appendingPathComponent("01-background.svg"), atomically: true, encoding: .utf8)
try foregroundSVG.write(to: outputDir.appendingPathComponent("02-wave.svg"), atomically: true, encoding: .utf8)

if outputDir.lastPathComponent != "Assets" {
    try readme.write(to: outputDir.appendingPathComponent("README.md"), atomically: true, encoding: .utf8)
}

print("Created: \(outputDir.path)/01-background.svg")
print("Created: \(outputDir.path)/02-wave.svg")
if outputDir.lastPathComponent != "Assets" {
    print("Created: \(outputDir.path)/README.md")
}
