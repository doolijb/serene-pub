# BRIEF cv-guards-w5 — four raw-member fixtures

Worker for lane **cv-guards** (supervisor: lane-supervisor, Opus). Repo `/home/jody/github/serene-pub`. Use absolute paths. Report back as your final message (no report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

## Context
Character versions: every cast member has a **base** version, made by `insertCastMember(tx, values)` (`src/lib/server/characters/versions.ts`, returns `{ member, base }`). The graph context (`utils/graphContextFormatter.ts`) and graph links (`utils/graphEntryLinks.ts`) now read members through `membersAsRead`, which leaves out a member with no version (the old read is deleted, on purpose). Four test files insert members raw (`db.insert(schema.lorebookBindings)`), so their members now read as nobody (`node#3` instead of `Kiran`).

## Files owned (edit only these)
- `src/lib/server/pipelines/runtime/relationshipSearch.int.test.ts` (~105)
- `src/lib/server/pipelines/runtime/relationshipsRendered.int.test.ts` (~98)
- `src/lib/server/pipelines/runtime/eligibilityGates.int.test.ts` (~231)
- `src/lib/server/sockets/sessionPlaces.int.test.ts` (~119)

## Do
Switch each raw member insert to `insertCastMember` with the same values (a member's `nodeState` / `nodeVisibility` / names in the values become its base's — `insertCastMember` reads them). Keep every assertion as it is. If a test also writes a frozen binding column (`node_state`, `node_visibility`, `own_name`, …) or a `cast_amendments` row after the insert to set up state, set it on the version instead (`updateCastVersion(tx, baseId, { changes: {...} })`, or `writeCastVersion` author path for a dated change) and say which. Don't touch any other file.

## Done means
`npx vitest run --maxWorkers=2 <the four files>` passes (never pipe vitest into `head`). Prettier: format only your hunks. List `/tmp/serene-pub-vitest-*` before and after; delete only dirs your runs left, by name. Report changes per file and the run result.
