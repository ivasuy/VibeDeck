# Icon Composer Source

These files are the source layers for VibeDeckMac's macOS icon workflow, updated to match `dashboard/public/icon.svg`.

Files:
- `01-background.svg`: deep indigo rounded-square chrome from the new VibeDeck app icon.
- `02-mark.svg`: the stacked deck foreground mark from the new VibeDeck app icon.

Recommended import flow:
1. Open `Icon Composer.app` from Xcode.
2. Create a new icon document.
3. Drag `01-background.svg` and `02-mark.svg` into the canvas in that order.
4. Preview the macOS variant and tune material/specular settings if needed.
5. Save the result as `VibeDeckMac/VibeDeckMac/AppIcon.icon`.
6. Keep the target app icon name set to `AppIcon` and rebuild VibeDeckMac.
