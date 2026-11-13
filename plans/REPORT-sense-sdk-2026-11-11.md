# REPORT — lane `sense-sdk` — 2026-11-11

Written by the lead from the supervisor's final message. About half the lane is built; two parts are held for the
owner because building them as briefed would cross the brief's own stop lines.

## Built

- **C1, the assemble half — a prompt step wires itself.** `../serene-pub-sdk/sdk/src/builder.ts`: non-exported
  `supplyPromptStepWiring(spec)`, called from `SpecBuilder.build()`. For an `assemble@2` that feeds a model call (the
  validator's own rule), it fills `template = slot.template()` and `connection = slot.connectionOf(<that oracle>)`
  only where the key is undefined. Idempotent. It lives in `build()` because the app's `seedCoreSpecs` stores
  `entry.build()`. `sdk/src/validate.ts`: comment only; the warning now serves documents not built through the
  builder. `guides/your-first-plugin.md`: the two contradicting passages fixed.
  Tests `sdk-tests/assembleWiring.test.ts`: bare, only-template and only-connection specs give the same
  `canonicalize` and `canonicalHash` as the hand-wired spec; an explicit connection is kept; `build()` twice is the
  same document; an assemble that feeds no model call gains no keys.
- **C7 — a script failure at an interior point is absorbed.** `sdk/src/executor.ts`: the `applyAtSeam(known, value,
  'binding')` call is in a try/catch; a throw records `{ scriptId: -1, name: '(engine)', scriptKind: '', phase:
  'before', appliedBy: 'binding', result: 'err', reason }` and the value passes through. The undeclared-point throw
  and `ScriptSeamHalt` are untouched. Test `sdk-tests/scriptPoints.test.ts` replaced accordingly.
- **Item 4 — the turn pool's `all` option says what it does.** `contracts/src/tasks.ts`, description text only:
  "The same as Active today, kept so presets that name it still load. A benched character never takes a turn."

App repo: no source changes.

## Tests

SDK: 14 files 314/314 and 7 files 131/131 (`npx tsx --test`, capped scope); `tsc --noEmit -p sdk-tests` clean.
`npm run sdk:build` once, exit 0 (no vite dev server running). App: `specHashes.test.ts`, `registryHashes.test.ts`,
`runtime/run.int.test.ts`: 19/19.

## Golden pins

**None moved.** Checked: the coreCatalog announcement digest `cf4c379152e8e47a`, the create-spec pins, the Lair's
per-spec hashes, catalogueParity's ruleset pins; app `specHashes` and `registryHashes` green.

## Open ★ (held, not built)

- **★ C1-oracle — a model-call oracle defaults its own `connection` and `sampling`.** Of all core specs only
  `core:spec/speak-message` (node `spoken.words.speak`, `core:oracle/speak@1`) lacks them. Building the default
  would move the app pin `"core:spec/speak-message@1.0.0": "1702bfb01171db"` and the SDK announcement golden, and
  change what the speak binding receives (`bindings.ts` ~6704) — the speech red list, out of this lane's scope.
  Recommendation: build it as the review intended, re-pin speak-message with a dated note, and have whoever owns
  speech confirm a resolved connection is what speak wants. About 15 lines plus tests.
- **★ C8 — `optional: true` on `core:oracle/pick-sprite@1` adds a second on/off switch.** `settingsSlotFor`
  (`sdk/src/settingsSlot.ts` ~114–121) gives every `optional` definition a `settings.enabled` field, "Run this
  step"; pick-sprite already has `params.enabled`, "Choose sprites". Options: (a) accept both switches; (b) declare
  `optional` and retire "Choose sprites" (renames a published param; presets store it); (c) let `optional` opt out
  of the switch (a new SDK option); (d) leave unbuilt. Recommendation: (b) at the RC1 squash, or (d) for now.

## Noticed, not done

- Pre-existing prettier drift across several SDK source files.
- `Descriptor.optional`'s docblock (`descriptors.ts` ~1767) does not say that `optional` also earns the node a
  "Run this step" switch; a modder would not learn that from the type.
