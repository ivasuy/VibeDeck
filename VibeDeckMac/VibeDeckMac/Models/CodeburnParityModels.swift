import Foundation

struct CodeburnTotals: Decodable, Equatable {
    let sessionCount: Int?
    let totalTokens: Int?
    let totalCostUSD: String?
    let costEstimated: Bool?
    let costQuality: String?

    enum CodingKeys: String, CodingKey {
        case sessionCount = "session_count"
        case totalTokens = "total_tokens"
        case totalCostUSD = "total_cost_usd"
        case costEstimated = "cost_estimated"
        case costQuality = "cost_quality"
    }
}

struct CompareMetricsResponse: Decodable, Equatable {
    let ok: Bool
    let asOf: String?
    let totals: CodeburnTotals?
    let metrics: [String: String]?

    enum CodingKeys: String, CodingKey {
        case ok
        case asOf = "as_of"
        case totals
        case metrics
    }
}

struct ModelParityRow: Decodable, Equatable, Identifiable {
    var id: String { model }
    let model: String
    let providers: [String]?
    let totalTokens: Int?
    let totalCostUSD: String?
    let sessionCount: Int?
    let taskCategories: [String: Int]?
    let tools: [String: Int]?
    let skills: [String: Int]?
    let fastModeCount: Int?

    enum CodingKeys: String, CodingKey {
        case model
        case providers
        case totalTokens = "total_tokens"
        case totalCostUSD = "total_cost_usd"
        case sessionCount = "session_count"
        case taskCategories = "task_categories"
        case tools
        case skills
        case fastModeCount = "fast_mode_count"
    }
}

struct ModelsParityResponse: Decodable, Equatable {
    let ok: Bool
    let models: [ModelParityRow]

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        ok = try container.decodeIfPresent(Bool.self, forKey: .ok) ?? false
        models = try container.decodeIfPresent([ModelParityRow].self, forKey: .models) ?? []
    }

    enum CodingKeys: String, CodingKey {
        case ok
        case models
    }
}

struct YieldBranchRow: Decodable, Equatable, Identifiable {
    var id: String { branch }
    let branch: String
    let yieldState: String
    let sessionCount: Int?
    let totalTokens: Int?
    let totalCostUSD: String?

    enum CodingKeys: String, CodingKey {
        case branch
        case yieldState = "yield_state"
        case sessionCount = "session_count"
        case totalTokens = "total_tokens"
        case totalCostUSD = "total_cost_usd"
    }
}

struct YieldResponse: Decodable, Equatable {
    let ok: Bool
    let branches: [YieldBranchRow]

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        ok = try container.decodeIfPresent(Bool.self, forKey: .ok) ?? false
        branches = try container.decodeIfPresent([YieldBranchRow].self, forKey: .branches) ?? []
    }

    enum CodingKeys: String, CodingKey {
        case ok
        case branches
    }
}
