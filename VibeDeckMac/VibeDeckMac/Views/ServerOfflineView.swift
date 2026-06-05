import SwiftUI

/// Shown when the server failed to start or became unreachable.
struct ServerOfflineView: View {
    let message: String
    let onRetry: () async -> Void

    var body: some View {
        VStack(spacing: 18) {
            Spacer()

            ThreePlaneMark()
                .frame(width: 74, height: 56)
                .foregroundStyle(Color.brand.opacity(0.32))
                .accessibilityHidden(true)

            Text(Strings.serverOfflineTitle)
                .font(.system(size: 24, weight: .semibold, design: .rounded))
            Text(Strings.serverOfflineBody)
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)

            HStack(spacing: 10) {
                Button(Strings.restartServerButton) {
                    Task { await onRetry() }
                }
                .buttonStyle(.borderedProminent)
                .tint(Color.brand)

                Button(Strings.openDashboardInBrowser) {
                    DashboardBrowserOpener.openDashboard(from: "offline")
                }
                .buttonStyle(.bordered)
            }
            .controlSize(.regular)

            Text("Logs: \(Strings.serverOfflineLogs)")
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(.tertiary)
                .lineLimit(1)
                .truncationMode(.middle)
                .padding(.top, 4)
                .help(message.isEmpty ? Strings.serverOfflineHint : message)

            Spacer()
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 28)
    }
}

private struct ThreePlaneMark: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8)
                .frame(width: 46, height: 18)
                .offset(y: -13)
            RoundedRectangle(cornerRadius: 8)
                .frame(width: 62, height: 18)
            RoundedRectangle(cornerRadius: 8)
                .frame(width: 46, height: 18)
                .offset(y: 13)
        }
    }
}

/// Shown while the server is starting up.
struct ServerStartingView: View {
    var body: some View {
        InstrumentLoadingPanel(
            title: Strings.serverStarting,
            detail: Strings.serverPreparing,
            mode: .indeterminate
        )
    }
}

enum InstrumentLoadingMode {
    case indeterminate
    case skeleton
}

struct InstrumentLoadingPanel: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let title: String
    let detail: String
    let mode: InstrumentLoadingMode

    var body: some View {
        VStack(spacing: 14) {
            Spacer()

            ClawdCompanionView.LoadingMascotView()
                .frame(width: 58, height: 62)
                .accessibilityHidden(true)

            VStack(spacing: 4) {
                Text(title)
                    .font(.subheadline)
                    .modifier(FontWeightModifier(weight: .medium))
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            VStack(spacing: 9) {
                InstrumentLoadingBar(reduceMotion: reduceMotion, active: mode == .indeterminate)
                InstrumentSkeletonRow(width: 0.82)
                InstrumentSkeletonRow(width: 0.64)
                InstrumentSkeletonRow(width: 0.74)
            }
            .frame(width: 260)
            .padding(14)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(.regularMaterial)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(Color.panelBorder, lineWidth: 0.5)
                    )
            )

            Spacer()
        }
        .frame(maxWidth: .infinity)
    }
}

private struct InstrumentLoadingBar: View {
    let reduceMotion: Bool
    let active: Bool

    @State private var offset: CGFloat = -1

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.limitTrack)
                Capsule()
                    .fill(Color.brand)
                    .frame(width: active && !reduceMotion ? proxy.size.width * 0.34 : proxy.size.width * 0.64)
                    .offset(x: active && !reduceMotion ? proxy.size.width * offset : 0)
            }
        }
        .frame(height: 5)
        .clipShape(Capsule())
        .onAppear {
            guard active, !reduceMotion else { return }
            withAnimation(NativeMotion.Ease.linear(duration: 1.2).repeatForever(autoreverses: false)) {
                offset = 1.2
            }
        }
    }
}

private struct InstrumentSkeletonRow: View {
    let width: CGFloat

    var body: some View {
        HStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 3)
                .fill(Color.panelFillStrong)
                .frame(width: 14, height: 14)
            GeometryReader { proxy in
                RoundedRectangle(cornerRadius: 3)
                    .fill(Color.panelFill)
                    .frame(width: proxy.size.width * width, height: 8)
                    .frame(maxHeight: .infinity, alignment: .center)
            }
            .frame(height: 14)
        }
    }
}
