import SwiftUI

struct TopModelsView: View {
    let models: [TopModel]

    var body: some View {
        if !models.isEmpty {
            VStack(alignment: .leading, spacing: 7) {
                SectionHeader(title: Strings.topModelsTitle)
                ForEach(models) { model in
                    HStack(spacing: 5) {
                        ProviderLogoView(provider: model.source, size: 11)
                        Text(model.name)
                            .font(.system(.caption, design: .default))
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Spacer(minLength: 4)
                        Text(TokenFormatter.formatCompact(model.tokens))
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.secondary)
                        Text(model.percent + "%")
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.tertiary)
                            .frame(width: 38, alignment: .trailing)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel(
                        Strings.topModelAccessibility(
                            name: model.name,
                            source: model.source,
                            tokens: TokenFormatter.formatCompact(model.tokens),
                            percent: model.percent
                        )
                    )
                }
            }
        }
    }
}
