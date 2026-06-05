import SwiftUI
import Combine

// MARK: - Supporting Types

struct FleetEntry: Identifiable {
    let id = UUID()
    let label: String
    let totalPercent: String
    let usd: Double
    let usage: Int
    let models: [FleetModel]
}

struct FleetModel: Identifiable {
    let id: String
    let name: String
    let share: Double
    let usage: Int
}

struct TopModel: Identifiable {
    let id: String
    let name: String
    let source: String
    let tokens: Int
    let usd: Double
    let percent: String
}

// MARK: - DashboardViewModel

@MainActor
class DashboardViewModel: ObservableObject {

    // MARK: - Published State

    @Published var period: DateHelpers.Period = .month
    @Published var todaySummary: UsageSummaryResponse?
    @Published var summary: UsageSummaryResponse?
    @Published var rollingSummary: UsageSummaryResponse?
    @Published var totalSummary: UsageSummaryResponse?
    @Published var daily: [DailyEntry] = []
    @Published var monthly: [MonthlyEntry] = []
    @Published var hourly: [HourlyEntry] = []
    @Published var heatmap: HeatmapResponse?
    @Published var modelBreakdown: ModelBreakdownResponse?
    @Published var projectUsage: ProjectUsageResponse?
    @Published var usageLimits: UsageLimitsResponse?
    @Published var liveSessionsSnapshot: LiveSessionsSnapshotResponse?
    @Published var compareMetrics: CompareMetricsResponse?
    @Published var parityModels: ModelsParityResponse?
    @Published var yieldSummary: YieldResponse?
    @Published var optimizeFindings: OptimizeFindingsResponse?
    @Published var planView: PlanViewResponse?
    @Published var forecastView: ForecastResponse?
    @Published var startupSnapshot: StartupSnapshotResponse?
    @Published var projectionFreshness: ProjectionFreshness?
    @Published var displayCurrency: String = UserDefaults.standard.string(forKey: "vibedeck.displayCurrency") ?? "USD"
    @Published var parityError: String?

    @Published var isLoading = false
    @Published var isSyncing = false
    @Published var error: String?
    @Published var serverOnline = false
    @Published var lastRefreshed: Date?

    // Derived (cached) data
    @Published private(set) var fleetData: [FleetEntry] = []
    @Published private(set) var topModels: [TopModel] = []

    private var refreshTask: Task<Void, Never>?

    // MARK: - Computed Properties

    // Today card (always today)
    var todayTokens: Int { todaySummary?.totals.totalTokens ?? startupSnapshot?.totals.todayTokens ?? 0 }
    var todayCost: String {
        if let todaySummary {
            return TokenFormatter.formatCostFromString(todaySummary.totals.totalCostUsd)
        }
        return TokenFormatter.formatCost(startupSnapshot?.totals.todayCostUsd ?? 0)
    }

    // Rolling stats (always 30-day window)
    var last7dTokens: Int { rollingSummary?.rolling.last7d.totals.billableTotalTokens ?? startupSnapshot?.totals.weekTokens ?? 0 }
    var last7dActiveDays: Int { rollingSummary?.rolling.last7d.activeDays ?? 0 }
    var last30dTokens: Int { rollingSummary?.rolling.last30d.totals.billableTotalTokens ?? 0 }
    var last30dAvgPerDay: Int { rollingSummary?.rolling.last30d.avgPerActiveDay ?? 0 }

    // All-time total (matches dashboard "Total" period)
    var totalTokens: Int { totalSummary?.totals.totalTokens ?? 0 }
    var totalCost: String { TokenFormatter.formatCostFromString(totalSummary?.totals.totalCostUsd) }
    var activeLiveSessions: [LiveSessionRow] {
        if let liveSessionsSnapshot { return liveSessionsSnapshot.currentSessions }
        return startupSnapshot?.activeSessions ?? []
    }

    var readinessState: ProjectionReadinessState? {
        if let projectionFreshness {
            return projectionFreshness.readinessState
        }
        return startupSnapshot?.readinessState
    }

    var hasRenderableUsageSurface: Bool {
        hasTrackedUsage || hasStartupSnapshotUsage || readinessState != nil
    }

    var hasTrackedUsage: Bool {
        todayTokens > 0 ||
            last7dTokens > 0 ||
            last30dTokens > 0 ||
            totalTokens > 0 ||
            (summary?.totals.totalTokens ?? 0) > 0 ||
            daily.contains { $0.totalTokens > 0 } ||
            monthly.contains { $0.totalTokens > 0 } ||
            hourly.contains { $0.totalTokens > 0 } ||
            (heatmap?.activeDays ?? 0) > 0 ||
            !fleetData.isEmpty ||
            !topModels.isEmpty ||
            !activeLiveSessions.isEmpty
    }

    private var hasStartupSnapshotUsage: Bool {
        guard todaySummary == nil && rollingSummary == nil && totalSummary == nil else { return false }
        guard let startupSnapshot else { return false }
        return startupSnapshot.totals.todayTokens > 0 ||
            startupSnapshot.totals.weekTokens > 0 ||
            !startupSnapshot.activeSessions.isEmpty ||
            !startupSnapshot.recentSessions.isEmpty ||
            !startupSnapshot.topProviders.isEmpty ||
            !startupSnapshot.recentProjects.isEmpty
    }

    // MARK: - Period Switching

    func switchPeriod(_ newPeriod: DateHelpers.Period) {
        guard newPeriod != period else { return }
        period = newPeriod
        Task {
            await loadAll()
        }
    }

    // MARK: - Data Loading

    func loadAll() async {
        guard !isLoading else { return }
        isLoading = true
        error = nil

        serverOnline = await APIClient.shared.checkServerHealth()
        guard serverOnline else {
            isLoading = false
            return
        }

        let range = DateHelpers.rangeForPeriod(period)
        let rollingFrom = DateHelpers.daysAgoString(30)
        let rollingTo = DateHelpers.todayString()
        let totalRange = DateHelpers.rangeForPeriod(.total)

        var errorCount = 0
        var firstError: String?
        let totalFetches = 9

        await withTaskGroup(of: Void.self) { group in
            // Today summary (always today for summary cards)
            group.addTask { @MainActor in
                do {
                    let today = DateHelpers.todayString()
                    let response = try await APIClient.shared.fetchSummary(from: today, to: today)
                    self.todaySummary = response
                    self.applyFreshness(response.freshness)
                } catch {
                    errorCount += 1
                    if firstError == nil { firstError = error.localizedDescription }
                }
            }
            // Period summary (for the selected period — drives chart/models)
            group.addTask { @MainActor in
                do {
                    let response = try await APIClient.shared.fetchSummary(from: range.from, to: range.to)
                    self.summary = response
                    self.applyFreshness(response.freshness)
                } catch {
                    errorCount += 1
                    if firstError == nil { firstError = error.localizedDescription }
                }
            }
            // Rolling summary (always 30-day for the rolling cards)
            group.addTask { @MainActor in
                do {
                    let response = try await APIClient.shared.fetchSummary(from: rollingFrom, to: rollingTo)
                    self.rollingSummary = response
                    self.applyFreshness(response.freshness)
                } catch {
                    errorCount += 1
                    if firstError == nil { firstError = error.localizedDescription }
                }
            }
            // All-time total summary (matches dashboard "Total" range)
            group.addTask { @MainActor in
                do {
                    let response = try await APIClient.shared.fetchSummary(from: totalRange.from, to: totalRange.to)
                    self.totalSummary = response
                    self.applyFreshness(response.freshness)
                } catch {
                    errorCount += 1
                    if firstError == nil { firstError = error.localizedDescription }
                }
            }
            // Trend data: daily always 30-day, plus hourly/monthly for specific periods
            group.addTask { @MainActor in
                do {
                    // Always fetch 30-day daily for week/month chart
                    let response = try await APIClient.shared.fetchDaily(from: rollingFrom, to: rollingTo)
                    self.daily = response.data
                    self.applyFreshness(response.freshness)
                } catch {
                    errorCount += 1
                    if firstError == nil { firstError = error.localizedDescription }
                }
            }
            group.addTask { @MainActor in
                do {
                    if self.period == .day {
                        let response = try await APIClient.shared.fetchHourly(day: rollingTo)
                        self.hourly = response.data
                        self.monthly = []
                        self.applyFreshness(response.freshness)
                    } else if self.period == .total {
                        let response = try await APIClient.shared.fetchMonthly(from: range.from, to: range.to)
                        self.monthly = response.data
                        self.hourly = []
                        self.applyFreshness(response.freshness)
                    } else {
                        self.hourly = []
                        self.monthly = []
                    }
                } catch {
                    errorCount += 1
                    if firstError == nil { firstError = error.localizedDescription }
                }
            }
            // Heatmap (always full year)
            group.addTask { @MainActor in
                do {
                    let response = try await APIClient.shared.fetchHeatmap()
                    self.heatmap = response
                    self.applyFreshness(response.freshness)
                } catch {
                    errorCount += 1
                    if firstError == nil { firstError = error.localizedDescription }
                }
            }
            // Model breakdown (for selected period)
            group.addTask { @MainActor in
                do {
                    let response = try await APIClient.shared.fetchModelBreakdown(from: range.from, to: range.to)
                    self.modelBreakdown = response
                    self.applyFreshness(response.freshness)
                } catch {
                    errorCount += 1
                    if firstError == nil { firstError = error.localizedDescription }
                }
            }
            // Project usage (for selected period)
            group.addTask { @MainActor in
                do {
                    let response = try await APIClient.shared.fetchProjectUsage(from: range.from, to: range.to)
                    self.projectUsage = response
                    self.applyFreshness(response.freshness)
                } catch {
                    errorCount += 1
                    if firstError == nil { firstError = error.localizedDescription }
                }
            }
            // Usage limits (best-effort, non-fatal)
            group.addTask { @MainActor in
                do {
                    self.usageLimits = try await APIClient.shared.fetchUsageLimits()
                } catch {
                    // Non-fatal: usage limits are best-effort, don't increment errorCount
                }
            }
            // Live snapshot (best-effort, non-fatal)
            group.addTask { @MainActor in
                do {
                    let response = try await APIClient.shared.fetchLiveSessionsSnapshot()
                    self.liveSessionsSnapshot = response
                    self.applyFreshness(response.freshness)
                } catch {
                    self.liveSessionsSnapshot = nil
                }
            }
        }

        if errorCount >= totalFetches {
            self.error = firstError
        }
        if errorCount < totalFetches {
            self.lastRefreshed = Date()
        }

        await refreshParityTabs()
        updateDerivedData()
        isLoading = false

        // Push the latest data to the widget snapshot file so the desktop
        // widgets pick it up on their next timeline reload.
        await WidgetSnapshotWriter.update(from: self)
    }

    // MARK: - Sync

    /// Initial launch: publish the startup snapshot first, then refresh server data.
    func syncThenLoad() async {
        serverOnline = await APIClient.shared.checkServerHealth()
        if serverOnline {
            await loadStartupSnapshot()
        }

        isSyncing = true
        do {
            _ = try await APIClient.shared.triggerSync()
        } catch {
            // Sync failure is non-fatal — proceed with whatever data exists
        }
        isSyncing = false
        await loadAll()
    }

    func loadStartupSnapshot() async {
        do {
            let snapshot = try await APIClient.shared.fetchStartupSnapshot()
            startupSnapshot = snapshot
            projectionFreshness = nil
        } catch {
            // Snapshot is an optional fast-start path; normal refresh still follows.
        }
    }

    func refreshParityTabs() async {
        parityError = nil
        var failures: [String] = []

        do {
            compareMetrics = try await APIClient.shared.fetchCompareMetrics()
        } catch {
            failures.append("Compare: \(error.localizedDescription)")
        }

        do {
            parityModels = try await APIClient.shared.fetchModelsParity()
        } catch {
            failures.append("Models: \(error.localizedDescription)")
        }

        do {
            yieldSummary = try await APIClient.shared.fetchYield()
        } catch {
            failures.append("Yield: \(error.localizedDescription)")
        }

        do {
            optimizeFindings = try await APIClient.shared.fetchOptimizeFindings()
        } catch {
            failures.append("Optimize: \(error.localizedDescription)")
        }

        do {
            planView = try await APIClient.shared.fetchPlanView()
        } catch {
            failures.append("Plan: \(error.localizedDescription)")
        }

        do {
            forecastView = try await APIClient.shared.fetchForecast()
        } catch {
            failures.append("Forecast: \(error.localizedDescription)")
        }

        parityError = failures.isEmpty ? nil : failures.joined(separator: "\n")
    }

    func triggerSync() async {
        guard !isSyncing else { return }
        isSyncing = true
        do {
            _ = try await APIClient.shared.triggerSync()
            await loadAll()
        } catch {
            self.error = error.localizedDescription
        }
        isSyncing = false
    }

    // MARK: - Auto Refresh

    func startAutoRefresh(interval: TimeInterval = 300) {
        stopAutoRefresh()
        refreshTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(interval) * 1_000_000_000)
                guard !Task.isCancelled, let self else { break }
                await self.syncThenLoad()
            }
        }
    }

    func stopAutoRefresh() {
        refreshTask?.cancel()
        refreshTask = nil
    }

    // MARK: - Derived Data

    private func updateDerivedData() {
        fleetData = buildFleetData()
        topModels = buildTopModels()
    }

    private func applyFreshness(_ freshness: ProjectionFreshness?) {
        guard let freshness else { return }
        projectionFreshness = freshness
    }

    private func buildFleetData() -> [FleetEntry] {
        guard let sources = modelBreakdown?.sources else { return [] }

        let normalized: [(source: String, totalTokens: Int, totalCost: Double, models: [ModelEntry])] = sources.compactMap { entry in
            let tokens = entry.totals.billableTotalTokens > 0
                ? entry.totals.billableTotalTokens
                : entry.totals.totalTokens
            guard tokens > 0 else { return nil }
            let cost = Double(entry.totals.totalCostUsd ?? "0") ?? 0
            return (source: entry.source, totalTokens: tokens, totalCost: cost, models: entry.models)
        }

        guard !normalized.isEmpty else { return [] }

        let grandTotal = normalized.reduce(0) { $0 + $1.totalTokens }

        return normalized
            .sorted { $0.totalTokens > $1.totalTokens }
            .filter { entry in
                let pct = grandTotal > 0 ? Double(entry.totalTokens) / Double(grandTotal) * 100 : 0
                return pct >= 0.1
            }
            .map { entry in
                let label = entry.source.isEmpty ? "—" : entry.source.uppercased()
                let percentRaw = grandTotal > 0 ? Double(entry.totalTokens) / Double(grandTotal) * 100 : 0
                let totalPercent = String(format: "%.1f", percentRaw)

                let models: [FleetModel] = entry.models.compactMap { model in
                    let modelTokens = model.totals.billableTotalTokens > 0
                        ? model.totals.billableTotalTokens
                        : model.totals.totalTokens
                    guard modelTokens > 0 else { return nil }
                    let share = entry.totalTokens > 0
                        ? (Double(modelTokens) / Double(entry.totalTokens) * 1000).rounded() / 10
                        : 0
                    let name = model.model.isEmpty ? "—" : model.model
                    let id = model.modelId.isEmpty ? name.lowercased() : model.modelId
                    return FleetModel(id: id, name: name, share: share, usage: modelTokens)
                }

                return FleetEntry(
                    label: label,
                    totalPercent: totalPercent,
                    usd: entry.totalCost,
                    usage: entry.totalTokens,
                    models: models
                )
            }
    }

    private func buildTopModels() -> [TopModel] {
        guard let sources = modelBreakdown?.sources, !sources.isEmpty else { return [] }

        var totalsByKey: [String: Int] = [:]
        var costsByKey: [String: Double] = [:]
        var nameByKey: [String: String] = [:]
        var sourceByKey: [String: String] = [:]
        var nameWeight: [String: Int] = [:]
        var totalTokensAll = 0

        for source in sources {
            for model in source.models {
                let tokens = model.totals.billableTotalTokens
                guard tokens > 0 else { continue }
                totalTokensAll += tokens

                let name = model.model.isEmpty ? "—" : model.model
                let key = name.lowercased().trimmingCharacters(in: .whitespaces)
                guard !key.isEmpty else { continue }

                totalsByKey[key, default: 0] += tokens
                costsByKey[key, default: 0] += Double(model.totals.totalCostUsd ?? "0") ?? 0
                let currentWeight = nameWeight[key] ?? 0
                if tokens >= currentWeight {
                    nameWeight[key] = tokens
                    nameByKey[key] = name
                    sourceByKey[key] = source.source
                }
            }
        }

        guard !totalsByKey.isEmpty else { return [] }

        let knownTotal = totalsByKey.values.reduce(0, +)
        let totalTokens = totalTokensAll > 0 ? totalTokensAll : knownTotal

        return totalsByKey
            .map { key, tokens -> TopModel in
                let percent = totalTokens > 0
                    ? String(format: "%.1f", Double(tokens) / Double(totalTokens) * 100)
                    : "0.0"
                return TopModel(
                    id: key,
                    name: nameByKey[key] ?? "—",
                    source: sourceByKey[key] ?? "",
                    tokens: tokens,
                    usd: costsByKey[key] ?? 0,
                    percent: percent
                )
            }
            .filter { $0.tokens > 0 }
            .sorted { lhs, rhs in
                if lhs.tokens != rhs.tokens { return lhs.tokens > rhs.tokens }
                return lhs.name.localizedCompare(rhs.name) == .orderedAscending
            }
            .prefix(5)
            .map { $0 }
    }
}
