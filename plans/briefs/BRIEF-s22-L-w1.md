# BRIEF s22-L-w1 — server: a preset's ruleset is a default, never a lock; Incompatible rules are refused (one helper)

Lane **s22-L**, worker **w1** (Sonnet, `lane-worker`). Supervisor: the s22-L lane-supervisor. Work in `/home/jody/github/serene-pub`. Report to your supervisor through your final message (changed files, tests run with counts, decisions you made, anything you stopped on).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You should need no `sdk:build`: **no SDK edit** in this brief.)

## Goal — owner rulings (2026-11-05), quoted
- "Rulesets can't be locked, but incompatible rulesets can be locked out" + "Always lock out Incompatible, no setting." R32 (2026-10-20, "each layer sets a value and locks it or leaves it open") **stands for every other setting** (How strict's lock stays exactly as it is). For the ruleset, a preset's value is the **pre-chosen default**, never a lock.
- Every fit rating above Incompatible stays a sentence ("genres expect, never lock", 10-23). `rulesets: { only }` stays the one declared lock — **do not change how `only` behaves**.
- 0.6 is in users' hands: **no running session, and no next chapter, is ever re-judged or refused for its rules.**

## Work
### 1. `src/lib/server/rulesets/bookRules.ts` — the one helper
- Add an exported `rulesetIncompatibleRefusal(genreId: string | null | undefined, rulesetId: string): string | null`. It returns the refusal sentence when the genre (`getGenre(genreId)`) **declares `uses`**, the ruleset is registered (`getRuleset(rulesetId)`), and `rulesetFit(genre, ruleset).rating === "incompatible"` (`rulesetFit` from `@serene-pub/sdk`, the same call `genreOffer.ts` makes). Otherwise null (no genre, no `uses`, unregistered ruleset, any other rating).
- **Words (copy ★, use exactly):** `` `${genreName ?? "This genre"} can't play ${rulesName(rulesetId)}: ${fit.reason}.` `` — e.g. _Lair can't play Freeform: missing dice with no fallback._ (`fit.reason` is the SDK's own sentence, lower-case start; do not reword it). Reuse the file's `rulesName`; derive `genreName` the way `strictRulesRefusal` already does (factor that into a small private helper rather than copying it).
- Fold it into `strictRulesRefusal`: signature becomes `strictRulesRefusal(genreId, book: { name: string; primaryRuleset: string }, opts?: { starter?: boolean; nextChapter?: boolean })`. Order: (a) today's `only` check, words unchanged for a lorebook; with `opts.starter` the words say _the starter lorebook '‹name›'_ and _Choose a starter lorebook that uses …_ (exactly today's inline kit sentence in `sessions.ts` ~1158–1162); (b) then, **unless `opts.nextChapter`**, `rulesetIncompatibleRefusal(genreId, book.primaryRuleset)`. A Freeform book (`adoptedBookRules(...)` null) still returns null before both checks (fix7: the session plays its own pick, which is checked separately).
- Update the file's header comment to say the helper also refuses Incompatible rules (owner 2026-11-05) and that a next chapter is exempt.

### 2. `src/lib/server/sockets/sessions.ts` — the create rules block ONLY (~1108–1205; re-read immediately before each edit, other programmes edit this file)
- Kit path (~1152–1166): replace the inline `only` refusal with `strictRulesRefusal(genreId, { name: startKit.name, primaryRuleset: rules.primaryRuleset }, { starter: true, nextChapter: creationMode === "next-chapter" })` (`creationMode` is in scope above, ~700; check). Words for `only` must stay byte-identical.
- Book path (~1167–1185): replace the inline `only` refusal with `strictRulesRefusal(genreId, book, { nextChapter: creationMode === "next-chapter" })` (same words as today's inline sentence — verify byte-for-byte). `genreId` here = `(params.session as any).genreId ?? STANDARD_GENRE_ID` (the value the block already computes for `getGenre`; hoist it to a const).
- The not-adopted path (~1186–1196):
  - **Delete** the R32 lock line (`if (atStart?.locked.includes("ruleset") …) data.primaryRuleset = atStart.rules.ruleset`) and replace its comment: the preset's ruleset is a default (owner 2026-11-05, R32 amended for rulesets).
  - `valid(id)` = registered (`getRuleset`) and (no `only` or in `only`) — today's test. `picked` = the sent `data.primaryRuleset` (trimmed) when valid — **today's swap for an unregistered or outside-`only` pick is unchanged**.
  - When `picked` is set and `creationMode !== "next-chapter"`: `rulesetIncompatibleRefusal(genreId, picked)` → `return refuse(it)` (**refused, never swapped to the default**).
  - When nothing valid was sent: take `atStart?.rules.ruleset` (the cascade's value — the preset's, even one stored with `lock`) when it is a string, valid, and **not** Incompatible (a preset's default that the genre can't play falls through silently to the genre's default — it is a default, not the person's choice); else `genreDefault`; else `"core:ruleset/freeform@1"` (unchanged).
- Do **not** touch the `sessions:update` attach check (~5966–5980) or `src/lib/server/sockets/summarize.ts` (~544–562): both already call `strictRulesRefusal(genreId, book)` and so refuse Incompatible through the helper. Confirm by reading; edit neither unless the signature change forces it.
- Do **not** touch How strict's lock (R32 stands there), the follow path (~719–748), `shareAsLorebook`, the "Update rules" conversion, or any other block.

### 3. Tests
- `src/lib/server/rulesets/bookRules.test.ts` (unit, sdk mocked as it is): extend the mock with `rulesetFit` or use a genre with `uses` + a real-shaped fit — simplest: add `rulesetFit` to the mock returning `{ rating: "incompatible", reason: "missing dice with no fallback" }` for one ruleset and `"good"` otherwise. Cases: Incompatible book refused in the new words; the starter words for `only`; `nextChapter: true` skips the rating (an `only` refusal still stands); a genre without `uses` never rates; `rulesetIncompatibleRefusal` alone.
- `src/lib/server/sockets/sessions.createRulesets.int.test.ts` (extend; 60 s timeouts are set at file top): a **fixture genre that rates a ruleset Incompatible** — no core genre does today. Recommended: partial-mock `@serene-pub/sdk` (`vi.mock("@serene-pub/sdk", async (orig) => { const real = await orig(); return { ...real, getGenre: (id) => … } })`) so `core:genre/lair` returns a copy with `uses: { ...real.uses, dice: "required" }` and `rulesets: { recommended: [...], default: VIS_ITINERIS }` — then Freeform (no dice) rates Incompatible and Vis Itineris does not. Check with `rulesetFit` in the test which rulesets come out Incompatible before you rely on one (Wherewithal for a book whose rules are adopted, or a pub ruleset you register — your call; say which). If the partial mock breaks the file's other tests, put the new cases in a new file `src/lib/server/sockets/sessions.rulesIncompatible.int.test.ts` (same harness, own `mkdtemp` prefix `serene-pub-vitest-rules-incompatible-`, removed in `afterAll`). Cases:
  1. create with that genre and a blank **pick** on the Incompatible ruleset → refused, `res.error` equals the helper's words; no session row made.
  2. create with a **book** whose `primaryRuleset` is Incompatible → refused in words.
  3. create with a **starter kit** on Incompatible rules → refused in words (if making a kit in the test is heavy, say so and cover it in the unit test instead).
  4. `sessions:update` attaching such a book to a session with no messages → refused; summarize's attach (the handler in `summarize.ts` that calls `strictRulesRefusal`) → refused (cover at least one attach path in int; say which).
  5. a **next chapter** (`creationMode: "next-chapter"`, `from` = a session on such a book) → allowed.
  6. an old preset stored with `settings: { ruleset: { value: VIS_ITINERIS, lock: true } }` (insert a `sessionPresets` row for the genre; never at a hardcoded id) → create with no `primaryRuleset` gets VIS_ITINERIS; create with `primaryRuleset: FREEFORM` (on Story, where Freeform is fine) gets FREEFORM — **the pick wins**.
- Keep green: `bookRules.test.ts`, `sessions.createRulesets.int.test.ts`, `src/lib/server/sessions/convertRuleset.int.test.ts`, `src/lib/server/sessions/noLorebook.int.test.ts`, `sessions.dungeonCrawler.int.test.ts`, and any `sessions.*.int` test that asserts the `only` sentence (grep `plays only by`).

## Rules you must follow (quoted)
- CLAUDE.md Decisions: "Decide implementation inside the asked scope … name the choice in your report." "Propose and wait — one recommendation and its trade-off, marked ★ — on anything a user sees or that outlives the change." Findings along the way go under **Noticed, not done**, never fixed in passing.
- CLAUDE.md Hard rules: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." "Never seed a row at a hardcoded id." "Never add a top-level `await` to `src/lib/server/db/index.ts`."
- Standing ruling: "0.6 is in users' hands. A change to stored data or ids ships with a forward migration…" — this brief changes **no stored data**: an old preset's `lock` on `ruleset` is simply not enforced. Do not write a migration or boot pass.
- NOMENCLATURE R1 one word, one meaning; R3 qualify, never the bare noun (`rulesetIncompatibleRefusal`, never `incompatible`); §23 retired words: never say *phantom* (say *own book*), never *chat* for a session.
- Targeted tests only (`npx vitest run <files>`). **Never pipe vitest into `head`** (SIGPIPE leaks PGlite temp dirs). An int test that opens a DB inside an `it` needs a 60 s timeout.
- Re-read `sessions.ts` immediately before every edit; additive/replace hunks inside the rules block only; **never reformat** it (it is dirty at HEAD) — no `prettier --write` on it or on any edited test file that is dirty at HEAD.

## Files owned
`src/lib/server/rulesets/bookRules.ts`, `src/lib/server/rulesets/bookRules.test.ts`, `src/lib/server/sockets/sessions.ts` (the create rules block ~1108–1205 only), `src/lib/server/sockets/sessions.createRulesets.int.test.ts`, new `src/lib/server/sockets/sessions.rulesIncompatible.int.test.ts`.
## Files readable
Anything. Especially `src/lib/server/rulesets/genreOffer.ts`, `genreFit.ts`, `src/lib/server/sessions/exposure.ts` (`resolveAtStart`: a locked setting ignores the person's ask and returns the layer's value; an open one returns the person's ask when sent, else the cascade's value), `src/lib/server/sockets/summarize.ts` ~535–565, `../serene-pub-sdk/sdk/src/fit.ts` ~290–371.
## Out of scope
No SDK edit; no change to `only`; no change to How strict's lock; no client file; no docs; no NOMENCLATURE; no migration; no change to `exposure.ts`.
## Stop and ask when
A ★ above is unclear, a new user-facing name is needed beyond the refusal sentence, a migration seems needed, or a file outside "Files owned" must change.
## Done means
`npx vitest run src/lib/server/rulesets/bookRules.test.ts src/lib/server/sockets/sessions.createRulesets.int.test.ts <new int file if any> src/lib/server/sessions/convertRuleset.int.test.ts src/lib/server/sessions/noLorebook.int.test.ts` green (report counts); `npx tsc --noEmit -p .` with no errors in your files (report others' errors by file only); `npx prettier --check` on any new file.
