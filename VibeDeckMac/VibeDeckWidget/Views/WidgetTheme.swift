import SwiftUI

// Self-contained styling so the widget extension does not need to import the
// main app's `Colors`/`TokenFormatter` files. The widget extension is a
// separate target with its own compilation unit and tight binary-size budget.

enum WidgetTheme {
    static let brand = Color(.sRGB, red: 0.357, green: 0.373, blue: 0.780, opacity: 1.0)
    static let brandStrong = Color(.sRGB, red: 0.310, green: 0.275, blue: 0.659, opacity: 1.0)
    static let brandLight = Color(.sRGB, red: 0.506, green: 0.549, blue: 0.973, opacity: 1.0)
    static let surfaceTop = Color(.sRGB, red: 0.965, green: 0.969, blue: 0.992, opacity: 0.96)
    static let surfaceBottom = Color(.sRGB, red: 0.938, green: 0.944, blue: 0.985, opacity: 0.92)
    static let surfaceStroke = Color(.sRGB, red: 0.357, green: 0.373, blue: 0.780, opacity: 0.18)
    static let statusOnline = Color(.sRGB, red: 0.357, green: 0.373, blue: 0.780, opacity: 0.92)
    static let statusWarning = Color(.sRGB, red: 0.933, green: 0.620, blue: 0.243, opacity: 0.92)

    // MARK: - Heatmap palette
    static let heatmapLevels: [Color] = [
        Color(.sRGB, red: 0.5, green: 0.5, blue: 0.5, opacity: 0.10),
        WidgetTheme.brand.opacity(0.25),
        WidgetTheme.brand.opacity(0.50),
        WidgetTheme.brand.opacity(0.75),
        WidgetTheme.brand
    ]

    // MARK: - Limit bars
    static func limitBarColor(_ fraction: Double) -> Color {
        if fraction >= 0.9 { return Color(.sRGB, red: 0.90, green: 0.30, blue: 0.30, opacity: 1) }
        if fraction >= 0.7 { return Color(.sRGB, red: 0.85, green: 0.65, blue: 0.20, opacity: 1) }
        return Color(.sRGB, red: 0.20, green: 0.72, blue: 0.40, opacity: 1)
    }

    static let limitTrack = Color.gray.opacity(0.18)

    // MARK: - Source colors
    static func sourceColor(_ source: String) -> Color {
        switch source.lowercased() {
        case "claude":      return Color(.sRGB, red: 0.431, green: 0.447, blue: 0.788, opacity: 1.0)
        case "codex":       return Color(.sRGB, red: 0.306, green: 0.322, blue: 0.612, opacity: 1.0)
        case "gemini":      return Color(.sRGB, red: 0.506, green: 0.549, blue: 0.973, opacity: 1.0)
        case "opencode":    return Color(.sRGB, red: 0.533, green: 0.475, blue: 0.863, opacity: 1.0)
        case "openclaw":    return Color(.sRGB, red: 0.647, green: 0.529, blue: 0.839, opacity: 1.0)
        case "cursor":      return Color(.sRGB, red: 0.396, green: 0.420, blue: 0.710, opacity: 1.0)
        case "kimi":        return Color(.sRGB, red: 0.459, green: 0.420, blue: 0.812, opacity: 1.0)
        case "everycode":   return Color(.sRGB, red: 0.459, green: 0.573, blue: 0.914, opacity: 1.0)
        case "kiro":        return Color(.sRGB, red: 0.494, green: 0.612, blue: 0.922, opacity: 1.0)
        case "antigravity": return Color(.sRGB, red: 0.243, green: 0.255, blue: 0.525, opacity: 1.0)
        case "copilot":     return Color(.sRGB, red: 0.380, green: 0.498, blue: 0.855, opacity: 1.0)
        default:            return .gray
        }
    }

    static func modelDot(_ idx: Int) -> Color {
        let palette: [Color] = [
            WidgetTheme.brandLight,
            Color(.sRGB, red: 0.431, green: 0.447, blue: 0.788, opacity: 1.0),
            WidgetTheme.brandStrong,
            Color(.sRGB, red: 0.651, green: 0.690, blue: 0.973, opacity: 1.0),
            Color(.sRGB, red: 0.243, green: 0.255, blue: 0.525, opacity: 1.0)
        ]
        return palette[idx % palette.count]
    }

    static var widgetBackground: some View {
        LinearGradient(
            colors: [surfaceTop, surfaceBottom],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}

enum WidgetFormat {

    static func compact(_ value: Int) -> String {
        let absVal = abs(value)
        let sign = value < 0 ? "-" : ""
        switch absVal {
        case 1_000_000_000...:
            return "\(sign)\(String(format: "%.1f", Double(absVal) / 1_000_000_000.0))B"
        case 1_000_000...:
            return "\(sign)\(String(format: "%.1f", Double(absVal) / 1_000_000.0))M"
        case 1_000...:
            return "\(sign)\(String(format: "%.1f", Double(absVal) / 1_000.0))K"
        default:
            return "\(value)"
        }
    }

    static func cost(_ value: Double) -> String {
        if value >= 1_000 {
            return String(format: "$%.0f", value)
        }
        return String(format: "$%.2f", value)
    }

    static func percent(_ value: Double, decimals: Int = 1) -> String {
        String(format: "%.\(decimals)f%%", value)
    }

    static func relativeUpdated(_ date: Date) -> String {
        let interval = Date().timeIntervalSince(date)
        if interval < 60 { return WidgetStrings.justNow }
        if interval < 3600 { return WidgetStrings.minutesAgo(Int(interval / 60)) }
        if interval < 86400 { return WidgetStrings.hoursAgo(Int(interval / 3600)) }
        return WidgetStrings.daysAgo(Int(interval / 86400))
    }

    /// "▲ 12%" / "▼ 5%" / "—" — short signed delta string for hero numbers.
    static func delta(_ percent: Double?) -> String {
        guard let p = percent else { return "—" }
        let rounded = Int(p.rounded())
        if rounded == 0 { return "±0%" }
        let arrow = rounded > 0 ? "▲" : "▼"
        return "\(arrow) \(abs(rounded))%"
    }

    /// Color for a delta arrow. Up = green (more usage isn't strictly bad,
    /// but matches "going up"), down = neutral secondary, zero = secondary.
    static func deltaColor(_ percent: Double?) -> Color {
        guard let p = percent, Int(p.rounded()) != 0 else { return .secondary }
        return p > 0
            ? WidgetTheme.brand
            : Color(.sRGB, red: 0.55, green: 0.55, blue: 0.55, opacity: 1)
    }

    /// "in 2h 14m" / "in 4d" — concise countdown to a future reset date.
    /// Returns nil when no date is provided or it has already passed.
    static func relativeReset(_ date: Date?) -> String? {
        guard let date else { return nil }
        let interval = date.timeIntervalSince(Date())
        if interval <= 0 { return nil }
        if interval < 3600 {
            return WidgetStrings.resetInMinutes(Int(interval / 60))
        }
        if interval < 86400 {
            let h = Int(interval / 3600)
            let m = Int((interval.truncatingRemainder(dividingBy: 3600)) / 60)
            return WidgetStrings.resetInHours(h, minutes: m)
        }
        return WidgetStrings.resetInDays(Int(interval / 86400))
    }
}
