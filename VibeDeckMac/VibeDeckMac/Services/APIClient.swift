import Foundation

actor APIClient {
    static let shared = APIClient()
    private struct LocalAuthResponse: Decodable {
        let token: String
    }

    private let baseURL = Constants.serverBaseURL
    private let session: URLSession
    private let decoder: JSONDecoder
    private let localAuthHeader = "x-vibedeck-local-auth"
    private var localAuthHeaderLegacy: String {
        localAuthHeader.replacingOccurrences(of: "vibedeck", with: "vibedeck")
    }

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 10
        config.timeoutIntervalForResource = 30
        self.session = URLSession(configuration: config)

        let jsonDecoder = JSONDecoder()
        // No .convertFromSnakeCase — all models use explicit CodingKeys with snake_case rawValues
        self.decoder = jsonDecoder
    }

    // MARK: - Public API

	func fetchSummary(from: String, to: String) async throws -> UsageSummaryResponse {
		try await fetch("/functions/vibedeck-usage-summary", queryItems: withTimeZoneQueryItems([
			URLQueryItem(name: "from", value: from),
			URLQueryItem(name: "to", value: to)
		]))
	}

	func fetchDaily(from: String, to: String) async throws -> DailyUsageResponse {
		try await fetch("/functions/vibedeck-usage-daily", queryItems: withTimeZoneQueryItems([
			URLQueryItem(name: "from", value: from),
			URLQueryItem(name: "to", value: to)
		]))
	}

	func fetchHeatmap(weeks: Int = 52) async throws -> HeatmapResponse {
		try await fetch("/functions/vibedeck-usage-heatmap", queryItems: withTimeZoneQueryItems([
			URLQueryItem(name: "weeks", value: String(weeks))
		]))
	}

	func fetchModelBreakdown(from: String, to: String) async throws -> ModelBreakdownResponse {
		try await fetch("/functions/vibedeck-usage-model-breakdown", queryItems: withTimeZoneQueryItems([
			URLQueryItem(name: "from", value: from),
			URLQueryItem(name: "to", value: to)
		]))
	}

	func fetchProjectUsage(from: String, to: String) async throws -> ProjectUsageResponse {
		try await fetch("/functions/vibedeck-project-usage-summary", queryItems: withTimeZoneQueryItems([
			URLQueryItem(name: "from", value: from),
			URLQueryItem(name: "to", value: to)
		]))
	}

	func fetchMonthly(from: String, to: String) async throws -> MonthlyUsageResponse {
		try await fetch("/functions/vibedeck-usage-monthly", queryItems: withTimeZoneQueryItems([
			URLQueryItem(name: "from", value: from),
			URLQueryItem(name: "to", value: to)
		]))
	}

	func fetchHourly(day: String) async throws -> HourlyUsageResponse {
		try await fetch("/functions/vibedeck-usage-hourly", queryItems: withTimeZoneQueryItems([
			URLQueryItem(name: "day", value: day)
		]))
	}

    func fetchUsageLimits() async throws -> UsageLimitsResponse {
        try await fetch("/functions/vibedeck-usage-limits")
    }

    func triggerSync() async throws -> SyncResponse {
        try await post("/functions/vibedeck-local-sync")
    }

    func checkServerHealth() async -> Bool {
        do {
            let paths = legacyAwarePaths(for: "/functions/vibedeck-user-status")
            for path in paths {
                guard let url = URL(string: baseURL + path) else { continue }
                do {
                    let (_, response) = try await session.data(from: url)
                    guard let httpResponse = response as? HTTPURLResponse else { continue }
                    if httpResponse.statusCode == 200 { return true }
                } catch {
                    continue
                }
            }
            return false
        } catch {
            return false
        }
    }

    // MARK: - Private Helpers

    private func fetch<T: Decodable>(_ path: String, queryItems: [URLQueryItem] = []) async throws -> T {
        let candidatePaths = legacyAwarePaths(for: path);
        for (index, candidatePath) in candidatePaths.enumerated() {
            guard var components = URLComponents(string: baseURL + candidatePath) else {
                throw APIError.invalidURL
            }
            if !queryItems.isEmpty {
                components.queryItems = queryItems
            }
            guard let url = components.url else {
                throw APIError.invalidURL
            }
            var request = URLRequest(url: url)
            request.httpMethod = "GET";
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.invalidResponse
            }
            if (200...299).contains(httpResponse.statusCode) {
                return try decoder.decode(T.self, from: data)
            }
            if httpResponse.statusCode == 404 && index < candidatePaths.count - 1 {
                continue
            }
            throw APIError.httpError(statusCode: httpResponse.statusCode)
        }
        throw APIError.httpError(statusCode: 404)
    }

	private func withTimeZoneQueryItems(_ items: [URLQueryItem]) -> [URLQueryItem] {
		items + [
			URLQueryItem(name: "tz", value: DateHelpers.currentTimeZoneIdentifier),
			URLQueryItem(name: "tz_offset_minutes", value: String(DateHelpers.currentUTCOffsetMinutes()))
		]
	}

    private func post<T: Decodable>(_ path: String) async throws -> T {
        let candidatePaths = legacyAwarePaths(for: path);
        let token = try await fetchLocalAuthToken()
        var lastNetworkError: Error?
        for (index, candidatePath) in candidatePaths.enumerated() {
            do {
                guard var components = URLComponents(string: baseURL + candidatePath) else {
                    throw APIError.invalidURL
                }
                guard let url = components.url else {
                    throw APIError.invalidURL
                }
                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.setValue("application/json", forHTTPHeaderField: "Accept")
                request.setValue(token, forHTTPHeaderField: localAuthHeader)
                request.setValue(token, forHTTPHeaderField: localAuthHeaderLegacy)
                request.httpBody = Data("{}".utf8)
                let (data, response) = try await session.data(for: request)
                guard let httpResponse = response as? HTTPURLResponse else {
                    throw APIError.invalidResponse
                }
                if (200...299).contains(httpResponse.statusCode) {
                    return try decoder.decode(T.self, from: data)
                }
                if httpResponse.statusCode == 404 && index < candidatePaths.count - 1 {
                    continue
                }
                throw APIError.httpError(statusCode: httpResponse.statusCode)
            } catch {
                lastNetworkError = error
                if let apiError = error as? APIError, case .httpError(let statusCode) = apiError, statusCode == 404 && index < candidatePaths.count - 1 {
                    continue
                }
                throw error
            }
        }
        if let apiError = lastNetworkError as? APIError, case .httpError(let statusCode) = apiError {
            throw APIError.httpError(statusCode: statusCode)
        }
        throw lastNetworkError ?? APIError.httpError(statusCode: 404)
    }

    private func fetchLocalAuthToken() async throws -> String {
        guard let url = URL(string: baseURL + "/api/local-auth") else {
            throw APIError.invalidURL
        }
        let (data, response) = try await session.data(from: url)
        try validateResponse(response)
        let payload = try decoder.decode(LocalAuthResponse.self, from: data)
        guard !payload.token.isEmpty else {
            throw APIError.invalidResponse
        }
        return payload.token
    }

    private func legacyAwarePaths(for primaryPath: String) -> [String] {
        let legacyPath = primaryPath.replacingOccurrences(of: "/functions/vibedeck-", with: "/functions/vibedeck-")
        if legacyPath == primaryPath {
            return [primaryPath]
        }
        return [primaryPath, legacyPath]
    }
}

enum APIError: LocalizedError {
    case invalidURL
    case invalidResponse
    case httpError(statusCode: Int)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .invalidResponse:
            return "Invalid response from server"
        case .httpError(let statusCode):
            return "HTTP error: \(statusCode)"
        }
    }
}
