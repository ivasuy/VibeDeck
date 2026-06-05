import SwiftUI
import WidgetKit

// Rate-limit progress widget. The bars ARE the widget — sorted by remaining
// headroom (most-consumed first) so the most urgent provider is always at
// the top. Reset countdown sits beside the bar where space allows.

struct UsageLimitsWidget: Widget {
    let kind: String = "VibeDeckLimitsWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: StaticSnapshotProvider()) { entry in
            UsageLimitsWidgetView(entry: entry)
                .modifier(WidgetFamilyPadding())
                .containerBackground(for: .widget) {
                    WidgetTheme.widgetBackground
                }
                .widgetURL(WidgetDeepLink.url("settings"))
        }
        .contentMarginsDisabled()
        .configurationDisplayName(WidgetStrings.limitsName)
        .description(WidgetStrings.limitsDescription)
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct UsageLimitsWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: StaticEntry

    private var maxRows: Int {
        switch family {
        case .systemSmall: return 1
        case .systemMedium: return 3
        default: return 6
        }
    }

    /// Sort providers so all windows from the same source stay adjacent
    /// (Claude · 7d next to Claude · 5h). Sources are ordered by their
    /// hottest window so the most-urgent provider floats to the top.
    /// Within a source, higher fraction comes first.
    private var orderedRows: [LimitProvider] {
        let grouped = Dictionary(grouping: entry.snapshot.limits, by: { $0.source })
        let orderedGroups = grouped.values.sorted { lhs, rhs in
            (lhs.map(\.fraction).max() ?? 0) > (rhs.map(\.fraction).max() ?? 0)
        }
        let flat = orderedGroups.flatMap { $0.sorted { $0.fraction > $1.fraction } }
        return Array(flat.prefix(maxRows))
    }

    var body: some View {
        let trimmed = orderedRows
        if trimmed.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                WidgetHeader(title: "LIMITS", subtitle: WidgetFormat.relativeUpdated(entry.snapshot.generatedAt), icon: "gauge.with.dots.needle.33percent")
                WidgetEmptyState(message: WidgetStrings.noConfiguredProviders)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        } else if family == .systemSmall, let limit = trimmed.first {
            LimitSmallCard(limit: limit, updated: entry.snapshot.generatedAt)
        } else {
            // Uniform spacing across all rows. The grouping (Claude windows
            // adjacent to each other) is communicated by the dot color and
            // shared "Claude · …" label — no extra gap needed. Vertical
            // centering via top/bottom Spacers; the inner VStack uses
            // fixedSize so it doesn't get stretched by the surrounding
            // GeometryReader inside LimitRow.
            VStack(spacing: 0) {
                WidgetHeader(title: "LIMITS", subtitle: WidgetFormat.relativeUpdated(entry.snapshot.generatedAt), icon: "gauge.with.dots.needle.33percent")
                Spacer(minLength: family == .systemSmall ? 12 : 0)
                VStack(alignment: .leading, spacing: rowGap) {
                    ForEach(trimmed) { (limit: LimitProvider) in
                        LimitRow(limit: limit)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                if family == .systemLarge {
                    ResetTimelineView(limits: trimmed)
                        .padding(.top, 8)
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var rowGap: CGFloat { family == .systemMedium ? 9 : 12 }
}

private struct LimitSmallCard: View {
    let limit: LimitProvider
    let updated: Date

    var body: some View {
        let f = max(0, min(1, limit.fraction))
        let reset = WidgetFormat.relativeReset(limit.resetsAt)
        let percent = WidgetFormat.percent(f * 100, decimals: 0)
        let tokenPair = WidgetFormat.tokenPair(used: limit.usedTokens, limit: limit.limitTokens)

        VStack(alignment: .leading, spacing: 8) {
            WidgetHeader(title: "LIMITS", subtitle: WidgetFormat.relativeUpdated(updated), icon: "gauge.with.dots.needle.33percent")

            Spacer(minLength: 0)

            HStack(spacing: 6) {
                WidgetProviderLogo(source: limit.source, size: 14)
                Text(providerName(limit.source))
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }

            HStack(alignment: .center, spacing: 8) {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 3)
                            .fill(WidgetTheme.limitTrack)
                        RoundedRectangle(cornerRadius: 3)
                            .fill(WidgetTheme.limitBarColor(f))
                            .frame(width: max(geo.size.width * f, f > 0 ? 4 : 0))
                    }
                }
                .frame(height: 6)

                Text(percent)
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundStyle(WidgetTheme.limitBarColor(f))
                    .monospacedDigit()
            }

            Text(tokenPair ?? "\(percent) of \(windowName(limit.label))")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .monospacedDigit()

            if let reset {
                Text("resets \(reset)")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .monospacedDigit()
            }

            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(smallAccessibilityLabel(percent: percent, reset: reset))
    }

    private func providerName(_ source: String) -> String {
        switch source.lowercased() {
        case "codex": return "Codex"
        case "copilot": return "Copilot"
        case "cursor": return "Cursor"
        case "gemini": return "Gemini"
        case "kimi": return "Kimi"
        case "kiro": return "Kiro"
        case "antigravity": return "Antigravity"
        case "claude": return "Claude"
        default: return source.capitalized
        }
    }

    private func windowName(_ label: String) -> String {
        let window = String(label.split(separator: "·").last ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !window.isEmpty {
            return "\(window) window"
        }
        return "limit window"
    }

    private func smallAccessibilityLabel(percent: String, reset: String?) -> String {
        let tokenPair = WidgetFormat.tokenPair(used: limit.usedTokens, limit: limit.limitTokens)
        let base = "\(providerName(limit.source)), \(tokenPair ?? "\(percent) of \(windowName(limit.label))")"
        if let reset {
            return "\(base), resets \(reset)"
        }
        return base
    }
}

private struct LimitRow: View {
    let limit: LimitProvider

    var body: some View {
        let f = max(0, min(1, limit.fraction))
        let reset = WidgetFormat.relativeReset(limit.resetsAt)
        let urgent = f >= 0.9
        let textColor: Color = urgent ? WidgetTheme.limitBarColor(f) : .primary
        let tokenPair = WidgetFormat.tokenPair(used: limit.usedTokens, limit: limit.limitTokens)

        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                WidgetProviderLogo(source: limit.source, size: 12)
                Text(WidgetStrings.limitLabel(limit))
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(textColor)
                    .lineLimit(1)
                Spacer(minLength: 6)
                if let reset {
                    Text(reset)
                        .font(.system(size: 10))
                        .foregroundColor(.secondary)
                        .monospacedDigit()
                }
                Text(WidgetFormat.percent(f * 100, decimals: 0))
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(textColor)
                    .monospacedDigit()
            }
            if let tokenPair {
                Text(tokenPair)
                    .font(.system(size: 9, weight: .medium, design: .rounded))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .monospacedDigit()
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(WidgetTheme.limitTrack)
                    RoundedRectangle(cornerRadius: 3)
                        .fill(WidgetTheme.limitBarColor(f))
                        .frame(width: max(geo.size.width * f, f > 0 ? 4 : 0))
                }
            }
            .frame(height: 5)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilitySummary(percent: WidgetFormat.percent(f * 100, decimals: 0), reset: reset))
    }

    private func accessibilitySummary(percent: String, reset: String?) -> String {
        let usage = WidgetFormat.tokenPair(used: limit.usedTokens, limit: limit.limitTokens) ?? "\(percent) used"
        if let reset {
            return "\(WidgetStrings.limitLabel(limit)), \(usage), resets \(reset)"
        }
        return "\(WidgetStrings.limitLabel(limit)), \(usage)"
    }
}

private struct ResetTimelineView: View {
    let limits: [LimitProvider]

    private var resetRows: [LimitProvider] {
        limits
            .filter { $0.resetsAt != nil }
            .sorted { lhs, rhs in
                (lhs.resetsAt ?? .distantFuture) < (rhs.resetsAt ?? .distantFuture)
            }
            .prefix(4)
            .map { $0 }
    }

    var body: some View {
        if !resetRows.isEmpty {
            VStack(alignment: .leading, spacing: 7) {
                Divider()

                Text("RESET TIMELINE")
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(0.6)
                    .foregroundStyle(.secondary)

                HStack {
                    ForEach(["Now", "1h", "6h", "12h", "1d", "2d"], id: \.self) { label in
                        Text(label)
                            .font(.system(size: 8, weight: .semibold, design: .rounded))
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }

                HStack(alignment: .center, spacing: 0) {
                    ForEach(Array(resetRows.enumerated()), id: \.element.id) { index, limit in
                        VStack(alignment: .leading, spacing: 4) {
                            RoundedRectangle(cornerRadius: 1.5)
                                .fill(WidgetTheme.limitBarColor(limit.fraction))
                                .frame(height: 3)

                            HStack(spacing: 4) {
                                WidgetProviderLogo(source: limit.source, size: 10)
                                Text(shortName(limit.source))
                                    .font(.system(size: 9, weight: .medium))
                                    .lineLimit(1)
                            }

                            if let reset = WidgetFormat.relativeReset(limit.resetsAt) {
                                Text(reset)
                                    .font(.system(size: 9, weight: .semibold, design: .rounded))
                                    .foregroundStyle(.secondary)
                                    .monospacedDigit()
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(resetAccessibilityLabel(for: limit))

                        if index < resetRows.count - 1 {
                            Spacer(minLength: 6)
                        }
                    }
                }
            }
        }
    }

    private func shortName(_ source: String) -> String {
        let name = source.capitalized
        if name.count <= 8 { return name }
        return String(name.prefix(7)) + "…"
    }

    private func resetAccessibilityLabel(for limit: LimitProvider) -> String {
        if let reset = WidgetFormat.relativeReset(limit.resetsAt) {
            return "\(WidgetStrings.limitLabel(limit)) resets \(reset)"
        }
        return "\(WidgetStrings.limitLabel(limit)) reset time unavailable"
    }
}
