import SwiftUI
import AppKit

enum NativeOptimizePlanTab: String, CaseIterable, Identifiable {
    case optimize
    case plan

    var id: String { rawValue }

    var title: String {
        switch self {
        case .optimize: return "Optimize"
        case .plan: return "Plan"
        }
    }
}

struct OptimizePlanTabsView: View {
    @ObservedObject var viewModel: DashboardViewModel
    @State private var selected: NativeOptimizePlanTab

    init(viewModel: DashboardViewModel, initialTab: NativeOptimizePlanTab = .optimize) {
        self.viewModel = viewModel
        _selected = State(initialValue: initialTab)
    }

    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader(title: "Intelligence") {
                    Picker("", selection: $selected) {
                        ForEach(NativeOptimizePlanTab.allCases) { tab in
                            Text(tab.title).tag(tab)
                        }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .frame(width: 220)
                }

                if let parityError = viewModel.parityError, !parityError.isEmpty {
                    NativeParityWarning(message: parityError)
                }

                Group {
                    switch selected {
                    case .optimize:
                        optimizeContent
                    case .plan:
                        planContent
                    }
                }
                .animation(NativeMotion.Ease.short(), value: selected.rawValue)
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

    private var optimizeContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            NativeOptimizeHero(response: viewModel.optimizeFindings)
            OptimizeTab(response: viewModel.optimizeFindings)
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

    private var planContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let forecast = viewModel.forecastView {
                ForecastCard(forecast: forecast)
            }
            PlanTab(response: viewModel.planView)
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
}

private struct NativeOptimizeHero: View {
    let response: OptimizeFindingsResponse?

    private var totalWaste: Double {
        response?.findings.reduce(0) { $0 + $1.estimatedCostWasteUsd } ?? 0
    }

    private var highCount: Int {
        response?.findings.filter { $0.severity.lowercased() == "high" }.count ?? 0
    }

    var body: some View {
        HStack(alignment: .bottom, spacing: 18) {
            VStack(alignment: .leading, spacing: 8) {
                Text(totalWaste > 0 ? "Potential savings" : "Nothing to optimize yet")
                    .font(.caption)
                    .modifier(FontWeightModifier(weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.76))
                    .textCase(.uppercase)
                    .modifier(TrackingModifier(value: 0.7))

                Text(totalWaste > 0 ? formatWasteCost(totalWaste) : "Running tight")
                    .font(.system(size: 44, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(.white)

                Text(totalWaste > 0 ? "\(response?.findings.count ?? 0) findings · \(highCount) high impact" : "Savings will appear after the scanner sees a real pattern.")
                    .font(.callout)
                    .foregroundStyle(Color.white.opacity(0.82))
                    .lineLimit(2)
            }

            Spacer(minLength: 12)

            VStack(alignment: .trailing, spacing: 7) {
                NativeHeroSideStat(label: "Grade", value: response?.health?.healthGrade ?? "-")
                NativeHeroSideStat(label: "Score", value: "\(response?.health?.score ?? 0)")
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(
                colors: [Color.brand700, Color.brand600],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

private struct NativeHeroSideStat: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .trailing, spacing: 2) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(Color.white.opacity(0.62))
            Text(value)
                .font(.headline)
                .modifier(FontWeightModifier(weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(.white)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color.white.opacity(0.12))
        )
    }
}

private struct NativeParityWarning: View {
    let message: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle")
                .foregroundStyle(Color.statusWarning)
                .accessibilityHidden(true)
            Text("Some intelligence data is stale.")
                .font(.caption)
                .modifier(FontWeightModifier(weight: .semibold))
            Spacer(minLength: 8)
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color.brand.opacity(0.10))
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(Color.brand.opacity(0.18), lineWidth: 0.5)
                )
        )
        .help(message)
    }
}

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
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text(Self.prettyPlanName(plan.plan))
                                .font(.title3)
                                .modifier(FontWeightModifier(weight: .semibold))
                            if plan.inferred == true {
                                Text("auto-detected")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(
                                        Capsule().fill(Color.panelFillStrong)
                                    )
                            }
                        }
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

    static func prettyPlanName(_ plan: String) -> String {
        switch plan.lowercased() {
        case "claude-pro": return "Claude Pro"
        case "claude-max": return "Claude Max"
        case "claude-monthly": return "Claude monthly"
        case "codex-monthly": return "Codex monthly"
        case "mixed-monthly": return "Claude + Codex monthly"
        case "cursor-pro": return "Cursor Pro"
        case "copilot-pro": return "Copilot Pro"
        case "custom": return "Custom"
        default:
            let trimmed = plan.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? "Custom" : trimmed.replacingOccurrences(of: "-", with: " ").capitalized
        }
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
