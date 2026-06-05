import AppKit
import SwiftUI
import WebKit
import WidgetKit

@MainActor
final class DashboardWindowController: NSObject, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {


    private enum DashboardChromeMetrics {

        static let approxWindowOuterCornerRadius: CGFloat = 28
        static let mainGutterPoints: CGFloat = 12
        static var mainCardCornerRadiusPixels: Int {
            Int(max(8, approxWindowOuterCornerRadius - mainGutterPoints))
        }
    }

    static let shared = DashboardWindowController()


    var windowForSheet: NSWindow? { window }

    private var window: NSWindow?

    private var chromeFollowsSystem = false
    private var effectiveAppearanceObservation: NSKeyValueObservation?
    private var webView: WKWebView?
    private var loadingOverlay: NSView?
    private var loadingHostingController: NSHostingController<AnyView>?
    private var shellHostingController: NSHostingController<AnyView>?
    private weak var dashboardViewModel: DashboardViewModel?
    private weak var serverManager: ServerManager?

    private var retryCount = 0
    private let maxRetries = 5

    /// Shared process pool — ensures cookies are consistent across webView recreations
    private static let sharedProcessPool = WKProcessPool()

    private override init() {
        super.init()
    }

    // MARK: - Public

    func configure(viewModel: DashboardViewModel, serverManager: ServerManager) {
        dashboardViewModel = viewModel
        self.serverManager = serverManager
    }

    func showWindow() {

        for window in NSApp.windows where window.className.contains("Popover") {
            window.close()
        }

        // Reuse existing window if possible
        if let window {
            NSApp.setActivationPolicy(.regular)
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            syncChromeAppearanceFromWebView()
            injectMainCardCornerRadius()
            return
        }

        // Create WKWebView with persistent data store and shared process pool
        let contentController = WKUserContentController()
        contentController.add(self, name: "nativeOAuth")
        contentController.add(self, name: "nativeBridge")
        // Earliest paint: transparent root so NSVisualEffectView is visible (index.html also sets native-app via nativeBridge).
        let nativeThemePreference = NativeAppearancePreference.current.rawValue
        let transparencyBootstrap = """
        (function(){
          try {
            var nativeTheme = '\(nativeThemePreference)';
            if (nativeTheme === 'light' || nativeTheme === 'dark' || nativeTheme === 'system') {
              localStorage.setItem('vd-theme', nativeTheme);
              localStorage.removeItem('vibedeck-theme');
            }
          } catch (e) {}
          document.documentElement.classList.add('native-app');
          var s=document.createElement('style');
          s.textContent='html,html.dark{background:transparent!important}body{background:transparent!important}';
          (document.head||document.documentElement).appendChild(s);
        })();
        """
        let bootstrapScript = WKUserScript(
            source: transparencyBootstrap,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        contentController.addUserScript(bootstrapScript)
        let webConfig = WKWebViewConfiguration()
        webConfig.userContentController = contentController
        webConfig.processPool = Self.sharedProcessPool
        webConfig.websiteDataStore = WKWebsiteDataStore.default()
        let webView = WKWebView(frame: .zero, configuration: webConfig)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.setValue(false, forKey: "drawsBackground")
        self.webView = webView

        // Container: Liquid Glass (macOS 26+) or NSVisualEffectView under a transparent WKWebView (sidebar + chrome see through).
        let container = NSView()
        container.wantsLayer = true
        container.layer?.backgroundColor = NSColor.clear.cgColor

        let dashboardBackground = DashboardBackgroundView.makeFullWindowBackground()
        container.addSubview(dashboardBackground)

        let shellHosting = NSHostingController(
            rootView: AnyView(NativeDashboardShellView(
                webView: webView,
                viewModel: dashboardViewModel,
                serverManager: serverManager,
                onNavigate: { [weak self] destination in
                    self?.navigate(to: destination)
                },
                onReload: { [weak self] in
                    self?.reload()
                },
                onSyncNow: { [weak self] in
                    guard let viewModel = self?.dashboardViewModel else { return }
                    Task { @MainActor in
                        await viewModel.triggerSync()
                    }
                }
            ))
        )
        self.shellHostingController = shellHosting
        shellHosting.view.translatesAutoresizingMaskIntoConstraints = false
        shellHosting.view.wantsLayer = true
        shellHosting.view.layer?.backgroundColor = NSColor.clear.cgColor
        container.addSubview(shellHosting.view)

        NSLayoutConstraint.activate([
            dashboardBackground.topAnchor.constraint(equalTo: container.topAnchor),
            dashboardBackground.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            dashboardBackground.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            dashboardBackground.trailingAnchor.constraint(equalTo: container.trailingAnchor),
        ])

        // Titlebar drag area — transparent, sits above webView so window is draggable
        let dragBar = TitlebarDragView()
        dragBar.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(dragBar)

        // Loading overlay with the same structured instrument panel used by native startup states.
        let overlay = makeLoadingOverlay()
        overlay.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(overlay)
        self.loadingOverlay = overlay

        NSLayoutConstraint.activate([
            shellHosting.view.topAnchor.constraint(equalTo: container.topAnchor),
            shellHosting.view.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            shellHosting.view.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            shellHosting.view.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            dragBar.topAnchor.constraint(equalTo: container.topAnchor),
            dragBar.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            dragBar.trailingAnchor.constraint(equalTo: container.trailingAnchor),

            dragBar.heightAnchor.constraint(equalToConstant: 28),
            overlay.topAnchor.constraint(equalTo: container.topAnchor),
            overlay.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            overlay.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            overlay.trailingAnchor.constraint(equalTo: container.trailingAnchor),
        ])

        // Create window
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1100, height: 720),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.minSize = NSSize(width: 960, height: 640)
        window.title = "VibeDeck"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        let toolbar = NSToolbar(identifier: "DashboardToolbar")
        toolbar.showsBaselineSeparator = false
        window.toolbar = toolbar
        window.toolbarStyle = .unifiedCompact
        window.contentView = container
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.setFrameAutosaveName("DashboardWindow")
        window.center()
        // Clear window so native glass / vibrancy + transparent WKWebView show material (not an opaque gray sheet).
        window.isOpaque = false
        window.backgroundColor = .clear
        self.window = window

        // Wire bridge so SettingsPage can read/write menu-bar prefs
        NativeBridge.shared.webView = webView



        registerEffectiveAppearanceObserverIfNeeded()

        // Load dashboard
        retryCount = 0
        if let url = URL(string: Constants.serverBaseURL + "?app=1") {
            webView.load(URLRequest(url: url))
        }

        // Switch to regular app (shows dock icon), then show window
        NSApp.setActivationPolicy(.regular)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func reload() {
        retryCount = 0
        webView?.reload()
    }

    func show(destination: NativeDashboardDestination) {
        showWindow()
        navigate(to: destination)
    }

    func showLiveSession(provider: String?, sessionID: String?) {
        showWindow()

        let trimmedProvider = provider?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let trimmedSessionID = sessionID?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        var components = URLComponents(string: Constants.serverBaseURL + NativeDashboardDestination.live.path)
        var queryItems = [URLQueryItem(name: "app", value: "1")]
        if !trimmedProvider.isEmpty, !trimmedSessionID.isEmpty {
            queryItems.append(URLQueryItem(name: "session", value: "\(trimmedProvider):\(trimmedSessionID)"))
        }
        components?.queryItems = queryItems
        if let url = components?.url {
            webView?.load(URLRequest(url: url))
        }
    }

    private func navigate(to destination: NativeDashboardDestination) {
        retryCount = 0
        if let url = URL(string: Constants.serverBaseURL + destination.path + "?app=1") {
            webView?.load(URLRequest(url: url))
        }
    }

    /// Match dashboard light/dark so native glass / `NSVisualEffectView` + window chrome follow the web theme.

    func applyChromeAppearance(theme: String, resolvedIsDark: Bool) {
        switch theme {
        case "system":
            chromeFollowsSystem = true
            window?.appearance = nil
        case "light":
            chromeFollowsSystem = false
            window?.appearance = NSAppearance(named: .aqua)
        case "dark":
            chromeFollowsSystem = false
            window?.appearance = NSAppearance(named: .darkAqua)
        default:
            chromeFollowsSystem = false
            window?.appearance = NSAppearance(named: resolvedIsDark ? .darkAqua : .aqua)
        }
        registerEffectiveAppearanceObserverIfNeeded()


        if chromeFollowsSystem {
            DispatchQueue.main.async { [weak self] in
                self?.pushCurrentSystemAppearanceToWeb()
            }
        }
    }

    func setNativeThemePreference(_ rawTheme: String) {
        let preference = NativeAppearancePreference.normalize(rawTheme)
        UserDefaults.standard.set(preference.rawValue, forKey: NativeAppearancePreference.storageKey)
        let isDark = NativeAppearancePreference.resolvedIsDark(for: preference)
        applyChromeAppearance(theme: preference.rawValue, resolvedIsDark: isDark)
        pushThemePreferenceToWeb(theme: preference.rawValue, isDark: isDark)
    }



    func pushCurrentSystemAppearanceToWeb() {
        let isDark = NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        pushSystemAppearanceToWeb(isDark: isDark)
    }




    private func registerEffectiveAppearanceObserverIfNeeded() {
        guard effectiveAppearanceObservation == nil else { return }


        effectiveAppearanceObservation = NSApp.observe(\.effectiveAppearance, options: [.new]) { [weak self] _, _ in
            DispatchQueue.main.async {
                self?.pushCurrentSystemAppearanceToWeb()
            }
        }
    }

    private func pushSystemAppearanceToWeb(isDark: Bool) {
        let js = """
        (function(){
          var d = \(isDark ? "true" : "false");
          if (d) { document.documentElement.classList.add('dark'); } else { document.documentElement.classList.remove('dark'); }
          window.dispatchEvent(new CustomEvent('native:systemAppearanceChanged', { detail: { isDark: d } }));
        })();
        """
        webView?.evaluateJavaScript(js, completionHandler: nil)
    }

    private func pushThemePreferenceToWeb(theme: String, isDark: Bool) {
        let js = """
        (function(){
          try {
            var theme = '\(theme)';
            var isDark = \(isDark ? "true" : "false");
            localStorage.setItem('vd-theme', theme);
            localStorage.removeItem('vibedeck-theme');
            if (isDark) { document.documentElement.classList.add('dark'); } else { document.documentElement.classList.remove('dark'); }
            window.dispatchEvent(new CustomEvent('native:themePreferenceChanged', { detail: { theme: theme, isDark: isDark } }));
          } catch (e) {}
        })();
        """
        webView?.evaluateJavaScript(js, completionHandler: nil)
    }

    private func syncChromeAppearanceFromWebView() {
        let js = """
        (function(){
          try {
            var t = localStorage.getItem('vd-theme') || localStorage.getItem('vibedeck-theme') || 'system';
            var d = document.documentElement.classList.contains('dark');
            return JSON.stringify({ theme: t, isDark: d });
          } catch (e) {
            return JSON.stringify({ theme: 'system', isDark: false });
          }
        })()
        """
        webView?.evaluateJavaScript(js) { [weak self] result, _ in
            guard let self,
                  let json = result as? String,
                  let data = json.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let theme = obj["theme"] as? String,
                  let isDark = obj["isDark"] as? Bool else { return }
            applyChromeAppearance(theme: theme, resolvedIsDark: isDark)
        }
    }


    private func injectMainCardCornerRadius() {
        let px = DashboardChromeMetrics.mainCardCornerRadiusPixels
        let js = "document.documentElement.style.setProperty('--tt-main-card-radius', '\(px)px');"
        webView?.evaluateJavaScript(js, completionHandler: nil)
    }

    // MARK: - Loading Overlay

    private func makeLoadingOverlay() -> NSView {
        let overlay = NSView()
        overlay.wantsLayer = true
        overlay.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor

        let hosting = NSHostingController(
            rootView: AnyView(
                InstrumentLoadingPanel(
                    title: Strings.loadingData,
                    detail: Strings.serverPreparing,
                    mode: .indeterminate
                )
            )
        )
        self.loadingHostingController = hosting
        hosting.view.translatesAutoresizingMaskIntoConstraints = false
        hosting.view.wantsLayer = true
        hosting.view.layer?.contentsScale = NSScreen.main?.backingScaleFactor ?? 2.0
        overlay.addSubview(hosting.view)

        NSLayoutConstraint.activate([
            hosting.view.topAnchor.constraint(equalTo: overlay.topAnchor),
            hosting.view.bottomAnchor.constraint(equalTo: overlay.bottomAnchor),
            hosting.view.leadingAnchor.constraint(equalTo: overlay.leadingAnchor),
            hosting.view.trailingAnchor.constraint(equalTo: overlay.trailingAnchor),
        ])
        return overlay
    }

    private func dismissLoadingOverlay() {
        guard let overlay = loadingOverlay else { return }
        // Keep drawsBackground false so native glass / vibrancy shows through non-painted areas (sidebar + window chrome).
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.3
            overlay.animator().alphaValue = 0
        } completionHandler: { [weak self] in
            overlay.removeFromSuperview()
            self?.loadingOverlay = nil
            self?.loadingHostingController = nil
        }
    }

    func closeWindow() {
        window?.close()
    }

    // MARK: - NSWindowDelegate

    func windowWillClose(_ notification: Notification) {
        // Keep webView and window alive so cookies/login state persist.
        DispatchQueue.main.async { [weak self] in
            let closingWindow = self?.window
            let hasOtherVisibleWindows = NSApp.windows.contains {
                $0.isVisible
                && !$0.isKind(of: NSPanel.self)
                && $0 != closingWindow
            }
            if !hasOtherVisibleWindows {
                NSApp.setActivationPolicy(.accessory)
                NSApp.hide(nil)
            }
        }
    }

    // MARK: - WKScriptMessageHandler

    nonisolated func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        let name = message.name
        let body = message.body
        Task { @MainActor [weak self] in
            self?.handleScriptMessage(name: name, body: body)
        }
    }

    private func handleScriptMessage(name: String, body: Any) {
        if name == "nativeBridge" {
            NativeBridge.shared.handle(message: body)
            return
        }
        guard name == "nativeOAuth",
              let urlString = body as? String,
              let url = URL(string: urlString) else { return }
        // Open OAuth in system browser where user has saved Google/GitHub sessions
        NSWorkspace.shared.open(url)
    }

    /// Open the dashboard and navigate directly to the Settings page.
    func showSettings() {
        show(destination: .settings)
    }

    /// Called when `vibedeck://auth/done` deep link is received after browser login.
    func handleAuthDone() {
        showWindow()
        // Reload dashboard so native auth state is picked up after the server-side relay.
        if let url = URL(string: Constants.serverBaseURL + "?app=1") {
            webView?.load(URLRequest(url: url))
        }
    }

    /// Called when browser relays OAuth code back via `vibedeck://auth/callback?code=xxx`.
    /// Loads the callback page in the WebView so the SDK can exchange the code using the
    /// PKCE verifier that's already in WebView's sessionStorage.
    func handleAuthCallback(code: String) {
        showWindow()
        let encoded = code.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? code
        let callbackUrl = Constants.serverBaseURL + "/auth/callback?code=\(encoded)"
        if let url = URL(string: callbackUrl) {
            webView?.load(URLRequest(url: url))
        }
    }

    // MARK: - WKUIDelegate

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    // MARK: - WKNavigationDelegate

    private func isLocalDashboardURL(_ url: URL) -> Bool {
        url.host == "localhost" || url.host == "127.0.0.1"
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        // Allow local dashboard navigation
        if isLocalDashboardURL(url) {
            decisionHandler(.allow)
            return
        }

        let isMainFrameNavigation = navigationAction.targetFrame?.isMainFrame ?? true
        // Only promote top-level user clicks to the system browser. Subframe
        // clicks (e.g. the Cloud IP Check iframe) should stay inside the
        // iframe so embedded tools can navigate normally.
        if (url.scheme == "http" || url.scheme == "https"),
           navigationAction.navigationType == .linkActivated,
           isMainFrameNavigation {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        retryCount = 0

        let css = """
            * { -webkit-user-select: none !important; } \
            input, textarea { -webkit-user-select: text !important; } \
            .native-app header { padding-top: 36px !important; } \
            ::-webkit-scrollbar { display: none !important; }
            """
        let escapedCSS = css
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
            .replacingOccurrences(of: "\n", with: " ")
        let js = "document.documentElement.classList.add('native-app');var s=document.createElement('style');s.textContent='\(escapedCSS)';document.head.appendChild(s);"
        webView.evaluateJavaScript(js)

        // Wait for next animation frame so the page has actually painted before dismissing overlay
        let waitForPaint = "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))).then(() => 'ready')"
        webView.evaluateJavaScript(waitForPaint) { [weak self] _, _ in
            DispatchQueue.main.async {
                self?.syncChromeAppearanceFromWebView()


                self?.pushCurrentSystemAppearanceToWeb()
                self?.injectMainCardCornerRadius()
                self?.dismissLoadingOverlay()
            }
        }
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        retryCount += 1
        guard retryCount <= maxRetries else { return }
        let delay = min(Double(retryCount) * 2, 10)
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self, let url = URL(string: Constants.serverBaseURL + "?app=1") else { return }
            self.webView?.load(URLRequest(url: url))
        }
    }
}

// MARK: - Titlebar Drag View

/// Transparent view overlaying the titlebar area to enable window dragging
/// while WKWebView is fullSizeContentView.
private final class TitlebarDragView: NSView {
    override var mouseDownCanMoveWindow: Bool { true }

    override func mouseDown(with event: NSEvent) {
        window?.performDrag(with: event)
    }
}

// MARK: - Native dashboard shell

enum NativeDashboardDestination: String, CaseIterable, Identifiable {
    case dashboard
    case live
    case branches
    case optimize
    case plan
    case compare
    case models
    case yield
    case skills
    case widgets
    case export
    case settings

    var id: String { rawValue }

    static func deepLinkDestination(for slug: String) -> NativeDashboardDestination? {
        switch slug.trimmingCharacters(in: CharacterSet(charactersIn: "/")).lowercased() {
        case "", "dashboard", "summary":
            return .dashboard
        case "live":
            return .live
        case "branches":
            return .branches
        case "optimize":
            return .optimize
        case "plan":
            return .plan
        case "compare":
            return .compare
        case "models", "top-models", "topmodels":
            return .models
        case "yield", "heatmap", "activity":
            return .yield
        case "skills":
            return .skills
        case "widgets":
            return .widgets
        case "export":
            return .export
        case "settings", "limits":
            return .settings
        default:
            return nil
        }
    }

    var title: String {
        switch self {
        case .dashboard: return "Dashboard"
        case .live: return "Live"
        case .branches: return "Branches"
        case .optimize: return "Optimize"
        case .plan: return "Plan"
        case .compare: return "Compare"
        case .models: return "Models"
        case .yield: return "Yield"
        case .skills: return "Skills"
        case .widgets: return "Widgets"
        case .export: return "Export"
        case .settings: return "Settings"
        }
    }

    var path: String {
        switch self {
        case .dashboard: return ""
        case .live: return "/live"
        case .branches: return "/branches"
        case .optimize: return "/optimize"
        case .plan: return "/plan"
        case .compare: return "/compare"
        case .models: return "/models"
        case .yield: return "/yield"
        case .skills: return "/skills"
        case .widgets: return "/widgets"
        case .export: return "/export"
        case .settings: return "/settings"
        }
    }

    var section: NativeDashboardSection {
        switch self {
        case .dashboard, .live, .branches:
            return .live
        case .optimize, .plan, .compare, .models:
            return .intelligence
        case .yield, .skills:
            return .analytics
        case .widgets, .export, .settings:
            return .setup
        }
    }
}

enum NativeDashboardSection: String, CaseIterable, Identifiable {
    case live = "LIVE"
    case intelligence = "INTELLIGENCE"
    case analytics = "ANALYTICS"
    case setup = "SETUP"

    var id: String { rawValue }
}

struct NativeDashboardShellView: View {
    let webView: WKWebView
    let viewModel: DashboardViewModel?
    let serverManager: ServerManager?
    let onNavigate: (NativeDashboardDestination) -> Void
    let onReload: () -> Void
    let onSyncNow: () -> Void

    @State private var selected: NativeDashboardDestination = .dashboard
    @State private var showFirstLaunch = false
    @AppStorage(NativeAppearancePreference.storageKey) private var theme = NativeAppearancePreference.system.rawValue
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let firstLaunchKey = "vd-first-launch-seen"
    private var preference: NativeAppearancePreference {
        NativeAppearancePreference.normalize(theme)
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            shellContent

            if showFirstLaunch {
                NativeFirstLaunchOverlay()
                    .transition(.opacity)
                    .zIndex(4)
            }
        }
        .onAppear(perform: runFirstLaunchIfNeeded)
        .preferredColorScheme(NativeAppearancePreference.preferredColorScheme(for: preference))
    }

    @ViewBuilder
    private var shellContent: some View {
        if #available(macOS 13.0, *) {
            splitShell
        } else {
            legacySplitShell
        }
    }

    @available(macOS 13.0, *)
    private var splitShell: some View {
        NavigationSplitView {
            NativeDashboardSidebar(
                selected: $selected,
                viewModel: viewModel,
                serverManager: serverManager,
                onNavigate: onNavigate,
                onReload: onReload,
                onSyncNow: onSyncNow
            )
            .navigationSplitViewColumnWidth(min: 220, ideal: 220, max: 220)
        } detail: {
            NativeDashboardDetailView(
                selected: selected,
                webView: webView,
                viewModel: viewModel,
                serverManager: serverManager
            )
                .ignoresSafeArea()
        }
        .navigationSplitViewStyle(.balanced)
    }

    private var legacySplitShell: some View {
        HStack(spacing: 0) {
            NativeDashboardSidebar(
                selected: $selected,
                viewModel: viewModel,
                serverManager: serverManager,
                onNavigate: onNavigate,
                onReload: onReload,
                onSyncNow: onSyncNow
            )

            Divider()

            NativeDashboardDetailView(
                selected: selected,
                webView: webView,
                viewModel: viewModel,
                serverManager: serverManager
            )
                .ignoresSafeArea()
        }
    }

    private func runFirstLaunchIfNeeded() {
        guard !UserDefaults.standard.bool(forKey: Self.firstLaunchKey) else { return }
        UserDefaults.standard.set(true, forKey: Self.firstLaunchKey)
        guard !reduceMotion else { return }

        withAnimation(NativeMotion.Ease.micro()) {
            showFirstLaunch = true
        }

        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 4_200_000_000)
            withAnimation(NativeMotion.Ease.short()) {
                showFirstLaunch = false
            }
        }
    }
}

private struct NativeFirstLaunchOverlay: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var arrived = false
    @State private var coloredPlanes = false
    @State private var docked = false
    @State private var faded = false

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                Rectangle()
                    .fill(.regularMaterial)
                    .overlay(Color.panelFill.opacity(0.82))
                    .opacity(faded ? 0 : 1)

                NativeFirstLaunchMark(colored: coloredPlanes)
                    .frame(width: 160, height: 160)
                    .scaleEffect(docked ? 0.24 : arrived ? 1 : 0.7)
                    .opacity(faded ? 0 : arrived ? 1 : 0)
                    .offset(
                        x: docked ? -(proxy.size.width / 2) + 112 : 0,
                        y: docked ? -(proxy.size.height / 2) + 88 : 0
                    )
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
            .allowsHitTesting(false)
            .onAppear {
                guard !reduceMotion else {
                    faded = true
                    return
                }

                withAnimation(NativeMotion.Spring.slow) {
                    arrived = true
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                    withAnimation(NativeMotion.Ease.long()) {
                        coloredPlanes = true
                    }
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                    withAnimation(NativeMotion.Spring.slow) {
                        docked = true
                    }
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 3.9) {
                    withAnimation(NativeMotion.Ease.short()) {
                        faded = true
                    }
                }
            }
        }
    }
}

private struct NativeFirstLaunchMark: View {
    let colored: Bool

    var body: some View {
        Canvas { context, size in
            let scaleX = size.width / 290
            let scaleY = size.height / 170
            context.scaleBy(x: scaleX, y: scaleY)
            context.translateBy(x: -100, y: -170)

            drawPlane(
                in: context,
                points: [
                    CGPoint(x: 107, y: 231),
                    CGPoint(x: 307, y: 231),
                    CGPoint(x: 377, y: 181),
                    CGPoint(x: 177, y: 181),
                ],
                color: colored ? Color(red: 0.65, green: 0.71, blue: 0.99).opacity(0.55) : Color.secondary.opacity(0.26)
            )
            drawPlane(
                in: context,
                points: [
                    CGPoint(x: 107, y: 281),
                    CGPoint(x: 307, y: 281),
                    CGPoint(x: 377, y: 231),
                    CGPoint(x: 177, y: 231),
                ],
                color: colored ? Color(red: 0.51, green: 0.55, blue: 0.97).opacity(0.78) : Color.secondary.opacity(0.34)
            )
            drawPlane(
                in: context,
                points: [
                    CGPoint(x: 107, y: 331),
                    CGPoint(x: 307, y: 331),
                    CGPoint(x: 377, y: 281),
                    CGPoint(x: 177, y: 281),
                ],
                color: colored ? Color.brand : Color.secondary.opacity(0.48)
            )
        }
    }

    private func drawPlane(in context: GraphicsContext, points: [CGPoint], color: Color) {
        guard let first = points.first else { return }
        var path = Path()
        path.move(to: first)
        points.dropFirst().forEach { path.addLine(to: $0) }
        path.closeSubpath()
        context.fill(path, with: .color(color))
    }
}

private struct NativeDashboardSidebar: View {
    @Binding var selected: NativeDashboardDestination

    let viewModel: DashboardViewModel?
    let serverManager: ServerManager?
    let onNavigate: (NativeDashboardDestination) -> Void
    let onReload: () -> Void
    let onSyncNow: () -> Void

    private let sections = NativeDashboardSection.allCases

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 16) {
                NativeSidebarBrand()

                ForEach(sections) { section in
                    VStack(alignment: .leading, spacing: 5) {
                        Text(section.rawValue)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(.secondary)
                            .textCase(.uppercase)
                            .modifier(TrackingModifier(value: 0.6))
                            .padding(.horizontal, 10)
                            .padding(.top, section == sections.first ? 0 : 8)

                        ForEach(NativeDashboardDestination.allCases.filter { $0.section == section }) { destination in
                            NativeSidebarRow(
                                title: destination.title,
                                isSelected: selected == destination
                            ) {
                                selected = destination
                                onNavigate(destination)
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 32)

            Spacer(minLength: 16)

            Group {
                if let viewModel, let serverManager {
                    NativeObservedSidebarUtilityCard(
                        viewModel: viewModel,
                        serverManager: serverManager,
                        onSyncNow: onSyncNow
                    )
                } else {
                    NativeSidebarUtilityCard(
                        status: .idle,
                        isSyncing: false,
                        onSyncNow: {}
                    )
                }
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 14)
        }
        .frame(minWidth: 220, idealWidth: 220, maxWidth: 220)
        .background(.ultraThinMaterial)
    }
}

private struct NativeSidebarBrand: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        HStack(spacing: 10) {
            Image(colorScheme == .dark ? "VibeDeckIconDark" : "VibeDeckIconLight")
                .resizable()
                .scaledToFit()
                .frame(width: 28, height: 28)

            VStack(alignment: .leading, spacing: 1) {
                Text("VibeDeck")
                    .font(.headline)
                    .modifier(FontWeightModifier(weight: .semibold))
                Text("Local dashboard")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 8)
        .padding(.bottom, 2)
    }
}

private struct NativeSidebarRow: View {
    let title: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(isSelected ? Color.brand : Color.clear)
                    .frame(width: 3, height: 16)

                Text(title)
                    .font(.system(size: 13, weight: isSelected ? .semibold : .regular))
                    .foregroundStyle(isSelected ? Color.primary : Color.primary.opacity(0.82))

                Spacer(minLength: 0)
            }
            .frame(height: 28)
            .padding(.horizontal, 8)
            .background(
                RoundedRectangle(cornerRadius: 4)
                    .fill(isSelected ? Color.brand.opacity(0.12) : Color.clear)
            )
            .contentShape(RoundedRectangle(cornerRadius: 4))
        }
        .buttonStyle(.plain)
    }
}

private struct NativeObservedSidebarUtilityCard: View {
    @ObservedObject var viewModel: DashboardViewModel
    @ObservedObject var serverManager: ServerManager
    let onSyncNow: () -> Void

    var body: some View {
        NativeSidebarUtilityCard(
            status: serverManager.status,
            isSyncing: viewModel.isSyncing,
            onSyncNow: onSyncNow
        )
    }
}

private struct NativeSidebarUtilityCard: View {
    let status: ServerManager.Status
    let isSyncing: Bool
    let onSyncNow: () -> Void

    private var title: String {
        switch status {
        case .running:
            return "Healthy"
        case .starting:
            return "Starting"
        case .idle:
            return "Standby"
        case .failed:
            return "Offline"
        }
    }

    private var detail: String {
        switch status {
        case .running:
            return "Local sync ready"
        case .starting:
            return "Starting bridge"
        case .idle:
            return "Waiting for server"
        case .failed:
            return "Server unavailable"
        }
    }

    private var filledSegments: Int {
        switch status {
        case .running:
            return 6
        case .starting:
            return 3
        case .idle:
            return 2
        case .failed:
            return 1
        }
    }

    private var accent: Color {
        switch status {
        case .running:
            return .white
        case .starting, .idle:
            return Color(red: 0.78, green: 0.83, blue: 1.0)
        case .failed:
            return Color(red: 1.0, green: 0.66, blue: 0.48)
        }
    }

    private var canSync: Bool {
        status == .running && !isSyncing
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Server")
                .font(.caption2)
                .modifier(FontWeightModifier(weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.7))
                .textCase(.uppercase)
                .modifier(TrackingModifier(value: 0.6))

            Text(title)
                .font(.headline)
                .modifier(FontWeightModifier(weight: .semibold))
                .foregroundStyle(.white)

            Text(detail)
                .font(.caption)
                .foregroundStyle(Color.white.opacity(0.7))
                .lineLimit(1)

            HStack(spacing: 4) {
                ForEach(0..<6, id: \.self) { index in
                    Capsule()
                        .fill(index < filledSegments ? accent.opacity(0.88) : Color.white.opacity(0.2))
                        .frame(height: 5)
                }
            }

            Button(action: onSyncNow) {
                Text(isSyncing ? "Syncing" : "Sync now")
                    .font(.caption)
                    .modifier(FontWeightModifier(weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
                    .background(Capsule().fill(canSync ? Color.white.opacity(0.18) : Color.white.opacity(0.1)))
                    .foregroundStyle(canSync ? Color.white : Color.white.opacity(0.55))
            }
            .buttonStyle(.plain)
            .disabled(!canSync)
        }
        .padding(14)
        .frame(height: 160)
        .background(
            LinearGradient(
                colors: [
                    Color(red: 0.12, green: 0.11, blue: 0.29),
                    Color(red: 0.23, green: 0.21, blue: 0.53),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color.white.opacity(0.12), lineWidth: 0.5)
        )
    }
}

private struct NativeDashboardDetailView: View {
    let selected: NativeDashboardDestination
    let webView: WKWebView
    let viewModel: DashboardViewModel?
    let serverManager: ServerManager?

    var body: some View {
        Group {
            if let viewModel, let serverManager {
                nativeDetail(viewModel: viewModel, serverManager: serverManager)
            } else {
                NativeWebViewHost(webView: webView)
            }
        }
    }

    @ViewBuilder
    private func nativeDetail(viewModel: DashboardViewModel, serverManager: ServerManager) -> some View {
        switch selected {
        case .dashboard:
            DashboardView(viewModel: viewModel, serverManager: serverManager)
        case .live:
            NativeLiveDetailView(viewModel: viewModel)
        case .optimize:
            OptimizePlanTabsView(viewModel: viewModel, initialTab: .optimize)
        case .plan:
            OptimizePlanTabsView(viewModel: viewModel, initialTab: .plan)
        case .compare:
            AnalyticsTabsView(viewModel: viewModel, initialTab: .compare)
        case .models:
            AnalyticsTabsView(viewModel: viewModel, initialTab: .models)
        case .yield:
            AnalyticsTabsView(viewModel: viewModel, initialTab: .yield)
        case .skills:
            AnalyticsTabsView(viewModel: viewModel, initialTab: .skills)
        case .settings:
            NativeSettingsView()
        case .widgets:
            NativeWidgetsDetailView(viewModel: viewModel)
        case .export:
            NativeExportDetailView()
        case .branches:
            NativeBranchesDetailView()
        }
    }
}

private struct NativeBranchesDetailView: View {
    @State private var response: BranchUsageResponse?
    @State private var isLoading = false
    @State private var errorText: String?
    @State private var filter = ""

    private var rows: [BranchUsageRow] {
        let flattened = (response?.repos ?? []).flatMap { repo in
            repo.branches.map { branch -> BranchUsageRow in
                var copy = branch
                copy.repoRoot = repo.repoRoot ?? repo.projectRef ?? repo.projectKey
                return copy
            }
        }
        let needle = filter.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return flattened }
        return flattened.filter { row in
            row.branch.lowercased().contains(needle)
                || (row.attributionBranch ?? "").lowercased().contains(needle)
                || (row.repoRoot ?? "").lowercased().contains(needle)
                || (row.models.first?.model ?? "").lowercased().contains(needle)
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                SectionHeader(title: "Branches") {
                    Button {
                        Task { await load() }
                    } label: {
                        Label(isLoading ? "Refreshing" : "Refresh", systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .disabled(isLoading)
                }

                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Branch attribution")
                            .font(.title)
                            .modifier(FontWeightModifier(weight: .semibold))
                        Text("Review branch-level token, cost, model, and confidence signals from the local event ledger.")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }

                    Spacer()
                }

                NativeBranchesSummary(response: response, rowCount: rows.count, isLoading: isLoading)

                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 10) {
                        Image(systemName: "magnifyingglass")
                            .foregroundStyle(.secondary)
                        TextField("Filter branch, repo, or model", text: $filter)
                            .textFieldStyle(.plain)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .background(
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color.panelFill)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(Color.panelBorder, lineWidth: 1)
                    )

                    if let errorText {
                        Text(errorText)
                            .font(.caption)
                            .foregroundStyle(Color.statusWarning)
                    }

                    NativeBranchesTable(rows: Array(rows.prefix(50)), isLoading: isLoading)
                }
            }
            .padding(24)
        }
        .background(Color(NSColor.textBackgroundColor).opacity(0.28))
        .task {
            if response == nil {
                await load()
            }
        }
    }

    private func load() async {
        isLoading = true
        errorText = nil
        do {
            response = try await APIClient.shared.fetchBranchUsage()
        } catch {
            errorText = "Unable to load branch usage — \(error.localizedDescription)"
        }
        isLoading = false
    }
}

private struct NativeBranchesSummary: View {
    let response: BranchUsageResponse?
    let rowCount: Int
    let isLoading: Bool

    var body: some View {
        HStack(spacing: 12) {
            NativeExportStat(label: "Branches", value: isLoading ? "..." : "\(rowCount)")
            NativeExportStat(
                label: "Tokens",
                value: isLoading ? "..." : TokenFormatter.formatCompact(response?.totals?.totalTokens ?? 0)
            )
            NativeExportStat(
                label: "Cost",
                value: isLoading ? "..." : formatCost(response?.totals?.totalCostUSD)
            )
            NativeExportStat(
                label: "Sessions",
                value: isLoading ? "..." : "\(response?.totals?.sessionCount ?? 0)"
            )
        }
    }

    private func formatCost(_ value: FlexibleCostValue?) -> String {
        guard let value else { return "Unknown" }
        return TokenFormatter.formatCost(value.doubleValue)
    }
}

private struct NativeBranchesTable: View {
    let rows: [BranchUsageRow]
    let isLoading: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            NativeBranchesHeader()

            if rows.isEmpty {
                PlaceholderBlock(height: 132, hint: isLoading ? "Loading branch usage..." : "No attribution rows match current filters.")
                    .padding(.top, 8)
            } else {
                ForEach(rows) { row in
                    Divider().opacity(0.45)
                    NativeBranchRow(row: row)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.panelFill)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.panelBorder, lineWidth: 1)
        )
    }
}

private struct NativeBranchesHeader: View {
    var body: some View {
        HStack(spacing: 10) {
            header("Repo", width: 150)
            header("Branch", width: 170)
            header("Confidence", width: 112)
            Spacer()
            header("Sessions", width: 68, alignment: .trailing)
            header("Tokens", width: 84, alignment: .trailing)
            header("Cost", width: 76, alignment: .trailing)
        }
        .padding(.vertical, 6)
    }

    private func header(_ title: String, width: CGFloat, alignment: Alignment = .leading) -> some View {
        Text(title)
            .font(.caption2)
            .modifier(FontWeightModifier(weight: .semibold))
            .foregroundStyle(.tertiary)
            .textCase(.uppercase)
            .frame(width: width, alignment: alignment)
    }
}

private struct NativeBranchRow: View {
    let row: BranchUsageRow

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(repoName(row.repoRoot))
                    .lineLimit(1)
                if let repoRoot = row.repoRoot, !repoRoot.isEmpty {
                    Text(repoRoot)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                }
            }
            .frame(width: 150, alignment: .leading)

            VStack(alignment: .leading, spacing: 2) {
                Text(row.attributionBranch ?? row.branch)
                    .lineLimit(1)
                Text(row.branchKind ?? "unknown")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .frame(width: 170, alignment: .leading)

            NativeBranchConfidenceBars(confidence: row.confidence)
                .frame(width: 112, alignment: .leading)

            Spacer()

            Text("\(row.sessionCount)")
                .font(.caption.monospacedDigit())
                .frame(width: 68, alignment: .trailing)
            Text(TokenFormatter.formatCompact(row.totalTokens))
                .font(.caption.monospacedDigit())
                .frame(width: 84, alignment: .trailing)
            Text(formatCost(row.totalCostUSD))
                .font(.caption.monospacedDigit())
                .frame(width: 76, alignment: .trailing)
        }
        .font(.caption)
        .padding(.vertical, 8)
        .help(row.models.first?.model ?? "")
    }

    private func repoName(_ raw: String?) -> String {
        let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !trimmed.isEmpty else { return "Unknown repo" }
        return trimmed.split(separator: "/").last.map(String.init) ?? trimmed
    }

    private func formatCost(_ value: FlexibleCostValue?) -> String {
        guard let value else { return "Unknown" }
        return TokenFormatter.formatCost(value.doubleValue)
    }
}

private struct NativeBranchConfidenceBars: View {
    let confidence: BranchConfidence?

    private var values: [(String, Int, Color)] {
        [
            ("H", confidence?.high ?? 0, Color.brand600),
            ("M", confidence?.medium ?? 0, Color.statusWarning),
            ("L", confidence?.low ?? 0, Color.secondary.opacity(0.7)),
            ("U", confidence?.unattributed ?? 0, Color.panelBorder)
        ]
    }

    private var total: Int {
        max(values.map(\.1).reduce(0, +), 1)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 2) {
                ForEach(values, id: \.0) { _, count, color in
                    RoundedRectangle(cornerRadius: 2)
                        .fill(color)
                        .frame(width: max(5, CGFloat(count) / CGFloat(total) * 72), height: 7)
                }
            }

            Text(summary)
                .font(.caption2.monospacedDigit())
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }

    private var summary: String {
        values.map { "\($0.0)\($0.1)" }.joined(separator: " ")
    }
}

private struct NativeExportDetailView: View {
    @State private var fromDate = ""
    @State private var toDate = ""
    @State private var format = "json"
    @State private var preview: ExportPreviewResponse?
    @State private var isLoading = false
    @State private var isDownloading = false
    @State private var statusText: String?
    @State private var errorText: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                SectionHeader(title: "Export") {
                    if let statusText {
                        Text(statusText)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }

                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Download local ledger data")
                            .font(.title)
                            .modifier(FontWeightModifier(weight: .semibold))
                        Text("Filter by date, preview aggregate totals, then export JSON or CSV from the local database.")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }

                    Spacer()

                    Button {
                        Task { await downloadExport() }
                    } label: {
                        Label(isDownloading ? "Exporting" : "Export \(format.uppercased())", systemImage: "square.and.arrow.down")
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isDownloading || isLoading)
                }

                NativeExportForm(
                    fromDate: $fromDate,
                    toDate: $toDate,
                    format: $format,
                    isLoading: isLoading,
                    onPreview: {
                        Task { await loadPreview() }
                    }
                )

                if let errorText {
                    Text(errorText)
                        .font(.caption)
                        .foregroundStyle(Color.statusWarning)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(
                            RoundedRectangle(cornerRadius: 8)
                                .fill(Color.statusWarning.opacity(0.12))
                        )
                }

                NativeExportTotals(preview: preview, isLoading: isLoading)

                NativeExportRows(rows: Array((preview?.rows ?? []).prefix(8)))
            }
            .padding(24)
        }
        .background(Color(NSColor.textBackgroundColor).opacity(0.28))
        .task {
            if preview == nil {
                await loadPreview()
            }
        }
    }

    private func loadPreview() async {
        isLoading = true
        errorText = nil
        do {
            preview = try await APIClient.shared.fetchExportPreview(from: fromDate, to: toDate)
            statusText = preview?.asOf.flatMap { parseDate($0).map(relativeUpdated) } ?? "Preview updated"
        } catch {
            errorText = "Couldn't load export preview — \(error.localizedDescription)"
        }
        isLoading = false
    }

    private func downloadExport() async {
        isDownloading = true
        errorText = nil
        do {
            let url = try await APIClient.shared.downloadExport(format: format, from: fromDate, to: toDate)
            statusText = "Saved \(url.lastPathComponent) to Downloads"
        } catch {
            errorText = "Couldn't export file — \(error.localizedDescription)"
        }
        isDownloading = false
    }
}

private struct NativeExportForm: View {
    @Binding var fromDate: String
    @Binding var toDate: String
    @Binding var format: String
    let isLoading: Bool
    let onPreview: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionHeader(title: "Filters")

            HStack(alignment: .bottom, spacing: 12) {
                NativeExportField(title: "From", placeholder: "YYYY-MM-DD", text: $fromDate)
                NativeExportField(title: "To", placeholder: "YYYY-MM-DD", text: $toDate)
                VStack(alignment: .leading, spacing: 6) {
                    Text("Format")
                        .font(.caption)
                        .modifier(FontWeightModifier(weight: .semibold))
                        .foregroundStyle(.secondary)
                    Picker("Format", selection: $format) {
                        Text("JSON").tag("json")
                        Text("CSV").tag("csv")
                    }
                    .labelsHidden()
                    .pickerStyle(.segmented)
                    .frame(width: 160)
                }
            }

            HStack {
                Button {
                    onPreview()
                } label: {
                    Label(isLoading ? "Loading" : "Refresh Preview", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
                .disabled(isLoading)

                Spacer()
            }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.panelFill)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.panelBorder, lineWidth: 1)
        )
    }
}

private struct NativeExportField: View {
    let title: String
    let placeholder: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.caption)
                .modifier(FontWeightModifier(weight: .semibold))
                .foregroundStyle(.secondary)
            TextField(placeholder, text: $text)
                .textFieldStyle(.roundedBorder)
                .frame(minWidth: 180)
        }
    }
}

private struct NativeExportTotals: View {
    let preview: ExportPreviewResponse?
    let isLoading: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: "Aggregate Totals")

            HStack(spacing: 12) {
                NativeExportStat(
                    label: "Tokens",
                    value: isLoading ? "..." : TokenFormatter.formatCompact(preview?.totals?.totalTokens ?? 0)
                )
                NativeExportStat(
                    label: "Cost",
                    value: isLoading ? "..." : TokenFormatter.formatCostFromString(preview?.totals?.totalCostUSD)
                )
                NativeExportStat(
                    label: "Sessions",
                    value: isLoading ? "..." : "\(preview?.totals?.sessionCount ?? 0)"
                )
            }
        }
    }
}

private struct NativeExportStat: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(.caption2)
                .modifier(FontWeightModifier(weight: .semibold))
                .foregroundStyle(.secondary)
                .modifier(TrackingModifier(value: 0.5))
            Text(value)
                .font(.title3.monospacedDigit())
                .modifier(FontWeightModifier(weight: .semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.panelFill)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.panelBorder, lineWidth: 1)
        )
    }
}

private struct NativeExportRows: View {
    let rows: [ExportPreviewRow]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Preview Rows") {
                Text("\(rows.count) shown")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            if rows.isEmpty {
                PlaceholderBlock(height: 96, hint: "No export rows for this window yet.")
            } else {
                VStack(spacing: 0) {
                    NativeExportRowHeader()
                    ForEach(rows) { row in
                        Divider().opacity(0.45)
                        NativeExportRow(row: row)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(Color.panelFill)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Color.panelBorder, lineWidth: 1)
                )
            }
        }
    }
}

private struct NativeExportRowHeader: View {
    var body: some View {
        HStack(spacing: 10) {
            tableText("Provider", width: 96)
            tableText("Branch", width: 140)
            tableText("Model", width: 180)
            Spacer()
            tableText("Tokens", width: 84, alignment: .trailing)
            tableText("Cost", width: 72, alignment: .trailing)
        }
        .padding(.vertical, 6)
    }

    private func tableText(_ value: String, width: CGFloat, alignment: Alignment = .leading) -> some View {
        Text(value)
            .font(.caption2)
            .modifier(FontWeightModifier(weight: .semibold))
            .foregroundStyle(.tertiary)
            .textCase(.uppercase)
            .frame(width: width, alignment: alignment)
    }
}

private struct NativeExportRow: View {
    let row: ExportPreviewRow

    var body: some View {
        HStack(spacing: 10) {
            HStack(spacing: 6) {
                ProviderLogoView(provider: row.provider, size: 14)
                Text(row.provider.isEmpty ? "Unknown" : row.provider)
                    .lineLimit(1)
            }
            .frame(width: 96, alignment: .leading)

            Text(row.branch.isEmpty ? "-" : row.branch)
                .lineLimit(1)
                .frame(width: 140, alignment: .leading)
            Text(row.model.isEmpty ? "-" : row.model)
                .lineLimit(1)
                .frame(width: 180, alignment: .leading)
            Spacer()
            Text(TokenFormatter.formatCompact(row.totalTokens))
                .font(.caption.monospacedDigit())
                .frame(width: 84, alignment: .trailing)
            Text(TokenFormatter.formatCostFromString(row.costUSD))
                .font(.caption.monospacedDigit())
                .frame(width: 72, alignment: .trailing)
        }
        .font(.caption)
        .padding(.vertical, 7)
    }
}

private struct NativeWidgetsDetailView: View {
    @ObservedObject var viewModel: DashboardViewModel
    @State private var snapshot = WidgetSnapshotStore.read()
    @State private var isRefreshing = false

    private var displaySnapshot: WidgetSnapshot? {
        snapshot
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                SectionHeader(title: "Widgets") {
                    HStack(spacing: 8) {
                        if let generatedAt = snapshot?.generatedAt {
                            Text(relativeUpdated(generatedAt))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }

                        Button {
                            Task { await refreshSnapshot() }
                        } label: {
                            Label(isRefreshing ? "Refreshing" : "Refresh", systemImage: "arrow.clockwise")
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .disabled(isRefreshing)
                    }
                }

                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Four glanceable panels")
                            .font(.title)
                            .modifier(FontWeightModifier(weight: .semibold))
                        Text("Preview the WidgetKit snapshot, reload timelines, and add the VibeDeck widgets from macOS.")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }

                    Spacer()

                    Button {
                        showWidgetGalleryInstructions()
                    } label: {
                        Label("Add Widgets", systemImage: "rectangle.stack.badge.plus")
                    }
                    .buttonStyle(.borderedProminent)
                }

                LazyVGrid(columns: [
                    GridItem(.flexible(minimum: 260), spacing: 14),
                    GridItem(.flexible(minimum: 260), spacing: 14)
                ], spacing: 14) {
                    NativeWidgetPreviewCard(
                        title: "Summary",
                        subtitle: "Today",
                        systemImage: "chart.line.uptrend.xyaxis",
                        metric: displaySnapshot.map { TokenFormatter.formatCompact($0.today.tokens) } ?? "No snapshot",
                        detail: displaySnapshot.map { "\(TokenFormatter.formatCost($0.today.costUsd)) · \($0.today.conversations) sessions" } ?? "Run a sync to write widget data.",
                        accent: .brand600
                    ) {
                        NativeWidgetSparkline(points: displaySnapshot?.dailyTrend ?? [])
                    }

                    NativeWidgetPreviewCard(
                        title: "Top Models",
                        subtitle: "Spend",
                        systemImage: "list.number",
                        metric: displaySnapshot?.topModels.first?.name ?? "No models",
                        detail: displaySnapshot?.topModels.first.map {
                            "\(TokenFormatter.formatCost($0.costUsd)) · \(String(format: "%.1f", $0.sharePercent))%"
                        } ?? "Top model rows appear after usage is recorded.",
                        accent: .brand500
                    ) {
                        NativeWidgetModelPreview(models: displaySnapshot?.topModels ?? [])
                    }

                    NativeWidgetPreviewCard(
                        title: "Usage Limits",
                        subtitle: "Quota",
                        systemImage: "gauge.with.dots.needle.bottom.50percent",
                        metric: hottestLimitLabel,
                        detail: hottestLimitDetail,
                        accent: hottestLimitColor
                    ) {
                        NativeWidgetLimitsPreview(limits: displaySnapshot?.limits ?? [])
                    }

                    NativeWidgetPreviewCard(
                        title: "Heatmap",
                        subtitle: "Activity",
                        systemImage: "square.grid.3x3.square",
                        metric: displaySnapshot.map { "\($0.heatmap.activeDays) active days" } ?? "No activity",
                        detail: displaySnapshot.map { "\($0.heatmap.streakDays)d current streak" } ?? "The heatmap uses the shared snapshot file.",
                        accent: .brand700
                    ) {
                        NativeWidgetHeatmapPreview(weeks: displaySnapshot?.heatmap.weeks ?? [])
                    }
                }

                NativeWidgetConfigPanel(
                    snapshot: snapshot,
                    isRefreshing: isRefreshing,
                    onReload: {
                        Task { await refreshSnapshot() }
                    },
                    onAdd: showWidgetGalleryInstructions
                )
            }
            .padding(24)
        }
        .background(Color(NSColor.textBackgroundColor).opacity(0.28))
        .onAppear {
            snapshot = WidgetSnapshotStore.read()
        }
    }

    private var hottestLimit: LimitProvider? {
        displaySnapshot?.limits.max { lhs, rhs in
            lhs.fraction < rhs.fraction
        }
    }

    private var hottestLimitLabel: String {
        guard let hottestLimit else { return "No limits" }
        return hottestLimit.label
    }

    private var hottestLimitDetail: String {
        guard let hottestLimit else { return "Provider limits appear after sync." }
        let percent = Int((hottestLimit.fraction * 100).rounded())
        if let resetsAt = hottestLimit.resetsAt {
            return "\(percent)% · resets \(relativeFuture(from: resetsAt))"
        }
        return "\(percent)% of window"
    }

    private var hottestLimitColor: Color {
        guard let hottestLimit else { return .brand600 }
        return Color.limitBar(fraction: hottestLimit.fraction)
    }

    private func refreshSnapshot() async {
        isRefreshing = true
        await WidgetSnapshotWriter.update(from: viewModel)
        WidgetCenter.shared.reloadAllTimelines()
        snapshot = WidgetSnapshotStore.read()
        isRefreshing = false
    }

    private func showWidgetGalleryInstructions() {
        let alert = NSAlert()
        alert.messageText = Strings.addWidgetsTitle
        alert.informativeText = Strings.addWidgetsMessage
        alert.alertStyle = .informational
        alert.addButton(withTitle: Strings.gotItButton)
        alert.runModal()
    }
}

private struct NativeWidgetPreviewCard<Content: View>: View {
    let title: String
    let subtitle: String
    let systemImage: String
    let metric: String
    let detail: String
    let accent: Color
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Image(systemName: systemImage)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(accent)
                Text(title.uppercased())
                    .font(.caption2)
                    .modifier(FontWeightModifier(weight: .semibold))
                    .foregroundStyle(.secondary)
                    .modifier(TrackingModifier(value: 0.5))
                Spacer()
                Text(subtitle)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(metric)
                    .font(.title3)
                    .modifier(FontWeightModifier(weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }

            content()
                .frame(height: 64)
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 178, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.panelFill)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.panelBorder, lineWidth: 1)
        )
    }
}

private struct NativeWidgetSparkline: View {
    let points: [DailyPoint]

    var body: some View {
        GeometryReader { proxy in
            let values = points.suffix(14).map(\.totalTokens)
            let maxValue = max(values.max() ?? 0, 1)
            Path { path in
                for (index, value) in values.enumerated() {
                    let x = CGFloat(index) / CGFloat(max(values.count - 1, 1)) * proxy.size.width
                    let y = proxy.size.height - (CGFloat(value) / CGFloat(maxValue) * proxy.size.height)
                    if index == 0 {
                        path.move(to: CGPoint(x: x, y: y))
                    } else {
                        path.addLine(to: CGPoint(x: x, y: y))
                    }
                }
            }
            .stroke(Color.brand600, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
            .overlay {
                if values.isEmpty {
                    PlaceholderBlock(height: 64, hint: "Sparkline after sync")
                }
            }
        }
    }
}

private struct NativeWidgetModelPreview: View {
    let models: [SnapshotModelEntry]

    var body: some View {
        VStack(spacing: 6) {
            ForEach(models.prefix(3)) { model in
                HStack(spacing: 8) {
                    ProviderLogoView(provider: model.source, size: 14)
                    Text(model.name)
                        .font(.caption)
                        .lineLimit(1)
                    Spacer()
                    Text(TokenFormatter.formatCost(model.costUsd))
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }

            if models.isEmpty {
                PlaceholderBlock(height: 64, hint: "Model rows after sync")
            }
        }
    }
}

private struct NativeWidgetLimitsPreview: View {
    let limits: [LimitProvider]

    var body: some View {
        VStack(spacing: 7) {
            ForEach(limits.sorted { $0.fraction > $1.fraction }.prefix(3)) { limit in
                HStack(spacing: 8) {
                    ProviderLogoView(provider: limit.source, size: 14)
                    Text(limit.label)
                        .font(.caption)
                        .lineLimit(1)
                    if let used = limit.usedTokens, let total = limit.limitTokens, total > 0 {
                        Text("\(TokenFormatter.formatCompact(used)) / \(TokenFormatter.formatCompact(total))")
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    GeometryReader { proxy in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Color.limitTrack)
                            Capsule()
                                .fill(Color.limitBar(fraction: limit.fraction))
                                .frame(width: max(5, proxy.size.width * CGFloat(min(max(limit.fraction, 0), 1))))
                        }
                    }
                    .frame(height: 6)
                    Text("\(Int((limit.fraction * 100).rounded()))%")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .frame(width: 38, alignment: .trailing)
                }
            }

            if limits.isEmpty {
                PlaceholderBlock(height: 64, hint: "Limit rows after sync")
            }
        }
    }
}

private struct NativeWidgetHeatmapPreview: View {
    let weeks: [[Int]]

    var body: some View {
        let displayWeeks = Array(weeks.suffix(13))
        HStack(alignment: .top, spacing: 3) {
            ForEach(Array(displayWeeks.enumerated()), id: \.offset) { _, week in
                VStack(spacing: 3) {
                    ForEach(Array(week.prefix(7).enumerated()), id: \.offset) { _, level in
                        RoundedRectangle(cornerRadius: 2)
                            .fill(Color.heatmapLevels[max(0, min(level, Color.heatmapLevels.count - 1))])
                            .frame(width: 7, height: 7)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay {
            if displayWeeks.isEmpty {
                PlaceholderBlock(height: 64, hint: "Heatmap after sync")
            }
        }
    }
}

private struct NativeWidgetConfigPanel: View {
    let snapshot: WidgetSnapshot?
    let isRefreshing: Bool
    let onReload: () -> Void
    let onAdd: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: "Configuration")

            HStack(spacing: 12) {
                NativeWidgetConfigStat(label: "Families", value: "Small · Medium · Large")
                NativeWidgetConfigStat(label: "Cadence", value: "5 min")
                NativeWidgetConfigStat(label: "Source", value: snapshot == nil ? "Waiting" : "Snapshot")
            }

            HStack(spacing: 10) {
                Button {
                    onReload()
                } label: {
                    Label(isRefreshing ? "Refreshing" : "Reload Timelines", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
                .disabled(isRefreshing)

                Button {
                    onAdd()
                } label: {
                    Label("Add Widgets", systemImage: "rectangle.stack.badge.plus")
                }
                .buttonStyle(.borderedProminent)

                Spacer()
            }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.panelFill)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.panelBorder, lineWidth: 1)
        )
    }
}

private struct NativeWidgetConfigStat: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(.caption2)
                .modifier(FontWeightModifier(weight: .semibold))
                .foregroundStyle(.secondary)
                .modifier(TrackingModifier(value: 0.5))
            Text(value)
                .font(.callout)
                .modifier(FontWeightModifier(weight: .semibold))
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.panelFillStrong)
        )
    }
}

private struct NativeLiveDetailView: View {
    @ObservedObject var viewModel: DashboardViewModel

    private var sessions: [LiveSessionRow] {
        viewModel.liveSessionsSnapshot?.sessions ?? []
    }

    private var activeSessions: [LiveSessionRow] {
        viewModel.activeLiveSessions
    }

    private var operations: [LiveSessionRow] {
        if sessions.isEmpty { return activeSessions }
        return sessions
    }

    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader(title: "Live") {
                    NativeFreshnessText(generatedAt: viewModel.liveSessionsSnapshot?.generatedAt)
                }

                NativeLiveKPIStrip(
                    activeCount: activeSessions.count,
                    todayTokens: viewModel.todayTokens,
                    todayCost: viewModel.todayCost,
                    limitCount: NativeLiveLimitRow.rows(from: viewModel.usageLimits).count
                )

                HStack(alignment: .top, spacing: 12) {
                    NativeLiveSessionCard(sessions: activeSessions)
                        .frame(minWidth: 0, maxWidth: .infinity)

                    NativeLiveLimitsCard(limits: viewModel.usageLimits)
                        .frame(width: 300)
                }

                NativeLiveOperationsTable(sessions: Array(operations.prefix(50)))
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 18)
        }
        .background(
            LinearGradient(
                colors: [Color.chromeTop, Color.chromeBottom],
                startPoint: .top,
                endPoint: .bottom
            )
        )
    }
}

private struct NativeFreshnessText: View {
    let generatedAt: String?

    var body: some View {
        Text(label)
            .font(.caption2)
            .foregroundStyle(.secondary)
            .monospacedDigit()
    }

    private var label: String {
        guard let date = parseDate(generatedAt) else { return "Waiting for live data" }
        let interval = max(Date().timeIntervalSince(date), 0)
        if interval < 30 { return "LIVE" }
        if interval < 60 { return "just now" }
        if interval < 3600 { return "\(Int(interval / 60))m ago" }
        if interval < 86400 { return "\(Int(interval / 3600))h ago" }
        return "\(Int(interval / 86400))d ago"
    }
}

private struct NativeLiveKPIStrip: View {
    let activeCount: Int
    let todayTokens: Int
    let todayCost: String
    let limitCount: Int

    var body: some View {
        HStack(spacing: 0) {
            NativeLiveKPICell(
                label: "Active sessions",
                value: activeCount > 0 ? "\(activeCount)" : "None",
                detail: activeCount > 0 ? "running now" : "idle now",
                isHero: true
            )
            NativeLiveKPICell(
                label: "Today's tokens",
                value: TokenFormatter.formatCompact(todayTokens),
                detail: "from local ledger",
                isHero: false
            )
            NativeLiveKPICell(
                label: "Today's cost",
                value: todayCost,
                detail: "estimated spend",
                isHero: false
            )
            NativeLiveKPICell(
                label: "Provider limits",
                value: limitCount > 0 ? "\(limitCount)" : "None",
                detail: limitCount > 0 ? "configured windows" : "not configured",
                isHero: false
            )
        }
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color.panelBorder, lineWidth: 0.5)
        )
    }
}

private struct NativeLiveKPICell: View {
    let label: String
    let value: String
    let detail: String
    let isHero: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(label)
                .font(.caption2)
                .modifier(FontWeightModifier(weight: .semibold))
                .foregroundStyle(isHero ? Color.white.opacity(0.76) : .secondary)
                .textCase(.uppercase)
                .modifier(TrackingModifier(value: 0.6))

            Text(value)
                .font(.system(size: 24, weight: .semibold, design: .rounded))
                .foregroundStyle(isHero ? .white : .primary)
                .monospacedDigit()

            Text(detail)
                .font(.caption2)
                .foregroundStyle(isHero ? Color.white.opacity(0.72) : Color.secondary.opacity(0.68))
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, minHeight: 104, alignment: .leading)
        .padding(14)
        .background(isHero ? Color.brand600 : Color.panelFill)
        .overlay(alignment: .trailing) {
            if !isHero {
                Rectangle()
                    .fill(Color.panelBorder)
                    .frame(width: 0.5)
                    .opacity(0.7)
            }
        }
    }
}

private struct NativeLiveSessionCard: View {
    let sessions: [LiveSessionRow]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Sessions") {
                Text("\(sessions.count) active")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }

            if sessions.isEmpty {
                NativeLiveEmptyState()
            } else {
                VStack(spacing: 0) {
                    ForEach(sessions.prefix(20)) { session in
                        NativeLiveSessionRow(session: session)
                        if session.id != sessions.prefix(20).last?.id {
                            Divider().opacity(0.35)
                        }
                    }
                }
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(.regularMaterial)
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(Color.panelBorder, lineWidth: 0.5)
                )
        )
    }
}

private struct NativeLiveSessionRow: View {
    let session: LiveSessionRow

    var body: some View {
        HStack(spacing: 10) {
            NativeLiveDot(active: session.isActive)
            ProviderLogoView(provider: session.provider ?? "", size: 16)

            VStack(alignment: .leading, spacing: 2) {
                Text(session.displayProvider)
                    .font(.caption)
                    .modifier(FontWeightModifier(weight: .semibold))
                Text(session.displayContext)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 2) {
                Text(session.displayCost)
                    .font(.caption)
                    .modifier(FontWeightModifier(weight: .semibold))
                    .monospacedDigit()
                if let tokens = session.totalTokens, tokens > 0 {
                    Text(TokenFormatter.formatCompact(tokens))
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .monospacedDigit()
                }
            }
        }
        .frame(height: 36)
        .accessibilityElement(children: .combine)
    }
}

private struct NativeLiveDot: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var faded = false
    let active: Bool

    var body: some View {
        Circle()
            .fill(active ? Color.brand : Color.secondary.opacity(0.42))
            .frame(width: 8, height: 8)
            .opacity(active && !reduceMotion ? (faded ? 0.6 : 1.0) : 1.0)
            .onAppear {
                guard active, !reduceMotion else { return }
                withAnimation(NativeMotion.Ease.linear(duration: 1.6).repeatForever(autoreverses: true)) {
                    faded = true
                }
            }
            .accessibilityHidden(true)
    }
}

private struct NativeLiveEmptyState: View {
    var body: some View {
        VStack(spacing: 8) {
            ThreePlaneTinyMark()
                .frame(width: 44, height: 32)
                .foregroundStyle(Color.secondary.opacity(0.28))
                .accessibilityHidden(true)
            Text("Nothing's running right now")
                .font(.callout)
                .modifier(FontWeightModifier(weight: .semibold))
            Text("Recent operations stay visible below when the live snapshot has history.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 320)
        }
        .frame(maxWidth: .infinity, minHeight: 190)
    }
}

private struct NativeLiveLimitsCard: View {
    let limits: UsageLimitsResponse?

    private var rows: [NativeLiveLimitRow] {
        Array(NativeLiveLimitRow.rows(from: limits).prefix(5))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Provider limits")

            if rows.isEmpty {
                PlaceholderBlock(height: 188, hint: "No configured provider limits yet.")
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(rows) { row in
                        VStack(alignment: .leading, spacing: 5) {
                            HStack(spacing: 7) {
                                ProviderLogoView(provider: row.provider, size: 14)
                                Text(row.title)
                                    .font(.caption)
                                    .modifier(FontWeightModifier(weight: .semibold))
                                    .lineLimit(1)
                                Spacer(minLength: 6)
                                Text("\(Int(row.percent.rounded()))%")
                                    .font(.caption)
                                    .monospacedDigit()
                                    .foregroundStyle(.secondary)
                            }

                            GeometryReader { proxy in
                                ZStack(alignment: .leading) {
                                    Capsule().fill(Color.limitTrack)
                                    Capsule()
                                        .fill(Color.limitBar(fraction: row.percent / 100))
                                        .frame(width: max(4, proxy.size.width * min(max(row.percent / 100, 0), 1)))
                                }
                            }
                            .frame(height: 6)

                            Text(row.resetLabel)
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                    }
                }
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(.regularMaterial)
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(Color.panelBorder, lineWidth: 0.5)
                )
        )
    }
}

private struct NativeLiveLimitRow: Identifiable {
    let provider: String
    let label: String
    let percent: Double
    let resetAt: Date?

    var id: String { "\(provider)-\(label)" }
    var title: String { "\(displayProvider) \(label)" }
    var displayProvider: String { LimitsSettingsStore.displayNames[ProviderLogoView.normalizedProviderId(from: provider)] ?? provider.capitalized }
    var resetLabel: String {
        guard let resetAt else { return "reset time unavailable" }
        return "resets \(relativeFuture(from: resetAt))"
    }

    static func rows(from limits: UsageLimitsResponse?) -> [NativeLiveLimitRow] {
        guard let limits else { return [] }
        var rows: [NativeLiveLimitRow] = []

        if limits.claude.configured, limits.claude.error == nil {
            append(&rows, provider: "claude", label: "5h", percent: limits.claude.fiveHour?.utilization, iso: limits.claude.fiveHour?.resetsAt)
            append(&rows, provider: "claude", label: "7d", percent: limits.claude.sevenDay?.utilization, iso: limits.claude.sevenDay?.resetsAt)
            append(&rows, provider: "claude", label: "Opus", percent: limits.claude.sevenDayOpus?.utilization, iso: limits.claude.sevenDayOpus?.resetsAt)
        }
        if limits.codex.configured, limits.codex.error == nil {
            append(&rows, provider: "codex", label: "5h", percent: limits.codex.primaryWindow.map { Double($0.usedPercent) }, epoch: limits.codex.primaryWindow?.resetAt)
            append(&rows, provider: "codex", label: "7d", percent: limits.codex.secondaryWindow.map { Double($0.usedPercent) }, epoch: limits.codex.secondaryWindow?.resetAt)
        }
        if limits.cursor.configured, limits.cursor.error == nil {
            append(&rows, provider: "cursor", label: "Plan", percent: limits.cursor.primaryWindow?.usedPercent, iso: limits.cursor.primaryWindow?.resetAt)
            append(&rows, provider: "cursor", label: "Auto", percent: limits.cursor.secondaryWindow?.usedPercent, iso: limits.cursor.secondaryWindow?.resetAt)
        }
        if limits.gemini.configured, limits.gemini.error == nil {
            append(&rows, provider: "gemini", label: "Pro", percent: limits.gemini.primaryWindow?.usedPercent, iso: limits.gemini.primaryWindow?.resetAt)
        }
        if let kimi = limits.kimi, kimi.configured, kimi.error == nil {
            append(&rows, provider: "kimi", label: "Weekly", percent: kimi.primaryWindow?.usedPercent, iso: kimi.primaryWindow?.resetAt)
        }
        if limits.kiro.configured, limits.kiro.error == nil {
            append(&rows, provider: "kiro", label: "Month", percent: limits.kiro.primaryWindow?.usedPercent, iso: limits.kiro.primaryWindow?.resetAt)
        }
        if let copilot = limits.copilot, copilot.configured, copilot.error == nil {
            append(&rows, provider: "copilot", label: "Premium", percent: copilot.primaryWindow?.usedPercent, iso: copilot.primaryWindow?.resetAt)
        }
        if limits.antigravity.configured, limits.antigravity.error == nil {
            append(&rows, provider: "antigravity", label: "Claude", percent: limits.antigravity.primaryWindow?.usedPercent, iso: limits.antigravity.primaryWindow?.resetAt)
        }

        return rows.sorted {
            if urgency($0.percent) == urgency($1.percent) { return $0.percent > $1.percent }
            return urgency($0.percent) > urgency($1.percent)
        }
    }

    private static func append(_ rows: inout [NativeLiveLimitRow], provider: String, label: String, percent: Double?, iso: String? = nil, epoch: Int? = nil) {
        guard let percent else { return }
        rows.append(
            NativeLiveLimitRow(
                provider: provider,
                label: label,
                percent: min(max(percent, 0), 100),
                resetAt: parseDate(iso) ?? epoch.map { Date(timeIntervalSince1970: TimeInterval($0)) }
            )
        )
    }

    private static func urgency(_ percent: Double) -> Int {
        if percent >= 90 { return 3 }
        if percent >= 70 { return 2 }
        if percent >= 50 { return 1 }
        return 0
    }
}

private struct NativeLiveOperationsTable: View {
    let sessions: [LiveSessionRow]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Operations")

            if sessions.isEmpty {
                PlaceholderBlock(height: 132, hint: "No live operations yet.")
            } else {
                VStack(spacing: 0) {
                    HStack {
                        tableHeader("Provider")
                        tableHeader("Project")
                        tableHeader("Branch")
                        tableHeader("Tokens", alignment: .trailing)
                        tableHeader("Cost", alignment: .trailing)
                    }
                    .frame(height: 28)

                    Divider().opacity(0.45)

                    ForEach(sessions) { session in
                        HStack(spacing: 8) {
                            HStack(spacing: 6) {
                                NativeLiveDot(active: session.isActive)
                                ProviderLogoView(provider: session.provider ?? "", size: 14)
                                Text(session.displayProvider)
                                    .lineLimit(1)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)

                            Text(projectName(session))
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .lineLimit(1)
                            Text(session.branch?.isEmpty == false ? session.branch! : "-")
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .lineLimit(1)
                            Text(session.totalTokens.map(TokenFormatter.formatCompact) ?? "-")
                                .frame(maxWidth: .infinity, alignment: .trailing)
                                .monospacedDigit()
                            Text(session.displayCost)
                                .frame(maxWidth: .infinity, alignment: .trailing)
                                .monospacedDigit()
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(height: 30)
                        Divider().opacity(0.22)
                    }
                }
            }
        }
    }

    private func tableHeader(_ label: String, alignment: Alignment = .leading) -> some View {
        Text(label)
            .font(.caption2)
            .modifier(FontWeightModifier(weight: .semibold))
            .foregroundStyle(.tertiary)
            .textCase(.uppercase)
            .modifier(TrackingModifier(value: 0.5))
            .frame(maxWidth: .infinity, alignment: alignment)
    }

    private func projectName(_ session: LiveSessionRow) -> String {
        let raw = session.repoRoot ?? session.cwd ?? ""
        let name = raw.split(separator: "/").last.map(String.init) ?? ""
        return name.isEmpty ? "Unknown project" : name
    }
}

private struct ThreePlaneTinyMark: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 4)
                .frame(width: 30, height: 10)
                .offset(y: -8)
            RoundedRectangle(cornerRadius: 4)
                .frame(width: 40, height: 10)
            RoundedRectangle(cornerRadius: 4)
                .frame(width: 30, height: 10)
                .offset(y: 8)
        }
    }
}

private func parseDate(_ raw: String?) -> Date? {
    guard let raw, !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
    let iso = ISO8601DateFormatter()
    iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = iso.date(from: raw) { return date }
    iso.formatOptions = [.withInternetDateTime]
    return iso.date(from: raw)
}

private func relativeUpdated(_ date: Date) -> String {
    let seconds = max(Date().timeIntervalSince(date), 0)
    if seconds < 60 { return "just now" }
    if seconds < 3600 { return "\(Int(seconds / 60))m ago" }
    if seconds < 86400 { return "\(Int(seconds / 3600))h ago" }
    return "\(Int(seconds / 86400))d ago"
}

private func relativeFuture(from date: Date) -> String {
    let seconds = max(date.timeIntervalSince(Date()), 0)
    if seconds < 60 { return "now" }
    if seconds < 3600 { return "in \(Int(seconds / 60))m" }
    if seconds < 86400 {
        let hours = Int(seconds / 3600)
        let minutes = Int(seconds.truncatingRemainder(dividingBy: 3600) / 60)
        return minutes > 0 ? "in \(hours)h \(minutes)m" : "in \(hours)h"
    }
    return "in \(Int(seconds / 86400))d"
}

private struct NativeWebViewHost: NSViewRepresentable {
    let webView: WKWebView

    func makeNSView(context: Context) -> WKWebView {
        webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
