# BRIEF playtest-ST-w2 — the narrator's name is a non-cast label; the handoff names the seed (item 11 steps 1 and 3)

Lane `playtest-ST`, worker 2. Supervisor checks your diff against this brief. Report: put your full report in your final message (changed files, exact test commands with pass/fail counts, anything you could not do, Noticed-not-done). Do not write a report file.

## Background (why)
In Story, narration lines go into history as assistant turns labelled `Narrator: …`. The narrator's name is never a stop and never stripped: `nonCastLabelsFor` (`src/lib/server/pipelines/runtime/dispatch.ts:454-484`) returns only the player label (`playerLabelFor`) and the genre's declared envoys. So a character's reply that opens with `Narrator:` keeps it, and a runaway `\nNarrator:` isn't stopped. Separately, `src/lib/server/pipelines/prompt/endOnUserTurn.ts:90` prefers the last assistant line's speaker over the seed label, so a prompt ending on the narrator's line hands the turn to "Narrator" even when Aria is the one about to speak.

## Goal
1. **`nonCastLabelsFor`** (`dispatch.ts`) also returns:
   - the session narrator's name, from `narratorNameFor(db, sessionId, undefined)` exported by `src/lib/server/pipelines/runtime/host.ts:672` — **import it (dynamic `import()` like the function's other imports); do not edit `host.ts`**;
   - the distinct non-blank `metadata.narratorName` values found on the session's stored messages (`schema.sessionMessages`, `metadata` is jsonb; see `src/lib/server/db/schema.ts:2848`) — the names narration was written under before a rename. One query, no full-row read (select the field, distinct, non-null).
   Keep the result de-duplicated and trimmed as today. Each new source must fail on its own: if `narratorNameFor` or the history query throws, the other labels (player label, envoys) are still returned — today's single `try/catch` returning `[]` would drop them all, so split it. Update the function's doc comment to say the narrator's names are included (its comment calls these "the labels of the session's voices nobody in the cast is").
   - Nothing else in the call site changes: `ownLabels` / `assembledOwnLabels` already exempt the speaking voice's own label (`src/lib/server/connections/stops.ts:241-244`, and the `stray` filter at `dispatch.ts:~1398`), so on a narrate turn "Narrator" is not a stop and not stripped.
   - To test it, export `nonCastLabelsFor` (it is module-private today). Same name; no other new identifier.
2. **`endOnUserTurn.ts:90`**: `const name = speakerOf(end) ?? opts.seedLabel ?? null` → `const name = opts.seedLabel ?? speakerOf(end) ?? null`. Nothing else in that file.

## Tests
- **New** `src/lib/server/pipelines/runtime/nonCastLabels.int.test.ts` (new file; name it so): a Story session whose narrator has been **renamed** (not "Narrator") — `nonCastLabelsFor` returns the renamed narrator; a stored narration row whose `metadata.narratorName` is an older name — that name is returned too; the player label/envoys behaviour is unchanged where you can show it cheaply. Prefer a real test DB world (`createTestDb` via `vi.mock("$lib/server/db", …)`, the pattern in `src/lib/server/sockets/scenes.live.int.test.ts:22-33`; pass `db` explicitly — `defaultDb()` dynamic imports bypass `vi.mock`). Find how a narrator gets a name in a real session first: `narratorNameFor` resolves `context.prompts.narratorName` of the Story narrate spec through `buildWorld` (read `host.ts:672-687`, `src/lib/server/pipelines/config/world.ts`, and existing tests such as `src/lib/server/sockets/sessions.sanctum.int.test.ts`, `pipelines.scoping.int.test.ts`, `replyRoad.int.test.ts`, `pipelines/entities/sessionGenres.int.test.ts` for how a Story session and its prompt config are seeded). If a real rename cannot be seeded in reasonable code, `vi.mock` only `narratorNameFor` (partial mock of `host.ts`) to return the renamed name, keep the history part real, and **say so in your report**. Every `test` that opens a DB gets a `60_000` timeout; a `beforeAll` that creates the DB gets `60_000` too.
- `src/lib/server/connections/stops.test.ts`: add tests with `composeStops` (look at the existing `nonCastLabels`/`ownLabels` cases and the file's helpers): (a) a character's turn with `nonCastLabels: ["Narrator"]` → `Narrator:` is a speaker stop (newline-prefixed on the chat wire with inline labels, as the other participants' are); (b) a narrate turn (`ownLabels: ["Narrator"]`) → `Narrator:` is not a stop. Optionally one `trimAtSpeakerBoundary` case: a reply with a later line `\nNarrator: …` is cut there.
- `src/lib/server/pipelines/prompt/endOnUserTurn.test.ts`: add a test — a prompt ending on `bot("Narrator: The wind rises.")` with `{ seedLabel: "Aria" }` gets the handoff `speakerCue("Aria")`; the existing "a round nobody spoke in" test (no seed label → "Narrator") must stay green.

## Files owned (edit only these)
- `/home/jody/github/serene-pub/src/lib/server/pipelines/runtime/dispatch.ts` (only `nonCastLabelsFor`: its body, its doc comment, and `export`)
- `/home/jody/github/serene-pub/src/lib/server/pipelines/runtime/nonCastLabels.int.test.ts` (new)
- `/home/jody/github/serene-pub/src/lib/server/connections/stops.test.ts`
- `/home/jody/github/serene-pub/src/lib/server/pipelines/prompt/endOnUserTurn.ts` (line 90 only)
- `/home/jody/github/serene-pub/src/lib/server/pipelines/prompt/endOnUserTurn.test.ts`

## Files readable
Anything. `src/lib/server/connections/stops.ts` is read only.

## Out of scope (never build)
`src/lib/server/messages/replyView.ts` (the re-anchor rule is ★11a, unruled); restoring a name prefill on chat connections (★11b); `runtime/host.ts`; `core-catalog/src/registry/genres.ts`; the narrator's turn toggle (item 7); any other lane's file. Other lanes are working in the same tree right now (Models view / finder files, `src/lib/server/sessions/rewind.int.test.ts`, and finished work in host/, sessions/, sockets/…): leave it all alone, including prettier noise in files you don't own.

## Stop and ask when
A change needs a file outside Files owned, a new name beyond the new test file and the `export` (identifier, field, label, error string), a setting, a flag or a migration — stop that step, finish the rest, say so in your report.

## Rules you work under (quoted)
- CLAUDE.md Decisions: *"Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing 'for later': no option, hook or extension point nobody asked for."*
- NOMENCLATURE §9 row (line ~3000): **non-cast labels** — *"the player label and the genre's envoys' names (`ComposeStopsInput.nonCastLabels`, `ownLabels`; `nonCastLabelsFor`, `assembledOwnLabels`) — stopped on like a participant's, and **stray labels** (`ReplyFacts.strayLabels`) taken off a reply's front"*. This change widens the set to the narrator's names; the supervisor records the canon row, you don't edit `NOMENCLATURE.md`.
- *"Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."* Use the `db` handle `nonCastLabelsFor` is given for every query.
- *"defaultDb() bypasses vi.mock — pass db explicitly."*
- *"Never seed a row at a hardcoded id."*
- *"Never `git checkout` / `restore` / `stash` in `../serene-pub-sdk`."*

## Done means — tests (run only these)
Scratchpad: `/tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/` (call it `$S`; write it out in full in the command).
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/server/connections/stops.test.ts src/lib/server/pipelines/prompt/endOnUserTurn.test.ts src/lib/server/pipelines/runtime/nonCastLabels.int.test.ts > $S/playtest-ST-w2-1.log 2>&1; echo exit=$?'` (if `systemd-run` is refused, use `timeout 900` with the same NODE_OPTIONS). Never pipe vitest into `head`. Also `npx prettier --check` on each file you edited (report pre-existing noise, don't fix it). Never a full `npm test`, `npm run check`, `tsc` over the project, `npm run sdk:test` or `sdk:build`.

## Verbatim (lead's standing lines)
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You should not need `sdk:build` at all.)
