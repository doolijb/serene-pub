# REPORT — worker task `sdk-g7` (2026-11-17): a spec that exposes a context or variable template to users is ignored, with a warning (G7)

Built. SDK suite `plans/sdk-g7-1.log`: 4835 tests, 4830 pass, the four known fail (derive-don't-spell ×2, untagged exports, guide vocabulary). App test `plans/sdk-g7-app-2.log`: 31/31. No registry pin moved.

- **Before:** `exposureFindings` (`sdk/src/exposure.ts`) refused `reach: 'owner'` on any key in `MODEL_PLUMBING`, template keys included: a throw from `genre()` and `describe*Definition` (`checkExposure`), an error from the door's `validate()`, a ruleset `bad-setting` finding; conformance C36 counted it as a failure.
- **Now:** ★ `templateExposureWarnings`; sentence ★ *‹at›.‹key› exposes a context or variable template to the owner (reach: 'owner') — templates are an administrator's, so the exposure was ignored and the setting stays administrator-only; drop the reach.* Recorded at define time in `definitionFindings` beside the review-fields finding; the door's `validate()` raises it as a warning with law `exposed template`. The declaration stays in the built document (hashes unchanged). C36 counts only errors, so a template exposure is no longer a failure there (no code change to C36).
- **By slot kind:** a schema in a `template` or `variables` slot is matched by slot kind (any key name). Genre and ruleset fields have no slot: still matched by key (`template`, `templates`, `variables`). **Cannot be closed:** a plain `string` in a `parameters` slot on a step that calls no model. The `prompts` kind is untouched. The docs say so.
- **Unchanged:** connections, sampling, loadouts still throw / error on `reach: 'owner'`; `resolveExposure` still hides them.
- **Tests re-pinned:** `sdk-tests/exposure.test.ts`: the node-definition throw case now uses the `sampling` key (still throws); new: a `template` key and an `anyName` key in a `template` slot do not throw, `definitionFindings` returns 2, the declaration is kept; a genre with a `variables` field no longer throws. App: one test in `sessions/settingsForm.int.test.ts` (every step open to the owner → the owner's form shows only `params`, `settings` or `prompts` slots).
- **Files:** SDK `sdk/src/exposure.ts`, `descriptors.ts` (`@internal` `templateExposureOf`), `registrations.ts`, `INTEGRATING.md` (the exposure bullet), `guides/where-values-come-from.md`; app NOMENCLATURE §25.

## Noticed, not done
- A **genre or ruleset** that exposes a template now gets **no warning** at define time: neither has a warning channel (the exposure is ignored silently there).
- The `definitionFindings` doc comment still says "the review-fields rule alone".
