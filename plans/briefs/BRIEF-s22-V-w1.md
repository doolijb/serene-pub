# BRIEF s22-V-w1 — server: ruleset fit per genre on the Rulesets and Lorebooks list rows

Lane s22-V (supervisor writes the lane report). Work from `/home/jody/github/serene-pub`. Report back in your final message (no report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal
The owner ruled (★§22-3, 2026-11-05): a ruleset row shows its fit **per enabled genre that declares `uses`** — "Story: Great · Lair: Good · Dungeon Crawler: Poor" — from **today's** `rulesetFit(genre, ruleset)` (SDK), the same rating the start form's Rules card gets through `genreRulesOffer` (`src/lib/server/rulesets/genreOffer.ts` ~27–55). A lorebook row shows the same for **its** ruleset. **No new calculation, no per-preset fit.** ★§22-2: `rulesets: { only }` stays a lock, so a genre declaring `only` also speaks: a ruleset **outside** its list reads `"not-offered"`.

The supervisor already wrote the type contract — do not change its shape:
- `src/lib/server/rulesets/genreFit.ts`: `interface RulesetGenreFit { genreId; genreName; rating: RulesetRating | "not-offered"; reason; inWords?: { label; why }[] }`.
- `RulesetListRow.rulesetFitByGenre?: RulesetGenreFit[]` (`src/lib/server/rulesets/pubRulesets.ts` ~117).
- the `lorebooks:list` row's `rulesetFitByGenre?` (`src/lib/shared/sockets/types.ts` ~7860).

## Build
1. In `src/lib/server/rulesets/genreFit.ts` (add below the interface; keep its header comment):
   - `export interface FitRatingGenre { genreId: string; genreName: string; decl: { uses?: unknown; rulesets?: { only: readonly string[] } | { recommended: readonly string[]; default: string } } }`
   - `export function rulesetFitByGenre(genres: readonly FitRatingGenre[], ruleset: RulesetDecl): RulesetGenreFit[]` — pure, in `genres` order. For each genre: if it declares `only` and `ruleset.id` is not in it → `{ genreId, genreName, rating: "not-offered", reason: "this genre plays only <names>" }` where names = each id's `i18nText(getRuleset(id)?.name) ?? id`, joined "A" / "A and B" / "A, B and C". Else if it declares `uses` → `rulesetFit(decl as any, ruleset)` mapped **exactly as `genreOffer.ts` maps it** (`rating`, `reason`, and `inWords` only when non-empty, as `{ label: r.label ?? r.key, why: r.why ?? "" }`). Else (no `uses`, and not excluded by `only`) → nothing for that genre.
   - `export async function fitRatingGenres(db: Db): Promise<FitRatingGenre[]>` — `listOfferedGenres(db)` (`$lib/server/pipelines/entities/sessionGenres`, **dynamic import**, as `sessions.ts` `genreRowFor` does) → each row's SDK declaration `getGenre(g.genreId)`; keep those whose declaration has `uses`, or `rulesets` with `only`. `genreName` is the offered row's name (check its type; make it a string).
   - `export async function rulesetFitReader(db: Db): Promise<(rulesetId: string | null | undefined) => RulesetGenreFit[] | undefined>` — loads the genres **once** (on error: `console.warn` one line and use `[]` — a fit failure never breaks a list), caches results per ruleset id in a `Map`, and returns `undefined` for a null id, an unregistered id (`getRuleset(id)` undefined), or an empty result. One reader per request; never a query per row.
2. `src/lib/server/rulesets/pubRulesets.ts`: `listRow` takes an optional `fitOf` and, **only when `decl` is present** (a registered ruleset — a draft-only row gets nothing), sets `rulesetFitByGenre` when the reader returns one. `listRulesets` and `rulesetDetail` each create one reader per call. Additive; touch nothing else.
3. `src/lib/server/sockets/lorebooks.ts` `buildLorebooksList` (~318–470; lane m3b-F just added `provided.pluginName` there — **re-read the file immediately before editing; additive hunks only; the file is dirty at HEAD, never reformat it**): when `which === "books"` and there are books, make one reader after `ownerNames`; on each row add `...(fit ? { rulesetFitByGenre: fit } : {})` with `fit = fitOf(adoptedBookRules(book.primaryRuleset))` — `adoptedBookRules` from `$lib/shared/rulesets/rulesOffer` returns null for a Freeform book (it brings no rules; the client says *Freeform — the session chooses the rules*). `sockets/rulesets.ts` should need no change (it calls `listRulesets` / `rulesetDetail`).

## Tests (Done means these green)
- New `src/lib/server/rulesets/genreFit.test.ts` (unit, node): with `@serene-pub/core-catalog`'s `storyGenre`, `chatGenre`, `dungeonCrawlerGenre` and `freeformRuleset`, `visItinerisRuleset` (check the exports): Story and Crawler entries carry a rating from `RULESET_RATINGS` and the same `reason` as `rulesetFit` gives; Chat (no `uses`) gives nothing; a fake genre `{ rulesets: { only: [visItinerisRuleset.id] } }` with no `uses` gives `"not-offered"` with a reason starting "this genre plays only " for Freeform and **nothing** for Vis Itineris; a fake `only` genre with `uses` gives the rating for a ruleset inside the list.
- New `src/lib/server/rulesets/genreFit.int.test.ts`, following `src/lib/server/sockets/sessions.createRulesets.int.test.ts`'s setup exactly (`vi.mock("$lib/server/db", …createTestDb)`, the embedding/broadcast mocks, `defaults.sync()`, `bootstrapPipelines`, a data dir from `fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-genre-fit-"))` removed in `afterAll`, `vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })`): (a) `rulesets:list` (call the handler with an admin fake socket, or `listRulesets`) — Freeform's and Vis Itineris's rows carry entries for `core:genre/story`, `core:genre/lair`, `core:genre/dungeon-crawler` and **none** for `core:genre/chat` / guide; (b) the lorebooks list (`buildLorebooksList` — read its signature) for a user with one book on Vis Itineris and one on Freeform (make them the way existing lorebook int tests do — find one; never seed a fixed id): the Vis Itineris book's `rulesetFitByGenre` equals that ruleset's row's; the Freeform book's is absent.
- Run only: `npx vitest run src/lib/server/rulesets/genreFit.test.ts src/lib/server/rulesets/genreFit.int.test.ts src/lib/server/rulesets/pubRulesets.int.test.ts src/lib/server/plugins/providedBooksPubWide.int.test.ts` — report counts. Then `npx tsc --noEmit -p .` and report only errors in your files (others' are known), and `npx prettier --check` on the two new test files and `genreFit.ts`.

## Files owned (edit only these)
`src/lib/server/rulesets/genreFit.ts`, `src/lib/server/rulesets/genreFit.test.ts` (new), `src/lib/server/rulesets/genreFit.int.test.ts` (new), `src/lib/server/rulesets/pubRulesets.ts` (additive), `src/lib/server/sockets/lorebooks.ts` (additive, shared — re-read before each edit).
## Files readable
Anything. Especially `genreOffer.ts`, `sessions.ts` `genreRowFor` (~2037), `sessionGenres.ts` `listOfferedGenres` (~281), SDK `../serene-pub-sdk/sdk/src/fit.ts` (read only).
## Out of scope
The client (another worker), the start form, any SDK edit, any new socket event, any new setting, `only`'s refusal, docs, NOMENCLATURE.
## Stop and ask (in your report, then stop) when
A name beyond the ones above seems needed; the type contract cannot hold what is needed; anything needs a migration or a file outside your list.

## Rules that bind (quoted)
- CLAUDE.md Decisions: "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing 'for later'." "Say each assumption when you make it."
- CLAUDE.md P1: "Code decides what code can; the model only judges. Same inputs, same result." P2: "A module owns its data and every write to it."
- Hard rules: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." "Never add a top-level `await` to `src/lib/server/db/index.ts`; await `dbReady`." "Never seed a row at a hardcoded id."
- NOMENCLATURE R1 "One word, one meaning" · R3 "Qualify, never abbreviate to the bare noun" (hence `rulesetFitByGenre`, never bare `fit` — the canon has registration fit and template fit too) · R6 mark provisional words 🚧 (doc comments say 🚧 (s22-V)).
- Sockets: "one domain context per event family … is the only listener, and the only place that toasts"; "An event in `SCOPED_EVENTS` must carry its scope key … in the payload, or `emitToUser` silently sends nothing." (No new event here.)
- Tests: "Never pipe vitest into `head`: the SIGPIPE leaks PGlite temp dirs." "An int test that opens a DB inside an `it` needs a 60 s timeout under load." Run only the targeted files above — never the full suite.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You should not need one: no SDK edits.)
- Never `git checkout` / `restore` / `stash` in either repo.

## Report (final message)
Changed files with line ranges; each decision you took and why; tests run with pass/fail counts; tsc/prettier result for your files; Noticed, not done.
