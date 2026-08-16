// Preloaded via `node --require` before the main server entrypoint (see
// scripts/build-android.js and NodeService.kt) — nodejs-mobile's Android
// build of Node was compiled with ICU support stripped entirely
// (`intl=none`), so `Intl` isn't just missing locale data, it's undefined
// as a global outright, breaking any code that references it directly
// (Intl.DateTimeFormat, etc.) or transitively (Date/Number.prototype
// .toLocaleString()). The `intl` package self-detects a missing
// global.Intl and polyfills it, including patching those prototype
// methods (__applyLocaleSensitivePrototypes()) — a no-op import on every
// other platform, where a real Intl already exists.
//
// Must stay a real .cjs file passed via node's --require flag (not
// inlined into the ESM server bundle, and not run via `node -e`, which
// doesn't resolve this package's internal global assignment the same
// way a real file does).
require("intl")
