# BRIEF — worker `time-t6c2-w1` (app, data + the deciding module) — the *not common knowledge* mark and knowledge ties

Supervisor: lane `time-t6c2`. App repo `/home/jody/github/serene-pub`. SDK repo `/home/jody/github/serene-pub-sdk`
(you do not edit it). Another session shares both checkouts: touch only the files below.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: **do not run `sdk:build` or `sdk:test`.** Never `prettier --write`. Never `git checkout / restore / stash` in either
repo. Never `kill -9`. Never pipe vitest into `head`/`tail` (the SIGPIPE leaks PGlite temp dirs). Run tests **only** in
this capped form, one run at a time, writing to a log you then Read:

```
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t6c2-w1.log 2>&1"
```

An int test that opens a DB inside an `it` takes a 60 s timeout. Comments state the rule, not the story (no "lane",
"2026-…", "was", "now" narration). No other product's name in any file.

## Owner rulings this serves (quoted; do not change them)

- 2026-11-14: "**Knowing a particular entry is a tie** between the cast member and the entry (*has been there*, *was
  told*, *knows*; *kept from* for the opposite). An entry marked **not common knowledge** is read only by those tied
  to it." ★2: "A tie to an entry counts as knowing it (so *has been there* is enough, and nothing is said twice)".
  ★3: every entry is common knowledge unless marked; no entry type starts marked.
- Plan §5 rule 5: "Knowledge ties are a kind of their own, left out of the relationship graph, tie ranking and the
  ties in the prompt." Rule 6: "A filter always shows its cause: *not known by ‹name›*". Rule 8: the
  not-common-knowledge marks are the lorebook owner's alone.
- 2026-11-14: "Unknown content is left out of the prompt; the model is never told what a character does not know."
  ★6: a narrator, an envoy and a step writing for several characters read everything.
- Standing: "0.6 is in users' hands" — a change to stored data ships with a forward migration and a test that a
  second boot changes nothing. P2: one module owns its data and every write to it.
- CLAUDE.md hard rules: migrations are **generated** (`npm run db:generate`); never seed a row at a hardcoded id;
  inside `db.transaction(async (tx) => …)` use only `tx` (the outer `db` deadlocks PGlite silently); never add a
  top-level `await` to `src/lib/server/db/index.ts`.

## The rule (the module implements exactly this)

1. **The mark** is one stored boolean on the entry. Unmarked = common knowledge = today's behaviour. Not per
   version, not per line; the edit history does not record it.
2. **Knowing:** the speaker knows an entry when **any** row of `narrative_relationships` with `status = 'active'`
   runs **from** the speaker's cast binding (`from_node_id` = the speaker's cast member id, a `lorebook_bindings.id`)
   **to** that entry (`to_entry_id`), reads on the reply's line at the reply's date, and is **not** a *kept from*
   row. An ordinary tie that exists today (`knowledge_kind` NULL, "member of → The Guild") counts.
3. **A knowledge tie** is such a cast→entry row with a non-NULL `knowledge_kind`: `was_told`, `knows`,
   `has_been_there` (knowing) or `kept_from` (the opposite).
4. **Dating.** A row's date is its `history_entry_id`'s date only (the history entry's `fields.year/month/day`, as
   `historyEntryDate` in `src/lib/server/state/reading.ts` ~454 reads them; `scene_id` plays no part). Undated
   (NULL, or a history entry with no date) counts as earliest and is never cut by a fork. A row of the attached
   lorebook reads when `rowReadsOnLine(row, reading.line, date, reading.moment)`
   (`src/lib/shared/lorebooks/lineReading.ts` ~365) is true. A row of the session's **notes** (own book, when an
   attached lorebook also exists) is the session's own: its branch is not judged; it reads unless dated after the
   reading's moment. When the session has no attached book, the reading **is** the own book's: judge its rows with
   `rowReadsOnLine` like any other.
   **Which row wins** for one entry, among the rows that read: the later date (undated earliest); same date, the
   row on the nearer line (a notes row is nearest; then the index of the row's step in `reading.line.steps`, the
   line itself first); then *kept from*. With the lorebook's Timeline off (`reading.timelineOff`), dates play no
   part (treat every row as undated, no moment cut) and only `status` ends a row; lines still apply.
5. **Left out**, for a reply spoken by one cast member on its own turn: an entry when (a) it is marked and the
   winning row is not a knowing row (no row at all, or *kept from* wins), or (b) a *kept from* row wins for it
   (marked or not). Causes: `not-known` for (a) without a winning kept-from row, `kept-from` otherwise.
6. **Every lorebook the session reads** is judged: the attached lorebook and the session's notes (own book),
   exactly the two `lorebooksReadBy` (`src/lib/server/lorebooks/ownBook.ts` ~325) returns. Ties kept in the notes
   count (a notes row's `from_node_id` may name a binding of the attached book, and its `to_entry_id` an entry of
   the attached book: see `rulesets/read.ts` ~516–590 for how notes rows are read).
7. A narrator's turn, an envoy's, a step writing for several characters (no speaker, or a speaker that resolves to
   no seat with a cast member: `seatOf` in `src/lib/server/sessions/seats.ts` ~1989 never returns an envoy) read
   everything.

## Files owned (only these)

1. **`src/lib/shared/lorebooks/knowledgeKinds.ts`** (new, a leaf: imports nothing from `$lib/server`):
   `export const KNOWLEDGE_KINDS = ["was_told", "knows", "has_been_there", "kept_from"] as const`,
   `export type KnowledgeKind`, `KNOWING_KINDS` (the first three), `isKnowledgeKind(v): v is KnowledgeKind`. One
   JSDoc line each.
2. **`src/lib/server/db/schema.ts`** — two columns and one CHECK, nothing else:
   - `lorebookEntries` (~8940–9060, beside `decayRate` ~9024): `notCommonKnowledge: boolean("not_common_knowledge")
     .notNull().default(false)`, with a JSDoc: what it means, that unmarked is common knowledge, that its only
     writer is `lorebooks/entryKnowledge.ts` (owner only), that it is not per version or per line and the edit
     history does not record it.
   - `narrativeRelationships` (~5182–5375): `knowledgeKind: text("knowledge_kind").$type<KnowledgeKind>()`
     (nullable, no default), placed after `reverseRelationshipType`, with a JSDoc: NULL for every ordinary row;
     set only on a cast→entry row; such a row is a **knowledge tie**, left out of the relationship graph, tie
     ranking, the ties in a prompt, the link hop, lore links, the Timeline, embeddings and ruleset ties, and
     carried by export / import / copies; its only writer is `lorebooks/entryKnowledge.ts`.
   - One CHECK in the table's array: `narrative_relationships_knowledge_check`:
     `${t.knowledgeKind} IS NULL OR (${t.knowledgeKind} IN ('was_told','knows','has_been_there','kept_from') AND
     ${t.fromNodeId} IS NOT NULL AND ${t.toEntryId} IS NOT NULL AND ${t.reverseRelationshipType} IS NULL)`, with a
     one-line comment. Do not touch any other constraint.
3. **The migration**: run `cd /home/jody/github/serene-pub && npm run db:generate -- --name entry_knowledge`
   exactly once, after the schema edit. Expected: `drizzle/0167_entry_knowledge.sql`,
   `drizzle/meta/0167_snapshot.json`, one new `_journal.json` entry with `idx` 167. **Then Read the SQL.** It must
   contain only: `ALTER TABLE "lorebook_entries" ADD COLUMN "not_common_knowledge" boolean DEFAULT false NOT
   NULL`, `ALTER TABLE "narrative_relationships" ADD COLUMN "knowledge_kind" text`, and the `ADD CONSTRAINT …
   CHECK`. **If it contains anything else** (another session's pending schema change), or the index is not 0167,
   or the command prompts: stop, do not edit the SQL or the snapshot, and report exactly what it produced. Never
   hand-edit generated files.
4. **`src/lib/server/db/entryKnowledge0167.int.test.ts`** (new), in the style of
   `src/lib/server/db/messageFirsthandDrop0166.int.test.ts` (read it): migrate a PGlite through
   `0166_message_firsthand_drop` (`migrationsFolderThrough`), insert a user, a lorebook, two entries, a cast binding
   and one cast→entry and one entry→entry relationship with raw SQL, migrate to the real folder; assert every
   existing entry reads `not_common_knowledge = false`, every existing relationship `knowledge_kind IS NULL`, the
   rows are otherwise unchanged; columns and indexes match a fresh install; the CHECK refuses a knowledge kind on an
   entry→entry row and an unknown kind; and a second `migrate` changes nothing (ledger, rows, columns). Read the
   0166 test's helpers before writing raw INSERTs (required columns of `lorebooks`, `lorebook_entries`,
   `lorebook_bindings`; check `schema.ts`).
5. **`src/lib/server/lorebooks/entryKnowledge.ts`** (new) — the only owner of the decision and of the writes. A
   header JSDoc: *Purpose / Owns / Does not own* (P6), the rule above in short, "every function takes its handle;
   never statically imports `$lib/server/db`; inside a transaction, its `tx`". Exports:
   - Pure core:
     - `interface KnowledgeRowRead { id: number; entryId: number; kind: KnowledgeKind | null; branchId: number |
       null; date: StoryDate | null; inNotes: boolean }`
     - `type KnowledgeCause = "not-known" | "kept-from"`
     - `judgeEntryKnowledge(input: { markedEntryIds: Iterable<number>; rows: readonly KnowledgeRowRead[]; line: Line;
       moment: StoryDate | null; timelineOff: boolean; ownBookIsReading?: boolean }): { leftOut: Array<{ entryId:
       number; cause: KnowledgeCause }>; notKnown: number; keptFrom: number }` — rule 4 and 5, leftOut sorted by
       entryId; O(rows + marked) (group rows by entry once).
     - `knowledgeExclusionReason(cause, name)`: 🚧 `Not known by ${name}.` / `Kept from ${name}.`
     - `knowledgeReceipt(name, judged)`: 🚧 `No entries left out for ${name}` · `1 entry left out: not known by
       ${name}` · `${n} entries left out: not known by ${name}` · `1 entry left out: kept from ${name}` ·
       `${n} entries left out: kept from ${name}` · mixed: `${n} entries left out: ${a} not known by ${name}, ${b}
       kept from ${name}`.
     - `NOTHING_MARKED_RECEIPT` = 🚧 `No entries left out: nothing here is marked not common knowledge or kept from anyone`.
     - `KNOWLEDGE_SOURCES = ["worldLore", "characterLore", "history"] as const` — the candidate sources an entry
       reaches eligibility under (`history` also covers the vector index's `historyEntry`: eligibility aliases it,
       `pipelines/ranking/eligibility.ts` ~78–84), and `knowledgeExclusions(leftOut, name)` → one
       `{ source, id: entryId, reason }` per entry **per source** in that list.
   - Loader: `loadEntryKnowledge(db, { sessionId: number; speaker: unknown }): Promise<{ kind: "reads-all" } | {
     kind: "nothing-marked" } | { kind: "judged"; name: string; leftOut: …; notKnown: number; keptFrom: number }>`.
     Steps, in this order, so the cost stays small:
     1. `speaker` not a non-empty string → `reads-all` (no statement).
     2. **One** statement: the marked entry ids of the books the session reads **and** the entry ids of active
        `kept_from` rows in those books (any member), e.g. one `UNION ALL` with the books as a subselect
        (`sessions.lorebook_id` of the session, and `lorebooks.id where session_id = $session`). Both empty →
        `nothing-marked`.
     3. `seatOf(db, sessionId, speaker)`; no seat or `castMemberId` null → `reads-all`.
     4. **One** statement: the member's rows — `from_node_id = member`, `to_entry_id IS NOT NULL`,
        `status = 'active'`, `lorebook_id` in the books read — with `id, to_entry_id, knowledge_kind, branch_id,
        lorebook_id` and the history entry's `fields` (left join `lorebook_entries` on `history_entry_id`), so the
        date needs no further query. `inNotes` = the row's book is the own book while an attached book exists.
     5. The member's name: `membersAsRead(db, [member], { sessionId }).get(member)?.shownName`, trimmed, else
        `this character` (as `sessions/firsthandFilter.ts` ~424 does).
     6. Only when the member has rows: `sessionReadingOf(db, sessionId)` (`state/reading.ts` ~331) for `line`,
        `moment`, `timelineOff`, `onOwnBook`. With no rows, every marked entry is `not-known` and no reading is
        needed. A null reading: judge with `MAIN_LINE`, moment null.
     7. `judgeEntryKnowledge` → `judged`.
     Read-only; never inside a transaction with the outer `db`.
   - Writers (the only ones), each in `db.transaction(async (tx) => …)` using only `tx`, each refusing with a
     sentence (throw `Error` with it) unless the user owns the book (`findOwnedBook`, `src/lib/server/utils/ownedBook.ts`
     ~36):
     - `setEntryCommonKnowledge(db, { userId, entryId, notCommonKnowledge: boolean })` → sets the column on that
       entry (its book must be the user's). 🚧 refusal: `Only the lorebook's owner can mark what is common knowledge.`
     - `writeKnowledgeTie(db, { userId, lorebookId, castMemberId, entryId, kind: KnowledgeKind, historyEntryId?:
       number | null, branchId?: number | null })` → the new row's id. The binding and the entry must belong to
       `lorebookId`, or, when `lorebookId` is a session's notes (`lorebooks.session_id` set), to that session's
       attached lorebook. Sets `knowledge_kind = kind`, `relationship_type = kind`, `status = 'active'`, everything
       else default. 🚧 refusal sentences of your own, short, plain.
     - `endKnowledgeTie(db, { userId, tieId })` → `status = 'ended'`; refuses a row whose `knowledge_kind` is NULL
       (🚧 `That is not a knowledge tie.`).
     No socket, no UI, no event.
6. **`src/lib/server/lorebooks/entryKnowledge.test.ts`** (new, pure) and
   **`src/lib/server/lorebooks/entryKnowledge.int.test.ts`** (new, PGlite; find an existing int-test helper that
   builds a session with a lorebook, cast and seats — e.g. what `src/lib/server/sessions/firsthandFilter.int.test.ts`
   uses — and reuse it). Cases (pure unless the case needs the DB):
   unmarked → nothing left out; marked and untied → left out `not-known`; an ordinary cast→entry tie (kind NULL)
   lets it in; each knowing kind lets it in; *kept from* leaves out an **unmarked** entry (`kept-from`); later date
   wins (knowing later than kept-from → in; kept-from later → out); same date, nearer line wins; same date and line
   → *kept from*; undated is earliest; Timeline off ignores dates (a kept-from row dated later on main does not beat a
   knowing row on the reading's own branch; and a row dated after the moment still counts); a tie on a line the reply does not read does not count; a
   tie dated after the reply's moment does not count; an ended tie does not count (int); a tie kept in the
   session's notes counts (int); narrator (`speaker` null / an envoy ref) → `reads-all` (int); nothing marked and no
   kept-from → `nothing-marked` with **exactly 1 statement** (int, count statements as
   `firsthandFilter.int.test.ts` ~200 `countStatements` does); report the statement count of a judged read with
   rows (int); writers refuse a non-owner, `writeKnowledgeTie` refuses a binding/entry of another book,
   `endKnowledgeTie` refuses an ordinary row; `knowledgeExclusions` spells every source.

## Files readable

Everything. Especially: `src/lib/shared/lorebooks/lineReading.ts`, `src/lib/server/state/reading.ts`,
`src/lib/server/lorebooks/ownBook.ts` (`lorebooksReadBy`), `src/lib/server/rulesets/read.ts` ~509–600,
`src/lib/server/sessions/firsthandFilter.ts` (+ its int test) as the module pattern,
`src/lib/server/utils/ownedBook.ts`, `src/lib/server/sessions/seats.ts` (`seatOf`).

## Out of scope

Any reader of the table other than your new module (another worker filters them); export/import; the SDK; the
pipeline binding; docs; NOMENCLATURE; any socket, UI, event or setting; the scene's place listing.

## Stop and ask when

CLAUDE.md §Decisions applies; the generated migration holds anything but the three statements or another index; a
CHECK would have to change; the CHECK constraints forbid a cast→entry knowledge row; a name you need is not listed
above (use a 🚧 name and list it in your report instead of stopping, if it is internal to `entryKnowledge.ts`).

## Done means

- `npx vitest run --maxWorkers=3 src/lib/server/db/entryKnowledge0167.int.test.ts src/lib/server/lorebooks/entryKnowledge.test.ts src/lib/server/lorebooks/entryKnowledge.int.test.ts` (capped form) all green.
- `cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` shows no error in your files (report any others, do not fix them).
- `npx prettier --check` on your files (report, do not `--write`).

## Report

Write it to `/home/jody/github/serene-pub/plans/briefs/REPORT-time-t6c2-w1.md`: files changed, the migration file
names and its SQL verbatim, every exported name, the sentences, the statement counts, tests run with results,
anything you decided, **Noticed, not done**. Delete only the `/tmp/serene-pub-vitest-*` dirs your runs made, by name.
