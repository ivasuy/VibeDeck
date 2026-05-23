import Foundation

struct OptimizeHealth: Decodable, Equatable {
    let healthGrade: String
    let score: Int
    let observedAt: String?
    let countsBySeverity: [String: Int]

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        healthGrade = try container.decodeIfPresent(String.self, forKey: .healthGrade)
            ?? container.decodeIfPresent(String.self, forKey: .grade)
            ?? "-"
        score = try container.decodeIfPresent(Int.self, forKey: .score) ?? 0
        observedAt = try container.decodeIfPresent(String.self, forKey: .observedAt)
        countsBySeverity = try container.decodeIfPresent([String: Int].self, forKey: .countsBySeverity) ?? [:]
    }

    enum CodingKeys: String, CodingKey {
        case healthGrade = "health_grade"
        case grade
        case score
        case observedAt = "observed_at"
        case countsBySeverity = "counts_by_severity"
    }
}

struct OptimizeFinding: Decodable, Equatable, Identifiable {
    var id: String { fingerprint.isEmpty ? "\(rowID)-\(title)" : fingerprint }
    let rowID: Int
    let fingerprint: String
    let findingKind: String
    let severity: String
    let title: String
    let detail: String
    let estimatedTokenWaste: Int
    let estimatedCostWasteUsd: Double
    let pasteFix: String?

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        rowID = try container.decodeIfPresent(Int.self, forKey: .id) ?? 0
        fingerprint = try container.decodeIfPresent(String.self, forKey: .fingerprint) ?? ""
        findingKind = try container.decodeIfPresent(String.self, forKey: .findingKind) ?? ""
        severity = try container.decodeIfPresent(String.self, forKey: .severity) ?? "low"
        title = try container.decodeIfPresent(String.self, forKey: .title) ?? "Optimize finding"
        detail = try container.decodeIfPresent(String.self, forKey: .detail) ?? ""
        estimatedTokenWaste = try container.decodeIfPresent(Int.self, forKey: .estimatedTokenWaste) ?? 0
        estimatedCostWasteUsd = try container.decodeFlexibleDouble(forKey: .estimatedCostWasteUsd) ?? 0
        pasteFix = try container.decodeIfPresent(String.self, forKey: .pasteFix)
    }

    enum CodingKeys: String, CodingKey {
        case id
        case fingerprint
        case findingKind = "finding_kind"
        case severity
        case title
        case detail
        case estimatedTokenWaste = "estimated_token_waste"
        case estimatedCostWasteUsd = "estimated_cost_waste_usd"
        case pasteFix = "paste_fix"
    }
}

struct OptimizeFindingsResponse: Decodable, Equatable {
    let ok: Bool
    let health: OptimizeHealth?
    let findings: [OptimizeFinding]

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        ok = try container.decodeIfPresent(Bool.self, forKey: .ok) ?? false
        health = try container.decodeIfPresent(OptimizeHealth.self, forKey: .health)
        findings = try container.decodeIfPresent([OptimizeFinding].self, forKey: .findings) ?? []
    }

    enum CodingKeys: String, CodingKey {
        case ok
        case health
        case findings
    }
}

struct PlanRange: Decodable, Equatable {
    let from: String
    let to: String

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        from = try container.decodeIfPresent(String.self, forKey: .from) ?? ""
        to = try container.decodeIfPresent(String.self, forKey: .to) ?? ""
    }

    enum CodingKeys: String, CodingKey {
        case from
        case to
    }
}

struct PlanViewResponse: Decodable, Equatable {
    let ok: Bool
    let plan: String
    let label: String
    let labelDetail: String
    let monthlyUsd: Double
    let monthToDateUsd: Double
    let usagePercent: Double?
    let displayCurrency: String?
    let range: PlanRange?

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        ok = try container.decodeIfPresent(Bool.self, forKey: .ok) ?? false
        plan = try container.decodeIfPresent(String.self, forKey: .plan) ?? "custom"
        label = try container.decodeIfPresent(String.self, forKey: .label) ?? "Plan usage"
        labelDetail = try container.decodeIfPresent(String.self, forKey: .labelDetail) ?? label
        monthlyUsd = try container.decodeFlexibleDouble(forKey: .monthlyPlanUsd)
            ?? container.decodeFlexibleDouble(forKey: .monthlyUsd)
            ?? 0
        monthToDateUsd = try container.decodeFlexibleDouble(forKey: .monthToDateApiEquivalentUsd)
            ?? container.decodeFlexibleDouble(forKey: .monthToDateUsd)
            ?? 0
        usagePercent = try container.decodeFlexibleDouble(forKey: .usagePercent)
        displayCurrency = try container.decodeIfPresent(String.self, forKey: .displayCurrency)
        range = try container.decodeIfPresent(PlanRange.self, forKey: .range)
    }

    enum CodingKeys: String, CodingKey {
        case ok
        case plan
        case label
        case labelDetail = "label_detail"
        case monthlyUsd = "monthly_usd"
        case monthlyPlanUsd = "monthly_plan_usd"
        case monthToDateUsd = "month_to_date_usd"
        case monthToDateApiEquivalentUsd = "month_to_date_api_equivalent_usd"
        case usagePercent = "usage_percent"
        case displayCurrency = "display_currency"
        case range
    }
}

struct ForecastAnomaly: Decodable, Equatable, Identifiable {
    var id: String { day }
    let day: String
    let totalCostUsd: String
    let prior7dAverageUsd: String
    let deltaUsd: String

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        day = try container.decodeIfPresent(String.self, forKey: .day) ?? ""
        totalCostUsd = try container.decodeIfPresent(String.self, forKey: .totalCostUsd) ?? "0.0000"
        prior7dAverageUsd = try container.decodeIfPresent(String.self, forKey: .prior7dAverageUsd) ?? "0.0000"
        deltaUsd = try container.decodeIfPresent(String.self, forKey: .deltaUsd) ?? "0.0000"
    }

    enum CodingKeys: String, CodingKey {
        case day
        case totalCostUsd = "total_cost_usd"
        case prior7dAverageUsd = "prior_7d_average_usd"
        case deltaUsd = "delta_usd"
    }
}

struct ForecastPulse: Decodable, Equatable {
    let state: String
    let reason: String

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        state = try container.decodeIfPresent(String.self, forKey: .state) ?? "quiet"
        reason = try container.decodeIfPresent(String.self, forKey: .reason) ?? ""
    }

    enum CodingKeys: String, CodingKey {
        case state
        case reason
    }
}

struct ForecastResponse: Decodable, Equatable {
    let ok: Bool
    let movingAverage7d: String
    let forecast30dUsd: String
    let anomalies: [ForecastAnomaly]
    let pulse: ForecastPulse?

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        ok = try container.decodeIfPresent(Bool.self, forKey: .ok) ?? false
        movingAverage7d = try container.decodeIfPresent(String.self, forKey: .movingAverage7d) ?? "0.0000"
        forecast30dUsd = try container.decodeIfPresent(String.self, forKey: .forecast30dUsd) ?? "0.0000"
        anomalies = try container.decodeIfPresent([ForecastAnomaly].self, forKey: .anomalies) ?? []
        pulse = try container.decodeIfPresent(ForecastPulse.self, forKey: .pulse)
    }

    enum CodingKeys: String, CodingKey {
        case ok
        case movingAverage7d = "moving_average_7d"
        case forecast30dUsd = "forecast_30d_usd"
        case anomalies
        case pulse
    }
}

struct CurrencyRatesResponse: Decodable, Equatable {
    let base: String
    let rates: [String: Double]
    let cached: Bool?
    let stale: Bool?
    let asOf: String?
    let error: String?

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        base = try container.decodeIfPresent(String.self, forKey: .base) ?? "USD"
        rates = try container.decodeIfPresent([String: Double].self, forKey: .rates) ?? [:]
        cached = try container.decodeIfPresent(Bool.self, forKey: .cached)
        stale = try container.decodeIfPresent(Bool.self, forKey: .stale)
        asOf = try container.decodeIfPresent(String.self, forKey: .asOf)
        error = try container.decodeIfPresent(String.self, forKey: .error)
    }

    enum CodingKeys: String, CodingKey {
        case base
        case rates
        case cached
        case stale
        case asOf = "as_of"
        case error
    }
}

private extension KeyedDecodingContainer {
    func decodeFlexibleDouble(forKey key: Key) throws -> Double? {
        if let value = try decodeIfPresent(Double.self, forKey: key) {
            return value
        }
        if let value = try decodeIfPresent(Int.self, forKey: key) {
            return Double(value)
        }
        if let value = try decodeIfPresent(String.self, forKey: key) {
            let number = Double(value)
            return number?.isFinite == true ? number : nil
        }
        return nil
    }
}
