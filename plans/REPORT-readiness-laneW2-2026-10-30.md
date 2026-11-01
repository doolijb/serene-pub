# REPORT — readiness lane W2 (docs pass two) — 2026-10-30

Saved by the lead from the supervisor's hand-back. Nothing committed.

## Built
**Lane C (connections):** `docs/connect-a-model.md` local step 2 (preselected build: NVIDIA full, Apple silicon Mac
build, AMD or none the other-cards build; Selected box says why; ends with **Download & Start**), step 3 (proposed
tier with reason under "‹n› GB tier · Change"; Mac ~two-thirds, no card ~half; own answer wins; nothing found →
**Not sure**), hosted step 5 (free first after any model already in Reply), LANE C placeholder filled with the
status-card sentence and both wizard Key saved lines verbatim, new troubleshooting bullet "OpenRouter refuses every
reply, and your key has no credit." `docs/connections.md`: Models tab sentence + status-card table row (free tier).

**Lane K:** `docs/getting-started.md` §4 (Nell first, Comes with Serene Pub, Pick → Adding… → Change, refusal
sentence, card hides while an unchanged copy exists, link to The Ninth Mile, "easiest start" moved to Nell, add-one
list reordered Create/Library/Import). `docs/lorebooks.md`: "Serene Pub comes with two" (The Ninth Mile first, then
Brackenvale); "often a cast"; two broken `#starter-starter lorebooks` links fixed.

**Lane P:** `docs/plugins.md` (on by default, variable turns off, no in-app switch yet; install flow with the
review, Uploading… n% / Installing…; installs switched off; new `### What a plugin can't do` matching
`palisade.ts`; `### Installing from disk`; stability guide linked). `docs/environment-variables.md`
(`SP_PLUGINS_ENABLED` default on, values, restart, quoted status line; `SP_PLUGIN_PACKAGE_MAX_MB` 70 MB sentence
dropped, `BODY_SIZE_LIMIT` needs no raising). `docs/hosting.md` (review line; heading `### Install a package from
disk`, anchors updated). Stale "plugins off" fixed in `component-authoring.md`, `genres.md:67`,
`coming-from-sillytavern.md:152`. `scripts/build-docs.js:319,329` banners: "releases ship with them on (an
administrator can turn them off with SP_PLUGINS_ENABLED)". `docs/release-notes/0.6.0-pr-7.md`: "Review a package
before it installs"; Nell, The Ninth Mile, free models first, KoboldCPP set up for your computer; "Plugins are on by
default", "No 70 MB upload limit"; for plugin authors: `check` == `build` (`E_COMPONENT_BUILD`,
`E_SANDBOX_BUNDLE`), reinstall replaces own node definitions, stability guide.

**Lane S / lane W action 6:** `docs/plugins.md` links `./sdk/guides/stability.md`; `README.md` Code signing policy link.

**NOMENCLATURE.md:** §8 🚧 starter character (⚠ not starter lorebook, not retold's "a starter"); starter lorebook row
amended. §10 🚧 machine hardware; 🚧 detected memory tier · detected build; 🚧 free tier (OpenRouter key) · free
model; memory tier row amended. §12 🚧 palisade (⚠ not capability/permission; UI says What it can't do); upload
piece (⚠ not rulesets piece §24); finding code. §22 icon row `Ban` · `Check`. §27 banner row. §25 ten rows dated
2026-10-30. **STYLE-GUIDE.md §6.11:** "An install review is two lists".

## Verified
`node scripts/build-docs.js --site`: 284 pages, 0 warnings. Anchor script (`scratchpad/W2/W2-anchors.py`) checked
every `/docs/…#…` and `#…` link on all built pages: all app pages pass incl. `#what-a-plugin-cant-do`,
`#install-a-package-from-disk`, `#starter-lorebooks`, `#4-pick-a-character`, `#free-models`, `#feature-toggles`,
`/docs/sdk/guides/stability`. NOMENCLATURE column counts checked.

## Hand-offs
- 9 pre-existing broken anchors in generated SDK API pages: `sdk/api/sdk/src/messageBlocks#rollblockband-1`,
  `conditions#conditionproptype-1` (6), `strokes#strokekind-1` (2).
- Status line says "on this server"; owner may prefer "on this pub".

## Left open
★ Admin › Plugins switch (`system_settings.plugins_enabled`); three docs places say "no switch yet". AMD on Windows
not detected. `0.6.0-pr-1.md` still says plugins off (historical, left).
