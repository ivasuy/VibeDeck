import AppKit
import Combine
import SwiftUI

enum MenuBarDisplayMetric: String, CaseIterable {
    case todayTokens
    case todayCost
    case last7dTokens
    case totalTokens
    case totalCost
    case claude5h
    case claude7d
    case codex5h
    case codex7d
    case cursorPlan
    case geminiPro
    case kimiWeekly
    case kiroMonth
    case copilotPremium
    case antigravityClaude

    var menuLabel: String {
        switch self {
        case .todayTokens: return "Tokens"
        case .todayCost: return "Cost"
        case .last7dTokens: return "7d"
        case .totalTokens: return "Total"
        case .totalCost: return "All $"
        case .claude5h: return "Cl 5h"
        case .claude7d: return "Cl 7d"
        case .codex5h: return "Cx 5h"
        case .codex7d: return "Cx 7d"
        case .cursorPlan: return "Cur"
        case .geminiPro: return "Gem"
        case .kimiWeekly: return "Kimi"
        case .kiroMonth: return "Kiro"
        case .copilotPremium: return "Cop"
        case .antigravityClaude: return "Ag"
        }
    }

    var settingsTitle: String {
        switch self {
        case .todayTokens: return "Today Tokens"
        case .todayCost: return "Today Cost"
        case .last7dTokens: return "Last 7 Days"
        case .totalTokens: return "Total Tokens"
        case .totalCost: return "Total Cost"
        case .claude5h: return "Claude 5h Limit"
        case .claude7d: return "Claude 7d Limit"
        case .codex5h: return "Codex 5h Limit"
        case .codex7d: return "Codex 7d Limit"
        case .cursorPlan: return "Cursor Plan Limit"
        case .geminiPro: return "Gemini Pro Limit"
        case .kimiWeekly: return "Kimi Weekly Limit"
        case .kiroMonth: return "Kiro Monthly Limit"
        case .copilotPremium: return "Copilot Premium Limit"
        case .antigravityClaude: return "Antigravity Claude Limit"
        }
    }

    var settingsCategory: String {
        switch self {
        case .todayTokens, .last7dTokens, .totalTokens:
            return "tokens"
        case .todayCost, .totalCost:
            return "cost"
        case .claude5h, .claude7d, .codex5h, .codex7d, .cursorPlan,
             .geminiPro, .kimiWeekly, .kiroMonth, .copilotPremium,
             .antigravityClaude:
            return "limits"
        }
    }
}

enum MenuBarDisplayPreferences {
    static let key = "MenuBarDisplayItems"
    static let defaultIDs = [MenuBarDisplayMetric.todayTokens.rawValue, MenuBarDisplayMetric.todayCost.rawValue]
    static let maxVisibleItems = 2

    static var availableItemsPayload: [[String: String]] {
        MenuBarDisplayMetric.allCases.map {
            [
                "id": $0.rawValue,
                "label": $0.settingsTitle,
                "shortLabel": $0.menuLabel,
                "category": $0.settingsCategory,
            ]
        }
    }

    static func read(from defaults: UserDefaults = .standard) -> [String] {
        let raw = defaults.stringArray(forKey: key) ?? defaultIDs
        let normalized = normalize(raw)
        // Self-heal: if stored data drifted (legacy >2-item arrays from earlier
        // dev builds, duplicates, or unknown ids), persist the cleaned version
        // back so the next read doesn't have to keep trimming.
        if raw != normalized {
            defaults.set(normalized, forKey: key)
        }
        return normalized
    }

    static func write(_ ids: [String], to defaults: UserDefaults = .standard) {
        defaults.set(normalize(ids), forKey: key)
    }

    static func normalize(_ ids: [String]) -> [String] {
        var seen = Set<String>()
        let allowed = Set(MenuBarDisplayMetric.allCases.map(\.rawValue))
        var normalized = ids.compactMap { raw -> String? in
            guard allowed.contains(raw), !seen.contains(raw) else { return nil }
            seen.insert(raw)
            return raw
        }
        // Pad up to `maxVisibleItems` with defaults that haven't been picked yet.
        // Guards against legacy UserDefaults written by earlier dev builds
        // (e.g. only `["todayTokens"]` would otherwise leave the second slot empty).
        for fallbackID in defaultIDs where normalized.count < maxVisibleItems {
            guard !seen.contains(fallbackID) else { continue }
            normalized.append(fallbackID)
            seen.insert(fallbackID)
        }
        return Array(normalized.prefix(maxVisibleItems))
    }
}

private struct MenuBarDisplayValue {
    let id: String
    let label: String
    let value: String
}

@MainActor
final class StatusBarController: NSObject {

    private static weak var instance: StatusBarController?


    static func prepareForSystemAlert() {
        instance?.closePopoverForModalAlert()
    }

    private static let popoverWidth: CGFloat = 320
    private static let popoverMaxHeight: CGFloat = 560

    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let popover = NSPopover()
    private let viewModel: DashboardViewModel
    private let serverManager: ServerManager
    private var animator: MenuBarAnimator?
    private var popoverRefreshTask: Task<Void, Never>?
    private var cancellables = Set<AnyCancellable>()

    private let menuBarHeight: CGFloat = 22
    private let menuBarIconSize = NSSize(width: 16, height: 16)
    private let emptyAttributedTitle = NSAttributedString(string: "")
    private var isUpdatingDisplay = false

    private static let showStatsKey = "MenuBarShowStats"
    private var showStats: Bool {
        get { UserDefaults.standard.object(forKey: Self.showStatsKey) as? Bool ?? true }
        set {
            UserDefaults.standard.set(newValue, forKey: Self.showStatsKey)
            updateStatsDisplay()
        }
    }

    // MARK: - Init

    init(viewModel: DashboardViewModel,
         serverManager: ServerManager,
         launchAtLoginManager _: LaunchAtLoginManager) {
        self.viewModel = viewModel
        self.serverManager = serverManager
        super.init()

        Self.instance = self

        setupStatusItem()
        setupPopover()
        observeSyncState()
        observeNativeBridgeSettings()
    }

    private func closePopoverForModalAlert() {
        if popover.isShown {
            popover.performClose(nil)
        }
    }

    /// React to setting changes pushed by the dashboard SettingsPage via NativeBridge.
    /// Re-reads UserDefaults and refreshes the menu-bar visuals (stats badge + animation state).
    private func observeNativeBridgeSettings() {
        NotificationCenter.default.addObserver(
            forName: .nativeSettingsChanged,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.animator?.applyCurrentState()
                self.updateStatsDisplay()
            }
        }
    }

    // MARK: - Status Item

    private func setupStatusItem() {
        guard let button = statusItem.button else { return }

        let image = NSImage(named: "MenuBarIcon")
        image?.isTemplate = true
        button.image = image

        button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        button.action = #selector(handleClick(_:))
        button.target = self

        animator = MenuBarAnimator(button: button)
        animator?.onImageUpdated = { [weak self] _ in
            guard let self, self.showStats, self.viewModel.todayTokens > 0 else { return }
            self.updateStatsDisplay()
        }
        updateStatsDisplay()
    }

    private func observeSyncState() {
        viewModel.$isSyncing
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in self?.refreshAnimatorState() }
            .store(in: &cancellables)

        // Observe server online status for disconnected icon
        viewModel.$serverOnline
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in self?.refreshAnimatorState() }
            .store(in: &cancellables)

        viewModel.$liveSessionsSnapshot
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in self?.refreshAnimatorState() }
            .store(in: &cancellables)

        // Update stats text when today data changes
        viewModel.$todaySummary
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in self?.updateStatsDisplay() }
            .store(in: &cancellables)

        viewModel.$rollingSummary
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in self?.updateStatsDisplay() }
            .store(in: &cancellables)

        viewModel.$totalSummary
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in self?.updateStatsDisplay() }
            .store(in: &cancellables)

        viewModel.$usageLimits
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in self?.updateStatsDisplay() }
            .store(in: &cancellables)
    }

    private func refreshAnimatorState() {
        if viewModel.isSyncing {
            animator?.setState(.syncing)
        } else if !viewModel.serverOnline {
            animator?.setState(.disconnected)
        } else if !viewModel.activeLiveSessions.isEmpty {
            animator?.setState(.active)
        } else {
            animator?.setState(.idle)
        }
    }

    private func updateStatsDisplay() {
        guard !isUpdatingDisplay else { return }
        isUpdatingDisplay = true
        defer { isUpdatingDisplay = false }
        guard let button = statusItem.button else { return }
        let displayItems = buildMenuBarDisplayValues()




        let canResizeStatusItem = !popover.isShown

        if showStats && !displayItems.isEmpty {
            let compositeImage = makeDisplayMenuBarImage(
                icon: animator?.currentImage ?? button.image,
                items: displayItems
            )

            button.title = ""
            button.attributedTitle = emptyAttributedTitle
            button.imagePosition = .imageOnly
            button.image = compositeImage
            if canResizeStatusItem {
                statusItem.length = compositeImage.size.width
            }
        } else {
            button.title = ""
            button.attributedTitle = emptyAttributedTitle
            button.imagePosition = .imageOnly
            if canResizeStatusItem {
                statusItem.length = NSStatusItem.squareLength
            }
            animator?.applyCurrentState()
        }
    }

    private func buildMenuBarDisplayValues() -> [MenuBarDisplayValue] {
        MenuBarDisplayPreferences.read().compactMap { id -> MenuBarDisplayValue? in
            guard let metric = MenuBarDisplayMetric(rawValue: id) else { return nil }

            switch metric {
            case .todayTokens:
                guard viewModel.todayTokens > 0 else { return nil }
                return MenuBarDisplayValue(
                    id: id,
                    label: metric.menuLabel,
                    value: TokenFormatter.formatCompact(viewModel.todayTokens)
                )
            case .todayCost:
                guard viewModel.todayTokens > 0 else { return nil }
                return MenuBarDisplayValue(id: id, label: metric.menuLabel, value: viewModel.todayCost)
            case .last7dTokens:
                guard viewModel.last7dTokens > 0 else { return nil }
                return MenuBarDisplayValue(
                    id: id,
                    label: metric.menuLabel,
                    value: TokenFormatter.formatCompact(viewModel.last7dTokens)
                )
            case .totalTokens:
                guard viewModel.totalTokens > 0 else { return nil }
                return MenuBarDisplayValue(
                    id: id,
                    label: metric.menuLabel,
                    value: TokenFormatter.formatCompact(viewModel.totalTokens)
                )
            case .totalCost:
                guard viewModel.totalTokens > 0 else { return nil }
                return MenuBarDisplayValue(id: id, label: metric.menuLabel, value: viewModel.totalCost)
            case .claude5h:
                guard let window = viewModel.usageLimits?.claude.fiveHour,
                      viewModel.usageLimits?.claude.configured == true,
                      viewModel.usageLimits?.claude.error == nil else { return nil }
                return MenuBarDisplayValue(id: id, label: metric.menuLabel, value: formatLimitPercent(window.utilization))
            case .claude7d:
                guard let window = viewModel.usageLimits?.claude.sevenDay,
                      viewModel.usageLimits?.claude.configured == true,
                      viewModel.usageLimits?.claude.error == nil else { return nil }
                return MenuBarDisplayValue(id: id, label: metric.menuLabel, value: formatLimitPercent(window.utilization))
            case .codex5h:
                guard let window = viewModel.usageLimits?.codex.primaryWindow,
                      viewModel.usageLimits?.codex.configured == true,
                      viewModel.usageLimits?.codex.error == nil else { return nil }
                return MenuBarDisplayValue(id: id, label: metric.menuLabel, value: "\(window.usedPercent)%")
            case .codex7d:
                guard let window = viewModel.usageLimits?.codex.secondaryWindow,
                      viewModel.usageLimits?.codex.configured == true,
                      viewModel.usageLimits?.codex.error == nil else { return nil }
                return MenuBarDisplayValue(id: id, label: metric.menuLabel, value: "\(window.usedPercent)%")
            case .cursorPlan:
                guard let window = viewModel.usageLimits?.cursor.primaryWindow,
                      viewModel.usageLimits?.cursor.configured == true,
                      viewModel.usageLimits?.cursor.error == nil else { return nil }
                return MenuBarDisplayValue(id: id, label: metric.menuLabel, value: formatLimitPercent(window.usedPercent))
            case .geminiPro:
                guard let window = viewModel.usageLimits?.gemini.primaryWindow,
                      viewModel.usageLimits?.gemini.configured == true,
                      viewModel.usageLimits?.gemini.error == nil else { return nil }
                return MenuBarDisplayValue(id: id, label: metric.menuLabel, value: formatLimitPercent(window.usedPercent))
            case .kimiWeekly:
                guard let window = viewModel.usageLimits?.kimi?.primaryWindow,
                      viewModel.usageLimits?.kimi?.configured == true,
                      viewModel.usageLimits?.kimi?.error == nil else { return nil }
                return MenuBarDisplayValue(id: id, label: metric.menuLabel, value: formatLimitPercent(window.usedPercent))
            case .kiroMonth:
                guard let window = viewModel.usageLimits?.kiro.primaryWindow,
                      viewModel.usageLimits?.kiro.configured == true,
                      viewModel.usageLimits?.kiro.error == nil else { return nil }
                return MenuBarDisplayValue(id: id, label: metric.menuLabel, value: formatLimitPercent(window.usedPercent))
            case .copilotPremium:
                guard let window = viewModel.usageLimits?.copilot?.primaryWindow,
                      viewModel.usageLimits?.copilot?.configured == true,
                      viewModel.usageLimits?.copilot?.error == nil else { return nil }
                return MenuBarDisplayValue(id: id, label: metric.menuLabel, value: formatLimitPercent(window.usedPercent))
            case .antigravityClaude:
                guard let window = viewModel.usageLimits?.antigravity.primaryWindow,
                      viewModel.usageLimits?.antigravity.configured == true,
                      viewModel.usageLimits?.antigravity.error == nil else { return nil }
                return MenuBarDisplayValue(id: id, label: metric.menuLabel, value: formatLimitPercent(window.usedPercent))
            }
        }
    }

    private func formatLimitPercent(_ value: Double) -> String {
        "\(Int(min(max(value, 0), 100).rounded()))%"
    }

    private func makeDisplayMenuBarImage(icon: NSImage?, items: [MenuBarDisplayValue]) -> NSImage {
        let valueFont = NSFont.monospacedDigitSystemFont(ofSize: 10, weight: .regular)
        let labelFont = NSFont.systemFont(ofSize: 7, weight: .regular)
        let valueColor = NSColor.labelColor
        let labelColor = NSColor.labelColor

        let columns = items.map { item in
            let value = NSAttributedString(string: item.value, attributes: [
                .font: valueFont,
                .foregroundColor: valueColor,
            ])
            let label = NSAttributedString(string: item.label, attributes: [
                .font: labelFont,
                .foregroundColor: labelColor,
            ])
            let width = ceil(max(value.size().width, label.size().width))
            return (value: value, label: label, width: width)
        }

        let iconTrailingPadding: CGFloat = 6
        let trailingPadding: CGFloat = 3
        let lineGap: CGFloat = -1
        let sepGap: CGFloat = 4

        let valueHeight = ceil(max(valueFont.ascender - valueFont.descender, columns.map { $0.value.size().height }.max() ?? 0))
        let labelHeight = ceil(max(labelFont.ascender - labelFont.descender, columns.map { $0.label.size().height }.max() ?? 0))
        let textBlockHeight = valueHeight + lineGap + labelHeight
        let textOriginY = floor((menuBarHeight - textBlockHeight) / 2)
        let labelOriginY = textOriginY
        let valueOriginY = labelOriginY + labelHeight + lineGap

        let iconWidth = menuBarIconSize.width
        let textOriginX = iconWidth + iconTrailingPadding
        let columnsWidth = columns.enumerated().reduce(CGFloat(0)) { total, pair in
            let separatorWidth: CGFloat = pair.offset == 0 ? 0 : (sepGap + 1 + sepGap)
            return total + separatorWidth + pair.element.width
        }
        let totalWidth = ceil(textOriginX + columnsWidth + trailingPadding)
        let imageSize = NSSize(width: totalWidth, height: menuBarHeight)

        let image = NSImage(size: imageSize, flipped: false) { [weak self] _ in
            guard let self else { return false }

            if let icon {
                let iconRect = NSRect(
                    x: 0,
                    y: floor((self.menuBarHeight - self.menuBarIconSize.height) / 2),
                    width: self.menuBarIconSize.width,
                    height: self.menuBarIconSize.height
                )
                // Template icons are black alpha — tint to labelColor for compositing
                if icon.isTemplate {
                    icon.draw(in: iconRect, from: .zero, operation: .sourceOver, fraction: 1)
                    NSColor.labelColor.setFill()
                    iconRect.fill(using: .sourceAtop)
                } else {
                    icon.draw(in: iconRect, from: .zero, operation: .sourceOver, fraction: 1)
                }
            }

            var cursorX = textOriginX
            for (index, column) in columns.enumerated() {
                if index > 0 {
                    let sepX = cursorX + sepGap
                    NSColor.labelColor.withAlphaComponent(0.5).setFill()
                    NSRect(x: sepX, y: labelOriginY + 1, width: 0.5, height: textBlockHeight - 2).fill()
                    cursorX = sepX + 1 + sepGap
                }

                let valueRect = NSRect(x: cursorX, y: valueOriginY, width: column.width, height: valueHeight)
                let labelRect = NSRect(x: cursorX, y: labelOriginY, width: column.width, height: labelHeight)
                column.value.draw(in: self.centeredRect(for: column.value, in: valueRect))
                column.label.draw(in: self.centeredRect(for: column.label, in: labelRect))
                cursorX += column.width
            }

            return true
        }

        image.isTemplate = false
        return image
    }

    private func centeredRect(for string: NSAttributedString, in rect: NSRect) -> NSRect {
        let size = string.size()
        return NSRect(
            x: rect.minX + floor((rect.width - size.width) / 2),
            y: rect.minY + floor((rect.height - size.height) / 2),
            width: ceil(size.width),
            height: ceil(size.height)
        )
    }

    // MARK: - Popover

    private func setupPopover() {
        let rootView = MenuBarPopoverView(
            viewModel: viewModel,
            serverManager: serverManager,
            onOpenDashboard: { [weak self] in
                self?.popover.performClose(nil)
                DashboardWindowController.shared.showWindow()
            },
            onOpenSettings: { [weak self] in
                self?.popover.performClose(nil)
                DashboardWindowController.shared.showSettings()
            },
            onOpenSession: { [weak self] session in
                self?.popover.performClose(nil)
                DashboardWindowController.shared.showLiveSession(
                    provider: session.provider,
                    sessionID: session.sessionId
                )
            },
            onSync: { [weak self] in Task { await self?.viewModel.triggerSync() } },
            onClose: { [weak self] in self?.popover.performClose(nil) }
        )
        .frame(width: Self.popoverWidth)
        .frame(maxHeight: Self.popoverMaxHeight)

        popover.contentViewController = NSHostingController(rootView: rootView)
        popover.contentSize = NSSize(width: Self.popoverWidth, height: Self.popoverMaxHeight)
        popover.behavior = .transient


        NotificationCenter.default.addObserver(
            forName: NSPopover.didCloseNotification,
            object: popover,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.stopPopoverRefresh()
                self?.updateStatsDisplay()
            }
        }
    }

    // MARK: - Click Handling

    @objc private func handleClick(_ sender: NSStatusBarButton) {
        guard let event = NSApp.currentEvent else { return }

        if event.type == .rightMouseUp {
            showMenu()
        } else {
            togglePopover()
        }
    }

    private func togglePopover() {
        guard let button = statusItem.button else { return }

        if popover.isShown {
            popover.performClose(nil)
        } else {
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)

            // Ensure popover closes when user clicks outside
            if let window = popover.contentViewController?.view.window {
                NSApp.activate(ignoringOtherApps: true)
                window.makeKey()
            }

            // Refresh data when popover opens
            Task { await viewModel.loadAll() }
            startPopoverRefresh()
        }
    }

    private func startPopoverRefresh() {
        stopPopoverRefresh()
        popoverRefreshTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                guard !Task.isCancelled else { break }
                await MainActor.run {
                    guard let self, self.popover.isShown else { return }
                    Task { await self.viewModel.loadAll() }
                }
            }
        }
    }

    private func stopPopoverRefresh() {
        popoverRefreshTask?.cancel()
        popoverRefreshTask = nil
    }

    // MARK: - Right-Click Menu

    private func showMenu() {
        let menu = NSMenu()

        let dashboardItem = NSMenuItem(title: Strings.openDashboard, action: #selector(openDashboard), keyEquivalent: "d")
        dashboardItem.target = self
        menu.addItem(dashboardItem)

        let settingsItem = NSMenuItem(title: "Preferences", action: #selector(openDashboardSettings), keyEquivalent: ",")
        settingsItem.target = self
        menu.addItem(settingsItem)

        menu.addItem(.separator())

        let quitItem = NSMenuItem(title: Strings.quitButton, action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        statusItem.menu = menu
        statusItem.button?.performClick(nil)
        statusItem.menu = nil
    }

    // MARK: - Menu Actions

    @objc private func openDashboard() {
        DashboardWindowController.shared.showWindow()
    }

    @objc private func openDashboardSettings() {
        DashboardWindowController.shared.showSettings()
    }

    @objc private func quit() {
        AppDelegate.requestQuit()
    }
}

private struct MenuBarPopoverView: View {
    @ObservedObject var viewModel: DashboardViewModel
    @ObservedObject var serverManager: ServerManager
    let onOpenDashboard: () -> Void
    let onOpenSettings: () -> Void
    let onOpenSession: (LiveSessionRow) -> Void
    let onSync: () -> Void
    let onClose: () -> Void
    @State private var activeFocusIndex = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var isOffline: Bool {
        !serverManager.isServerRunning || !viewModel.serverOnline
    }

    private var isFirstRun: Bool {
        viewModel.totalTokens <= 0 &&
            viewModel.todayTokens <= 0 &&
            viewModel.topModels.isEmpty &&
            viewModel.fleetData.isEmpty
    }

    private var activeSessions: [LiveSessionRow] {
        Array(viewModel.activeLiveSessions.prefix(4))
    }

    private var activeOverflowCount: Int {
        max(0, viewModel.activeLiveSessions.count - activeSessions.count)
    }

    private var activeStatusText: String {
        if isOffline { return "STALE" }
        if activeSessions.isEmpty { return "IDLE" }
        return "\(activeSessions.count) ACTIVE"
    }

    private var popoverClawdState: ClawdCompanionView.ClawdState {
        if isOffline { return .disconnected }
        if isFirstRun { return .idleLook }
        if viewModel.isSyncing { return .workingTyping }
        if activeSessions.isEmpty { return .sleeping }
        return .idleLiving
    }

    private var limitRows: [MenuBarLimitRow] {
        guard let limits = viewModel.usageLimits else { return [] }
        var rows: [MenuBarLimitRow] = []
        if limits.claude.configured {
            if let window = limits.claude.sevenDay {
                appendLimitRow(
                    to: &rows,
                    provider: "claude",
                    name: "Claude",
                    label: "7d",
                    fraction: window.utilization / 100,
                    resetDate: parseISODate(window.resetsAt)
                )
            } else if let window = limits.claude.fiveHour {
                appendLimitRow(
                    to: &rows,
                    provider: "claude",
                    name: "Claude",
                    label: "5h",
                    fraction: window.utilization / 100,
                    resetDate: parseISODate(window.resetsAt)
                )
            } else if let window = limits.claude.sevenDayOpus {
                appendLimitRow(
                    to: &rows,
                    provider: "claude",
                    name: "Claude",
                    label: "Opus",
                    fraction: window.utilization / 100,
                    resetDate: parseISODate(window.resetsAt)
                )
            }
        }
        if limits.codex.configured {
            if let window = limits.codex.primaryWindow {
                appendLimitRow(
                    to: &rows,
                    provider: "codex",
                    name: "Codex",
                    label: "5h",
                    fraction: Double(window.usedPercent) / 100,
                    resetDate: parseEpochDate(window.resetAt)
                )
            } else if let window = limits.codex.secondaryWindow {
                appendLimitRow(
                    to: &rows,
                    provider: "codex",
                    name: "Codex",
                    label: "7d",
                    fraction: Double(window.usedPercent) / 100,
                    resetDate: parseEpochDate(window.resetAt)
                )
            }
        }
        if limits.cursor.configured, let window = limits.cursor.primaryWindow {
            appendLimitRow(
                to: &rows,
                provider: "cursor",
                name: "Cursor",
                label: Strings.cursorPlanLabel,
                fraction: window.usedPercent / 100,
                resetDate: parseISODate(window.resetAt)
            )
        }
        if limits.gemini.configured, let window = limits.gemini.primaryWindow {
            appendLimitRow(
                to: &rows,
                provider: "gemini",
                name: "Gemini",
                label: limits.gemini.accountPlan ?? "Pro",
                fraction: window.usedPercent / 100,
                resetDate: parseISODate(window.resetAt)
            )
        }
        if let kimi = limits.kimi, kimi.configured, let window = kimi.primaryWindow {
            appendLimitRow(
                to: &rows,
                provider: "kimi",
                name: "Kimi",
                label: Strings.kimiWeeklyLabel,
                fraction: window.usedPercent / 100,
                resetDate: parseISODate(window.resetAt)
            )
        }
        if limits.kiro.configured, let window = limits.kiro.primaryWindow {
            appendLimitRow(
                to: &rows,
                provider: "kiro",
                name: "Kiro",
                label: limits.kiro.planName ?? Strings.kiroMonthLabel,
                fraction: window.usedPercent / 100,
                resetDate: parseISODate(window.resetAt)
            )
        }
        if let copilot = limits.copilot, copilot.configured, let window = copilot.primaryWindow {
            appendLimitRow(
                to: &rows,
                provider: "copilot",
                name: "Copilot",
                label: copilot.planName ?? "Premium",
                fraction: window.usedPercent / 100,
                resetDate: parseISODate(window.resetAt)
            )
        }
        if limits.antigravity.configured, let window = limits.antigravity.primaryWindow {
            appendLimitRow(
                to: &rows,
                provider: "antigravity",
                name: "Antigravity",
                label: limits.antigravity.accountPlan ?? "Claude",
                fraction: window.usedPercent / 100,
                resetDate: parseISODate(window.resetAt)
            )
        }
        return rows
            .sorted { lhs, rhs in
                if lhs.urgency != rhs.urgency { return lhs.urgency > rhs.urgency }
                return lhs.fraction > rhs.fraction
            }
            .prefix(3)
            .map { $0 }
    }

    private func appendLimitRow(
        to rows: inout [MenuBarLimitRow],
        provider: String,
        name: String,
        label: String,
        fraction: Double,
        resetDate: Date?
    ) {
        rows.append(
            MenuBarLimitRow(
                provider: provider,
                name: name,
                label: label,
                fraction: min(max(fraction, 0), 1),
                reset: relativeResetString(resetDate)
            )
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            if isOffline {
                offlineBody
            } else if isFirstRun {
                firstRunBody
            } else {
                todaySection
                Divider()
                activeSection
                Divider()
                limitsSection
                if !topModelRows.isEmpty {
                    Divider()
                    topModelsSection
                }
                if optimizeSummary != nil {
                    Divider()
                    optimizeSection
                }
            }
            Divider()
            footer
        }
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color(NSColor.separatorColor), lineWidth: 0.5)
        )
        .background(
            MenuBarKeyCaptureView(
                onMove: moveActiveFocus,
                onEnter: openFocusedActiveSession,
                onEscape: onClose
            )
            .frame(width: 0, height: 0)
        )
        .onExitCommand(perform: onClose)
        .onChange(of: activeSessions.map(\.id)) { _ in
            clampActiveFocus()
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            ClawdCompanionView.StateMascotView(state: popoverClawdState)
                .scaleEffect(0.34)
                .frame(width: 20, height: 20)
                .clipped()
                .accessibilityHidden(true)
            Text(Strings.appTitle)
                .font(.headline)
                .modifier(FontWeightModifier(weight: .semibold))
            Spacer()
            HStack(spacing: 5) {
                if !isOffline && !activeSessions.isEmpty {
                    MenuBarLiveDot()
                        .frame(width: 8, height: 8)
                } else {
                    Circle()
                        .fill(isOffline ? Color.statusWarning : Color.secondary.opacity(0.55))
                        .frame(width: 7, height: 7)
                }
                Text(activeStatusText)
                    .font(.caption2)
                    .modifier(FontWeightModifier(weight: .semibold))
                    .foregroundStyle(.secondary)
            }
            Menu {
                Button {
                    onOpenSettings()
                } label: {
                    Label(Strings.menuSettings, systemImage: "gearshape")
                }
                Divider()
                Button {
                    NSApp.terminate(nil)
                } label: {
                    Label("Quit VibeDeck", systemImage: "power")
                }
                .keyboardShortcut("q", modifiers: .command)
            } label: {
                Image(systemName: "gearshape")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.secondary)
                    .frame(width: 22, height: 22)
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .frame(width: 22, height: 22)
            .accessibilityLabel(Strings.menuSettings)
        }
        .frame(height: 44)
        .padding(.horizontal, 16)
    }

    private var todaySection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionLabel("TODAY")
            HStack(alignment: .lastTextBaseline, spacing: 8) {
                Text(viewModel.todayCost)
                    .id("today-cost-\(viewModel.todayCost)")
                    .font(.system(size: 28, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .transition(.opacity)
                Spacer(minLength: 8)
                HStack(alignment: .lastTextBaseline, spacing: 4) {
                    Text(TokenFormatter.formatCompact(viewModel.todayTokens))
                        .id("today-tokens-\(viewModel.todayTokens)")
                        .font(.system(size: 13, weight: .medium, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                        .transition(.opacity)
                    Text("tokens")
                        .font(.system(size: 11, weight: .regular))
                        .foregroundStyle(.secondary.opacity(0.7))
                }
            }
            .animation(NativeMotion.Ease.short(reduceMotion: reduceMotion), value: viewModel.todayCost)
            .animation(NativeMotion.Ease.short(reduceMotion: reduceMotion), value: viewModel.todayTokens)
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.panelFill)
                    Capsule()
                        .fill(Color.brand)
                        .frame(width: max(10, proxy.size.width * todayFillFraction))
                        .animation(NativeMotion.Ease.short(reduceMotion: reduceMotion), value: todayFillFraction)
                }
            }
            .frame(height: 6)
            todayProviderBreakdown
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 14)
    }

    private var todayProviderBreakdown: some View {
        let sources = viewModel.fleetData.prefix(4)
        return Group {
            if sources.isEmpty {
                EmptyView()
            } else {
                HStack(alignment: .center, spacing: 14) {
                    ForEach(sources) { source in
                        HStack(spacing: 5) {
                            ProviderLogoView(provider: source.label, size: 12)
                            Text(source.label.capitalized)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            Text("\(source.totalPercent)%")
                                .font(.system(size: 11, weight: .medium, design: .rounded))
                                .monospacedDigit()
                                .foregroundStyle(.primary.opacity(0.78))
                        }
                    }
                    Spacer(minLength: 0)
                }
            }
        }
    }

    private var activeSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionLabel("ACTIVE NOW")
            if activeSessions.isEmpty {
                Text("Nothing running right now.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 4)
            } else {
                ForEach(Array(activeSessions.enumerated()), id: \.element.id) { index, session in
                    Button {
                        activeFocusIndex = index
                        onOpenSession(session)
                    } label: {
                        HStack(alignment: .center, spacing: 10) {
                            MenuBarLiveDot()
                            ProviderLogoView(provider: session.provider ?? "", size: 14)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(session.displayProvider)
                                    .font(.caption)
                                    .modifier(FontWeightModifier(weight: .medium))
                                Text(session.displayContext)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                            }
                            Spacer(minLength: 8)
                            VStack(alignment: .trailing, spacing: 2) {
                                Text(session.displayCost)
                                    .font(.system(size: 12, weight: .medium, design: .rounded))
                                    .monospacedDigit()
                                Text("session total")
                                    .font(.system(size: 10))
                                    .foregroundStyle(.secondary.opacity(0.75))
                            }
                        }
                        .contentShape(Rectangle())
                        .frame(height: 38)
                        .padding(.horizontal, 8)
                        .background(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .fill(index == activeFocusIndex ? Color.brand.opacity(0.10) : Color.clear)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .stroke(index == activeFocusIndex ? Color.brand.opacity(0.35) : Color.clear, lineWidth: 0.5)
                        )
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Open \(session.displayProvider) session \(session.displayContext)")
                }
                if activeOverflowCount > 0 {
                    Text("(+\(activeOverflowCount) more)")
                        .font(.caption)
                        .foregroundStyle(Color.brand)
                        .frame(height: 24)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private var limitsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionLabel("LIMITS")
            if limitRows.isEmpty {
                Text("No limits configured yet.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 4)
            } else if limitRows.allSatisfy({ $0.fraction < 0.5 }) {
                HStack(alignment: .center, spacing: 10) {
                    Text("Plenty of headroom")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer(minLength: 8)
                    HStack(spacing: 8) {
                        ForEach(limitRows) { row in
                            HStack(spacing: 5) {
                                ProviderLogoView(provider: row.provider, size: 11)
                                Capsule()
                                    .fill(Color.limitTrack)
                                    .frame(width: 28, height: 4)
                                    .overlay(
                                        GeometryReader { proxy in
                                            Capsule()
                                                .fill(Color.limitBar(fraction: row.fraction))
                                                .frame(width: max(2, proxy.size.width * row.fraction))
                                        }
                                    )
                                Text("\(Int((row.fraction * 100).rounded()))%")
                                    .font(.system(size: 10, weight: .medium, design: .rounded))
                                    .monospacedDigit()
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                .padding(.vertical, 2)
            } else {
                ForEach(limitRows) { row in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            ProviderLogoView(provider: row.provider, size: 14)
                            Text(row.name)
                                .font(.caption)
                                .modifier(FontWeightModifier(weight: .medium))
                            Spacer()
                            Text("\(Int((row.fraction * 100).rounded()))%")
                                .font(.system(size: 12, weight: .medium, design: .rounded))
                                .monospacedDigit()
                        }
                        GeometryReader { proxy in
                            ZStack(alignment: .leading) {
                                Capsule().fill(Color.limitTrack)
                                Capsule()
                                    .fill(Color.limitBar(fraction: row.fraction))
                                    .frame(width: max(4, proxy.size.width * row.fraction))
                                    .animation(NativeMotion.Ease.short(reduceMotion: reduceMotion), value: row.fraction)
                            }
                        }
                        .frame(height: 6)
                        Text(row.reset)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .frame(height: 40)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(row.name) \(row.label), \(Int((row.fraction * 100).rounded())) percent used, \(row.reset)")
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private var topModelRows: [TopModel] {
        Array(viewModel.topModels.prefix(3))
    }

    private var topModelsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionLabel("TOP MODELS")
            ForEach(topModelRows) { model in
                HStack(spacing: 8) {
                    ProviderLogoView(provider: model.source, size: 12)
                    Text(model.name)
                        .font(.caption)
                        .modifier(FontWeightModifier(weight: .medium))
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Spacer(minLength: 8)
                    Text("\(model.percent)%")
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                .frame(height: 18)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(model.name), \(model.percent) percent of tokens")
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private struct OptimizeSummary {
        let findingCount: Int
        let monthlySavingsUsd: Double
        let healthGrade: String?
    }

    private var optimizeSummary: OptimizeSummary? {
        guard let response = viewModel.optimizeFindings else { return nil }
        let findings = response.findings
        let savings = findings.reduce(0.0) { $0 + max(0, $1.estimatedCostWasteUsd) }
        // Hide the section when there's nothing yet — scan hasn't run, no findings, no savings.
        if findings.isEmpty && (response.health?.healthGrade ?? "-") == "-" {
            return nil
        }
        return OptimizeSummary(
            findingCount: findings.count,
            monthlySavingsUsd: savings,
            healthGrade: response.health?.healthGrade
        )
    }

    private var optimizeSection: some View {
        guard let summary = optimizeSummary else {
            return AnyView(EmptyView())
        }
        return AnyView(
            VStack(alignment: .leading, spacing: 8) {
                sectionLabel("OPTIMIZE")
                HStack(alignment: .center, spacing: 10) {
                    if summary.findingCount == 0 {
                        Text("No findings open")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("\(summary.findingCount) \(summary.findingCount == 1 ? "finding" : "findings")")
                            .font(.caption)
                            .modifier(FontWeightModifier(weight: .medium))
                    }
                    Spacer(minLength: 8)
                    if summary.monthlySavingsUsd > 0 {
                        Text(savingsLabel(summary.monthlySavingsUsd))
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(Color.brand)
                    } else if let grade = summary.healthGrade, grade != "-" {
                        Text("Grade \(grade)")
                            .font(.system(size: 11, weight: .medium, design: .rounded))
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(height: 22)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(optimizeAccessibilityLabel(summary))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        )
    }

    private func savingsLabel(_ usd: Double) -> String {
        if usd >= 100 {
            return String(format: "$%.0f / mo potential", usd)
        }
        return String(format: "$%.2f / mo potential", usd)
    }

    private func optimizeAccessibilityLabel(_ summary: OptimizeSummary) -> String {
        var parts: [String] = []
        if summary.findingCount > 0 {
            parts.append("\(summary.findingCount) optimize \(summary.findingCount == 1 ? "finding" : "findings")")
        } else {
            parts.append("No optimize findings open")
        }
        if summary.monthlySavingsUsd > 0 {
            parts.append("estimated \(savingsLabel(summary.monthlySavingsUsd))")
        }
        return parts.joined(separator: ", ")
    }

    private var offlineBody: some View {
        VStack(spacing: 12) {
            ClawdCompanionView.StateMascotView(state: .disconnected)
                .scaleEffect(0.8)
                .frame(width: 56, height: 56)
                .clipped()
                .accessibilityHidden(true)
            Text(Strings.serverOfflineTitle)
                .font(.headline)
            Text(Strings.serverOfflineBody)
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button {
                Task {
                    await serverManager.retry()
                    if serverManager.isServerRunning {
                        await viewModel.loadAll()
                    }
                }
            } label: {
                Text(Strings.retryButton)
            }
            .buttonStyle(.borderedProminent)
            .tint(Color.brand)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28)
        .padding(.horizontal, 16)
    }

    private var firstRunBody: some View {
        VStack(spacing: 12) {
            ClawdCompanionView.StateMascotView(state: .idleLook)
                .scaleEffect(0.8)
                .frame(width: 56, height: 56)
                .clipped()
                .accessibilityHidden(true)
            Text("Run any AI tool to start tracking")
                .font(.headline)
                .multilineTextAlignment(.center)
            Text("VibeDeck will populate today's totals, active sessions, and provider limits after the first local session syncs.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button {
                onOpenSettings()
            } label: {
                Text("Open setup")
            }
            .buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28)
        .padding(.horizontal, 16)
    }

    private var footer: some View {
        HStack(spacing: 8) {
            Button(Strings.openDashboard) {
                onOpenDashboard()
            }
            .buttonStyle(.borderedProminent)
            .keyboardShortcut("o", modifiers: .command)
            .tint(Color.brand)
            .frame(maxWidth: .infinity)
            Button {
                onSync()
            } label: {
                HStack(spacing: 5) {
                    if viewModel.isSyncing {
                        MenuBarSyncIcon(isSyncing: true, reduceMotion: reduceMotion)
                        Text("Syncing...")
                    } else {
                        MenuBarSyncIcon(isSyncing: false, reduceMotion: reduceMotion)
                        Text("Sync")
                    }
                }
            }
            .buttonStyle(.bordered)
            .keyboardShortcut("r", modifiers: .command)
            .disabled(viewModel.isSyncing || isOffline)
            .frame(maxWidth: .infinity)
        }
        .frame(height: 44)
        .padding(.horizontal, 16)
    }

    private var todayFillFraction: Double {
        let reference = max(viewModel.last7dTokens / max(viewModel.last7dActiveDays, 1), 1)
        return min(max(Double(viewModel.todayTokens) / Double(reference), 0.08), 1.0)
    }

    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .font(.caption2)
            .modifier(FontWeightModifier(weight: .semibold))
            .foregroundStyle(.secondary)
            .textCase(.uppercase)
            .modifier(TrackingModifier(value: 0.5))
    }

    private func moveActiveFocus(_ direction: MenuBarKeyDirection) {
        guard !activeSessions.isEmpty else { return }
        switch direction {
        case .up:
            activeFocusIndex = max(0, activeFocusIndex - 1)
        case .down:
            activeFocusIndex = min(activeSessions.count - 1, activeFocusIndex + 1)
        }
    }

    private func openFocusedActiveSession() {
        guard activeSessions.indices.contains(activeFocusIndex) else { return }
        onOpenSession(activeSessions[activeFocusIndex])
    }

    private func parseISODate(_ value: String?) -> Date? {
        guard let value else { return nil }
        let withFractional = ISO8601DateFormatter()
        withFractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFractional.date(from: value) {
            return date
        }
        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        return standard.date(from: value)
    }

    private func parseEpochDate(_ value: Int?) -> Date? {
        guard let value else { return nil }
        return Date(timeIntervalSince1970: TimeInterval(value))
    }

    private func relativeResetString(_ date: Date?) -> String {
        guard let date else { return "reset unknown" }
        let interval = date.timeIntervalSince(Date())
        guard interval > 0 else { return "resets now" }
        if interval < 3600 {
            return "resets in \(max(1, Int(interval / 60)))m"
        }
        if interval < 86400 {
            let hours = Int(interval / 3600)
            let minutes = Int((interval.truncatingRemainder(dividingBy: 3600)) / 60)
            if minutes == 0 {
                return "resets in \(hours)h"
            }
            return "resets in \(hours)h \(minutes)m"
        }
        return "resets in \(Int(interval / 86400))d"
    }

    private func clampActiveFocus() {
        guard !activeSessions.isEmpty else {
            activeFocusIndex = 0
            return
        }
        activeFocusIndex = min(max(activeFocusIndex, 0), activeSessions.count - 1)
    }
}

private enum MenuBarKeyDirection {
    case up
    case down
}

private struct MenuBarKeyCaptureView: NSViewRepresentable {
    let onMove: (MenuBarKeyDirection) -> Void
    let onEnter: () -> Void
    let onEscape: () -> Void

    func makeNSView(context: Context) -> KeyCaptureNSView {
        let view = KeyCaptureNSView()
        view.onMove = onMove
        view.onEnter = onEnter
        view.onEscape = onEscape
        DispatchQueue.main.async {
            view.window?.makeFirstResponder(view)
        }
        return view
    }

    func updateNSView(_ nsView: KeyCaptureNSView, context: Context) {
        nsView.onMove = onMove
        nsView.onEnter = onEnter
        nsView.onEscape = onEscape
        DispatchQueue.main.async {
            nsView.window?.makeFirstResponder(nsView)
        }
    }

    final class KeyCaptureNSView: NSView {
        var onMove: ((MenuBarKeyDirection) -> Void)?
        var onEnter: (() -> Void)?
        var onEscape: (() -> Void)?

        override var acceptsFirstResponder: Bool { true }

        override func keyDown(with event: NSEvent) {
            guard event.modifierFlags.intersection(.deviceIndependentFlagsMask).isDisjoint(with: .command) else {
                super.keyDown(with: event)
                return
            }

            switch event.keyCode {
            case 36, 76:
                onEnter?()
            case 53:
                onEscape?()
            case 125:
                onMove?(.down)
            case 126:
                onMove?(.up)
            default:
                super.keyDown(with: event)
            }
        }
    }
}

private struct MenuBarLiveDot: View {
    @State private var isBright = true

    private var reduceMotion: Bool {
        NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    }

    var body: some View {
        Circle()
            .fill(Color.brand)
            .frame(width: 8, height: 8)
            .opacity(reduceMotion ? 1 : (isBright ? 1 : 0.6))
            .onAppear {
                guard !reduceMotion else { return }
                isBright = false
            }
            .animation(
                reduceMotion
                    ? nil
                    : NativeMotion.Ease.linear(duration: 0.8).repeatForever(autoreverses: true),
                value: isBright
            )
    }
}

private struct MenuBarSyncIcon: View {
    let isSyncing: Bool
    let reduceMotion: Bool
    @State private var rotation = 0.0

    var body: some View {
        Image(systemName: isSyncing ? "arrow.triangle.2.circlepath" : "arrow.clockwise")
            .font(.system(size: 11, weight: .semibold))
            .frame(width: 12, height: 12)
            .rotationEffect(.degrees(rotation))
            .onAppear {
                updateRotation()
            }
            .onChange(of: isSyncing) { _ in
                updateRotation()
            }
            .animation(NativeMotion.syncSpin(reduceMotion: reduceMotion), value: rotation)
    }

    private func updateRotation() {
        guard isSyncing, !reduceMotion else {
            rotation = 0
            return
        }
        rotation = 360
    }
}

private struct MenuBarLimitRow: Identifiable {
    var id: String { "\(provider)-\(label)" }
    let provider: String
    let name: String
    let label: String
    let fraction: Double
    let reset: String

    var urgency: Int {
        if fraction >= 0.9 { return 3 }
        if fraction >= 0.7 { return 2 }
        return 1
    }
}
