import AppKit

/// Three-plane menu bar mark with subtle state frames.
/// The popover can use Clawd, but the always-visible status item stays on the
/// monochrome product mark so it tints cleanly with macOS menu bar colors.
@MainActor
final class MenuBarAnimator {

    enum State: Equatable {
        case idle
        case active
        case syncing
        case disconnected
    }

    // MARK: - Properties

    private weak var button: NSStatusBarButton?
    private var animationTimer: Timer?
    private var blinkTimer: Timer?
    private var frameIndex = 0
    private(set) var currentState: State = .idle
    private var renderedImage: NSImage

    /// UserDefaults key for animation toggle
    private static let enabledKey = "MenuBarAnimationEnabled"

    /// Static fallback icon (original lightning bolt)
    private let fallbackIcon: NSImage

    private let canvasSize = NSSize(width: 22, height: 22)

    // Pre-rendered frames
    /// The current icon image (for external use, e.g. stats rendering)
    var currentImage: NSImage { renderedImage }
    var onImageUpdated: ((NSImage) -> Void)?

    private lazy var idleFrame = buildMarkFrame(alpha: 1.0)
    private lazy var blinkFrame = buildMarkFrame(alpha: 0.6)
    private lazy var reducedMotionActiveFrame = buildMarkFrame(alpha: 1.0, drawStatusDot: true)
    private lazy var syncFrames = buildSyncFrames()
    private lazy var disconnectedFrame = buildDisconnectedFrame()

    /// Whether pixel animation is enabled (persisted in UserDefaults)
    var isEnabled: Bool {
        get { UserDefaults.standard.object(forKey: Self.enabledKey) as? Bool ?? true }
        set {
            UserDefaults.standard.set(newValue, forKey: Self.enabledKey)
            applyCurrentState()
        }
    }

    // MARK: - Init

    init(button: NSStatusBarButton) {
        self.button = button
        let icon = NSImage(named: "MenuBarIcon") ?? NSImage()
        icon.isTemplate = true
        self.fallbackIcon = icon
        self.renderedImage = icon
        applyCurrentState()
    }

    // MARK: - Public

    func setState(_ newState: State) {
        guard newState != currentState else { return }
        currentState = newState
        applyCurrentState()
    }

    func applyCurrentState() {
        frameIndex = 0
        stopAnimation()
        cancelBlink()

        guard isEnabled else {
            setButtonImage(fallbackIcon)
            return
        }

        if reduceMotion {
            switch currentState {
            case .active, .syncing:
                setButtonImage(reducedMotionActiveFrame)
            case .disconnected:
                setButtonImage(disconnectedFrame)
            case .idle:
                setButtonImage(idleFrame)
            }
            return
        }

        switch currentState {
        case .idle:
            setButtonImage(idleFrame)
        case .active:
            startAnimation(interval: 0.4)
        case .syncing:
            startAnimation(interval: 0.4)
        case .disconnected:
            setButtonImage(disconnectedFrame)
        }
    }

    // MARK: - Animation Loop

    private func startAnimation(interval: TimeInterval) {
        tick()
        animationTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
    }

    private func stopAnimation() {
        animationTimer?.invalidate()
        animationTimer = nil
    }

    private func tick() {
        guard (currentState == .syncing || currentState == .active), !syncFrames.isEmpty else { return }
        setButtonImage(syncFrames[frameIndex % syncFrames.count])
        frameIndex += 1
    }

    // MARK: - Idle Blink

    private func scheduleNextBlink() {
        cancelBlink()
        let delay = TimeInterval.random(in: 3...6)
        blinkTimer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
            Task { @MainActor in self?.playBlink() }
        }
    }

    private func cancelBlink() {
        blinkTimer?.invalidate()
        blinkTimer = nil
    }

    private func playBlink() {
        guard currentState == .idle, !reduceMotion, isEnabled else {
            if currentState == .idle { scheduleNextBlink() }
            return
        }
        setButtonImage(blinkFrame)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
            guard let self, self.currentState == .idle else { return }
            self.setButtonImage(self.idleFrame)
            self.scheduleNextBlink()
        }
    }

    // MARK: - Sync Frames

    /// Opacity pulse: 1.6s full cycle, matching the DESIGN.md menubar pulse.
    private func buildSyncFrames() -> [NSImage] {
        [
            buildMarkFrame(alpha: 1.0),
            buildMarkFrame(alpha: 0.8),
            buildMarkFrame(alpha: 0.6),
            buildMarkFrame(alpha: 0.8),
        ]
    }

    // MARK: - Disconnected Frame

    private func buildDisconnectedFrame() -> NSImage {
        buildMarkFrame(alpha: 0.45, drawSlash: true)
    }

    // MARK: - Frame Drawing

    private func buildMarkFrame(alpha: CGFloat, drawSlash: Bool = false, drawStatusDot: Bool = false) -> NSImage {
        let img = NSImage(size: canvasSize, flipped: true) { [self] _ in
            guard let ctx = NSGraphicsContext.current?.cgContext else { return false }

            drawPlane(points: [
                CGPoint(x: 3.0, y: 8.2),
                CGPoint(x: 13.6, y: 8.2),
                CGPoint(x: 17.3, y: 5.6),
                CGPoint(x: 6.7, y: 5.6),
            ], alpha: alpha * 0.55)
            drawPlane(points: [
                CGPoint(x: 3.0, y: 11.0),
                CGPoint(x: 13.6, y: 11.0),
                CGPoint(x: 17.3, y: 8.2),
                CGPoint(x: 6.7, y: 8.2),
            ], alpha: alpha * 0.78)
            drawPlane(points: [
                CGPoint(x: 3.0, y: 13.8),
                CGPoint(x: 13.6, y: 13.8),
                CGPoint(x: 17.3, y: 11.0),
                CGPoint(x: 6.7, y: 11.0),
            ], alpha: alpha)

            if drawSlash {
                ctx.setLineWidth(1.8)
                ctx.setLineCap(.round)
                NSColor.black.withAlphaComponent(0.68).setStroke()
                ctx.move(to: CGPoint(x: 5.0, y: 16.0))
                ctx.addLine(to: CGPoint(x: 17.0, y: 4.0))
                ctx.strokePath()
            }

            if drawStatusDot {
                let dot = CGRect(x: 15.2, y: 3.2, width: 3.8, height: 3.8)
                NSColor.black.withAlphaComponent(0.9).setFill()
                ctx.fillEllipse(in: dot)
            }

            return true
        }
        img.isTemplate = true
        return img
    }

    private func drawPlane(points: [CGPoint], alpha: CGFloat) {
        guard let first = points.first else { return }
        let path = NSBezierPath()
        path.move(to: first)
        points.dropFirst().forEach { path.line(to: $0) }
        path.close()
        NSColor.black.withAlphaComponent(alpha).setFill()
        path.fill()
    }

    // MARK: - Helpers

    private func setButtonImage(_ image: NSImage) {
        renderedImage = image
        button?.image = image
        onImageUpdated?(image)
    }

    private var reduceMotion: Bool {
        NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    }
}
