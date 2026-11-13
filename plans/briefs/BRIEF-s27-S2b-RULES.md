# Rules every s27-S2b worker follows (quoted by the lane supervisor; read in full)

## From the S2 contract (`plans/briefs/BRIEF-s27-S2-common.md`, "Rules", verbatim)
CLAUDE.md Principles/Decisions/Hard rules; NOMENCLATURE R1–R6, §24; `tx` only inside `db.transaction` (the outer `db` deadlocks PGlite); no static `$lib/server/db` import in modules tests mock (pass `db`); targeted tests only (your files' tests and the ones the lane brief names); never pipe vitest into `head`; 60 s timeouts on int tests that touch the DB; delete only your own `/tmp/serene-pub-vitest-*` dirs by name. Never write "no book"/"no lorebook".

- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (This lane needs no `sdk:build` at all — never run it.)

## Also from the S2 contract (apply to your hunks)
- **Keys stay.** `session_cast:<cardId>` owners, `state.cast.byId[<cardId>]`, the turn order, `turnTally`, `speechAutoVoice:<speakerRef>`, `rankings.speaker_ref`, `rewind_taken`, the sprite-set slot on the `session_cast` owner: unchanged. Refs your code **emits** stay `character:<cardId>` (the seat's card) / `player-seat:<id>`. A card-shaped row read as its member keeps its `id` (the seat's card id) — only the read fields change.
- **Payloads are additive.** Do not change SDK types or objects handed to plugins (`CastEntry`, `SessionCharacterV1`, `ParticipantRef`, …). No SDK edit, no `sdk:build`, no migration, no boot-pass change, no new setting, flag or event.
- **Two live seats can share one member** until the next boot. Resolve per seat, never per member.
- **Every session has a lorebook** — its own book (Session notes) or an overlay of a book. Never write "no book", "no lorebook", "bookless", "reads no lorebook" in code, comments, tests or copy; say "a session whose lorebook is its own book".
- A new **exported** name needs a NOMENCLATURE §25 row: do NOT edit NOMENCLATURE.md yourself — list the name, file and one-line purpose in your report; the supervisor writes the row. Mark new exports 🚧 in their doc comment.

## Shared files
- `src/lib/server/sockets/sessions.ts` (≈11k lines) is edited by hunk by more than one agent. Re-read the hunk (`sed -n`) immediately before each edit; never reformat; **never run prettier --write on it**; edit only the hunks your brief names.
- `src/lib/server/pipelines/runtime/host.ts`: only the hunks your brief names.
- Files dirty at HEAD carry other lanes' uncommitted work: make additive hunks and re-read before each edit. Never `git checkout`/`restore` anything.

## CLAUDE.md hard rules that bite here
- Inside `db.transaction(async (tx) => …)` use only `tx`.
- `$state(new Set())` is not reactive (client only; you should not be touching client code).
- Never `kill -9` anything.
- Running tests: `npx vitest run <file> [<file>…]` from `/home/jody/github/serene-pub`, at most a handful of files per run, never piped to `head`/`tail -f`. If a run fails oddly mid-way (another lane may be rebuilding the SDK dist), re-run once before investigating.

## Decisions
Decide implementation inside your brief (structure, helpers, tests) and name each choice in your report. Anything a user sees, a new setting/flag/event/table, a file outside your list, or a choice between two readings: stop that item and put it under **Questions** in your report (one recommendation + trade-off). Findings outside your brief go under **Noticed, not done** — never fixed in passing.

## Your report (your final message — do not write a report file)
Changed files (with one line each) · each test you changed: file, test name, old → new value, and why (quote the ruling) · tests run with pass/fail counts · new exported names (for §25) · Questions · Noticed, not done.
