import SwiftUI
import AppKit

struct OptimizeTab: View {
    let response: OptimizeFindingsResponse?

    private let severities = ["high", "medium", "low"]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let health = response?.health {
                HStack(spacing: 10) {
                    statPill("Grade", value: health.healthGrade)
                        .accessibilityLabel("Optimize health grade \(health.healthGrade)")
                    statPill("Score", value: "\(health.score)")
                }
            }

            if findings.isEmpty {
                PlaceholderBlock(height: 120, hint: "No optimize findings yet.")
            } else {
                ScrollView(.vertical, showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(severities, id: \.self) { severity in
                            let group = findings.filter { $0.severity.lowercased() == severity }
                            if !group.isEmpty {
                                severitySection(severity: severity, findings: group)
                            }
                        }
                    }
                    .padding(.trailing, 4)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.top, 8)
    }

    private var findings: [OptimizeFinding] {
        response?.findings ?? []
    }

    private func severitySection(severity: String, findings: [OptimizeFinding]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(severity.capitalized)
                .font(.caption2)
                .modifier(FontWeightModifier(weight: .semibold))
                .foregroundStyle(.secondary)

            ForEach(findings) { finding in
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(finding.title)
                            .font(.caption)
                            .modifier(FontWeightModifier(weight: .semibold))
                            .lineLimit(2)
                        Spacer(minLength: 8)
                        Text(formatWasteCost(finding.estimatedCostWasteUsd))
                            .font(.caption2)
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                    }
                    if !finding.detail.isEmpty {
                        Text(finding.detail)
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                            .lineLimit(3)
                    }
                    HStack(spacing: 8) {
                        Text("\(finding.estimatedTokenWaste) tokens")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                        Spacer()
                        if let pasteFix = finding.pasteFix, !pasteFix.isEmpty {
                            Button("Paste fix") {
                                NSPasteboard.general.clearContents()
                                NSPasteboard.general.setString(pasteFix, forType: .string)
                            }
                            .font(.caption2)
                            .buttonStyle(.borderless)
                            .accessibilityLabel("Copy paste fix for \(finding.title)")
                        }
                    }
                }
                .padding(8)
                .background(
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color.panelFillStrong)
                )
            }
        }
    }

    private func statPill(_ label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(.tertiary)
            Text(value)
                .font(.caption)
                .modifier(FontWeightModifier(weight: .semibold))
                .monospacedDigit()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.panelFillStrong)
        )
    }
}

struct PlanTab: View {
    let response: PlanViewResponse?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let plan = response {
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(plan.label)
                            .font(.caption)
                            .modifier(FontWeightModifier(weight: .semibold))
                        Text(plan.plan)
                            .font(.title3)
                            .modifier(FontWeightModifier(weight: .semibold))
                        if !plan.labelDetail.isEmpty {
                            Text(plan.labelDetail)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    Spacer(minLength: 8)
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("Monthly plan")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                        Text(formatUsd(plan.monthlyUsd, decimals: 2))
                            .font(.caption)
                            .modifier(FontWeightModifier(weight: .semibold))
                            .monospacedDigit()
                    }
                }

                VStack(alignment: .leading, spacing: 5) {
                    HStack {
                        Text("Month-to-date API-equivalent spend")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Text(formatUsd(plan.monthToDateUsd, decimals: 4))
                            .font(.caption2)
                            .modifier(FontWeightModifier(weight: .semibold))
                            .monospacedDigit()
                    }

                    GeometryReader { proxy in
                        ZStack(alignment: .leading) {
                            Capsule()
                                .fill(Color.panelFillStrong)
                            Capsule()
                                .fill(Color.brand)
                                .frame(width: proxy.size.width * progressFraction(plan))
                        }
                    }
                    .frame(height: 8)
                    .accessibilityLabel("Plan progress \(String(format: "%.2f", usagePercent(plan))) percent")

                    Text("\(String(format: "%.2f", usagePercent(plan)))%")
                        .font(.caption2)
                        .monospacedDigit()
                        .foregroundStyle(.tertiary)
                }
            } else {
                PlaceholderBlock(height: 160, hint: "No plan data yet.")
            }
            Spacer(minLength: 0)
        }
        .padding(.top, 8)
    }

    private func usagePercent(_ plan: PlanViewResponse) -> Double {
        if let usagePercent = plan.usagePercent {
            return max(0, usagePercent)
        }
        guard plan.monthlyUsd > 0 else { return 0 }
        return max(0, (plan.monthToDateUsd / plan.monthlyUsd) * 100)
    }

    private func progressFraction(_ plan: PlanViewResponse) -> Double {
        min(1, usagePercent(plan) / 100)
    }
}

struct ForecastCard: View {
    let forecast: ForecastResponse

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Forecast")
            HStack(spacing: 10) {
                stat("7-day average", value: formatUsdString(forecast.movingAverage7d))
                stat("30-day forecast", value: formatUsdString(forecast.forecast30dUsd))
                stat("Anomalies", value: "\(forecast.anomalies.count)")
            }
            if let pulse = forecast.pulse, !pulse.reason.isEmpty {
                Text("\(pulse.state.capitalized): \(pulse.reason)")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .lineLimit(2)
            }
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.panelFill)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.panelBorder, lineWidth: 1)
                )
        )
        .accessibilityLabel("Forecast 7-day average \(formatUsdString(forecast.movingAverage7d)), 30-day forecast \(formatUsdString(forecast.forecast30dUsd)), \(forecast.anomalies.count) anomalies")
    }

    private func stat(_ label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(.tertiary)
            Text(value)
                .font(.caption)
                .modifier(FontWeightModifier(weight: .semibold))
                .monospacedDigit()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private func formatWasteCost(_ value: Double) -> String {
    formatUsd(value, decimals: 6)
}

private func formatUsdString(_ value: String) -> String {
    formatUsd(Double(value) ?? 0, decimals: 4)
}

private func formatUsd(_ value: Double, decimals: Int) -> String {
    "$" + String(format: "%.\(decimals)f", value)
}
