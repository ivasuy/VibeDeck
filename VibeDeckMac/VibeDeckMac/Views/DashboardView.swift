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
                if viewModel.isSyncing {
                    syncingView
                } else if viewModel.isLoading && viewModel.summary == nil {
                    loadingView
                } else if !viewModel.hasTrackedUsage {
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
