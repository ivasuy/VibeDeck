import Foundation

public enum NativeLocalization {
    public static let preferenceKey = "vibedeck-locale"
    public static let legacyPreferenceKey = "vibedeck-locale"
    public static let englishLocale = "en"

    private static var sharedDefaults: UserDefaults? {
        UserDefaults(suiteName: WidgetSharedConstants.appGroupIdentifier)
    }

    public static func normalizePreference(_ value: Any?) -> String {
        _ = value
        return englishLocale
    }

    public static var currentPreference: String {
        englishLocale
    }

    public static var currentResolvedLocale: String {
        englishLocale
    }

    public static var usesChinese: Bool {
        false
    }

    public static func resolveLocale(
        preference: String? = nil,
        preferredLanguages: [String] = Locale.preferredLanguages
    ) -> String {
        _ = preference
        _ = preferredLanguages
        return englishLocale
    }

    public static func storePreference(_ value: Any?) {
        _ = value
        UserDefaults.standard.set(englishLocale, forKey: preferenceKey)
        sharedDefaults?.set(englishLocale, forKey: preferenceKey)
    }
}
