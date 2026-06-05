import SwiftUI
import WidgetKit

// Hero-number summary widget. Each size promotes one primary number and lets
// the rest of the information serve it. Static configuration: each widget kind
// has a fixed, focused job (no period/metric switcher).

struct SummaryWidget: Widget {
    let kind: String = "VibeDeckSummaryWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: StaticSnapshotProvider()) { entry in
            SummaryWidgetView(entry: entry)
                .modifier(WidgetFamilyPadding())
                .containerBackground(for: .widget) {
                    WidgetTheme.widgetBackground
                }
                .widgetURL(WidgetDeepLink.url("dashboard"))
        }
        .contentMarginsDisabled()
        .configurationDisplayName(WidgetStrings.usageName)
        .description(WidgetStrings.usageDescription)
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct SummaryWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: StaticEntry

    var body: some View {
        if entry.snapshot.hasSummaryUsage {
            switch family {
            case .systemSmall:      SmallView(snap: entry.snapshot)
            case .systemMedium:     MediumView(snap: entry.snapshot)
            case .systemLarge:      LargeView(snap: entry.snapshot)
            default:                MediumView(snap: entry.snapshot)
            }
        } else {
            SummaryEmptyView(updated: entry.snapshot.generatedAt)
        }
    }
}

// MARK: - Small (2x2): Today only

private struct SmallView: View {
    let snap: WidgetSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SummaryTitleRow(title: WidgetStrings.today, updated: snap.generatedAt)

            Spacer(minLength: 0)

            Text(WidgetFormat.cost(snap.today.costUsd))
                .font(.system(size: 28, weight: .semibold, design: .rounded))
                .foregroundColor(.primary)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.5)

            Text("\(WidgetFormat.compact(snap.today.tokens)) tokens")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.secondary)
                .monospacedDigit()

            SparklineView(points: Array(snap.dailyTrend.suffix(7)))
                .frame(height: 24)

            Spacer(minLength: 0)

            if let todayDeltaPercent = snap.todayDeltaPercent {
                DeltaLine(delta: todayDeltaPercent)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(summaryAccessibility(snap, updated: snap.generatedAt, providerCount: 0))
    }
}

// MARK: - Medium (4x2): Today + 7d, with sparkline

private struct MediumView: View {
    let snap: WidgetSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SummaryTitleRow(title: WidgetStrings.today, updated: snap.generatedAt)

            HStack(alignment: .top, spacing: 18) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(WidgetFormat.cost(snap.today.costUsd))
                        .font(.system(size: 28, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                    Text("\(WidgetFormat.compact(snap.today.tokens)) tokens")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                    SparklineView(points: Array(snap.dailyTrend.suffix(20)))
                        .frame(height: 32)
                    if let todayDeltaPercent = snap.todayDeltaPercent {
                        DeltaLine(delta: todayDeltaPercent)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                ProviderList(sources: Array(snap.sources.prefix(4)))
                    .frame(width: 112, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(summaryAccessibility(snap, updated: snap.generatedAt, providerCount: 4))
    }
}

// MARK: - Large (4x4): Today + 7d + 30d + bar chart + top 3 models

private struct LargeView: View {
    let snap: WidgetSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SummaryTitleRow(title: WidgetStrings.today, updated: snap.generatedAt)
            HStack(alignment: .top, spacing: 18) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(WidgetFormat.cost(snap.today.costUsd))
                        .font(.system(size: 28, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                    Text("\(WidgetFormat.compact(snap.today.tokens)) tokens")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                    SparklineView(points: Array(snap.dailyTrend.suffix(20)))
                        .frame(height: 34)
                    if let todayDeltaPercent = snap.todayDeltaPercent {
                        DeltaLine(delta: todayDeltaPercent)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                ProviderList(sources: Array(snap.sources.prefix(5)))
                    .frame(width: 118, alignment: .leading)
            }

            Divider()

            VStack(alignment: .leading, spacing: 10) {
                Text(WidgetStrings.sevenDays)
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(0.6)
                    .foregroundColor(.secondary)
                BarTrendChart(points: Array(snap.dailyTrend.suffix(7)))
                    .frame(maxWidth: .infinity, minHeight: 64)
                HStack(spacing: 4) {
                    Text("\(WidgetFormat.cost(snap.last7d.costUsd)) total")
                        .monospacedDigit()
                    Text("·")
                    Text("\(snap.last7d.activeDays) active days")
                        .monospacedDigit()
                }
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(summaryAccessibility(snap, updated: snap.generatedAt, providerCount: 5))
    }
}

private struct SummaryEmptyView: View {
    let updated: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SummaryTitleRow(title: WidgetStrings.today, updated: updated)
            WidgetEmptyState(message: WidgetStrings.noUsageData)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("No usage yet, updated \(WidgetFormat.relativeUpdated(updated))")
    }
}

private struct SummaryTitleRow: View {
    let title: String
    let updated: Date

    var body: some View {
        HStack(alignment: .lastTextBaseline) {
            Text(title)
                .font(.system(size: 10, weight: .semibold))
                .tracking(0.6)
                .foregroundColor(.secondary)
            Spacer(minLength: 0)
            Text(WidgetFormat.relativeUpdated(updated))
                .font(.system(size: 9))
                .foregroundColor(.secondary.opacity(0.75))
                .monospacedDigit()
        }
        .frame(height: 16)
    }
}

private struct DeltaLine: View {
    let delta: Double

    var body: some View {
        HStack(spacing: 4) {
            Text(WidgetFormat.delta(delta))
                .foregroundStyle(WidgetFormat.deltaColor(delta))
                .monospacedDigit()
            Text(WidgetStrings.vsYesterday)
                .foregroundStyle(.secondary)
        }
        .font(.system(size: 10, weight: .semibold, design: .rounded))
    }
}

private extension WidgetSnapshot {
    var hasSummaryUsage: Bool {
        today.tokens > 0 ||
            today.costUsd > 0 ||
            last7d.tokens > 0 ||
            last7d.costUsd > 0 ||
            last30d.tokens > 0 ||
            last30d.costUsd > 0 ||
            total.tokens > 0 ||
            total.costUsd > 0 ||
            dailyTrend.contains { $0.totalTokens > 0 || $0.costUsd > 0 } ||
            sources.contains { $0.tokens > 0 || $0.costUsd > 0 }
    }
}

private func summaryAccessibility(_ snap: WidgetSnapshot, updated: Date, providerCount: Int) -> String {
    var parts = [
        "Today's spend \(WidgetFormat.cost(snap.today.costUsd))",
        "\(WidgetFormat.compact(snap.today.tokens)) tokens",
    ]
    if let delta = snap.todayDeltaPercent {
        parts.append("\(WidgetFormat.delta(delta)) versus yesterday")
    }
    if providerCount > 0 {
        let providers = snap.sources.prefix(providerCount).map { source in
            "\(source.source.capitalized) \(Int(source.sharePercent.rounded())) percent"
        }
        if !providers.isEmpty {
            parts.append("Provider mix \(providers.joined(separator: ", "))")
        }
    }
    parts.append("updated \(WidgetFormat.relativeUpdated(updated))")
    return parts.joined(separator: ", ")
}

private struct ProviderList: View {
    let sources: [SnapshotSourceEntry]

    var body: some View {
        let segments = sources.map { source in
            WidgetBarSegment(
                id: source.source,
                label: source.source.capitalized,
                fraction: source.sharePercent / 100,
                color: WidgetTheme.sourceColor(source.source)
            )
        }

        VStack(alignment: .leading, spacing: 6) {
            Text("PROVIDERS")
                .font(.system(size: 9, weight: .semibold))
                .tracking(0.6)
                .foregroundColor(.secondary)
            SegmentedBar(segments: segments)
            ForEach(sources) { source in
                HStack(spacing: 5) {
                    WidgetProviderLogo(source: source.source, size: 11)
                    Text(source.source.capitalized)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    Text(String(format: "%.0f%%", source.sharePercent))
                        .monospacedDigit()
                }
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(.secondary)
            }
        }
    }
}
