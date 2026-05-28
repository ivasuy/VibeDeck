import SwiftUI

/// Applies `.tracking()` on macOS 13+ and is a no-op on older versions.
struct TrackingModifier: ViewModifier {
    let value: CGFloat
    func body(content: Content) -> some View {
        if #available(macOS 13, *) {
            content.tracking(value)
        } else {
            content
        }
    }
}

/// Applies `.fontWeight()` on macOS 13+ and is a no-op on older versions.
struct FontWeightModifier: ViewModifier {
    let weight: Font.Weight
    func body(content: Content) -> some View {
        if #available(macOS 13, *) {
            content.fontWeight(weight)
        } else {
            content
        }
    }
}

/// Unified section header used across all dashboard sections.
struct SectionHeader<Trailing: View>: View {
    let title: String
    @ViewBuilder let trailing: () -> Trailing

    init(title: String, @ViewBuilder trailing: @escaping () -> Trailing = { EmptyView() }) {
        self.title = title
        self.trailing = trailing
    }

    var body: some View {
        HStack {
            Text(title)
                .font(.caption)
                .modifier(FontWeightModifier(weight: .semibold))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
                .modifier(TrackingModifier(value: 0.5))
            Spacer()
            trailing()
        }
    }
}

/// Rounded placeholder shown when a section has no data yet.
struct PlaceholderBlock: View {
    let height: CGFloat
    var hint: String = Strings.noData

    var body: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(Color.panelFill)
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color.panelBorder, lineWidth: 1)
            )
            .frame(height: height)
            .overlay(
                Text(hint)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 12)
            )
    }
}

struct ProviderLogoView: View {
    @Environment(\.colorScheme) private var colorScheme

    let provider: String
    var size: CGFloat = 16

    var body: some View {
        logo
            .frame(width: size, height: size)
            .accessibilityLabel("\(displayName(for: providerId)) logo")
    }

    private var providerId: String {
        Self.normalizedProviderId(from: provider)
    }

    @ViewBuilder
    private var logo: some View {
        if let filename = Self.monoSVGFilename(for: providerId),
           let image = BrandLogoResolver.shared.image(
               named: filename,
               replacingCurrentColorWith: colorScheme == .dark ? "#FFFFFF" : "#111111",
               targetSize: Int(max(size, 16))
           ) {
            Image(nsImage: image)
                .resizable()
                .interpolation(.high)
                .scaledToFit()
        } else if let iconName = LimitsSettingsStore.iconNames[providerId] {
            Image(iconName)
                .renderingMode(.original)
                .resizable()
                .interpolation(.high)
                .scaledToFit()
        } else {
            Image(colorScheme == .dark ? "VibeDeckIconDark" : "VibeDeckIconLight")
                .renderingMode(.original)
                .resizable()
                .interpolation(.high)
                .scaledToFit()
        }
    }

    private func displayName(for id: String) -> String {
        LimitsSettingsStore.displayNames[id] ?? "Provider"
    }

    static func normalizedProviderId(from source: String) -> String {
        let normalized = source
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "_", with: "-")

        if normalized.contains("copilot") { return "copilot" }
        if normalized.contains("cursor") { return "cursor" }
        if normalized.contains("gemini") || normalized.contains("google") { return "gemini" }
        if normalized.contains("kiro") { return "kiro" }
        if normalized.contains("kimi") { return "kimi" }
        if normalized.contains("factory") || normalized.contains("droid") { return "factoryai" }
        if normalized.contains("hermes") { return "hermes" }
        if normalized.contains("openclaw") || normalized.contains("open-claw") { return "openclaw" }
        if normalized.contains("opencode") || normalized.contains("open-code") { return "opencode" }
        if normalized.contains("claw") || normalized.contains("antigravity") { return "antigravity" }
        if normalized.contains("openai") || normalized.contains("codex") { return "codex" }
        if normalized.contains("claude") || normalized.contains("anthropic") { return "claude" }
        return normalized
    }

    static func monoSVGFilename(for providerId: String) -> String? {
        switch providerId {
        case "copilot": return "copilot.svg"
        case "cursor": return "cursor.svg"
        case "factoryai": return "factoryai-droid.svg"
        case "kimi": return "kimi.svg"
        case "kiro": return "kiro.svg"
        default: return nil
        }
    }
}
