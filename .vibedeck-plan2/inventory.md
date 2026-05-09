# Plan 2 — Storage Inventory (Pre-Schema)

- SQLite library: `node:sqlite` (built-in, requires Node `>=22.5`)
- DB file path origin: `resolveTrackerPaths()` in `src/lib/tracker-paths.js` derives `trackerDir` as `~/.vibedeck/tracker`; Plan 2 DB path will be `~/.vibedeck/tracker/vibedeck.sqlite3`
- WAL mode: will be enabled in `initSchema()` in Task 2
- Existing migration runner: none — Task 2 adds one
- Connection pattern: per-call `new DatabaseSync(dbPath)`; `db.close()` in `finally` — matches existing per-call shell-out style for reading external SQLite files
- Conventions: CommonJS modules, prefer `require` over `import`, follow existing `src/lib/` layout
