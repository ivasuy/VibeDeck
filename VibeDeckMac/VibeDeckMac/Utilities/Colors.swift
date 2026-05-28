import SwiftUI
import AppKit

extension Color {
    static let brand50 = Color(.sRGB, red: 0.961, green: 0.961, blue: 1.000, opacity: 1.0)
    static let brand100 = Color(.sRGB, red: 0.929, green: 0.929, blue: 1.000, opacity: 1.0)
    static let brand200 = Color(.sRGB, red: 0.831, green: 0.831, blue: 1.000, opacity: 1.0)
    static let brand300 = Color(.sRGB, red: 0.647, green: 0.706, blue: 0.988, opacity: 1.0)
    static let brand400 = Color(.sRGB, red: 0.506, green: 0.549, blue: 0.973, opacity: 1.0)
    static let brand500 = Color(.sRGB, red: 0.388, green: 0.400, blue: 0.945, opacity: 1.0)
    static let brand600 = Color(.sRGB, red: 0.357, green: 0.373, blue: 0.780, opacity: 1.0)
    static let brand700 = Color(.sRGB, red: 0.310, green: 0.275, blue: 0.659, opacity: 1.0)
    static let brand800 = Color(.sRGB, red: 0.231, green: 0.212, blue: 0.525, opacity: 1.0)
    static let brand900 = Color(.sRGB, red: 0.192, green: 0.180, blue: 0.416, opacity: 1.0)
    static let brand950 = Color(.sRGB, red: 0.118, green: 0.106, blue: 0.294, opacity: 1.0)

    static let brandPrimary = Color.brand600
    static let brand = Color.brand600
    static let brandStrong = Color.brand700
    static let brandLight = Color.brand400
    private static var isDarkAppearance: Bool {
        NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
    }
    static var chromeTop: Color {
        if isDarkAppearance {
            return Color(.sRGB, red: 0.118, green: 0.122, blue: 0.157, opacity: 0.98)
        }
        return Color(NSColor.windowBackgroundColor).opacity(0.98)
    }
    static var chromeBottom: Color {
        if isDarkAppearance {
            return Color(.sRGB, red: 0.149, green: 0.153, blue: 0.204, opacity: 0.96)
        }
        return Color(NSColor.controlColor).opacity(0.86)
    }
    static var panelFill: Color {
        if isDarkAppearance {
            return Color(.sRGB, red: 0.357, green: 0.373, blue: 0.780, opacity: 0.14)
        }
        return Color(.sRGB, red: 0.657, green: 0.694, blue: 0.988, opacity: 0.14)
    }
    static var panelFillStrong: Color {
        if isDarkAppearance {
            return Color(.sRGB, red: 0.357, green: 0.373, blue: 0.780, opacity: 0.28)
        }
        return Color(.sRGB, red: 0.657, green: 0.694, blue: 0.988, opacity: 0.28)
    }
    static let panelBorder = Color(NSColor.separatorColor).opacity(0.45)
    static let statusOnline = Color(.sRGB, red: 0.357, green: 0.373, blue: 0.780, opacity: 0.92)
    static let statusWarning = Color(.sRGB, red: 0.933, green: 0.620, blue: 0.243, opacity: 0.92)

    /// Primary accent used for emphasis throughout the app.
    static let heatmapLevels: [Color] = [
        Color(.sRGB, red: 0.5, green: 0.5, blue: 0.5, opacity: 0.10),  // level 0 — empty
        Color.brand.opacity(0.25),                                       // level 1
        Color.brand.opacity(0.50),                                       // level 2
        Color.brand.opacity(0.75),                                       // level 3
        Color.brand,                                                     // level 4
    ]

    /// Trend chart fill gradient.
    static let trendFill = Color.brand.opacity(0.15)

    /// Trend chart line color.
    static let trendLine = Color.brand

    /// Refined dot colors for model list, ordered by rank.
    private static let modelDotPalette: [Color] = [
        Color(.sRGB, red: 0.506, green: 0.549, blue: 0.973, opacity: 1.0),
        Color(.sRGB, red: 0.431, green: 0.447, blue: 0.788, opacity: 1.0),
        Color(.sRGB, red: 0.306, green: 0.322, blue: 0.612, opacity: 1.0),
        Color(.sRGB, red: 0.651, green: 0.690, blue: 0.973, opacity: 1.0),
        Color(.sRGB, red: 0.243, green: 0.255, blue: 0.525, opacity: 1.0),
    ]

    /// Returns a dot color for model list by rank index.
    static func modelDot(index: Int) -> Color {
        modelDotPalette[index % modelDotPalette.count]
    }

    // MARK: - Usage Limit Bars

    /// Track background for usage limit progress bars.
    static let limitTrack = Color.gray.opacity(0.10)

    /// Usage limit bar color by fraction (0.0–1.0).
    static func limitBar(fraction: Double) -> Color {
        if fraction >= 0.9 { return Color(.sRGB, red: 0.90, green: 0.30, blue: 0.30, opacity: 1.0) }
        if fraction >= 0.7 { return Color(.sRGB, red: 0.85, green: 0.65, blue: 0.20, opacity: 1.0) }
        return Color(.sRGB, red: 0.20, green: 0.72, blue: 0.40, opacity: 1.0)
    }

    /// Returns a brand color for the given AI source/provider name.
    static func sourceColor(_ source: String) -> Color {
        let key = source.lowercased().replacingOccurrences(of: "-", with: "").replacingOccurrences(of: "_", with: "")
        switch key {
        case "antigravity": return Color(.sRGB, red: 0.243, green: 0.255, blue: 0.525, opacity: 1.0)
        case "claude", "claudecode", "anthropic": return Color(.sRGB, red: 0.431, green: 0.447, blue: 0.788, opacity: 1.0)
        case "codex":       return Color(.sRGB, red: 0.306, green: 0.322, blue: 0.612, opacity: 1.0)
        case "copilot":     return Color(.sRGB, red: 0.380, green: 0.498, blue: 0.855, opacity: 1.0)
        case "cursor":      return Color(.sRGB, red: 0.396, green: 0.420, blue: 0.710, opacity: 1.0)
        case "factoryai", "factoryaidroid", "droid": return Color(.sRGB, red: 0.427, green: 0.447, blue: 0.788, opacity: 1.0)
        case "gemini":      return Color(.sRGB, red: 0.506, green: 0.549, blue: 0.973, opacity: 1.0)
        case "hermes":      return Color(.sRGB, red: 0.455, green: 0.408, blue: 0.816, opacity: 1.0)
        case "kimi":        return Color(.sRGB, red: 0.459, green: 0.420, blue: 0.812, opacity: 1.0)
        case "kiro":        return Color(.sRGB, red: 0.494, green: 0.612, blue: 0.922, opacity: 1.0)
        case "openclaw":    return Color(.sRGB, red: 0.647, green: 0.529, blue: 0.839, opacity: 1.0)
        case "opencode":    return Color(.sRGB, red: 0.533, green: 0.475, blue: 0.863, opacity: 1.0)
        case "everycode":   return Color(.sRGB, red: 0.459, green: 0.573, blue: 0.914, opacity: 1.0)
        default:            return .gray
        }
    }
}
