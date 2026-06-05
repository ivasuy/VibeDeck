import SwiftUI
import WidgetKit

// MARK: - Widget chrome

struct WidgetFamilyPadding: ViewModifier {
    @Environment(\.widgetFamily) private var family

    func body(content: Content) -> some View {
        content.padding(padding)
    }

    private var padding: CGFloat {
        switch family {
        case .systemSmall:
            return 12
        case .systemMedium:
            return 14
        default:
            return 16
        }
    }
}

// MARK: - Header

struct WidgetHeader: View {
    let title: String
    var subtitle: String? = nil
    var icon: String = "bolt.circle.fill"

    var body: some View {
        HStack(alignment: .lastTextBaseline, spacing: 6) {
            Text(title)
                .font(.system(size: 10, weight: .semibold))
                .tracking(0.6)
                .foregroundColor(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Spacer(minLength: 0)
            if let subtitle {
                Text(subtitle)
                    .font(.system(size: 9))
                    .foregroundColor(.secondary.opacity(0.75))
                    .lineLimit(1)
                    .monospacedDigit()
            }
        }
        .frame(height: 16)
    }
}

// MARK: - Stat block

struct WidgetStat: View {
    let label: String
    let value: String
    var sub: String? = nil
    var alignment: HorizontalAlignment = .leading

    var body: some View {
        VStack(alignment: alignment, spacing: 2) {
            Text(label.uppercased())
                .font(.system(size: 9, weight: .semibold))
                .foregroundColor(.secondary)
                .tracking(0.4)
            Text(value)
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundColor(.primary)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            if let sub {
                Text(sub)
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
                    .monospacedDigit()
                    .lineLimit(1)
            }
        }
    }
}

// MARK: - Sparkline

struct SparklineView: View {
    let points: [DailyPoint]

    var body: some View {
        GeometryReader { geo in
            let values = points.map { Double($0.totalTokens) }
            let maxV = max(values.max() ?? 1, 1)
            let minV = values.min() ?? 0
            let range = max(maxV - minV, 1)
            let pts = sparklinePoints(
                values: values,
                size: geo.size,
                minV: minV,
                range: range
            )

            ZStack(alignment: .bottomLeading) {
                Path { p in
                    guard let first = pts.first else { return }
                    p.move(to: first)
                    appendMonotoneCubic(to: &p, points: pts)
                }
                .stroke(WidgetTheme.brand, style: StrokeStyle(lineWidth: 1.4, lineCap: .round, lineJoin: .round))
            }
        }
    }
}

/// Map raw values to screen-space points for a sparkline.
private func sparklinePoints(
    values: [Double],
    size: CGSize,
    minV: Double,
    range: Double
) -> [CGPoint] {
    guard !values.isEmpty else { return [] }
    let stepX = size.width / CGFloat(max(values.count - 1, 1))
    return values.enumerated().map { i, v in
        let x = CGFloat(i) * stepX
        let normalized = (v - minV) / range
        let y = size.height - CGFloat(normalized) * size.height
        return CGPoint(x: x, y: y)
    }
}

/// Append a monotone cubic Hermite spline through the given points to `path`.
/// The caller is expected to have already moved the path to `points.first`.
/// Uses the Fritsch–Carlson method to preserve monotonicity and avoid the
/// overshoot that plain Catmull–Rom produces on small sparkline canvases.
private func appendMonotoneCubic(to path: inout Path, points: [CGPoint]) {
    let n = points.count
    guard n >= 2 else { return }
    if n == 2 {
        path.addLine(to: points[1])
        return
    }

    // Secant slopes between consecutive points.
    var dx = [CGFloat](repeating: 0, count: n - 1)
    var slopes = [CGFloat](repeating: 0, count: n - 1)
    for i in 0..<(n - 1) {
        dx[i] = points[i + 1].x - points[i].x
        slopes[i] = dx[i] == 0 ? 0 : (points[i + 1].y - points[i].y) / dx[i]
    }

    // Initial tangents: average of adjacent secants, endpoints use the edge secant.
    var tangents = [CGFloat](repeating: 0, count: n)
    tangents[0] = slopes[0]
    tangents[n - 1] = slopes[n - 2]
    for i in 1..<(n - 1) {
        if slopes[i - 1] * slopes[i] <= 0 {
            tangents[i] = 0
        } else {
            tangents[i] = (slopes[i - 1] + slopes[i]) / 2
        }
    }

    // Fritsch–Carlson monotonicity clamp.
    for i in 0..<(n - 1) {
        if slopes[i] == 0 {
            tangents[i] = 0
            tangents[i + 1] = 0
            continue
        }
        let a = tangents[i] / slopes[i]
        let b = tangents[i + 1] / slopes[i]
        let h = hypot(a, b)
        if h > 3 {
            let t = 3 / h
            tangents[i] = t * a * slopes[i]
            tangents[i + 1] = t * b * slopes[i]
        }
    }

    // Emit cubic segments.
    for i in 0..<(n - 1) {
        let p0 = points[i]
        let p1 = points[i + 1]
        let h = dx[i]
        let c1 = CGPoint(x: p0.x + h / 3, y: p0.y + tangents[i] * h / 3)
        let c2 = CGPoint(x: p1.x - h / 3, y: p1.y - tangents[i + 1] * h / 3)
        path.addCurve(to: p1, control1: c1, control2: c2)
    }
}

// MARK: - Bar trend chart

struct BarTrendChart: View {
    let points: [DailyPoint]
    var showAxis: Bool = false

    var body: some View {
        GeometryReader { geo in
            let values = points.map { Double($0.totalTokens) }
            let maxV = max(values.max() ?? 1, 1)
            let count = CGFloat(max(values.count, 1))
            let spacing: CGFloat = 2
            let barWidth = max((geo.size.width - spacing * (count - 1)) / count, 1)

            HStack(alignment: .bottom, spacing: spacing) {
                ForEach(Array(values.enumerated()), id: \.offset) { _, v in
                    let h = max((CGFloat(v) / CGFloat(maxV)) * geo.size.height, 1)
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(LinearGradient(
                            colors: [WidgetTheme.brand, WidgetTheme.brand.opacity(0.55)],
                            startPoint: .top, endPoint: .bottom
                        ))
                        .frame(width: barWidth, height: h)
                }
            }
        }
    }
}

// MARK: - Shared progress bars

struct WidgetBarSegment: Identifiable {
    let id: String
    let label: String
    let fraction: Double
    let color: Color

    init(id: String, label: String, fraction: Double, color: Color) {
        self.id = id
        self.label = label
        self.fraction = fraction
        self.color = color
    }
}

struct SegmentedBar: View {
    let segments: [WidgetBarSegment]
    var height: CGFloat = 8
    var minimumVisibleFraction: Double = 0.04

    private var normalizedSegments: [WidgetBarSegment] {
        let positives = segments
            .map { segment in
                WidgetBarSegment(
                    id: segment.id,
                    label: segment.label,
                    fraction: max(0, segment.fraction),
                    color: segment.color
                )
            }
            .filter { $0.fraction > 0 }
        let total = positives.reduce(0) { $0 + $1.fraction }
        guard total > 0 else { return [] }

        var visible: [WidgetBarSegment] = []
        var other = 0.0
        for segment in positives {
            let normalized = segment.fraction / total
            if normalized < minimumVisibleFraction {
                other += normalized
            } else {
                visible.append(WidgetBarSegment(
                    id: segment.id,
                    label: segment.label,
                    fraction: normalized,
                    color: segment.color
                ))
            }
        }
        if other > 0 {
            visible.append(WidgetBarSegment(
                id: "other",
                label: "Other",
                fraction: other,
                color: Color.gray.opacity(0.55)
            ))
        }
        return visible
    }

    var body: some View {
        let rows = normalizedSegments
        Canvas { context, size in
            guard !rows.isEmpty else { return }
            let gap: CGFloat = 1
            let usableWidth = max(0, size.width - gap * CGFloat(max(rows.count - 1, 0)))
            var x: CGFloat = 0
            for (index, segment) in rows.enumerated() {
                let width = index == rows.count - 1
                    ? max(0, size.width - x)
                    : max(0, usableWidth * CGFloat(segment.fraction))
                guard width > 0 else { continue }
                let rect = CGRect(x: x, y: 0, width: width, height: size.height)
                let path = Path(roundedRect: rect, cornerRadius: min(3, size.height / 2))
                context.fill(path, with: .color(segment.color))
                x += width + gap
            }
        }
        .frame(height: height)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilitySummary(rows))
    }

    private func accessibilitySummary(_ rows: [WidgetBarSegment]) -> String {
        if rows.isEmpty { return "No provider mix" }
        let parts = rows.map { segment in
            "\(segment.label) \(Int((segment.fraction * 100).rounded())) percent"
        }
        return "Provider mix, " + parts.joined(separator: ", ")
    }
}

struct SteppedBar: View {
    let value: Int
    var maximum: Int = 10
    var cells: Int = 10

    var body: some View {
        if value > maximum {
            LinearBar(fraction: Double(value) / Double(max(value, maximum)))
        } else {
            Canvas { context, size in
                let gap: CGFloat = 2
                let cellCount = max(cells, 1)
                let cellWidth = max(1, min(8, (size.width - gap * CGFloat(cellCount - 1)) / CGFloat(cellCount)))
                let cellHeight = min(8, size.height)
                let filled = min(max(value, 0), cellCount)
                for index in 0..<cellCount {
                    let x = CGFloat(index) * (cellWidth + gap)
                    let y = (size.height - cellHeight) / 2
                    let rect = CGRect(x: x, y: y, width: cellWidth, height: cellHeight)
                    let path = Path(roundedRect: rect, cornerRadius: 1.5)
                    context.fill(path, with: .color(index < filled ? WidgetTheme.brand : WidgetTheme.limitTrack))
                }
            }
            .frame(height: 8)
        }
    }
}

struct DualTrackBar: View {
    let actualFraction: Double
    let budgetFraction: Double

    var body: some View {
        Canvas { context, size in
            let actual = max(0, actualFraction)
            let budget = min(max(budgetFraction, 0), 1)
            let topHeight: CGFloat = 6
            let markerY = min(size.height - 2, topHeight + 5)
            let actualWidth = min(CGFloat(actual), 1) * size.width

            let track = CGRect(x: 0, y: 0, width: size.width, height: topHeight)
            context.fill(Path(roundedRect: track, cornerRadius: 3), with: .color(WidgetTheme.limitTrack))
            if actualWidth > 0 {
                let fill = CGRect(x: 0, y: 0, width: actualWidth, height: topHeight)
                context.fill(Path(roundedRect: fill, cornerRadius: 3), with: .color(actual > 1 ? WidgetTheme.limitBarColor(1) : WidgetTheme.brand))
            }
            if actual > 1 {
                let overrun = CGRect(x: size.width * budget, y: 0, width: max(0, size.width - size.width * budget), height: topHeight)
                context.fill(Path(roundedRect: overrun, cornerRadius: 3), with: .color(WidgetTheme.limitBarColor(1)))
            }

            let lineY = markerY
            var markerLine = Path()
            markerLine.move(to: CGPoint(x: 0, y: lineY))
            markerLine.addLine(to: CGPoint(x: size.width, y: lineY))
            context.stroke(markerLine, with: .color(Color.secondary.opacity(0.45)), lineWidth: 2)

            let markerX = budget * size.width
            let markerRect = CGRect(x: markerX - 3, y: lineY - 3, width: 6, height: 6)
            context.fill(Path(ellipseIn: markerRect), with: .color(Color.secondary))
        }
        .frame(height: 14)
    }
}

private struct LinearBar: View {
    let fraction: Double

    var body: some View {
        GeometryReader { geo in
            let f = min(max(fraction, 0), 1)
            ZStack(alignment: .leading) {
                Capsule().fill(WidgetTheme.limitTrack)
                Capsule()
                    .fill(WidgetTheme.brand)
                    .frame(width: geo.size.width * f)
            }
        }
        .frame(height: 8)
    }
}

// MARK: - Heatmap grid

struct HeatmapGridView: View {
    let payload: HeatmapPayload
    /// Truncate to the most recent N weeks (helps small sizes).
    var maxWeeks: Int = 26
    var showDayLabels: Bool = false

    var body: some View {
        GeometryReader { geo in
            let weeks = Array(payload.weeks.suffix(maxWeeks))
            let rows = 7
            let cols = max(weeks.count, 1)
            let spacing: CGFloat = 2
            let labelWidth: CGFloat = showDayLabels ? 12 : 0
            let cell = min(
                (geo.size.width - labelWidth - spacing * CGFloat(cols - 1)) / CGFloat(cols),
                (geo.size.height - spacing * CGFloat(rows - 1)) / CGFloat(rows)
            )
            let totalW = cell * CGFloat(cols) + spacing * CGFloat(cols - 1)
            let totalH = cell * CGFloat(rows) + spacing * CGFloat(rows - 1)
            let dayLabels = ["M", "T", "W", "T", "F", "S", "S"]

            VStack(spacing: spacing) {
                ForEach(0..<rows, id: \.self) { row in
                    HStack(spacing: spacing) {
                        if showDayLabels {
                            Text(dayLabels[row])
                                .font(.system(size: 8, weight: .semibold, design: .rounded))
                                .foregroundStyle(.secondary)
                                .frame(width: labelWidth - spacing, alignment: .leading)
                        }
                        ForEach(0..<cols, id: \.self) { col in
                            let level = (col < weeks.count && row < weeks[col].count) ? weeks[col][row] : 0
                            RoundedRectangle(cornerRadius: max(cell * 0.18, 1))
                                .fill(WidgetTheme.heatmapLevels[max(0, min(4, level))])
                                .frame(width: cell, height: cell)
                        }
                    }
                }
            }
            .frame(width: totalW + labelWidth, height: totalH)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        }
    }
}

// MARK: - Limit row

struct LimitBarRow: View {
    let limit: LimitProvider

    var body: some View {
        let f = max(0, min(1, limit.fraction))
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 4) {
                WidgetProviderLogo(source: limit.source, size: 10)
                Text(limit.label)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(.primary)
                    .lineLimit(1)
                Spacer(minLength: 4)
                Text(WidgetFormat.percent(f * 100, decimals: 0))
                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                    .foregroundColor(.secondary)
                    .monospacedDigit()
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(WidgetTheme.limitTrack)
                    RoundedRectangle(cornerRadius: 2)
                        .fill(WidgetTheme.limitBarColor(f))
                        .frame(width: geo.size.width * f)
                }
            }
            .frame(height: 4)
        }
    }
}

// MARK: - Source dot row

struct SourceDot: View {
    let source: String
    let label: String
    let value: String

    var body: some View {
        HStack(spacing: 5) {
            WidgetProviderLogo(source: source, size: 11)
            Text(label)
                .font(.system(size: 11, weight: .medium))
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 4)
            Text(value)
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .foregroundColor(.secondary)
                .monospacedDigit()
        }
    }
}

// MARK: - Provider logo

struct WidgetProviderLogo: View {
    @Environment(\.colorScheme) private var colorScheme

    let source: String
    var size: CGFloat = 14

    var body: some View {
        let provider = Self.normalized(source)
        if let imageName = Self.assetName(for: provider) {
            Image(imageName)
                .renderingMode(Self.isMono(provider) ? .template : .original)
                .resizable()
                .scaledToFit()
                .foregroundStyle(colorScheme == .dark ? Color.white : Color.primary)
                .frame(width: size, height: size)
                .accessibilityLabel("\(Self.displayName(for: provider)) logo")
        } else {
            Image(colorScheme == .dark ? "VibeDeckIconDark" : "VibeDeckIconLight")
                .renderingMode(.original)
                .resizable()
                .scaledToFit()
                .frame(width: size, height: size)
                .accessibilityLabel("Provider logo")
        }
    }

    private static func normalized(_ source: String) -> String {
        let value = source
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "_", with: "-")

        if value.contains("copilot") { return "copilot" }
        if value.contains("cursor") { return "cursor" }
        if value.contains("gemini") || value.contains("google") { return "gemini" }
        if value.contains("factory") || value.contains("droid") { return "factoryai" }
        if value.contains("hermes") { return "hermes" }
        if value.contains("kimi") { return "kimi" }
        if value.contains("kiro") { return "kiro" }
        if value.contains("openclaw") || value.contains("open-claw") { return "openclaw" }
        if value.contains("opencode") || value.contains("open-code") { return "opencode" }
        if value.contains("antigravity") { return "antigravity" }
        if value.contains("codex") || value.contains("openai") { return "codex" }
        if value.contains("claude") || value.contains("anthropic") { return "claude" }
        return value
    }

    private static func assetName(for provider: String) -> String? {
        switch provider {
        case "antigravity": return "AntigravityLogo"
        case "claude": return "ClaudeLogo"
        case "codex": return "CodexLogo"
        case "copilot": return "CopilotLogo"
        case "cursor": return "CursorLogo"
        case "factoryai": return "FactoryAIDroidLogo"
        case "gemini": return "GeminiLogo"
        case "hermes": return "HermesLogo"
        case "kimi": return "KimiLogo"
        case "kiro": return "KiroLogo"
        case "openclaw": return "OpenClawLogo"
        case "opencode": return "OpenCodeLogo"
        default: return nil
        }
    }

    private static func isMono(_ provider: String) -> Bool {
        ["cursor", "hermes", "kimi", "kiro", "openclaw", "opencode"].contains(provider)
    }

    private static func displayName(for provider: String) -> String {
        switch provider {
        case "factoryai": return "Factory AI Droid"
        case "openclaw": return "OpenClaw"
        case "opencode": return "OpenCode"
        default: return provider.capitalized
        }
    }
}

// MARK: - Empty state

struct WidgetEmptyState: View {
    let message: String

    var body: some View {
        VStack(spacing: 6) {
            WidgetThreePlaneMark()
                .frame(width: 30, height: 22)
                .opacity(0.60)
                .accessibilityHidden(true)
            Text(message)
                .font(.system(size: 11))
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct WidgetThreePlaneMark: View {
    var body: some View {
        Canvas { context, size in
            let scaleX = size.width / 290
            let scaleY = size.height / 170
            context.scaleBy(x: scaleX, y: scaleY)
            context.translateBy(x: -100, y: -170)

            drawPlane(
                in: context,
                points: [
                    CGPoint(x: 107, y: 231),
                    CGPoint(x: 307, y: 231),
                    CGPoint(x: 377, y: 181),
                    CGPoint(x: 177, y: 181),
                ],
                color: WidgetTheme.brand300
            )
            drawPlane(
                in: context,
                points: [
                    CGPoint(x: 107, y: 281),
                    CGPoint(x: 307, y: 281),
                    CGPoint(x: 377, y: 231),
                    CGPoint(x: 177, y: 231),
                ],
                color: WidgetTheme.brand400
            )
            drawPlane(
                in: context,
                points: [
                    CGPoint(x: 107, y: 331),
                    CGPoint(x: 307, y: 331),
                    CGPoint(x: 377, y: 281),
                    CGPoint(x: 177, y: 281),
                ],
                color: WidgetTheme.brand500
            )
        }
    }

    private func drawPlane(in context: GraphicsContext, points: [CGPoint], color: Color) {
        guard let first = points.first else { return }
        var path = Path()
        path.move(to: first)
        points.dropFirst().forEach { path.addLine(to: $0) }
        path.closeSubpath()
        context.fill(path, with: .color(color))
    }
}

// MARK: - Footer

struct WidgetFooter: View {
    let updated: Date
    var serverOnline: Bool = true

    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(serverOnline ? WidgetTheme.statusOnline : WidgetTheme.statusWarning)
                .frame(width: 5, height: 5)
            Text(WidgetStrings.updated(WidgetFormat.relativeUpdated(updated)))
                .font(.system(size: 9))
                .foregroundColor(.secondary)
                .monospacedDigit()
            Spacer(minLength: 0)
        }
    }
}
