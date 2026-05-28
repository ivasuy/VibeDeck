import SwiftUI
import WidgetKit

@main
struct VibeDeckWidgetBundle: WidgetBundle {
    var body: some Widget {
        SummaryWidget()
        TopModelsWidget()
        UsageLimitsWidget()
        HeatmapWidget()
    }
}
