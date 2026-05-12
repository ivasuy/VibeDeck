import SwiftUI

struct TopModelsView: View {
    @Environment(\.colorScheme) private var colorScheme
    let models: [TopModel]

    var body: some View {
        if !models.isEmpty {
            VStack(alignment: .leading, spacing: 7) {
                SectionHeader(title: Strings.topModelsTitle)
                ForEach(models) { model in
                    HStack(spacing: 5) {
                        providerIcon(for: model.source)
                            .frame(width: 11, height: 11)
                        Text(model.name)
                            .font(.system(.caption, design: .default))
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Spacer(minLength: 4)
                        Text(TokenFormatter.formatCompact(model.tokens))
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.secondary)
                        Text(model.percent + "%")
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.tertiary)
                            .frame(width: 38, alignment: .trailing)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel(
                        Strings.topModelAccessibility(
                            name: model.name,
                            source: model.source,
                            tokens: TokenFormatter.formatCompact(model.tokens),
                            percent: model.percent
                        )
                    )
                }
            }
        }
    }

    @ViewBuilder
    private func providerIcon(for source: String) -> some View {
        let providerId = normalizedProviderId(from: source)
        if let svgFilename = svgFilename(for: providerId),
           let image = BrandLogoResolver.shared.image(
               named: svgFilename,
               replacingCurrentColorWith: colorScheme == .dark ? "#FFFFFF" : "#111111",
               targetSize: 16
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
            Circle()
                .fill(Color.sourceColor(providerId))
        }
    }

    private func normalizedProviderId(from source: String) -> String {
        let normalized = source.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if normalized.contains("copilot") { return "copilot" }
        if normalized.contains("cursor") { return "cursor" }
        if normalized.contains("gemini") { return "gemini" }
        if normalized.contains("kiro") { return "kiro" }
        if normalized.contains("kimi") { return "kimi" }
        if normalized.contains("claw") || normalized.contains("antigravity") { return "antigravity" }
        if normalized.contains("openai") || normalized.contains("codex") { return "codex" }
        if normalized.contains("claude") { return "claude" }
        return normalized
    }

    private func svgFilename(for providerId: String) -> String? {
        switch providerId {
        case "cursor": return "cursor.svg"
        case "kimi": return "kimi.svg"
        case "kiro": return "kiro.svg"
        case "copilot": return "copilot.svg"
        default: return nil
        }
    }
}
