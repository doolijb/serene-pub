# BRIEF — worker task `sdk-g7` — a spec that exposes a context or variable template to users is ignored with a warning (owner ruling G7)

Repos `/home/jody/github/serene-pub-sdk` (edit it there; never `git checkout / restore / stash` in it) and
`/home/jody/github/serene-pub` (tests, docs). Read first: row D61 (G7) in `plans/DISCUSS-LATER.md`,
`plans/INVENTORY-guest-and-member-surfaces-2026-11-16.md` §5, `../serene-pub-sdk/INTEGRATING.md` where
`expose` / reach is described, `guides/where-values-come-from.md`, `NOMENCLATURE.md` §24.

Owner, 2026-11-16: "Regular users shouldn't be able to choose advanced settings, like context templates etc.
Such settings shouldn't be able to be set as user surfaced (admin only). SDK should ignore context/variable
template exposure to users on build, possibly with a warning." Asked whether to keep today's stricter error:
"Soften to: ignored, with a warning".

Rules: never commit; `npx prettier --check` only; no migration. Never `npm test` / `npm run build` at the SDK
root: `npm run sdk:build` from the app root after checking no dev / preview server (`pgrep -af "vite"`; the
Svelte language server's esbuild does not count) and no vitest is up
(`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`); then
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npm run sdk:test > plans/sdk-g7-<n>.log 2>&1"`
(four known failures: derive-don't-spell ×2, untagged exports, guide vocabulary). App tests the same capped
way with `npx vitest run --maxWorkers=3 <paths>`.

## Do

1. **Today** `exposureFindings` (find it: `sdk/src/builder.ts` and `validate()`) **refuses** owner reach on a
   context template or variable layout / template slot: an error or a throw at define time, in `validate()`, on
   genres and on rulesets. **New rule:** the exposure is **ignored** (the setting stays administrator-only, as
   if not exposed) and a **warning** is reported through the SDK's existing warning channel for `validate()` /
   define (the same finding list, severity warning): one sentence naming the spec, the step and the setting,
   and saying that templates are an administrator's and the exposure was ignored (★ sentence). Nothing throws.
   Apply the same to every place the old refusal fired (specs, genres, rulesets).
2. **Close the gap by slot kind, not by key.** The check matches plumbing by the setting's **key**, so a
   setting with another name that holds a template id slips through. Decide by the declared slot kind / type of
   the value (a context-template ref, a variable-layout ref, a variable-template ref: find how the contract
   types them) so any setting of those kinds is covered whatever it is called. The same for the other
   administrator-only kinds the write matrix already keeps at preset and genre scope (connections, sampling,
   loadouts): **do not change their behaviour** (they stay refused or ignored as today): report what each does
   today so the owner can see whether they should match.
3. **Core honours it:** in the app, wherever a declaration's reach decides whether a session owner sees a row
   (`sessions/settingsForm.ts`, `pipelines/config/panel/scopes.ts`), a template slot is never owner-visible even
   if a stored spec says so (defence for specs saved before this change): one test with a hand-built spec.
4. Docs: `INTEGRATING.md`, `guides/where-values-come-from.md` (what happens when a template is exposed),
   `docs/pipelines.md` if it describes it; `NOMENCLATURE.md` §25. Re-pin SDK tests that pin the old error
   (old → new); registry hashes with "(was …)" if any move.

## Report (under 300 words)

What the old refusal was and where; the new warning (sentence ★) and where it shows; how the gap is closed;
what connections / sampling / loadouts do today; tests re-pinned (old → new) and counts with log names;
**Noticed, not done**.

## Cold review corrections (2026-11-17) — these rule over the text above

1. **`exposureFindings` keeps its shape and its other refusals.** It returns `string[]` (`sdk/src/exposure.ts`
   135–155); `genre()` (`genres.ts:1217`) and node definitions (`checkExposure`, `descriptors.ts` 2494–2500)
   throw on it; rulesets get `[reason]` strings (`rulesetSections.ts:1600`); conformance C36 counts its output
   as failures (`conformance/src/index.ts:2135`). Do not change that published function's shape. Instead:
   **split the template / variables keys out into a separate warning list**; at define time record it the way
   `reviewFieldsFinding` is recorded (`descriptors.ts` 2487–2489); surface it in `validate()` through the
   existing `warn` (`registrations.ts:490`); C36 treats a template exposure as **not a failure** (say exactly
   what C36 does after). Any new export is a ★ name. Connections, sampling and loadouts **still throw**
   (`sdk-tests/exposure.test.ts` 125–150: the genre `loadout` case must still throw; the `template` case
   flips to a warning).
2. **"Ignored" means: the declaration stays in the built document** (hashes and registry pins do not move); the
   SDK's resolver already ignores plumbing (`exposure.ts:216`) and core never shows it.
3. **What "by slot kind" can and cannot close.** Slot kinds `template` and `variables` exist
   (`descriptors.ts` 93–102): match on them. `FieldType` has no template-reference type (`settings.ts` ~72) and
   genre and ruleset fields have no slot, so those stay matched by key. **Cannot be closed, say so in the docs
   and the report:** a plain `string` in a `parameters` slot on a step that calls no model. The rule must not
   reach the `prompts` kind (`promptReach: 'owner'` is allowed: `builder.ts` 591–597; owner 2026-11-16).
4. **Step 3 is already built: verify and pin, do not build.** The session settings form offers only
   `params` / `settings` slots (`sessions/settingsForm.ts:563`) and any field on a model-call step or matching
   a plumbing key is administrator-only (659–661): one test with a hand-built spec that exposes a template.
5. **Words to change:** `INTEGRATING.md` 1307–1308 ("refuse it"), `guides/where-values-come-from.md:67` ("is
   refused").
