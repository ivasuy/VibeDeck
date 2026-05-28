import Foundation

enum Strings {
    static var appTitle: String { "VibeDeck" }
    static var serverUnavailable: String { "Server Unavailable" }
    static var serverOfflineTitle: String { "VibeDeck is offline" }
    static var serverOfflineBody: String { "The local server isn't responding." }
    static var serverOfflineLogs: String { "~/Library/Application Support/VibeDeck/logs" }
    static var serverStarting: String { "Starting VibeDeck" }
    static var serverPreparing: String { "This usually takes a few seconds." }
    static var loadingData: String { "Loading data..." }
    static var noData: String { "No data" }
    static var welcomeToVibeDeck: String { "Welcome to VibeDeck" }
    static var firstRunDashboardBody: String {
        "Run any AI coding tool to start tracking. VibeDeck listens automatically."
    }
    static var refreshFailedTitle: String { "Could not refresh data" }
    static var showingLastKnownValues: String { "Showing last-known values." }
    static func showingValuesFrom(_ relative: String) -> String {
        "Showing values from \(relative)."
    }
    static var detectNow: String { "Detect now" }
    static var setupGuide: String { "Setup guide" }
    static var retryButton: String { "Retry" }
    static var restartServerButton: String { "Restart server" }
    static var openDashboard: String { "Open Dashboard" }
    static var openDashboardInBrowser: String { "Open dashboard in browser" }
    static var quitButton: String { "Quit" }
    static var justNow: String { "just now" }
    static var activityTitle: String { "Activity" }
    static var trendTitle: String { "Trend" }
    static var topModelsTitle: String { "Models" }
    static var modelBreakdownTitle: String { "Model Breakdown" }
    static var todayTitle: String { "Today" }
    static var sevenDayTitle: String { "7-Day" }
    static var thirtyDayTitle: String { "30-Day" }
    static var perDay: String { "/day" }
    static var hintTrend: String { "Usage trend appears after your first AI session" }
    static var hintBreakdown: String { "Model data appears after your first AI session" }
    static var periodTotal: String { "Period" }
    static var conversations: String { "conversations" }
    static var totalTitle: String { "Total" }
    static var hintModels: String { "Model data appears after your first AI session" }
    static var serverStartingSubtitle: String { "Starting local server..." }
    static var serverStartingHint: String { "This usually takes a few seconds." }
    static var serverOfflineHint: String { "Check that vibedeck-cli is installed and try again." }

    static var usageLimitsTitle: String { "Limits" }
    static var sessionExpired: String { "Session expired" }
    static var allProvidersHidden: String { "All providers hidden" }
    static var cursorPlanLabel: String { "Plan" }
    static var cursorAutoLabel: String { "Auto" }
    static var kimiWeeklyLabel: String { "Weekly" }
    static var kimiFiveHourLabel: String { "5h" }
    static var kimiTotalLabel: String { "Total" }
    static var kiroMonthLabel: String { "Month" }
    static var kiroBonusLabel: String { "Bonus" }
    static var limitResetNow: String { "now" }
    static func kimiParallelLabel(_ count: Int) -> String { "Parallel: \(count)" }

    static var periodDayLabel: String { "Day" }
    static var periodWeekLabel: String { "Week" }
    static var periodMonthLabel: String { "Month" }
    static var periodTotalLabel: String { "Total" }

    static func topModelAccessibility(name: String, source: String, tokens: String, percent: String) -> String {
        "\(name), \(source), \(tokens) tokens, \(percent) percent"
    }

    static var syncingUsageData: String { "Syncing usage data..." }
    static var syncingFirstLaunchHint: String { "First launch may take a moment" }
    static var limitsDisplayTitle: String { "Limit Display" }

    static var menuSyncNow: String { "Sync Now" }
    static var menuCheckForUpdates: String { "Check for Updates..." }
    static var menuLaunchAtLogin: String { "Launch at Login" }
    static var menuStarOnGitHub: String { "Star on GitHub" }
    static var menuShowStats: String { "Show Stats in Menu Bar" }
    static var menuAnimatedIcon: String { "Animated Icon" }
    static var menuSettings: String { "Settings" }
    static var menuTokenLabel: String { "Tokens" }
    static var menuCostLabel: String { "Cost" }
    static var tokensUnit: String { "tokens" }
    static var heatmapLegendLess: String { "Less" }
    static var heatmapLegendMore: String { "More" }
    static var trendAccessibilityLabel: String { "Token usage trend chart" }
    static var syncUsageData: String { "Sync usage data" }
    static var addWidgetsTitle: String { "Add VibeDeck widgets" }
    static var addWidgetsMessage: String {
        "Right-click an empty area of your desktop, choose \"Edit Widgets\", then search for \"VibeDeck\" in the gallery."
    }
    static var gotItButton: String { "Got it" }

    static var serverNotAvailableMessage: String {
        "VibeDeck server not available.\nPlease reinstall the app or install: npm install -g vibedeck-cli"
    }
    static func serverNotResponding(port: Int) -> String {
        "Server started but not responding on port \(port)."
    }
    static var serverExitedUnexpectedly: String { "Server process exited unexpectedly." }
    static func embeddedServerLaunchFailed(_ error: String) -> String {
        "Failed to launch embedded server: \(error)"
    }
    static func serverLaunchFailed(_ error: String) -> String {
        "Failed to launch server: \(error)"
    }
    static var serverBecameUnreachable: String { "Server became unreachable." }

    static var updateChecking: String { "Checking for updates..." }
    static func updateSkipped(target: String, current: String) -> String {
        "Auto-update skipped: \(target) reports as \(current). Reinstall manually."
    }
    static var upToDateTitle: String { "You're Up to Date" }
    static func upToDateMessage(_ version: String) -> String {
        "Version \(version) is the latest version."
    }
    static var updateCheckFailedTitle: String { "Update Check Failed" }
    static var manualCheckHint: String { "You can also check manually:" }
    static func newVersionTitle(_ version: String) -> String {
        "New Version Available - \(version)"
    }
    static var downloadInstallButton: String { "Download & Install" }
    static var viewOnGitHubButton: String { "View on GitHub" }
    static var laterButton: String { "Later" }
    static func updateCurrentLine(current: String, target: String) -> String {
        "Current: \(current) -> \(target)"
    }
    static var releaseNotesTitle: String { "Release Notes:" }
    static func updateSize(_ size: String) -> String { "Size: \(size) MB" }
    static var downloadFailedTitle: String { "Download Failed" }
    static var invalidDownloadURL: String {
        "Invalid download URL.\n\nYou can download manually from the Releases page."
    }
    static var manualDownloadHint: String {
        "You can download manually from the Releases page."
    }
    static var downloadingUnknown: String { "Downloading..." }
    static func downloadingPercent(_ pct: Int) -> String { "Downloading \(pct)%..." }
    static func downloadingProgress(pct: Int, receivedMB: String, totalMB: String) -> String {
        "Downloading \(pct)% (\(receivedMB)/\(totalMB) MB)"
    }
    static var installing: String { "Installing..." }
    static var restarting: String { "Restarting..." }
    static var installationFailedTitle: String { "Installation Failed" }
    static var manualInstallHint: String { "Please drag VibeDeck into Applications manually." }
    static var updateCompleteTitle: String { "Update Complete" }
    static var updateCompleteMessage: String {
        "New version installed to /Applications. Please restart manually."
    }
    static var openReleasesPageButton: String { "Open Releases Page" }
    static var okButton: String { "OK" }
    static func networkRequestFailed(code: Int) -> String {
        "Network request failed (HTTP \(code)). Check your connection or proxy settings."
    }
    static var emptyServerResponse: String { "Server returned an empty response." }
    static var fileDownloadFailed: String { "File download failed. This may be a network issue." }
    static func installFailed(_ reason: String) -> String { "Installation failed: \(reason)" }
    static var noReleaseAvailable: String { "No release available." }

    static func minutesAgo(_ n: Int) -> String { "\(n)m ago" }
    static func hoursAgo(_ n: Int) -> String { "\(n)h ago" }
    static func daysAgo(_ n: Int) -> String { "\(n)d ago" }
    static func activeDays(_ n: Int) -> String { "\(n) active days" }
    static func activeDaysThisWeek(_ n: Int) -> String { "\(n) active days this week" }
    static func tokensToday(_ tokens: String) -> String { "Today: \(tokens) tokens" }
    static func tokensSpentToday(tokens: String, cost: String) -> String {
        "\(tokens) tokens - \(cost) spent today"
    }
    static func aiInvestedToday(_ cost: String) -> String { "\(cost) invested in AI so far" }
    static func billToday(cost: String, tokens: String) -> String {
        "Today's bill: \(cost) for \(tokens) tokens"
    }
    static func aiTabToday(_ cost: String) -> String { "AI tab today: \(cost)" }
    static func sevenDayTotal(_ tokens: String) -> String { "7-day total: \(tokens) tokens" }
    static var perfectStreak: String { "7 active days this week" }
    static func thirtyDayTotal(_ tokens: String) -> String { "30-day total: \(tokens) tokens" }
    static func averagingPerDay(_ tokens: String) -> String { "Averaging ~\(tokens)/day this month" }
    static func streakDays(_ n: Int) -> String { "\(n)-day active streak" }
    static func activeDaysAllTime(_ n: Int) -> String { "\(n) active days all-time!" }
    static func topModel(_ name: String, _ percent: String) -> String { "Top model: \(name) (\(percent))" }
    static func runnerUp(_ name: String, _ percent: String) -> String { "Runner-up: \(name) at \(percent)" }
    static func modelCount(_ count: Int) -> String { "Using \(count) different models" }
    static func multiToolSetup(_ names: String) -> String { "Multi-tool setup: \(names)" }
    static func conversationsToday(_ count: Int) -> String {
        "\(count) conversation\(count == 1 ? "" : "s") today"
    }
    static func busyTalker(_ count: Int) -> String { "\(count) chats today" }

    static var syncingQuips: [String] {
        ["Syncing usage.", "Reading local totals.", "Updating counters.", "Refreshing state."]
    }
    static var emptyTodayQuips: [String] {
        ["All quiet. Tokens unspent.", "No sessions yet today.", "Waiting for local usage.", "Nothing's running."]
    }
    static var warmupQuips: [String] { ["Light usage today.", "Small session recorded."] }
    static var flowQuips: [String] { ["Usage is active.", "Steady usage today."] }
    static var busyQuips: [String] { ["Several sessions today.", "Context is moving."] }
    static var heavyQuips: [String] { ["High usage today.", "Large context load."] }
    static var massiveQuips: [String] { ["Very high usage today.", "Token count is high."] }
    static var personalityQuips: [String] {
        ["Local counters ready.", "Nothing's running.", "Usage stays local.", "Sync on demand.", "Watching local state."]
    }

    static func limitAccessibility(toolName: String, label: String, percent: Int, reset: String?) -> String {
        let base = "\(toolName) \(label) limit, \(percent)%"
        guard let reset else { return base }
        return "\(base), resets in \(reset)"
    }
}
