# BRIEF s22-V-w2 — client: the fit words in the Rulesets view and in Book settings

Lane s22-V (supervisor writes the lane report). Work from `/home/jody/github/serene-pub`. Report back in your final message (no report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal
Owner ruling ★§22-3 (2026-11-05): a ruleset row shows its fit per enabled genre — "Story: Great · Lair: Good · Dungeon Crawler: Poor"; a lorebook shows the same for **its** rules; a book on Freeform says *Freeform — the session chooses the rules*. "Pickers explain why" (owner 10-23): every rating carries its one-line why on hover or expand, as the start form's Rules card does. A ruleset no genre rates shows **nothing** (never "—").

Data (another worker is adding it server-side right now; the type is already in place): `Sockets.Rulesets.ListRow["rulesetFitByGenre"]` and the `lorebooks:list` row's `rulesetFitByGenre`, both `RulesetGenreFit[] | undefined` (`src/lib/server/rulesets/genreFit.ts`): `{ genreId, genreName, rating: "incompatible"|"poor"|"ok"|"good"|"great"|"perfect"|"not-offered", reason, inWords?: { label, why }[] }`. `reason` is a lower-case fragment ("everything it plays best with is here", "a health-like number — told in words", "this genre plays only Mundi rules"). Absent for a Freeform book's row. Type it through `Sockets…` (global ambient namespace, as `admin/sections/rulesets/Page.svelte` does) — **never import a `$lib/server` module from client code**.

## Build
1. New `src/lib/client/lorebooks/rulesFitWords.ts` (pure):
   - `export type GenreFit = NonNullable<Sockets.Rulesets.ListRow["rulesetFitByGenre"]>[number]`
   - `FIT_RATING_WORD`: Incompatible · Poor · Ok · Good · Great · Perfect · **Not offered** (`"not-offered"`) — the start form's words (`StartSessionForm.svelte` ~139, read only).
   - `FREEFORM_BOOK_FIT = "Freeform — the session chooses the rules"`.
   - `fitWords(f)` → `"Lair: Good"`; `rulesFitLine(fits)` → the `fitWords` joined by `" · "`, `""` when none; `rulesFitWhy(f)` → `"Lair: Good (a health-like number — told in words)"`; `rulesFitTitle(fits)` → the whys joined by `"\n"`; `isFreeformBook(primaryRuleset)` → true for null/empty or `BOOK_DEFAULT_RULES` (`$lib/shared/rulesets/rulesOffer`).
   - + `rulesFitWords.test.ts` (node) pinning each.
2. New `src/lib/client/lorebooks/RulesFitLine.svelte`: props `fits?: readonly GenreFit[] | null`, `freeform?: boolean`, `mode?: "line" | "details"` (default `"line"`), `class?: string`. Renders nothing when not `freeform` and the line is empty.
   - `freeform` → one muted line `FREEFORM_BOOK_FIT` (`data-rules-fit="freeform"`), either mode.
   - `"line"` → a `<span>` (valid inside a row's `<button>`: phrasing content only), `block truncate text-xs text-surface-600-400`, `title={rulesFitTitle(fits)}` (the hover why), `data-rules-fit`.
   - `"details"` → native `<details data-rules-fit>`: `<summary>` is the line (muted, text-xs); inside, a `<ul data-rules-fit-why>` with one `<li data-rules-fit-genre={genreId}>` per genre: `<span class="font-medium">{fitWords(f)}</span>: {f.reason}` and, when `inWords`, a nested list "Label: why" (label's first letter upper-cased, as the start form's `data-rules-in-words` list does ~2066).
   - Muted text is `text-surface-600-400` (STYLE-GUIDE §6.4: "muted … never quiet: these are facts a reader came for, and quiet text fails AA at this size").
3. Admin › Rulesets, `src/lib/client/admin/sections/rulesets/Page.svelte`: one column `{ key: "fit", label: "Genre fit", custom: true, text: (r) => rulesFitLine(r.rulesetFitByGenre) }` placed after **Plays**, drawn through the changelist's `cell` snippet (see `admin/sections/session-presets/Page.svelte` ~188 for how a page passes `cell`; `AdminChangelist.svelte` ~368) as `<RulesFitLine fits={row.rulesetFitByGenre} />`; any other custom column (none today) falls back to text. No sortValue.
4. The ruleset's page, `src/lib/client/admin/sections/rulesets/IdPage.svelte` `headerChips` snippet (~595): after the chips `<div>`, before `<FieldHelp>`: `<RulesFitLine fits={detail.rulesetFitByGenre} mode="details" />` (renders nothing without fits).
5. Book settings' Rules card, `src/lib/client/lorebooks/BookRulesCard.svelte`: prop `fits?: GenreFit[] | null`; under `<BookRulesPicker …/>` and before the `asking` block: `<RulesFitLine {fits} freeform={isFreeformBook(current)} mode="details" />`. `src/lib/client/lorebooks/BookSettings.svelte` (dirty at HEAD — additive hunks, never reformat): a prop `rulesFit?: GenreFit[] | null` (doc comment 🚧 s22-V) passed to `BookRulesCard` as `fits`. `src/lib/client/lorebooks/LorebooksWorkspace.svelte` (dirty, **shared** — lane m3b-F just finished there; re-read immediately before the edit; one additive line): beside `primaryRuleset={book.primaryRuleset ?? null}` (~3006) add `rulesFit={book.rulesetFitByGenre ?? null}`.
6. **Do not touch** `src/lib/client/components/listItems/LorebookListItem.svelte` (the lead is editing it) — the book **list row** half is queued by the supervisor.

## Tests (Done means these green)
- `rulesFitWords.test.ts` (above).
- New `src/lib/client/lorebooks/rulesFitLine.dom.test.svelte.ts`: mount `RulesFitLine` — (a) a ruleset's fits → the line reads exactly "Story: Great · Lair: Good · Dungeon Crawler: Poor" and the title holds each why; (b) `freeform` → the Freeform sentence, and no line; (c) a book on rated rules in `"details"` mode → one `data-rules-fit-genre` item per genre with its reason, and an `inWords` item; (d) no fits, not freeform → renders no `[data-rules-fit]`.
- New `src/lib/client/lorebooks/bookRulesFit.dom.test.svelte.ts`: mount `BookRulesCard` (mock the socket as `src/lib/client/admin/sections/rulesets/rulesetAdmin.dom.test.svelte.ts` does) — `current` Freeform → the Freeform sentence; `current` a rated ruleset with `fits` → the line.
- New `src/lib/client/admin/sections/rulesets/rulesetFit.dom.test.svelte.ts`: mount `Page.svelte`, answer `rulesets:list` with two rows (one with fits, one without) → the first row shows the line; the second shows no `[data-rules-fit]` and no "—".
- ⚠ No DOM node is ever handed to `expect` (a failing assertion on one serialises the whole happy-dom window and has OOM-killed VS Code): compare booleans, strings or plain data only.
- Run only: `npx vitest run src/lib/client/lorebooks/rulesFitWords.test.ts src/lib/client/lorebooks/rulesFitLine.dom.test.svelte.ts src/lib/client/lorebooks/bookRulesFit.dom.test.svelte.ts src/lib/client/admin/sections/rulesets/rulesetFit.dom.test.svelte.ts src/lib/client/admin/sections/rulesets/rulesetAdmin.dom.test.svelte.ts src/lib/client/lorebooks/providedRow.dom.test.ts src/lib/client/rulesetVocabulary.test.ts` — report counts. `npx tsc --noEmit -p .` → report only errors in your files (the server worker may still be mid-edit; others' errors are known). `npx prettier --check` on every new file.

## Files owned (edit only these)
New: `src/lib/client/lorebooks/rulesFitWords.ts`, `rulesFitWords.test.ts`, `RulesFitLine.svelte`, `rulesFitLine.dom.test.svelte.ts`, `bookRulesFit.dom.test.svelte.ts`, `src/lib/client/admin/sections/rulesets/rulesetFit.dom.test.svelte.ts`. Edit: `src/lib/client/admin/sections/rulesets/Page.svelte`, `IdPage.svelte`, `src/lib/client/lorebooks/BookRulesCard.svelte`, `BookSettings.svelte` (additive), `LorebooksWorkspace.svelte` (one additive line).
## Files readable
Anything; the server files are the other worker's — read only.
## Out of scope
Server code, `LorebookListItem.svelte`, the start form (`components/sessionForms/**`, another lane), docs, NOMENCLATURE, STYLE-GUIDE, any preset words (presets appear nowhere in these views), new settings, any toaster call.
## Stop and ask (in your report, then stop) when
Any copy beyond the strings named here seems needed; a name beyond the ones here; a file outside your list.

## Rules that bind (quoted)
- NOMENCLATURE §28: "**The client never shows an SDK noun** — _ruleset_, _mechanics_, _rigour_, _repertoire_, _piece_, _compendium_ …" (Admin › Rulesets is the exception; the Lorebooks view is everyone's — say _rules_, never _ruleset_, in anything a member reads). `src/lib/client/rulesetVocabulary.test.ts` enforces it.
- STYLE-GUIDE §10: "Sentence case everywhere." "Labels are nouns, hints are sentences." "No filler: a screen with nothing to say says nothing." "Help is one sentence. A second sentence is a docs link's words, a field's `title`, or gone."
- STYLE-GUIDE §6.4: "A row is two lines and a face" … "**muted** (`surface-600-400`, never quiet)" · "items joined by ` · `".
- CLAUDE.md: "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`." "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`." Sockets: "views register listeners for local state and never call `toaster`." "`socket.off(event)` with no handler removes **every** listener app-wide; always pass the handler."
- CLAUDE.md Decisions: "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing." "Say each assumption when you make it."
- Tests: "Never pipe vitest into `head`: the SIGPIPE leaks PGlite temp dirs." Run only the targeted files above.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You should not need one: no SDK edits.)
- Never `git checkout` / `restore` / `stash`.

## Report (final message)
Changed files with line ranges; decisions taken and why; tests run with pass/fail counts; tsc/prettier for your files; Noticed, not done.
