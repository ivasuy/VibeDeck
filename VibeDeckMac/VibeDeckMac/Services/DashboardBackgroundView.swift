import AppKit


@MainActor
enum DashboardBackgroundView {


    static func makeFullWindowBackground() -> NSView {
        if #available(macOS 26, *) {
            if let glass = makeLiquidGlassBackgroundView() {
                return glass
            }
        }
        return makeClassicVisualEffectBackground()
    }



    private static func makeClassicVisualEffectBackground() -> NSView {
        let visualEffectBackground = NSVisualEffectView()
        visualEffectBackground.translatesAutoresizingMaskIntoConstraints = false
        visualEffectBackground.material = .sidebar
        visualEffectBackground.blendingMode = .withinWindow
        visualEffectBackground.state = .active
        return visualEffectBackground
    }



    private static func makeLiquidGlassBackgroundView() -> NSView? {
        guard let glassClass = NSClassFromString("NSGlassEffectView") as? NSView.Type else {
            return nil
        }
        let glass = glassClass.init(frame: .zero)
        glass.translatesAutoresizingMaskIntoConstraints = false
        if glass.responds(to: NSSelectorFromString("setCornerRadius:")) {
            glass.setValue(NSNumber(value: 0.0), forKey: "cornerRadius")
        }

        let inner = NSView()
        inner.translatesAutoresizingMaskIntoConstraints = false
        inner.wantsLayer = true
        inner.layer?.backgroundColor = NSColor.clear.cgColor
        guard glass.responds(to: NSSelectorFromString("setContentView:")) else { return nil }
        glass.setValue(inner, forKey: "contentView")

        NSLayoutConstraint.activate([
            inner.leadingAnchor.constraint(equalTo: glass.leadingAnchor),
            inner.trailingAnchor.constraint(equalTo: glass.trailingAnchor),
            inner.topAnchor.constraint(equalTo: glass.topAnchor),
            inner.bottomAnchor.constraint(equalTo: glass.bottomAnchor),
        ])
        return glass
    }
}
