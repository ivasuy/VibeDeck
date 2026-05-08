import Foundation

enum TokenFormatter {

    /// Formats a token count into a compact human-readable string.
    /// Examples: 789 -> "789", 1500 -> "1.5K", 2300000 -> "2.3M", 5000000000 -> "5.0B"
    static func formatCompact(_ value: Int) -> String {
        let abs = abs(value)
        let sign = value < 0 ? "-" : ""

        switch abs {
        case 1_000_000_000...:
            let v = Double(abs) / 1_000_000_000.0
            return "\(sign)\(String(format: "%.1f", v))B"
        case 1_000_000...:
            let v = Double(abs) / 1_000_000.0
            return "\(sign)\(String(format: "%.1f", v))M"
        case 1_000...:
            let v = Double(abs) / 1_000.0
            return "\(sign)\(String(format: "%.1f", v))K"
        default:
            return "\(value)"
        }
    }

    /// Formats a cost value as USD with 2 decimal places. Example: 1.5 -> "$1.50"
    static func formatCost(_ value: Double) -> String {
        String(format: "$%.2f", value)
    }

    /// Parses a cost string (e.g. "1.234567") and formats as "$1.23". Returns "$0.00" on failure.
    static func formatCostFromString(_ value: String?) -> String {
        guard let value, let parsed = Double(value) else {
            return "$0.00"
        }
        return formatCost(parsed)
    }

    /// Formats a ratio as a percentage string. Example: 0.425 -> "42.5%"
    static func formatPercent(_ value: Double) -> String {
        String(format: "%.1f%%", value * 100)
    }
}
