# REPORT — readiness lane S (SDK and CLI: D2, D3, D4) — 2026-10-30

Saved by the lead from the supervisor's hand-back (the harness refused the subagent's own write). SDK NOT rebuilt
by the lane (another session's dev servers were up); the lead rebuilds before app tests.

## Built
### D4 — docs contradiction
`guides/extending.md:16`: ruleset row now "`defineRuleset`, carried in `rulesets` (🚧) or published on a pub",
linking `rulesets.md#shipping-a-ruleset-in-a-plugin-package`.

### D3 c33 — `check` refuses everything `build` refuses
`validatePackage()` in `cli/src/bin.ts` was already shared and already evaluated the entry (`E_ENTRY_THREW`),
ran `compilePlugin` and `installPackageFindings`. Two refusals ran only in `build`: the component build (C30
module check, missing esbuild) and the sandbox bundle. Both now run inside `validatePackage`, in memory:
- `cli/src/componentBundle.ts`: new `compileComponentModule()` (@internal); `bundleComponent()` is compile-then-write.
- `cli/src/bin.ts`: new `bundlePackageCode()` (@internal; types `PackageCode`, `BuiltComponent`) builds component
  modules and the sandbox bundle without writing. Findings `E_COMPONENT_BUILD`, `E_SANDBOX_BUNDLE` (errors),
  `W_COMPONENT_BUILD` (warning). `validatePackage` returns the built code as `v.code`; `build` writes it (no second
  bundling; `buildComponents()` deleted); `check` writes nothing. `validatePackage(dir, ignore, out)` takes build's
  `--out` (default `dist/plugin`) so component output paths never collide with `<dir>/components/<slug>.js` sources.
- Tests: three cases in `sdk-tests/plugin.test.ts` (§103): `E_SAMPLING_REFERENCE`, `E_COMPONENT_BUILD`,
  `E_SANDBOX_BUNDLE`; each checks both commands exit 1 with the same code, `--json` carries it, `check` left only
  the fixture behind. Fixtures under `sdk-tests/fixtures/c33-*`, removed in `finally`.

### D3 c36 — reinstalling the same plugin replaces its own node definitions
The refusal lived in the app's `src/lib/server/plugins/pluginDefinitions.ts`, not the SDK.
- SDK `sdk/src/descriptors.ts`: new `_withdrawDefinition(id): boolean` (@internal; `core:` throws; unknown or
  entry-type id → false). Tests in `redeclaration.test.ts` (+3).
- App `pluginDefinitions.ts`: `fromPlugins` maps pin → plugin id; `registerPluginDefinitions(declarations,
  pluginId)` withdraws and re-registers a pin held by the same plugin id; a failed SDK check puts the old one
  back ("The declaration this process held before stays in place."; if that fails too: "The definition is
  unavailable until the package is fixed and reinstalled."); a clash with the build or another plugin id keeps
  today's message byte for byte. Call sites: `install.ts:359` passes `pluginId`; `index.ts:121` passes
  `row.pluginId`. NEW `pluginDefinitions.test.ts` (6 cases).

### D2 — `guides/stability.md`, "What the SDK promises before 1.0"
Pins (`@1`); 🚧/⏳/⏸ (R6); `@public`/`@experimental`/`@internal` and the golden list in `surface.test.ts`; what
may change before 1.0 (ships with 0.7.0); what never breaks (plugin storage in `<data>/extensions_data/<id>` is
never removed by upgrade or uninstall; clean up in `uninstall`); where breaking changes are announced (SDK GitHub
releases per `RELEASING.md`; no CHANGELOG exists). `@2` after 1.0 is labelled a plan. README links it.

## Verified (touched files)
SDK (`cd sdk-tests && npx tsx --test`): plugin.test.ts 92/92; componentBundle 6; componentBuiltAgainst 8;
scaffoldPlugin 44; packageZipAssets 2; cliClone 14; redeclaration 20; surface 5; guides 38; guideSnippets 2;
docs 37 — all pass. App `pluginDefinitions.test.ts` 6/6 against SDK source via a scratch alias config; needs a
run against rebuilt dist. App tsc not run (would miss the export until rebuild). Prettier: the three app files were
already unformatted at HEAD.

**Lead must:** `npm run sdk:build`, then `npx vitest run src/lib/server/plugins/pluginDefinitions.test.ts` and an
install-path integration test (e.g. `src/lib/server/plugins/lifecycle.int.test.ts`).

## New terms (§25)
Finding codes `E_COMPONENT_BUILD`, `E_SANDBOX_BUNDLE`, `W_COMPONENT_BUILD`; `_withdrawDefinition` (@internal);
CLI @internal `bundlePackageCode`, `PackageCode`, `BuiltComponent`, `compileComponentModule`,
`ComponentBundleOptions`; the two c36 refusal sentences; guide title "What the SDK promises before 1.0".

## Hand-offs
Lane W / docs pass: link `docs/plugins.md` to the stability guide; §25 rows above.

## Left open
- ★ `check` exits 0 when the entry can't be evaluated (prints "build validation skipped") while `build` exits 1;
  deliberate 2026-10-29 and tested. Default: keep (alternative: `--strict`). Lead: kept.
- c36 covers node definitions only; uninstall still leaves the declaration in the process (could call
  `_withdrawDefinition`). Executor caches not checked for stale state; no live edit-to-effect walk yet.
- `check`/`build` now report every failing component, not just the first.
