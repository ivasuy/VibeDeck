import SwiftUI
import AppKit

struct LimitsSettingsView: View {
    @ObservedObject var store: LimitsSettingsStore
    var showsTitle = true
    @State private var draggingId: String?
    @AppStorage("vibedeck.displayCurrency") private var displayCurrency: String = "USD"

    private let displayCurrencies = ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "INR"]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if showsTitle {
                Text(Strings.limitsDisplayTitle)
                    .font(.system(.headline, design: .default))
                    .padding(.horizontal, 12)
                    .padding(.top, 10)
                    .padding(.bottom, 6)
            }

            VStack(spacing: 0) {
                ForEach(store.providerOrder, id: \.self) { id in
                    providerRow(id: id)
                        .opacity(draggingId == id ? 0.4 : 1)
                        .onDrag {
                            draggingId = id
                            return NSItemProvider(object: id as NSString)
                        }
                        .onDrop(of: [.text], delegate: ReorderDropDelegate(
                            targetId: id,
                            store: store,
                            draggingId: $draggingId
                        ))
                }
            }
            .padding(.bottom, 6)

            Divider()

            VStack(alignment: .leading, spacing: 6) {
                Text("Display currency")
                    .font(.caption)
                    .modifier(FontWeightModifier(weight: .semibold))
                    .foregroundStyle(.secondary)

                Picker("Display currency", selection: $displayCurrency) {
                    ForEach(displayCurrencies, id: \.self) { currency in
                        Text(currency).tag(currency)
                    }
                }
                .labelsHidden()
                .pickerStyle(.menu)
                .onChange(of: displayCurrency) { currency in
                    Task {
                        _ = try? await APIClient.shared.fetchCurrencyRates(currency: currency)
                    }
                }

                Text("Display currency only. Exports keep USD cost columns.")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
        }
        .frame(minWidth: 240, maxWidth: .infinity, alignment: .leading)
    }

    private func providerRow(id: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "line.3.horizontal")
                .font(.caption)
                .foregroundStyle(.tertiary)

            providerIcon(id: id)
                .frame(width: 14, height: 14)

            Text(LimitsSettingsStore.displayNames[id] ?? id)
                .font(.system(.body, design: .default))

            Spacer()

            Toggle("", isOn: Binding(
                get: { store.isVisible(id) },
                set: { store.providerVisibility[id] = $0 }
            ))
            .toggleStyle(.switch)
            .controlSize(.mini)
            .labelsHidden()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .contentShape(Rectangle())
        .onHover { hovering in
            if hovering {
                NSCursor.openHand.push()
            } else {
                NSCursor.pop()
            }
        }
    }

    // MARK: - Provider Icon (handles both asset catalog and bundled SVG)

    @ViewBuilder
    private func providerIcon(id: String) -> some View {
        ProviderLogoView(provider: id, size: 18)
    }
}

// MARK: - Smooth Reorder via DropDelegate

private struct ReorderDropDelegate: DropDelegate {
    let targetId: String
    let store: LimitsSettingsStore
    @Binding var draggingId: String?

    func dropEntered(info: DropInfo) {
        guard let dragging = draggingId,
              dragging != targetId,
              let from = store.providerOrder.firstIndex(of: dragging),
              let to = store.providerOrder.firstIndex(of: targetId) else { return }

        withAnimation(NativeMotion.Ease.short()) {
            store.move(from: IndexSet(integer: from), to: to > from ? to + 1 : to)
        }
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        DropProposal(operation: .move)
    }

    func performDrop(info: DropInfo) -> Bool {
        draggingId = nil
        return true
    }

    func dropExited(info: DropInfo) {}

    func validateDrop(info: DropInfo) -> Bool { true }
}
