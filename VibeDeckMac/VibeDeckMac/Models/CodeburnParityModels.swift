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

struct ExportPreviewResponse: Decodable, Equatable {
    let ok: Bool
    let asOf: String?
    let range: CodeburnRange?
    let totals: CodeburnTotals?
    let rows: [ExportPreviewRow]

    enum CodingKeys: String, CodingKey {
        case ok
        case asOf = "as_of"
        case range
        case totals
        case rows
    }
}

struct CodeburnRange: Decodable, Equatable {
    let from: String?
    let to: String?
    let tz: String?
}

struct ExportPreviewRow: Decodable, Equatable, Identifiable {
    var id: String { "\(provider):\(sessionId):\(lastObservedAt)" }
    let provider: String
    let sessionId: String
    let branch: String
    let model: String
    let totalTokens: Int
    let costUSD: String
    let lastObservedAt: String

    enum CodingKeys: String, CodingKey {
        case provider
        case sessionId = "session_id"
        case branch
        case model
        case totalTokens = "total_tokens"
        case costUSD = "cost_usd"
        case lastObservedAt = "last_observed_at"
    }
}

struct BranchUsageResponse: Decodable, Equatable {
    let repos: [BranchRepoEntry]
    let totals: BranchUsageTotals?
}

struct BranchUsageTotals: Decodable, Equatable {
    let totalTokens: Int?
    let totalCostUSD: FlexibleCostValue?
    let sessionCount: Int?

    enum CodingKeys: String, CodingKey {
        case totalTokens = "total_tokens"
        case totalCostUSD = "total_cost_usd"
        case sessionCount = "session_count"
    }
}

struct BranchRepoEntry: Decodable, Equatable, Identifiable {
    var id: String { repoRoot ?? projectRef ?? projectKey ?? "repo" }
    let repoRoot: String?
    let projectKey: String?
    let projectRef: String?
    let archived: Bool?
    let branches: [BranchUsageRow]

    enum CodingKeys: String, CodingKey {
        case repoRoot = "repo_root"
        case projectKey = "project_key"
        case projectRef = "project_ref"
        case archived
        case branches
    }
}

struct BranchUsageRow: Decodable, Equatable, Identifiable {
    var id: String { "\(repoRoot ?? ""):\(branch):\(branchKind ?? "")" }
    var repoRoot: String?
    let branch: String
    let attributionBranch: String?
    let branchKind: String?
    let totalTokens: Int
    let totalCostUSD: FlexibleCostValue?
    let sessionCount: Int
    let lastSeenAt: String?
    let confidence: BranchConfidence?
    let models: [BranchModelRollup]

    enum CodingKeys: String, CodingKey {
        case branch
        case attributionBranch = "attribution_branch"
        case branchKind = "branch_kind"
        case totalTokens = "total_tokens"
        case totalCostUSD = "total_cost_usd"
        case sessionCount = "session_count"
        case lastSeenAt = "last_seen_at"
        case confidence
        case models
    }
}

struct BranchConfidence: Decodable, Equatable {
    let high: Int?
    let medium: Int?
    let low: Int?
    let unattributed: Int?
}

struct BranchModelRollup: Decodable, Equatable {
    let model: String?
    let totalTokens: Int?

    enum CodingKeys: String, CodingKey {
        case model
        case totalTokens = "total_tokens"
    }
}

struct LiveSessionsSnapshotResponse: Decodable, Equatable {
    let sessions: [LiveSessionRow]
    let activeSessions: [LiveSessionRow]
    let generatedAt: String?
    let lastSyncAt: String?

    var currentSessions: [LiveSessionRow] {
        if !activeSessions.isEmpty { return activeSessions }
        return sessions.filter { $0.isActive }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        sessions = try container.decodeIfPresent([LiveSessionRow].self, forKey: .sessions) ?? []
        activeSessions = try container.decodeIfPresent([LiveSessionRow].self, forKey: .activeSessions) ?? []
        generatedAt = try container.decodeIfPresent(String.self, forKey: .generatedAt)
        lastSyncAt = try container.decodeIfPresent(String.self, forKey: .lastSyncAt)
    }

    enum CodingKeys: String, CodingKey {
        case sessions
        case activeSessions = "active_sessions"
        case generatedAt = "generated_at"
        case lastSyncAt = "last_sync_at"
    }
}

struct LiveSessionRow: Decodable, Equatable, Identifiable {
    var id: String {
        "\(provider ?? "unknown"):\(sessionId ?? startedAt ?? displayContext)"
    }
    let provider: String?
    let sessionId: String?
    let state: String?
    let startedAt: String?
    let endedAt: String?
    let lastObservedAt: String?
    let updatedAt: String?
    let cwd: String?
    let repoRoot: String?
    let branch: String?
    let model: String?
    let totalTokens: Int?
    let totalCostUSD: FlexibleCostValue?
    let estimatedTotalCostUSD: Double?

    var isActive: Bool {
        endedAt == nil && state?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() != "ended"
    }

    var displayProvider: String {
        let normalized = provider?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return normalized.isEmpty ? "AI" : normalized.capitalized
    }

    var displayContext: String {
        if let branch, !branch.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return branch
        }
        if let repoRoot, let name = repoRoot.split(separator: "/").last, !name.isEmpty {
            return String(name)
        }
        if let cwd, let name = cwd.split(separator: "/").last, !name.isEmpty {
            return String(name)
        }
        return model?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false ? model! : "Current session"
    }

    var displayCost: String {
        let value = estimatedTotalCostUSD ?? totalCostUSD?.doubleValue ?? 0
        return TokenFormatter.formatCost(value)
    }

    enum CodingKeys: String, CodingKey {
        case provider
        case sessionId = "session_id"
        case state
        case startedAt = "started_at"
        case endedAt = "ended_at"
        case lastObservedAt = "last_observed_at"
        case updatedAt = "updated_at"
        case cwd
        case repoRoot = "repo_root"
        case branch
        case model
        case totalTokens = "total_tokens"
        case totalCostUSD = "total_cost_usd"
        case estimatedTotalCostUSD = "estimated_total_cost_usd"
    }
}

struct FlexibleCostValue: Decodable, Equatable {
    let doubleValue: Double

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let value = try? container.decode(Double.self) {
            doubleValue = value
        } else if let value = try? container.decode(String.self), let parsed = Double(value) {
            doubleValue = parsed
        } else {
            doubleValue = 0
        }
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
