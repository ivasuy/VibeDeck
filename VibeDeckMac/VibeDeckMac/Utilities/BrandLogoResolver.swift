import AppKit

struct BrandLogoResolver {
    static let shared = BrandLogoResolver()
    private init() {}

    private let legacyPath = ["EmbeddedServer", "vibedeck", "dashboard", "dist", "brand-logos"]
    private let dashboardPath = ["dashboard", "dist", "brand-logos"]

    func image(
        named filename: String,
        replacingCurrentColorWith color: String? = nil,
        targetSize: Int = 24
    ) -> NSImage? {
        guard let url = logoURL(for: filename) else {
            return nil
        }
        guard var svg = try? String(contentsOf: url, encoding: .utf8) else {
            return nil
        }

        if let color {
            svg = svg.replacingOccurrences(of: "currentColor", with: color)
        }

        svg = normalizedIconSVG(svg, targetSize: targetSize)

        guard let data = svg.data(using: .utf8),
              let image = NSImage(data: data) else {
            return nil
        }

        image.size = NSSize(width: targetSize, height: targetSize)
        image.isTemplate = false
        return image
    }

    func logoURL(for filename: String) -> URL? {
        guard let resourceURL = Bundle.main.resourceURL else { return nil }
        let candidates = [
            resourceURL.appendingPathComponent(legacyPath.joined(separator: "/")).appendingPathComponent(filename),
            resourceURL.appendingPathComponent(dashboardPath.joined(separator: "/")).appendingPathComponent(filename),
            resourceURL.appendingPathComponent("brand-logos").appendingPathComponent(filename),
        ]
        return candidates.first(where: { FileManager.default.fileExists(atPath: $0.path) })
    }

    private func normalizedIconSVG(_ svg: String, targetSize: Int) -> String {
        var normalized = svg
        let widthPattern = "width\\s*=\\s*\"[^\"]*\""
        let heightPattern = "height\\s*=\\s*\"[^\"]*\""
        let replacementWidth = "width=\"\(targetSize)\""
        let replacementHeight = "height=\"\(targetSize)\""

        if normalized.range(of: widthPattern, options: .regularExpression) != nil {
            normalized = normalized.replacingOccurrences(of: widthPattern, with: replacementWidth, options: .regularExpression)
        } else if let svgTagRange = normalized.range(of: "<svg") {
            normalized = normalized.replacingOccurrences(of: "<svg", with: "<svg width=\"\(targetSize)\"", options: .literal, range: svgTagRange)
        }

        if normalized.range(of: heightPattern, options: .regularExpression) != nil {
            normalized = normalized.replacingOccurrences(of: heightPattern, with: replacementHeight, options: .regularExpression)
        } else if let svgTagRange = normalized.range(of: "<svg") {
            normalized = normalized.replacingOccurrences(of: "<svg", with: "<svg height=\"\(targetSize)\"", options: .literal, range: svgTagRange)
        }

        return normalized
    }
}
