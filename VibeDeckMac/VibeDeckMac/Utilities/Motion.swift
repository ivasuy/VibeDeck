import SwiftUI

enum NativeMotion {
    enum Spring {
        static let snap = Animation.interpolatingSpring(mass: 0.4, stiffness: 320, damping: 24)
        static let gentle = Animation.interpolatingSpring(mass: 0.6, stiffness: 240, damping: 28)
        static let bouncy = Animation.interpolatingSpring(mass: 0.8, stiffness: 200, damping: 16)
        static let slow = Animation.interpolatingSpring(mass: 1.0, stiffness: 140, damping: 26)
    }

    enum Ease {
        static func micro(reduceMotion: Bool = false) -> Animation {
            .easeOut(duration: reduceMotion ? 0.05 : 0.08)
        }

        static func short(reduceMotion: Bool = false) -> Animation {
            .easeOut(duration: reduceMotion ? 0.05 : 0.18)
        }

        static func medium(reduceMotion: Bool = false) -> Animation {
            .easeOut(duration: reduceMotion ? 0.08 : 0.32)
        }

        static func long(reduceMotion: Bool = false) -> Animation {
            .easeOut(duration: reduceMotion ? 0.08 : 0.60)
        }

        static func linear(duration: Double, reduceMotion: Bool = false) -> Animation {
            .linear(duration: reduceMotion ? min(duration, 0.05) : duration)
        }
    }

    static func syncSpin(reduceMotion: Bool = false) -> Animation? {
        guard !reduceMotion else { return nil }
        return Ease.linear(duration: 1.0).repeatForever(autoreverses: false)
    }
}
