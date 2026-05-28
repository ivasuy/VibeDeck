import SwiftUI

enum NativeAnalyticsTab: String, CaseIterable, Identifiable {
    case compare
    case models
    case yield
    case skills

    var id: String { rawValue }

    var title: String {
        switch self {
        case .compare: return "Compare"
        case .models: return "Models"
        case .yield: return "Yield"
        case .skills: return "Skills"
        }
    }
}

struct AnalyticsTabsView: View {
    @ObservedObject var viewModel: DashboardViewModel
    @State private var selected: NativeAnalyticsTab

    init(viewModel: DashboardViewModel, initialTab: NativeAnalyticsTab = .compare) {
        self.viewModel = viewModel
        _selected = State(initialValue: initialTab)
    }

    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader(title: "Analytics") {
                    Picker("", selection: $selected) {
                        ForEach(NativeAnalyticsTab.allCases) { tab in
                            Text(tab.title).tag(tab)
                        }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .frame(width: 330)
                }

                if viewModel.parityError != nil {
                    Text("Partial data")
                        .font(.caption)
                        .foregroundStyle(Color.statusWarning)
                }

                analyticsCard {
                    switch selected {
                    case .compare:
                        compareTab
                    case .models:
                        modelsTab
                    case .yield:
                        yieldTab
                    case .skills:
                        skillsTab
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

    private func analyticsCard<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        content()
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(.regularMaterial)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(Color.panelBorder, lineWidth: 0.5)
                    )
            )
    }

    private var compareTab: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let response = viewModel.compareMetrics {
                if let totals = response.totals {
                    HStack(spacing: 10) {
                        nativeStatPill("Sessions", value: "\(totals.sessionCount ?? 0)")
                        nativeStatPill("Tokens", value: TokenFormatter.formatCompact(totals.totalTokens ?? 0))
                        nativeStatPill("Cost", value: TokenFormatter.formatCostFromString(totals.totalCostUSD))
                    }
                }

                if let metrics = response.metrics, !metrics.isEmpty {
                    VStack(spacing: 7) {
                        ForEach(metrics.keys.sorted(), id: \.self) { key in
                            nativeMetricRow(metricLabel(key), value: metrics[key] ?? "0")
                        }
                    }
                } else {
                    PlaceholderBlock(height: 160, hint: "No compare metrics yet.")
                }
            } else {
                PlaceholderBlock(height: 180, hint: "No compare metrics yet.")
            }
        }
    }

    private var modelsTab: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let models = viewModel.parityModels?.models, !models.isEmpty {
                ForEach(models.prefix(12)) { model in
                    HStack(spacing: 10) {
                        ProviderLogoView(provider: model.providers?.first ?? model.model, size: 14)
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
                    .frame(height: 28)
                }
            } else {
                PlaceholderBlock(height: 180, hint: "No model parity data yet.")
            }
        }
    }

    private var yieldTab: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let branches = viewModel.yieldSummary?.branches, !branches.isEmpty {
                ForEach(branches.prefix(12)) { branch in
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
                    .frame(height: 28)
                }
            } else {
                PlaceholderBlock(height: 180, hint: "No yield data yet.")
            }
        }
    }

    private var skillsTab: some View {
        VStack(alignment: .leading, spacing: 8) {
            let rows = skillRows
            if rows.isEmpty {
                PlaceholderBlock(height: 180, hint: "No skill usage data yet.")
            } else {
                ForEach(rows.prefix(12)) { row in
                    HStack(spacing: 10) {
                        Text(row.name)
                            .font(.caption)
                            .modifier(FontWeightModifier(weight: .semibold))
                            .lineLimit(1)
                        Spacer(minLength: 8)
                        Text("\(row.count) uses")
                            .font(.caption)
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                    }
                    .frame(height: 28)
                }
            }
        }
    }

    private var skillRows: [NativeSkillUsageRow] {
        var counts: [String: Int] = [:]
        for model in viewModel.parityModels?.models ?? [] {
            for (skill, count) in model.skills ?? [:] {
                counts[skill, default: 0] += count
            }
        }
        return counts
            .map { NativeSkillUsageRow(name: $0.key, count: $0.value) }
            .sorted {
                if $0.count == $1.count { return $0.name < $1.name }
                return $0.count > $1.count
            }
    }

    private func nativeStatPill(_ label: String, value: String) -> some View {
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
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color.panelFillStrong)
        )
    }

    private func nativeMetricRow(_ label: String, value: String) -> some View {
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

private struct NativeSkillUsageRow: Identifiable {
    let name: String
    let count: Int

    var id: String { name }
}

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
                OptimizeTab(response: viewModel.optimizeFindings)
                    .tabItem { Text("Optimize") }
                PlanTab(response: viewModel.planView)
                    .tabItem { Text("Plan") }
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
