import SwiftUI

struct DashboardView: View {
    @ObservedObject var viewModel: DashboardViewModel
    @ObservedObject var serverManager: ServerManager
    @ObservedObject private var localization = LocalizationObserver.shared

    var body: some View {
        VStack(spacing: 0) {
            VibeDeckBrandHeader()

            // Clawd companion replaces the old header + Today card
            ClawdCompanionView(viewModel: viewModel)

            switch serverManager.status {
            case .idle, .starting:
                ServerStartingView()
            case .running:
                if viewModel.isSyncing {
                    syncingView
                } else if viewModel.isLoading && viewModel.summary == nil {
                    loadingView
                } else {
                    ScrollView(.vertical, showsIndicators: false) {
                        LazyVStack(spacing: 12) {
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
                            UsageLimitsView(limits: viewModel.usageLimits)
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
        VStack(spacing: 10) {
            Spacer()
            ProgressView()
                .controlSize(.regular)
            Text(Strings.syncingUsageData)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(Strings.syncingFirstLaunchHint)
                .font(.caption2)
                .foregroundStyle(.tertiary)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    private var loadingView: some View {
        VStack(spacing: 10) {
            Spacer()
            ProgressView()
                .controlSize(.regular)
            Text(Strings.loadingData)
                .font(.caption)
                .foregroundStyle(.tertiary)
            Spacer()
        }
        .frame(maxWidth: .infinity)
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
