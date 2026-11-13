# BRIEF s22-L-w2 — client: the preset's ruleset pre-chosen; Incompatible books and starters greyed; the preset editor offers no lock for Rules; the lorebook row's fit line always shows

Lane **s22-L**, worker **w2** (Sonnet, `lane-worker`). Supervisor: the s22-L lane-supervisor. Work in `/home/jody/github/serene-pub`. Report through your final message (changed files, tests run with counts, decisions you made, anything you stopped on).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`: **no SDK edit** in this brief.)

## Goal — owner rulings (2026-11-05), quoted
- "Rulesets can't be locked, but incompatible rulesets can be locked out" + "Always lock out Incompatible, no setting." R32 (2026-10-20, "each layer sets a value and locks it or leaves it open") **stands for every other setting** (How strict keeps its lock). For the ruleset, a preset's value is the **pre-chosen default**, never a lock. This **supersedes ★C-7** (built by lane s22-C: "a book on rules the genre rates Incompatible stays pickable").
- Every rating above Incompatible stays a sentence ("genres expect, never lock"); `rulesets: { only }` stays the one declared lock — its greying and words are unchanged.
- The book list row's fit line **always shows, as a third line** (STYLE-GUIDE §6.4 "a row is two lines and a face" is amended for lorebook rows by the supervisor — not by you).
- The server (worker w1, in parallel) refuses an Incompatible ruleset, book or starter at create and on attach with exactly: `` `${genreName || "This genre"} can't play ${rulesName}: ${fit.reason}.` `` (copy ★). The client says **the same sentence**.

## Work
### 1. `src/lib/client/components/sessionForms/createSession.svelte.ts`
- `bookRulesFit` (~589–603): after the `only` refusal, a choice whose `fit?.rating === "incompatible"` is refused: `refusal = \`${genreName || "This genre"} can't play ${choice.name}: ${choice.fit.reason}.\``. The `only` refusal keeps priority and its words. Update the `BookRulesFit.refusal` doc comment (it names only `only` today) and the function's comment. This is the one place the book rows and starter rows (`kitRulesLine` in `StartSessionForm.svelte` ~1088) read their refusal, so they grey through it — **check** in `StartSessionForm.svelte` that a book row's `fit.refusal` disables it (~2036) and the starter row's `refused` does (`StarterKitPicker` `rulesLine`), and remove any code or comment that keeps an Incompatible book pickable on purpose (★C-7). If `StartSessionForm.svelte` needs a change, keep it to those lines (it is dirty at HEAD; never reformat it).
- **The preset's ruleset, pre-chosen.** Add a derived `presetRules` beside `presetRigour` (~699): `(this.preset?.settings as Record<string, unknown> | null | undefined)?.ruleset` read through the SDK's `settingValueOf(raw).value` exactly as `presetRigour` reads `rigour` (a stored value is a plain value or `{ value, lock?, askAtStart? }`; an old preset stored with `lock: true` is read the same — the lock is ignored). In `rulesDefault` (~709): when `presetRules` is one of `offer.choices` and its `fit?.rating !== "incompatible"`, return it **first** (before the `presetRigour` logic); otherwise today's logic. The person's own `rulesPick` still wins (`rulesNowId`). A book that brings its own rules still wins (`adoptedRules`) — unchanged. No new socket field: the preset row already carries `settings`.
- Do not change `buildCreatePayload`, `reconcileToShape`, or `rulesFixed`.

### 2. `src/lib/client/admin/sections/session-presets/IdPage.svelte` (Settings fieldset ~941–1070)
- For the setting whose `s.key === "ruleset"`: **no Lock checkbox** (hide the `<label>…Lock</label>` for it). Its value stays. Under the row, one FieldHelp sentence (copy ★, use exactly): _The start form pre-chooses these rules; people may pick others the genre can play._ In the read-only line, say _This preset's default: ‹value›_ instead of _This preset: ‹value›_ for `ruleset` only.
- `setDecision` for `ruleset`: drop `lock` (so an old stored lock disappears the next time an admin saves this setting; the server ignores it either way — no boot pass, no stored-data change). The **Ask at start** checkbox for `ruleset` is shown or hidden exactly as for any other owner-reach setting, but read `d.lock` as absent for `ruleset`.
- Fieldset description (~946): keep, but it must not promise a lock for Rules — append nothing unless needed; if you change it, one sentence, and say so.
- No other preset-editor change.

### 3. `src/lib/client/components/listItems/LorebookListItem.svelte` (~150–180)
- Today `RulesFitLine` sits in the `{:else}` branch after the share line / session-notes line / description. Make it a **third line**: the `{#if}` chain keeps choosing the second line (share line · session-notes line · description), and `<RulesFitLine fits={lorebook.rulesetFitByGenre} freeform={isFreeformBook(lorebook.primaryRuleset)} />` follows the chain **always** (a Freeform book shows the Freeform sentence; a book no genre rates draws nothing — `RulesFitLine` already draws nothing then). Replace the 🚧 comment: owner 2026-11-05 (§24.8), the fit line is always the row's third line. Do **not** edit `RulesFitLine.svelte` unless a test proves it must change (it is the lane's, but leave it as is if it works).

### 4. Tests
- `src/lib/client/components/sessionForms/createSession.test.ts` (dirty at HEAD — add a describe at the end; **never** `prettier --write` it): `bookRulesFit` refuses an Incompatible choice in the words above; `only` still wins with its words; a Freeform book is never refused; the flow pre-chooses a preset's ruleset (plain value and `{ value, lock: true }`), a person's pick wins over it, an Incompatible or unoffered preset ruleset falls back to today's default.
- `src/lib/client/components/sessionForms/startSessionRules.dom.test.svelte.ts` (dirty at HEAD; additive): with a rules offer whose choice is `fit.rating: "incompatible"`, a book row on those rules is **disabled** with the refusal sentence in place of its rules line; a starter row the same (if the starter list is easy to stage in that file; else say so); the blank Incompatible row stays disabled. With a preset whose `settings.ruleset` names an offered ruleset, the **Start blank** row for it is the chosen one.
- A new `src/lib/client/components/listItems/lorebookRowFitLine.dom.test.ts` (or `.svelte.ts` — follow `src/lib/client/lorebooks/providedRow.dom.test.ts`'s harness for rendering `LorebookListItem`): a row with a description shows name, description and the fit line (three lines, `data-rules-fit` present); a shared row shows its share line and the fit line; a Freeform row shows `data-rules-fit="freeform"`; a row with no `rulesetFitByGenre` and not Freeform draws no `data-rules-fit`.
- Preset editor: only if an existing dom harness renders `session-presets/IdPage.svelte` cheaply, add a test that the `ruleset` row has no Lock checkbox and shows the sentence; otherwise skip and say so.
- Keep green: `createSession.test.ts`, `startSessionRules.dom.test.svelte.ts`, `startSessionApplet.dom.test.svelte.ts`, `startSessionModes.dom.test.svelte.ts`, `src/lib/client/lorebooks/providedRow.dom.test.ts`, `src/lib/client/lorebooks/rulesFitLine.dom.test.svelte.ts`, `src/lib/client/admin/sections/session-presets/presetsAdmin.test.ts`, `presetChanges.test.ts`.

## Rules you must follow (quoted)
- CLAUDE.md Decisions: "Decide implementation inside the asked scope … name the choice in your report." "Propose and wait — one recommendation and its trade-off, marked ★ — on anything a user sees." Copy beyond the sentences given here is a ★ in your report, not a decision. Findings go under **Noticed, not done**, never fixed in passing.
- Standing ruling (sockets): "one domain context per event family … is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`." Add no `toaster` call.
- CLAUDE.md Hard rules: "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`." "`socket.off(event)` with no handler removes every listener app-wide; always pass the handler." Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.
- STYLE-GUIDE §10: "Sentence case everywhere." "Help is one sentence." "Labels are nouns, hints are sentences … errors say what went wrong and what to do." §6.4: the row's meta lines are muted (`text-surface-600-400`), 12px (`text-xs`) — `RulesFitLine` already is.
- NOMENCLATURE R1 one word, one meaning; R3 qualify (`presetRules` is the preset's ruleset — say so in its doc comment; ⚠ not `rulesPick`, not `lorebookRules`); §28: the interface says **Rules**, never *ruleset*, to people; §23 retired: never *phantom*, never *chat* for a session.
- Targeted tests only (`npx vitest run <files>`). **Never pipe vitest into `head`.** Heavy DOM tests: run them by file, not the whole tree.
- Files dirty at HEAD (`StartSessionForm.svelte`, `createSession.svelte.ts`, `createSession.test.ts`, `startSessionRules.dom.test.svelte.ts`, `LorebookListItem.svelte`): additive hunks only, **never reformat** (no `prettier --write`).

## Files owned
`src/lib/client/components/sessionForms/createSession.svelte.ts`, `StartSessionForm.svelte` (only the refusal/greying lines named above), `createSession.test.ts`, `startSessionRules.dom.test.svelte.ts`, `src/lib/client/admin/sections/session-presets/IdPage.svelte` (+ a new test file there if cheap), `src/lib/client/components/listItems/LorebookListItem.svelte`, new `src/lib/client/components/listItems/lorebookRowFitLine.dom.test.ts`.
## Files readable
Anything. Especially `src/lib/shared/rulesets/rulesOffer.ts` (`RulesChoice.fit`), `src/lib/client/lorebooks/RulesFitLine.svelte`, `rulesFitWords.ts`, `src/lib/client/components/lorebookForms/StarterKitPicker.svelte`, `src/lib/server/rulesets/genreOffer.ts`.
## Out of scope
No server file, no SDK edit, no docs/STYLE-GUIDE/NOMENCLATURE (the supervisor writes those), no change to `only`'s words or How strict's lock, no new socket field, no new setting.
## Stop and ask when
A ★ above is unclear, a new user-facing name or sentence is needed beyond those given, or a file outside "Files owned" must change.
## Done means
The test files above green (report counts per file); `npx tsc --noEmit -p .` with no errors in your files (report others' by file only); `npx prettier --check` on new files.
