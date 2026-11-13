# BRIEF — `s4-bk-fold` worker 2 — the table registry copies into an existing book, 2026-11-08

Supervisor: lane `s4-bk-fold`. You are a lane-worker. Work only in the files below. Report back in your final message (the supervisor writes the lane report).

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no `sdk:build`.)

## Why

The lane will **fold a parent book P into a session's own book O** (plan §34.3: "P's tables into O via `copyLorebookTables(tx, P, O)` with token remap (`{{char:N}}`, `next_binding_number`)"; owner ★B-1, 2026-11-08: "the whole parent, every line"). Today `copyLorebookTables` (`src/lib/server/lorebooks/tableRegistry.ts` ~955) is documented and built for "an existing, **empty** book" (the duplicate, `src/lib/server/utils/lorebookDuplicate.ts`). Your job is only the registry half: make it copy correctly into a book that **already holds rows**, and keep a turn's tie when asked. The fold itself is not yours.

Read first: `tableRegistry.ts` whole (it is ~1,000 lines; the header, `IdMaps`, `polymorphic`, `attributeRow`, every spec, the consumers), `lorebookDuplicate.ts`, `src/lib/server/utils/lorebookBindingToken.ts` (`deriveNextBindingToken`), `src/lib/server/utils/castTags.ts` (`castTag`, `rewriteCastTagsDeep`, the `CAST_TAG_SITES` list ~250 — "the list IS the contract": every lore text column a tag can sit in), `CAST_VERSION_TAG_COLUMNS` in `src/lib/server/characters/versions.ts` ~566.

## Goal

1. **Signature.** `copyLorebookTables(tx, from, to, opts: CopyOptions = {})`, exported 🚧 `CopyOptions` `{ keepTurnTies?: boolean }` with one JSDoc sentence per field. Every existing caller (the duplicate) passes nothing and behaves **exactly** as today.
2. **Member tags when the target already has members.** `lorebook_bindings.binding` (the `{{char:N}}` tag) is unique per book (`lorebook_bindings_binding_unique`). Rule (decided by the supervisor): if `to` holds no `lorebook_bindings` row when the copy starts, every copied member keeps its tag (today). If it holds any, **every** copied member gets a fresh tag from `deriveNextBindingToken(to, tx)`, in source id order, and the copy records it in a new `IdMaps.tags: Map<number, number>` (source member number → copy member number; empty when tags were kept). Use `castTagNumber` (castTags.ts) to read a tag's number.
3. **Tags inside copied text.** When `maps.tags` is not empty, every copied row's lore text columns are rewritten through `rewriteCastTagsDeep(value, (n) => maps.tags.has(n) ? castTag(maps.tags.get(n)!) : null)` **at insert time** (a tag naming a number not in the map is left as written): entries (`content`, `title`, `keys`, `secondaryKeys`, `fields`), entry amendments (`fields`), members (`summary`), presences (`note`), scenes (`name`, `summary`), links (`title`, `description`, `reason`), character versions (every `CAST_VERSION_TAG_COLUMNS` column). That is the `CAST_TAG_SITES` list minus `lorebook` (the book row is not the registry's). If you find a copied lore text column not in that list, report it — don't add it to `CAST_TAG_SITES` (not your file).
4. **Line names.** `lorebook_branches_book_name` is unique on (book, name). A copied line whose name `to` already holds is renamed with the rule sessions already use for their lines (`src/lib/server/lorebooks/sessionLine.ts` `lineNameFor`, read it: trimmed, `name (2)`, `name (3)`… within 60 characters, never `main` case-insensitively). Implement the small loop locally in `tableRegistry.ts` (don't edit `sessionLine.ts`); names the copy itself assigns count as taken.
5. **Rows the target already has.** `binding_suggestions_book_key_uq` (book, entity key) and `owner_sheets_owner_sheet_uq` can collide when `to` is not empty: the target's own row wins (`onConflictDoNothing`). For every other unique index on a registered table (`grep -n "uniqueIndex(" src/lib/server/db/schema.ts`), work out whether a non-empty target can collide; handle only the two above, and **list the rest in your report** with the table, index and case. Also list, without solving, every place where a copied row and a target row would both apply and a reader must pick one — in particular the `lorebook`-kind attribute rows (`ownerMap` maps `from` → `to`, so the source's world values land beside the target's own) and the target's `lorebook_tags` — saying which one a reader takes today and why (cite the reader's file:line).
6. **Turn ties.** With `keepTurnTies: true`, the attribute rows (`attributeRow`) and the character versions keep `validFromMessageId` as stored (today both null it: "a copy is a real book"); everything else is unchanged. Default false = today.
7. **Header and doc comments** of `tableRegistry.ts` and `copyLorebookTables`: say that a copy may land in a non-empty book (the fold) and what changes then (tags, line names, target rows win), in the file's voice, one or two sentences each.

## Files owned

`src/lib/server/lorebooks/tableRegistry.ts`, `src/lib/server/lorebooks/tableRegistry.test.ts`, new `src/lib/server/lorebooks/tableRegistry.copyInto.int.test.ts`. **Readable:** everything. **Not yours:** `lorebookDuplicate.ts`, `castTags.ts`, `versions.ts`, `sessionLine.ts`, `ownBook.ts` (another worker edits it now), `NOMENCLATURE.md`.

## Out of scope

The fold (`foldInParent`), reseating, a session's own layer of attribute rows (`session_id` set — still never copied), scene captures (still never copied), the book row's own columns (calendar, clock, ruleset, annex), any reading rule.

## Stop and ask when

A copy into a non-empty book can't be made correct without changing a file you don't own; any new exported name beyond `CopyOptions`, `keepTurnTies`, `IdMaps.tags` (mark those 🚧 provisional in their JSDoc).

## Done means (tests)

- New `tableRegistry.copyInto.int.test.ts` (model the DB setup on `tableRegistry.versions.int.test.ts`: `vi.mock("$lib/server/db", …createTestDb)`, a temp `SERENE_PUB_DATA_DIR` named `serene-pub-vitest-registry-copyinto-…` which you delete in `afterAll`, `vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`). Fixture: a source book with three members (tags 1–3, one with versions whose text names `{{char:2}}`), entries and an entry amendment naming `{{char:1}}` / `{{char:3}}`, a link and a scene naming a tag, a presence, a line named "Night", a binding suggestion and a book-owned sheet; a target holding one member (tag 1), a line "Night", the same suggestion key and sheet. Assert: copied members' tags are fresh and distinct from the target's; `maps.tags` maps 1→n1, 2→n2, 3→n3; every copied text names the new tags (a dangling `{{char:99}}` left as written); the target's own rows unchanged; the copied line is "Night (2)"; suggestion and sheet: the target's kept; `to.next_binding_number` past every tag; **the source book byte-identical** (dump every registered table's rows for `from` before and after, compare); `keepTurnTies: true` keeps a version's and a value's `validFromMessageId`, default nulls them. A second case: copying into an **empty** target keeps every tag and rewrites nothing (`maps.tags` empty).
- Unchanged and green: `tableRegistry.test.ts`, `tableRegistry.versions.int.test.ts`, `src/lib/server/sockets/lorebooks.duplicate.int.test.ts`.
- **Timing (report, don't keep):** in a temporary test file, seed a large source (≈2,000 entries, 200 members with 5 versions each, 1,000 links, 2,000 attribute values) and time one `copyLorebookTables` into a non-empty target inside one `db.transaction`; report the milliseconds and the machine load you saw; then delete the temporary file.
- Capped scope, logged (never pipe vitest into `head`):
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-bk-fold-w2-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-bk-fold-w2-tests.log'`
- `npx tsc --noEmit -p .` under `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=8192; …'` — no new errors in your files.
- **Prettier:** `npx prettier --check` on changed files, but **only `--write` the lines you changed** — never reformat a whole file you didn't otherwise edit. If a file fails only on lines you didn't touch, leave it and say so.

## Hard rules that apply

- "⚠ Every statement runs on the `tx` handed in. The outer `db` inside a transaction deadlocks PGlite silently." (registry header) — never import `$lib/server/db` into `tableRegistry.ts`.
- Never `kill -9` a dev server. Never `git checkout` / `restore` / `stash`.

## Report (final message)

Changed files; the new signature and `IdMaps` shape; tests with pass/fail counts; tsc result; the unique-index collision list and the "both apply" precedence list (item 5) with file:line; the timing; Noticed, not done.
