import SwiftUI
import WidgetKit

// Ranked-bar widget. The list IS the widget — no title, no footer. The
// rank position, color dot, and bar length carry the hierarchy.

struct TopModelsWidget: Widget {
    let kind: String = "VibeDeckTopModelsWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: StaticSnapshotProvider()) { entry in
            TopModelsWidgetView(entry: entry)
                .modifier(WidgetFamilyPadding())
                .containerBackground(for: .widget) {
                    WidgetTheme.widgetBackground
                }
                .widgetURL(WidgetDeepLink.url("models"))
        }
        .contentMarginsDisabled()
        .configurationDisplayName(WidgetStrings.topModelsName)
        .description(WidgetStrings.topModelsDescription)
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct TopModelsWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: StaticEntry

    private var limit: Int {
        switch family {
        case .systemSmall: return 1
        case .systemMedium: return 3
        default: return 5
        }
    }

    var body: some View {
        let models = Array(entry.snapshot.topModels.prefix(limit))

        if models.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                WidgetHeader(title: "TOP MODELS", subtitle: WidgetFormat.relativeUpdated(entry.snapshot.generatedAt), icon: "circle.fill")
                WidgetEmptyState(message: WidgetStrings.noModelUsage)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        } else {
            switch family {
            case .systemSmall:
                TopModelSmall(model: models[0], updated: entry.snapshot.generatedAt)
            case .systemLarge:
                TopModelsLarge(models: models, sources: Array(entry.snapshot.sources.prefix(3)), updated: entry.snapshot.generatedAt)
            default:
                TopModelsList(models: models, updated: entry.snapshot.generatedAt)
            }
        }
    }
}

private struct TopModelSmall: View {
    let model: SnapshotModelEntry
    let updated: Date

    var body: some View {
        let share = max(0, min(100, model.sharePercent)) / 100.0

        VStack(alignment: .leading, spacing: 9) {
            WidgetHeader(title: "TOP MODEL", subtitle: WidgetFormat.relativeUpdated(updated), icon: "circle.fill")

            Spacer(minLength: 0)

            HStack(alignment: .center, spacing: 6) {
                WidgetProviderLogo(source: model.source, size: 14)
                Text(model.name)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.primary)
                    .lineLimit(2)
                    .truncationMode(.middle)
            }

            Text(WidgetFormat.cost(model.costUsd))
                .font(.system(size: 26, weight: .semibold, design: .rounded))
                .foregroundColor(.primary)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.65)

            Text("\(WidgetFormat.compact(model.tokens)) tokens")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(.secondary)
                .monospacedDigit()

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(WidgetTheme.limitTrack)
                    RoundedRectangle(cornerRadius: 3)
                        .fill(WidgetTheme.modelDot(0))
                        .frame(width: max(geo.size.width * share, share > 0 ? 4 : 0))
                }
            }
            .frame(height: 5)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            "Top model \(model.name), \(WidgetFormat.cost(model.costUsd)), \(WidgetFormat.compact(model.tokens)) tokens, \(Int(model.sharePercent.rounded())) percent share, updated \(WidgetFormat.relativeUpdated(updated))"
        )
    }
}

private struct TopModelsList: View {
    let models: [SnapshotModelEntry]
    let updated: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            WidgetHeader(title: "TOP MODELS", subtitle: WidgetFormat.relativeUpdated(updated), icon: "circle.fill")
            ForEach(Array(models.enumerated()), id: \.element.id) { idx, model in
                ModelBar(rank: idx, model: model, compact: false)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct TopModelsLarge: View {
    let models: [SnapshotModelEntry]
    let sources: [SnapshotSourceEntry]
    let updated: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            TopModelsList(models: models, updated: updated)

            if !sources.isEmpty {
                Divider()

                VStack(alignment: .leading, spacing: 8) {
                    Text("BY PROVIDER")
                        .font(.system(size: 10, weight: .semibold))
                        .tracking(0.6)
                        .foregroundStyle(.secondary)

                    ForEach(sources) { source in
                        ProviderShareRow(source: source)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct ModelBar: View {
    let rank: Int
    let model: SnapshotModelEntry
    let compact: Bool

    var body: some View {
        let share = max(0, min(100, model.sharePercent)) / 100.0
        let dotColor = WidgetTheme.modelDot(rank)

        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                WidgetProviderLogo(source: model.source, size: compact ? 12 : 13)
                Text(model.name)
                    .font(.system(size: compact ? 10 : 11, weight: .medium))
                    .foregroundColor(.primary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 4)
                Text(WidgetFormat.cost(model.costUsd))
                    .font(.system(size: compact ? 10 : 11, weight: .semibold, design: .rounded))
                    .foregroundColor(.secondary)
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                Text(String(format: "%.0f%%", model.sharePercent))
                    .font(.system(size: compact ? 9 : 10, weight: .semibold, design: .rounded))
                    .foregroundColor(Color.secondary.opacity(0.55))
                    .monospacedDigit()
                    .frame(width: compact ? 24 : 28, alignment: .trailing)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2.5)
                        .fill(WidgetTheme.limitTrack)
                    RoundedRectangle(cornerRadius: 2.5)
                        .fill(dotColor)
                        .frame(width: max(geo.size.width * share, share > 0 ? 4 : 0))
                }
            }
            .frame(height: compact ? 4 : 5)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            "Rank \(rank + 1), \(model.name), \(WidgetFormat.cost(model.costUsd)), \(WidgetFormat.compact(model.tokens)) tokens, \(Int(model.sharePercent.rounded())) percent share"
        )
    }
}

private struct ProviderShareRow: View {
    let source: SnapshotSourceEntry

    var body: some View {
        let share = max(0, min(100, source.sharePercent)) / 100.0

        HStack(spacing: 6) {
            WidgetProviderLogo(source: source.source, size: 12)
            Text(source.source.capitalized)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(.secondary)
                .lineLimit(1)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2.5)
                        .fill(WidgetTheme.limitTrack)
                    RoundedRectangle(cornerRadius: 2.5)
                        .fill(WidgetTheme.sourceColor(source.source))
                        .frame(width: max(geo.size.width * share, share > 0 ? 4 : 0))
                }
            }
            .frame(height: 5)
            Text(String(format: "%.0f%%", source.sharePercent))
                .font(.system(size: 10, weight: .semibold, design: .rounded))
                .foregroundStyle(.secondary)
                .monospacedDigit()
                .frame(width: 28, alignment: .trailing)
            Text(WidgetFormat.cost(source.costUsd))
                .font(.system(size: 10, weight: .semibold, design: .rounded))
                .foregroundStyle(.secondary)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .frame(width: 44, alignment: .trailing)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            "\(source.source.capitalized), \(WidgetFormat.cost(source.costUsd)), \(WidgetFormat.compact(source.tokens)) tokens, \(Int(source.sharePercent.rounded())) percent share"
        )
    }
}
