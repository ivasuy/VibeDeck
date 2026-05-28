import ServiceManagement
import SwiftUI
import WidgetKit

@main
struct VibeDeckMacApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        Settings {
            NativeSettingsView()
        }
        .commands {
            CommandGroup(after: .toolbar) {
                Button("Cycle Appearance") {
                    NativeAppearancePreference.cycle()
                }
                .keyboardShortcut("L", modifiers: [.command, .shift])
            }
        }
    }
}

@MainActor
enum NativeAppearancePreference: String, CaseIterable {
    case system
    case light
    case dark

    static let storageKey = "theme"

    var title: String {
        switch self {
        case .system: return "System"
        case .light: return "Light"
        case .dark: return "Dark"
        }
    }

    static var current: NativeAppearancePreference {
        normalize(UserDefaults.standard.string(forKey: storageKey))
    }

    static func normalize(_ raw: String?) -> NativeAppearancePreference {
        switch String(raw ?? "").lowercased() {
        case "light": return .light
        case "dark": return .dark
        default: return .system
        }
    }

    static func set(_ preference: NativeAppearancePreference) {
        UserDefaults.standard.set(preference.rawValue, forKey: storageKey)
        DashboardWindowController.shared.setNativeThemePreference(preference.rawValue)
    }

    static func cycle() {
        switch current {
        case .system: set(.light)
        case .light: set(.dark)
        case .dark: set(.system)
        }
    }

    static func resolvedIsDark(for preference: NativeAppearancePreference) -> Bool {
        switch preference {
        case .dark:
            return true
        case .light:
            return false
        case .system:
            return NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        }
    }

    static func preferredColorScheme(for preference: NativeAppearancePreference) -> ColorScheme? {
        switch preference {
        case .system:
            return nil
        case .light:
            return .light
        case .dark:
            return .dark
        }
    }
}

struct NativeSettingsView: View {
    @AppStorage(NativeAppearancePreference.storageKey) private var theme = NativeAppearancePreference.system.rawValue
    @AppStorage("MenuBarShowStats") private var showMenuBarStats = true
    @AppStorage("MenuBarAnimationEnabled") private var animateMenuBarIcon = true
    @AppStorage("vibedeck.displayCurrency") private var displayCurrency = "USD"
    @State private var selectedSection: NativeSettingsSection = .appearance
    @State private var menuBarItems = MenuBarDisplayPreferences.read()
    @State private var launchAtLogin = false
    @State private var updateStatus = UpdateChecker.shared.statusText

    private let displayCurrencies = ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "INR"]

    private var preference: NativeAppearancePreference {
        NativeAppearancePreference.normalize(theme)
    }

    var body: some View {
        HStack(spacing: 0) {
            settingsSidebar

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(selectedSection.title)
                                .font(.title2)
                                .modifier(FontWeightModifier(weight: .semibold))
                            Text(selectedSection.subtitle)
                                .font(.callout)
                                .foregroundStyle(.secondary)
                        }

                        Spacer()
                    }
                    .padding(.bottom, 4)

                    selectedSectionContent
                }
                .padding(24)
                .frame(maxWidth: 720, alignment: .leading)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(Color(NSColor.textBackgroundColor).opacity(0.35))
        }
        .frame(minWidth: 760, idealWidth: 860, minHeight: 560, idealHeight: 620)
        .preferredColorScheme(NativeAppearancePreference.preferredColorScheme(for: preference))
        .onAppear {
            refreshLaunchAtLogin()
            menuBarItems = MenuBarDisplayPreferences.read()
        }
        .onChange(of: showMenuBarStats) { _ in
            NotificationCenter.default.post(name: .nativeSettingsChanged, object: nil)
            NativeBridge.shared.pushSettings()
        }
        .onChange(of: animateMenuBarIcon) { _ in
            NotificationCenter.default.post(name: .nativeSettingsChanged, object: nil)
            NativeBridge.shared.pushSettings()
        }
    }

    private var settingsSidebar: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Settings")
                .font(.caption)
                .modifier(FontWeightModifier(weight: .semibold))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
                .modifier(TrackingModifier(value: 0.5))
                .padding(.horizontal, 12)
                .padding(.bottom, 6)

            ForEach(NativeSettingsSection.allCases) { section in
                Button {
                    withAnimation(NativeMotion.Ease.short()) {
                        selectedSection = section
                    }
                } label: {
                    HStack(spacing: 9) {
                        Image(systemName: section.systemImage)
                            .font(.system(size: 13, weight: .semibold))
                            .frame(width: 18)
                        Text(section.title)
                            .font(.callout)
                            .modifier(FontWeightModifier(weight: selectedSection == section ? .semibold : .regular))
                        Spacer()
                    }
                    .foregroundStyle(selectedSection == section ? Color.primary : Color.secondary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                    .background(
                        RoundedRectangle(cornerRadius: 7)
                            .fill(selectedSection == section ? Color.panelFillStrong : Color.clear)
                    )
                    .overlay(alignment: .leading) {
                        Capsule()
                            .fill(selectedSection == section ? Color.brand600 : Color.clear)
                            .frame(width: 3)
                    }
                }
                .buttonStyle(.plain)
            }

            Spacer()
        }
        .padding(14)
        .frame(width: 200)
        .frame(maxHeight: .infinity, alignment: .topLeading)
        .background(Color.chromeBottom)
    }

    @ViewBuilder
    private var selectedSectionContent: some View {
        switch selectedSection {
        case .account:
            accountSection
        case .appearance:
            appearanceSection
        case .providers:
            providersSection
        case .menuBar:
            menuBarSection
        case .advanced:
            advancedSection
        case .privacy:
            privacySection
        }
    }

    private var accountSection: some View {
        NativeSettingsRows {
            NativeSettingsRow(title: "Mode", detail: "Local app") {
                Text("No cloud account")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            NativeSettingsRow(title: "Launch", detail: launchAtLoginSupportedText) {
                Toggle("", isOn: Binding(
                    get: { launchAtLogin },
                    set: setLaunchAtLogin
                ))
                .labelsHidden()
                .disabled(!launchAtLoginSupported)
            }
        }
    }

    private var appearanceSection: some View {
        NativeSettingsRows {
            NativeSettingsRow(title: "Theme", detail: "Controls native chrome and dashboard theme handoff.") {
                Picker("Theme", selection: $theme) {
                    ForEach(NativeAppearancePreference.allCases, id: \.rawValue) { preference in
                        Text(preference.title).tag(preference.rawValue)
                    }
                }
                .labelsHidden()
                .pickerStyle(.segmented)
                .frame(width: 240)
                .onChange(of: theme) { newValue in
                    NativeAppearancePreference.set(NativeAppearancePreference.normalize(newValue))
                }
            }

            NativeSettingsRow(title: "Display currency", detail: "UI conversion only. Export cost columns stay in USD.") {
                Picker("Display currency", selection: $displayCurrency) {
                    ForEach(displayCurrencies, id: \.self) { currency in
                        Text(currency).tag(currency)
                    }
                }
                .labelsHidden()
                .pickerStyle(.menu)
                .frame(width: 120)
                .onChange(of: displayCurrency) { currency in
                    Task {
                        _ = try? await APIClient.shared.fetchCurrencyRates(currency: currency)
                    }
                }
            }
        }
    }

    private var providersSection: some View {
        NativeSettingsRows {
            VStack(alignment: .leading, spacing: 10) {
                NativeSettingsSectionLabel(
                    title: "Provider order",
                    detail: "Drag to reorder limit rows and hide providers from native limit panels."
                )

                LimitsSettingsView(store: LimitsSettingsStore.shared, showsTitle: false)
            }
            .padding(.vertical, 4)
        }
    }

    private var menuBarSection: some View {
        NativeSettingsRows {
            NativeSettingsRow(title: "Stats in menu bar", detail: "Show up to two compact values next to the mark.") {
                Toggle("", isOn: $showMenuBarStats)
                    .labelsHidden()
            }

            NativeSettingsRow(title: "Animated mark", detail: "Use the native reduced-motion preference when disabled.") {
                Toggle("", isOn: $animateMenuBarIcon)
                    .labelsHidden()
            }

            VStack(alignment: .leading, spacing: 10) {
                NativeSettingsSectionLabel(
                    title: "Visible metrics",
                    detail: "Pick exactly two values. The menu bar trims unknown or duplicate choices."
                )

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 190), spacing: 10)], spacing: 10) {
                    ForEach(MenuBarDisplayMetric.allCases, id: \.rawValue) { metric in
                        NativeMenuBarMetricToggle(
                            metric: metric,
                            isSelected: menuBarItems.contains(metric.rawValue),
                            isDisabled: !menuBarItems.contains(metric.rawValue)
                                && menuBarItems.count >= MenuBarDisplayPreferences.maxVisibleItems
                        ) {
                            toggleMenuBarMetric(metric.rawValue)
                        }
                    }
                }
            }
            .padding(.vertical, 4)
        }
    }

    private var advancedSection: some View {
        NativeSettingsRows {
            NativeSettingsRow(title: "Update check", detail: updateStatus ?? "Use the app's bundled update checker.") {
                Button("Check Now") {
                    UpdateChecker.shared.check(silent: false)
                    updateStatus = UpdateChecker.shared.statusText
                    NativeBridge.shared.pushSettings()
                }
                .buttonStyle(.borderedProminent)
            }

            NativeSettingsRow(title: "Widget timelines", detail: "Refresh all VibeDeck WidgetKit snapshots.") {
                Button("Reload Widgets") {
                    WidgetCenter.shared.reloadAllTimelines()
                }
            }

            NativeSettingsRow(title: "Diagnostics", detail: "~/Library/Application Support/VibeDeck/logs") {
                Button("Open Logs") {
                    openLogsFolder()
                }
            }
        }
    }

    private var privacySection: some View {
        NativeSettingsRows {
            NativeSettingsRow(title: "Storage", detail: "Usage data stays on this Mac in the local VibeDeck ledger.") {
                Text("Local only")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            NativeSettingsRow(title: "Prompts", detail: "The dashboard stores command and prompt hashes, not prompt bodies.") {
                Text("Hashes only")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            NativeSettingsRow(title: "Widgets", detail: "Widgets read the shared local snapshot file and never show sign-in state.") {
                Text("Snapshot")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var launchAtLoginSupported: Bool {
        if #available(macOS 13, *) { return true }
        return false
    }

    private var launchAtLoginSupportedText: String {
        launchAtLoginSupported ? "Start VibeDeck when you log in." : "Requires macOS 13 or newer."
    }

    private func refreshLaunchAtLogin() {
        guard #available(macOS 13, *) else {
            launchAtLogin = false
            return
        }
        launchAtLogin = SMAppService.mainApp.status == .enabled
    }

    private func setLaunchAtLogin(_ enabled: Bool) {
        guard #available(macOS 13, *) else { return }
        do {
            if enabled {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
        } catch {
            refreshLaunchAtLogin()
            return
        }
        refreshLaunchAtLogin()
        NativeBridge.shared.pushSettings()
    }

    private func toggleMenuBarMetric(_ id: String) {
        var next = menuBarItems
        if let index = next.firstIndex(of: id) {
            guard next.count > 1 else { return }
            next.remove(at: index)
        } else {
            guard next.count < MenuBarDisplayPreferences.maxVisibleItems else { return }
            next.append(id)
        }

        MenuBarDisplayPreferences.write(next)
        menuBarItems = MenuBarDisplayPreferences.read()
        NotificationCenter.default.post(name: .nativeSettingsChanged, object: nil)
        NativeBridge.shared.pushSettings()
    }

    private func openLogsFolder() {
        let url = FileManager.default
            .homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/VibeDeck/logs", isDirectory: true)
        NSWorkspace.shared.open(url)
    }
}

private enum NativeSettingsSection: String, CaseIterable, Identifiable {
    case account
    case appearance
    case providers
    case menuBar
    case advanced
    case privacy

    var id: String { rawValue }

    var title: String {
        switch self {
        case .account: return "Account"
        case .appearance: return "Appearance"
        case .providers: return "Providers"
        case .menuBar: return "Menu Bar"
        case .advanced: return "Advanced"
        case .privacy: return "Privacy"
        }
    }

    var subtitle: String {
        switch self {
        case .account:
            return "Local app behavior and launch settings."
        case .appearance:
            return "Theme, display currency, and visual preferences."
        case .providers:
            return "Provider visibility and limit ordering."
        case .menuBar:
            return "Compact status item values and animation."
        case .advanced:
            return "Updates, widgets, and diagnostics."
        case .privacy:
            return "Local storage and data handling."
        }
    }

    var systemImage: String {
        switch self {
        case .account: return "person.crop.circle"
        case .appearance: return "circle.lefthalf.filled"
        case .providers: return "square.stack.3d.up"
        case .menuBar: return "menubar.rectangle"
        case .advanced: return "slider.horizontal.3"
        case .privacy: return "lock"
        }
    }
}

private struct NativeSettingsRows<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            content()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(Color.panelFill)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color.panelBorder, lineWidth: 1)
        )
    }
}

private struct NativeSettingsRow<Accessory: View>: View {
    let title: String
    let detail: String
    @ViewBuilder let accessory: () -> Accessory

    var body: some View {
        HStack(alignment: .center, spacing: 18) {
            NativeSettingsSectionLabel(title: title, detail: detail)

            Spacer(minLength: 16)

            accessory()
                .frame(minWidth: 96, alignment: .trailing)
        }
        .padding(.vertical, 10)
        .overlay(alignment: .bottom) {
            Divider()
                .opacity(0.45)
        }
    }
}

private struct NativeSettingsSectionLabel: View {
    let title: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.callout)
                .modifier(FontWeightModifier(weight: .semibold))
            Text(detail)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct NativeMenuBarMetricToggle: View {
    let metric: MenuBarDisplayMetric
    let isSelected: Bool
    let isDisabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 9) {
                ZStack {
                    RoundedRectangle(cornerRadius: 5)
                        .fill(isSelected ? Color.brand600 : Color.clear)
                        .overlay(
                            RoundedRectangle(cornerRadius: 5)
                                .stroke(isSelected ? Color.brand600 : Color.panelBorder, lineWidth: 1)
                        )
                        .frame(width: 18, height: 18)

                    if isSelected {
                        Image(systemName: "checkmark")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(.white)
                    }
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text(metric.settingsTitle)
                        .font(.caption)
                        .modifier(FontWeightModifier(weight: .semibold))
                    Text(metric.menuLabel)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 0)
            }
            .padding(10)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(isSelected ? Color.panelFillStrong : Color.clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color.panelBorder, lineWidth: 1)
            )
            .opacity(isDisabled ? 0.45 : 1)
        }
        .buttonStyle(.plain)
        .disabled(isDisabled)
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {

    private var statusBarController: StatusBarController?
    private let viewModel = DashboardViewModel()
    private let serverManager = ServerManager()
    private let launchAtLoginManager = LaunchAtLoginManager()
    private static var userInitiatedQuit = false

    /// Real quit path: popover/Footer Quit buttons, NativeBridge "quit", UpdateChecker relaunch.
    /// Cmd+Q from the dashboard window goes through `applicationShouldTerminate` and is downgraded
    /// to a window-close so the menu bar item stays alive.
    static func requestQuit() {
        userInitiatedQuit = true
        NSApp.terminate(nil)
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if Self.userInitiatedQuit { return .terminateNow }
        // Switch to accessory BEFORE closing the window so the Dock icon drops
        // immediately; otherwise AppKit delays the update until focus changes.
        NSApp.setActivationPolicy(.accessory)
        DashboardWindowController.shared.closeWindow()
        // Hide after the close animation completes (next runloop).
        DispatchQueue.main.async { NSApp.hide(nil) }
        return .terminateCancel
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusBarController = StatusBarController(
            viewModel: viewModel,
            serverManager: serverManager,
            launchAtLoginManager: launchAtLoginManager
        )

        NativeBridge.shared.configure(
            viewModel: viewModel,
            launchAtLoginManager: launchAtLoginManager
        )
        DashboardWindowController.shared.configure(
            viewModel: viewModel,
            serverManager: serverManager
        )

        Task { @MainActor in
            await serverManager.ensureServerRunning()
            if serverManager.isServerRunning {
                await viewModel.syncThenLoad()
                viewModel.startAutoRefresh()
            }

            UpdateChecker.shared.check(silent: true)
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        serverManager.stopServer()
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls {
            guard url.scheme == "vibedeck" else { continue }
            if url.host == "auth" && url.path.hasPrefix("/done") {
                DashboardWindowController.shared.handleAuthDone()
            } else if url.host == "auth" && url.path.hasPrefix("/callback") {
                // Browser relays OAuth code back via vibedeck://auth/callback?code=xxx
                let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
                let code = components?.queryItems?.first(where: { $0.name == "code" })?.value
                if let code {
                    DashboardWindowController.shared.handleAuthCallback(code: code)
                }
            } else if url.host == "widget" || url.host == "open" {
                let slug = url.pathComponents.dropFirst().first ?? "dashboard"
                if let destination = NativeDashboardDestination.deepLinkDestination(for: slug) {
                    DashboardWindowController.shared.show(destination: destination)
                }
            }
        }
    }
}
