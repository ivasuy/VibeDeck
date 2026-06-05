import Foundation

struct ProjectUsageResponse: Codable, Equatable {
    var generatedAt: String
    var entries: [ProjectEntry]
    var freshness: ProjectionFreshness?

    init(generatedAt: String = "", entries: [ProjectEntry] = [], freshness: ProjectionFreshness? = nil) {
        self.generatedAt = generatedAt; self.entries = entries; self.freshness = freshness
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        generatedAt = try c.decodeIfPresent(String.self, forKey: .generatedAt) ?? ""
        entries = try c.decodeIfPresent([ProjectEntry].self, forKey: .entries) ?? []
        freshness = try c.decodeIfPresent(ProjectionFreshness.self, forKey: .freshness)
    }

    private enum CodingKeys: String, CodingKey {
        case generatedAt = "generated_at"
        case entries
        case freshness
    }
}

struct ProjectEntry: Codable, Equatable, Identifiable {
    var id: String { projectKey }
    var projectKey: String
    var projectRef: String?
    var totalTokens: String
    var billableTotalTokens: String

    var billableTokensInt: Int { Int(billableTotalTokens) ?? 0 }

    init(projectKey: String = "", projectRef: String? = nil, totalTokens: String = "0", billableTotalTokens: String = "0") {
        self.projectKey = projectKey; self.projectRef = projectRef
        self.totalTokens = totalTokens; self.billableTotalTokens = billableTotalTokens
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        projectKey = try c.decodeIfPresent(String.self, forKey: .projectKey) ?? ""
        projectRef = try c.decodeIfPresent(String.self, forKey: .projectRef)
        totalTokens = try c.decodeIfPresent(String.self, forKey: .totalTokens) ?? "0"
        billableTotalTokens = try c.decodeIfPresent(String.self, forKey: .billableTotalTokens) ?? "0"
    }

    private enum CodingKeys: String, CodingKey {
        case projectKey = "project_key"
        case projectRef = "project_ref"
        case totalTokens = "total_tokens"
        case billableTotalTokens = "billable_total_tokens"
    }
}
