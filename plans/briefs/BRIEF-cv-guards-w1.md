# BRIEF cv-guards-w1 — the two guard tests (one writer; frozen columns)

Worker for lane **cv-guards** (supervisor: lane-supervisor, Opus). Repo `/home/jody/github/serene-pub`. Use absolute paths. Report back as your final message (no report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

## Context
Character versions (S4 stage 1, owner GO 2026-11-05): one table `character_versions` holds every card version and every cast-member version. `src/lib/server/characters/versions.ts` is **the one writer** (P2: "A module owns its data and every write to it… Two writers of one thing is a bug."). The old columns that held the same data are **frozen** (⏳, dropped in S5). Plan `plans/PLAN-sdk-creation-seams-2026-10-30.md` §31 §8 (read lines 1029–1037) and §32 §8 (lines 1297–1318) — quoted:

> "**`lorebook_bindings`:** retold, the retold text columns, face_media_id, timbre, own_name/own_nickname, sprite_set, node_state, node_visibility. **`cast_amendments`:** its writer is sockets/amendments.ts:888, duplicated in tableRegistry.ts:644-667. **The card-field columns on `characters`**, except four kept as ⏳ copies of the **current** version, written only by the versions module: name, nickname and avatar_media_id, for library screens; description, which `embed_text_hash` is generated from."
> "**Guard test.** It fails on a read of a `characters` content column under pipelines/, sessions/, state/, speech/, sprites/, messages/, rulesets/, or the session, state, pipelines and jump sockets. Ids, owner and is_deleted are allowlisted."
> "The insert guard lands with the last insert site, as a closing step of wave 2."

The lane brief (lead): "1. A guard test: no `insert(schema.lorebookBindings)` / `insert(schema.characters)` / `insert(schema.characterVersions)` outside `characters/versions.ts` (the attic exempt). 2. A guard test: no read or write of the frozen columns (…) outside the versions module, the lift and the attic; session-path modules never read the card copies."

**Your job is to write the two guards and report what they find. Do NOT fix any source file.** A second worker is editing other files at the same time (`cast/memberAsRead.ts`, `lorebooks/retold.ts`, `lorebooks/tableRegistry.ts`, `pipelines/testing/fixtures.ts`, tests); don't touch them. The guards will be red at your hand-off; that is expected. The supervisor decides each finding (fix or allowlist).

## Files owned (create only these)
- `src/lib/server/characters/versionsWriter.guard.test.ts` (guard 1)
- `src/lib/server/characters/frozenColumns.guard.test.ts` (guard 2)
- optionally one shared helper `src/lib/server/characters/guardScan.ts` **only if** both tests need the same scanner (a non-test module is fine; it must import nothing from `$lib/server/db`). Otherwise keep each test self-contained.

## How (precedents to read first)
- `src/lib/server/adapters/importBoundary.test.ts` (header explains why a source scan) and `src/lib/shared/conformance/socketEgress.test.ts` (the TypeScript compiler API, an allowlist checked **in both directions**: a listed site that no longer exists fails too). Follow their style: a header that says what is guarded, why, and how to add an exception.
- Parse with `typescript` (`ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)`); no type checker, no program.

**Scan set:** every `src/**/*.ts` except `*.test.ts` / `*.spec.ts`, `src/lib/server/attic/**`, and `src/lib/server/db/schema.ts` (the definitions). Test helpers that are not `.test.ts` (e.g. `pipelines/testing/fixtures.ts`, `utils/testDb.ts`) ARE scanned. Say in the header that test files are out of scope (they build fixtures; product code is what the rule is about).

**Table references** (resolve syntactically, per file):
- a namespace import from a module whose specifier ends in `db/schema` (`import * as schema from "$lib/server/db/schema"`, any local name) → `ns.<table>`;
- named imports from that module (`import { lorebookBindings, characters as c } …`);
- a local `const X = <table ref>` and `alias(<table ref>, "…")` (drizzle-orm/pg-core) → X is that table.
The tables: `lorebookBindings`, `characters`, `characterVersions`, `castAmendments`.

### Guard 1 — one writer of three tables (`versionsWriter.guard.test.ts`)
- Fail on any call `<anything>.insert(<ref>)` where `<ref>` is `lorebookBindings`, `characters` or `characterVersions`, outside `src/lib/server/characters/versions.ts`.
- Also fail on a string/template literal containing `INSERT INTO` followed by `lorebook_bindings`, `characters` or `character_versions` (quoted or not, case-insensitive) outside that file.
- Allowlist `{ file, table, reason }[]`, checked both ways. **Leave it empty.** (Known today: `lorebooks/tableRegistry.ts` ~366 — the other worker is moving it into the versions module; your test must report it until that lands.)
- Add one positive control: the scanner, run on a small inline source string, finds `tx.insert(schema.characters)`, `db.insert(lb)` after `const lb = schema.lorebookBindings`, and a named-import `insert(characterVersions)`; and finds nothing in `tx.insert(schema.lorebookEntries)`.

### Guard 2 — frozen columns (`frozenColumns.guard.test.ts`)
Allowed modules (never flagged): `src/lib/server/characters/versions.ts` (the versions module), `src/lib/server/characters/versionsLift.ts` (the lift), the attic (already out of the scan set).

Frozen sets (drizzle property names):
- `lorebookBindings` **frozen**: `description, personality, scenario, firstMessage, alternateGreetings, exampleDialogues, faceMediaId, retold, ownName, ownNickname, timbre, spriteSet, nodeState, nodeVisibility` — any read or write is a finding. (`id, lorebookId, characterId, binding, name, aliases, absorbedAliases, summary, sceneId, historyEntryId, parentNodeId, overlayOf`, embeddings, timestamps are live, never flagged.)
- `castAmendments`: any **write** — `.insert(ref)` or `.update(ref)` — is a finding. Reads and deletes are not.
- `characters` **frozen content**: `aliases, summary, personality, scenario, firstMessage, alternateGreetings, exampleDialogues, groupOnlyGreetings, postHistoryInstructions, creatorNotes, creatorNotesMultilingual, strokes, extensions, characterVersion` — any read or write is a finding.
- `characters` **⏳ copies**: `name, nickname, avatarMediaId, description` — a **write** anywhere is a finding; a **read** is a finding only in a **session-path** file: `src/lib/server/{pipelines,sessions,state,speech,sprites,messages,rulesets}/**` and the files `src/lib/server/sockets/{sessions,state,pipelines,jump}.ts`.
- Everything else on `characters` (id, uuid, userId, isDeleted, isPersona, isDefaultPersona, folderId, lorebookId, category, creator, source, metadata, isFavorite, embeddings, timestamps, …) is never flagged.

What counts:
- **read**: a property access `<table ref>.<col>` (in `select({...})`, `where`, `orderBy`, `sql` interpolations — anywhere) that is not a write key; a key `<col>: true` inside the top-level `columns: {…}` of a `<x>.query.<table>.findFirst/findMany({...})` call.
- **write**: a key of the object literal passed to `.set({...})` in a chain that started with `.update(<table ref>)`; a key of `.values({...})` after `.insert(<table ref>)` (guard 2 still reports it — e.g. castAmendments); a key in `onConflictDoUpdate({ set: {...} })` on such an insert.
- **raw SQL**: a string/template literal containing `lorebook_bindings.<snake col>` or `"lorebook_bindings"."<snake col>"` for a frozen binding column, or the same for `characters` frozen/copies, by the rules above. (Don't match bare snake names — `character_versions` has the same column names.)
- Spreads (`...row`), whole-row selects and relational `with:` are **not** detectable as columns; say so in the header.

Each finding: `{ file (repo-relative POSIX), line, table, column, kind: "read" | "write" }`. The allowlist is `{ file, table, column, kind, reason }[]` (no line, so edits don't break it), checked **both ways**. Pre-ruled entries you may add now, **only after confirming the site reads nothing else frozen there**, each with its reason quoted:
- the provided mark is ownership metadata on `characters.extensions` (lead disposition 2026-11-05, cv-writers): reads of `characters.extensions` in `plugins/providedBooks.ts`, `plugins/providedPrimers.ts`, `sockets/appletLibrary.ts` that exist to read or match `extensions.serenepub.provided` — check each; one that reads something else from extensions (timbre, likeness…) is a finding, not an entry;
- `plugins/providedBooks.ts` `castHashNow` reads `characters.characterVersion` "so installed books' stored hashes stay stable; switching to the version label would flag every installed book as kept edited" (a test pins it).
Everything else stays a finding.

**Census (report only, not a failure):** in the session-path set, list each **whole-row read** of `characters`: `select()` with no projection `.from(<characters ref>)`, `query.characters.findFirst/findMany` with no `columns`, and a relational `with: { character: true | {…without columns} }`. Print the census with `console.info` from one `test` (never failing) so it shows in the run, and put it in your report.

Positive controls in guard 2: an inline source string where `schema.lorebookBindings.retold` (read), `.update(schema.characters).set({ personality: "x" })` (write), `.insert(schema.castAmendments)` (write), and `characters.name` in a session-path file name (read) are found; `schema.lorebookBindings.name` and `characters.name` in a non-session file are not.

## Done means
- Both files exist, type-check (`npx tsc --noEmit -p .` shows no errors in them — other lanes' errors elsewhere may exist; report only yours), prettier-clean (`npx prettier --check <file>`).
- Run: `npx vitest run src/lib/server/characters/versionsWriter.guard.test.ts src/lib/server/characters/frozenColumns.guard.test.ts` (unit tests; no DB). Never pipe vitest into `head`. The controls pass; the guards fail with the findings.
- Report: the run's result; **every finding grouped by file** (`file:line table.column kind`), the census, the allowlist entries you added with the line of code that justified each, and how long each test takes.
