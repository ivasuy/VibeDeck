import AppKit
import SwiftUI

struct DashboardView: View {
    @ObservedObject var viewModel: DashboardViewModel
    @ObservedObject var serverManager: ServerManager
    @ObservedObject private var localization = LocalizationObserver.shared

    var body: some View {
        VStack(spacing: 0) {
            VibeDeckBrandHeader()

            switch serverManager.status {
            case .idle, .starting:
                ServerStartingView()
            case .running:
                if viewModel.isSyncing && !viewModel.hasRenderableUsageSurface {
                    syncingView
                } else if viewModel.isLoading && !viewModel.hasRenderableUsageSurface {
                    loadingView
                } else if !viewModel.hasRenderableUsageSurface {
                    DashboardFirstRunView(
                        isSyncing: viewModel.isSyncing,
                        onDetect: {
                            Task { await viewModel.triggerSync() }
                        },
                        onSetupGuide: openSetupGuide
                    )
                } else {
                    ScrollView(.vertical, showsIndicators: false) {
                        LazyVStack(spacing: 12) {
                            if let error = viewModel.error {
                                DashboardStaleBanner(
                                    message: error,
                                    lastRefreshed: viewModel.lastRefreshed,
                                    onRetry: {
                                        Task { await viewModel.loadAll() }
                                    }
                                )
                            }
                            if let readinessState = viewModel.readinessState {
                                DashboardReadinessBanner(
                                    state: readinessState,
                                    isRefreshing: viewModel.isSyncing || viewModel.isLoading
                                )
                            }
                            SummaryCardsView(
                                todayTokens: viewModel.todayTokens,
                                todayCost: viewModel.todayCost,
                                last7dTokens: viewModel.last7dTokens,
                                last7dActiveDays: viewModel.last7dActiveDays,
                                last30dTokens: viewModel.last30dTokens,
                                last30dAvgPerDay: viewModel.last30dAvgPerDay,
                                totalTokens: viewModel.totalTokens,
                                totalCost: viewModel.totalCost
                            )
                            if let forecast = viewModel.forecastView {
                                ForecastCard(forecast: forecast)
                            }
                            UsageLimitsView(limits: viewModel.usageLimits)
                            ProjectUsageView(projectUsage: viewModel.projectUsage)
                            CodeburnParityTabsView(viewModel: viewModel)
                            ActivityHeatmapView(heatmap: viewModel.heatmap)
                            UsageTrendChartWrapper(
                                daily: viewModel.daily,
                                monthly: viewModel.monthly,
                                hourly: viewModel.hourly,
                                period: $viewModel.period,
                                onPeriodChange: { viewModel.switchPeriod($0) }
                            )
                            TopModelsView(models: viewModel.topModels)
                        }
                        .padding(.horizontal, 20)
                        .padding(.top, 4)
                        .padding(.bottom, 12)
                    }
                }
            case .failed(let message):
                ServerOfflineView(message: message) {
                    await serverManager.retry()
                    if serverManager.isServerRunning {
                        await viewModel.loadAll()
                    }
                }
            }

            ClawdCompanionView(viewModel: viewModel)
            Divider()
            FooterView()
        }
        .background(
            LinearGradient(
                colors: [Color.chromeTop, Color.chromeBottom],
                startPoint: .top,
                endPoint: .bottom
            )
        )
        .id(localization.revision)
    }

    private var syncingView: some View {
        InstrumentLoadingPanel(
            title: Strings.syncingUsageData,
            detail: Strings.syncingFirstLaunchHint,
            mode: .indeterminate
        )
    }

    private var loadingView: some View {
        InstrumentLoadingPanel(
            title: Strings.loadingData,
            detail: Strings.serverPreparing,
            mode: .skeleton
        )
    }

    private func openSetupGuide() {
        if let url = URL(string: "https://github.com/ivasuy/VibeDeck#quick-start") {
            NSWorkspace.shared.open(url)
        }
    }
}

private struct ProjectUsageView: View {
    let projectUsage: ProjectUsageResponse?

    private var entries: [ProjectEntry] {
        Array((projectUsage?.entries ?? [])
            .filter { $0.billableTokensInt > 0 || (Int($0.totalTokens) ?? 0) > 0 }
            .prefix(4))
    }

    var body: some View {
        if !entries.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Projects")
                        .font(.caption)
                        .modifier(FontWeightModifier(weight: .semibold))
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text("Selected period")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }

                VStack(spacing: 8) {
                    ForEach(entries) { entry in
                        HStack(spacing: 10) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(projectName(entry))
                                    .font(.caption)
                                    .modifier(FontWeightModifier(weight: .semibold))
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                                if let ref = entry.projectRef, !ref.isEmpty {
                                    Text(ref)
                                        .font(.caption2)
                                        .foregroundStyle(.tertiary)
                                        .lineLimit(1)
                                        .truncationMode(.middle)
                                }
                            }
                            Spacer(minLength: 8)
                            Text(TokenFormatter.formatCompact(entry.billableTokensInt > 0 ? entry.billableTokensInt : (Int(entry.totalTokens) ?? 0)))
                                .font(.system(.caption, design: .monospaced).weight(.semibold))
                                .foregroundStyle(Color.primary)
                        }
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(Color.panelFill)
                    .overlay(
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .stroke(Color.panelBorder, lineWidth: 1)
                    )
            )
        }
    }

    private func projectName(_ entry: ProjectEntry) -> String {
        let raw = entry.projectKey.isEmpty ? (entry.projectRef ?? "Unknown project") : entry.projectKey
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "Unknown project" }
        if trimmed.contains("/") {
            return trimmed.split(separator: "/").last.map(String.init) ?? trimmed
        }
        return trimmed
    }
}

private struct DashboardReadinessBanner: View {
    let state: ProjectionReadinessState
    let isRefreshing: Bool

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: state.tone == "indexing" ? "clock.arrow.circlepath" : "tray.full")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(state.tone == "indexing" ? Color.statusWarning : Color.secondary)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 1) {
                Text(state.label)
                    .font(.caption)
                    .modifier(FontWeightModifier(weight: .semibold))
                Text(detailText)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            if isRefreshing {
                ProgressView()
                    .controlSize(.small)
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 40)
        .background(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(Color.panelFill)
                .overlay(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .stroke(Color.panelBorder, lineWidth: 1)
                )
        )
        .accessibilityElement(children: .combine)
    }

    private var detailText: String {
        if isRefreshing { return "Refreshing local server data." }
        switch state.kind {
        case "indexing":
            return "Historical views will fill in as indexing completes."
        case "snapshot":
            return "Showing local startup snapshot while refresh continues."
        default:
            return "Waiting for local usage data."
        }
    }
}

private struct DashboardStaleBanner: View {
    let message: String
    let lastRefreshed: Date?
    let onRetry: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.statusWarning)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 1) {
                Text(Strings.refreshFailedTitle)
                    .font(.caption)
                    .modifier(FontWeightModifier(weight: .semibold))
                Text(detailText)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            Button(action: onRetry) {
                Text(Strings.retryButton)
                    .font(.caption)
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
        .padding(.horizontal, 12)
        .frame(height: 40)
        .background(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(Color.brand.opacity(0.10))
                .overlay(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .stroke(Color.brand.opacity(0.22), lineWidth: 1)
                )
        )
        .help(message)
        .accessibilityElement(children: .combine)
    }

    private var detailText: String {
        guard let lastRefreshed else { return Strings.showingLastKnownValues }
        return Strings.showingValuesFrom(relativeTime(from: lastRefreshed))
    }

    private func relativeTime(from date: Date) -> String {
        let interval = max(Date().timeIntervalSince(date), 0)
        if interval < 60 { return Strings.justNow }
        if interval < 3600 { return Strings.minutesAgo(Int(interval / 60)) }
        if interval < 86400 { return Strings.hoursAgo(Int(interval / 3600)) }
        return Strings.daysAgo(Int(interval / 86400))
    }
}

private struct DashboardFirstRunView: View {
    let isSyncing: Bool
    let onDetect: () -> Void
    let onSetupGuide: () -> Void

    var body: some View {
        VStack {
            Spacer(minLength: 24)

            VStack(spacing: 18) {
                ClawdCompanionView.LoadingMascotView()
                    .scaleEffect(1.15)
                    .frame(width: 80, height: 80)
                    .clipped()
                    .accessibilityHidden(true)

                VStack(spacing: 7) {
                    Text(Strings.welcomeToVibeDeck)
                        .font(.system(size: 22, weight: .semibold, design: .rounded))
                    Text(Strings.firstRunDashboardBody)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 360)
                }

                HStack(spacing: 10) {
                    Button(action: onDetect) {
                        Text(isSyncing ? Strings.syncingUsageData : Strings.detectNow)
                            .frame(minWidth: 96)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color.brand)
                    .disabled(isSyncing)

                    Button(action: onSetupGuide) {
                        Text(Strings.setupGuide)
                            .frame(minWidth: 96)
                    }
                    .buttonStyle(.bordered)
                }
            }
            .padding(.horizontal, 32)
            .padding(.vertical, 36)
            .frame(maxWidth: 520)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(Color.panelFill)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .stroke(Color.panelBorder, lineWidth: 1)
                    )
            )
            .accessibilityElement(children: .combine)

            Spacer(minLength: 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, 20)
    }
}

private struct VibeDeckBrandHeader: View {
    @Environment(\.colorScheme) private var colorScheme

    private var wordmarkName: String {
        colorScheme == .dark ? "VibeDeckWordmarkDark" : "VibeDeckWordmarkLight"
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(wordmarkName)
                .resizable()
                .scaledToFit()
                .frame(width: 148, height: 38, alignment: .leading)
                .accessibilityLabel(Strings.appTitle)

            Spacer(minLength: 0)

            Text("Local-first")
                .font(.caption2)
                .modifier(FontWeightModifier(weight: .semibold))
                .foregroundStyle(Color.brand)
                .padding(.horizontal, 9)
                .padding(.vertical, 4)
                .background(
                    Capsule()
                        .fill(Color.panelFill)
                        .overlay(
                            Capsule()
                                .stroke(Color.panelBorder, lineWidth: 1)
                        )
                )
        }
        .padding(.horizontal, 20)
        .padding(.top, 14)
        .padding(.bottom, 2)
    }
}
