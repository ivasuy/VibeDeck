import Foundation

enum WidgetStrings {
    static var usageName: String { "VibeDeck Usage" }
    static var usageDescription: String { "Today's tokens at a glance, with trend." }
    static var today: String { "TODAY" }
    static var sevenDays: String { "7 DAYS" }
    static var thirtyDays: String { "30 DAYS" }
    static var vsYesterday: String { "vs. yesterday" }

    static var heatmapName: String { "VibeDeck Heatmap" }
    static var heatmapDescription: String { "GitHub-style daily activity calendar." }
    static func streak(_ days: Int) -> String { "\(days)d streak" }
    static func tokensActiveDays(activeDays: Int) -> String {
        "tokens - \(activeDays) active days"
    }

    static var limitsName: String { "VibeDeck Limits" }
    static var limitsDescription: String { "Rate limits for Claude, Codex, Cursor, Gemini, and more." }
    static var noConfiguredProviders: String { "No configured providers" }

    static var topModelsName: String { "VibeDeck Top Models" }
    static var topModelsDescription: String { "Models with the highest token usage." }
    static var noModelUsage: String { "No model usage yet" }

    static func updated(_ relative: String) -> String {
        "Updated \(relative)"
    }

    static var justNow: String { "just now" }
    static func minutesAgo(_ minutes: Int) -> String { "\(minutes)m ago" }
    static func hoursAgo(_ hours: Int) -> String { "\(hours)h ago" }
    static func daysAgo(_ days: Int) -> String { "\(days)d ago" }
    static func resetInMinutes(_ minutes: Int) -> String { "in \(minutes)m" }
    static func resetInHours(_ hours: Int, minutes: Int) -> String {
        minutes > 0 ? "in \(hours)h \(minutes)m" : "in \(hours)h"
    }
    static func resetInDays(_ days: Int) -> String { "in \(days)d" }

    static func limitLabel(_ limit: LimitProvider) -> String {
        limit.label
    }
}
