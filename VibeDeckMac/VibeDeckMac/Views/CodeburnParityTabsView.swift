import SwiftUI

struct CodeburnParityTabsView: View {
    @ObservedObject var viewModel: DashboardViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Codeburn Parity") {
                if viewModel.parityError != nil {
                    Text("Partial data")
                        .font(.caption2)
                        .foregroundStyle(Color.statusWarning)
                }
            }

            TabView {
                compareTab
                    .tabItem { Text("Compare") }
                modelsTab
                    .tabItem { Text("Models") }
                yieldTab
                    .tabItem { Text("Yield") }
            }
            .frame(minHeight: 220)
            .padding(10)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.panelFill)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(Color.panelBorder, lineWidth: 1)
                    )
            )
        }
    }

    private var compareTab: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let response = viewModel.compareMetrics {
                if let totals = response.totals {
                    HStack(spacing: 10) {
                        statPill("Sessions", value: "\(totals.sessionCount ?? 0)")
                        statPill("Tokens", value: TokenFormatter.formatCompact(totals.totalTokens ?? 0))
                        statPill("Cost", value: TokenFormatter.formatCostFromString(totals.totalCostUSD))
                    }
                }

                if let metrics = response.metrics, !metrics.isEmpty {
                    VStack(spacing: 6) {
                        ForEach(metrics.keys.sorted(), id: \.self) { key in
                            metricRow(metricLabel(key), value: metrics[key] ?? "0")
                        }
                    }
                } else {
                    PlaceholderBlock(height: 118, hint: "No compare metrics yet.")
                }
            } else {
                PlaceholderBlock(height: 160, hint: "No compare metrics yet.")
            }
            Spacer(minLength: 0)
        }
        .padding(.top, 8)
    }

    private var modelsTab: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let models = viewModel.parityModels?.models, !models.isEmpty {
                ForEach(models.prefix(6)) { model in
                    HStack(spacing: 10) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(model.model.isEmpty ? "unknown" : model.model)
                                .font(.caption)
                                .modifier(FontWeightModifier(weight: .semibold))
                                .lineLimit(1)
                            Text((model.providers ?? []).joined(separator: ", "))
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 8)
                        Text(TokenFormatter.formatCompact(model.totalTokens ?? 0))
                            .font(.caption)
                            .monospacedDigit()
                        Text(TokenFormatter.formatCostFromString(model.totalCostUSD))
                            .font(.caption)
                            .monospacedDigit()
                    }
                    .padding(.vertical, 4)
                }
            } else {
                PlaceholderBlock(height: 160, hint: "No model parity data yet.")
            }
            Spacer(minLength: 0)
        }
        .padding(.top, 8)
    }

    private var yieldTab: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let branches = viewModel.yieldSummary?.branches, !branches.isEmpty {
                ForEach(branches.prefix(6)) { branch in
                    HStack(spacing: 10) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(branch.branch.isEmpty ? "Unknown branch" : branch.branch)
                                .font(.caption)
                                .modifier(FontWeightModifier(weight: .semibold))
                                .lineLimit(1)
                            Text("\(branch.sessionCount ?? 0) sessions")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                        Spacer(minLength: 8)
                        Text(branch.yieldState)
                            .font(.caption2)
                            .modifier(FontWeightModifier(weight: .semibold))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Capsule().fill(Color.panelFillStrong))
                        Text(TokenFormatter.formatCompact(branch.totalTokens ?? 0))
                            .font(.caption)
                            .monospacedDigit()
                    }
                    .padding(.vertical, 4)
                }
            } else {
                PlaceholderBlock(height: 160, hint: "No yield data yet.")
            }
            Spacer(minLength: 0)
        }
        .padding(.top, 8)
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

    private func metricRow(_ label: String, value: String) -> some View {
        HStack {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .font(.caption)
                .modifier(FontWeightModifier(weight: .semibold))
                .monospacedDigit()
        }
    }

    private func metricLabel(_ key: String) -> String {
        key
            .replacingOccurrences(of: "_usd", with: " USD")
            .replacingOccurrences(of: "_", with: " ")
            .capitalized
    }
}
