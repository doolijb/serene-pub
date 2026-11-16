# BRIEF — `time-t5a` worker 1 — the one writer of a dated entry version

Repo `/home/jody/github/serene-pub`. First read `plans/briefs/BRIEF-time-t5a-rules.md` (the rules, rulings,
words and how to run tests); it is part of this brief.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## Goal

Today the person's create of a dated version (`amendmentsCreateHandler`, `src/lib/server/sockets/amendments.ts`
~1694–1805) merges or inserts inline. A session's pipeline write will soon write the same rows. P2: one writer.
Build it, move the person's create onto it, change no behaviour.

## Build

1. **New file `src/lib/server/lorebooks/entryVersions.ts`** (a leaf module: never statically import
   `$lib/server/db`; every function takes its handle; inside a transaction it is the caller's `tx`). Header
   comment: what it owns (the write of an entry's dated version on a line, and the two checks every such write
   makes) and what it does not (held changes in a session's notes are `host.ts`'s and `ownBook.ts`'s; the
   per-turn record and the edit history are the caller's to file).
   - Move `assertAtOrAfterBeginning` (amendments.ts ~1626–1657) here, split in two, both exported:
     `beginningRefusal(tx, lorebookId, entryId, change: StoryDate): Promise<string | null>` (the sentence, or
     null) and `assertAtOrAfterBeginning(...)` that throws `new Error(sentence)`. **The sentence stays
     byte-identical.** Same skips (no entry, a type that does not `takesBeginning`, no numeric year).
   - Move `ownChangeAt` (~1659–1692) here, exported, unchanged (held rows, `base` set, never count; highest id
     answers; `exceptId`).
   - New exported `writeEntryVersion(tx, input)`:
     ```ts
     input: { lorebookId: number; entryId: number; branchId: number | null; date: StoryDate;
              fields: Record<string, unknown>; historyEntryId?: number | null }
     returns: { kind: "made"; id: number; after: Record<string, unknown> }
            | { kind: "merged"; id: number; before: Record<string, unknown>; after: Record<string, unknown> }
     ```
     In order: `select pg_advisory_xact_lock(${lorebookId})` (re-entrant: a caller that already holds it is
     fine); `assertAtOrAfterBeginning`; `ownChangeAt(tx, { entryId, branchId, date })`; when found, merge
     exactly as the handler does today (`after = { ...before, ...fields }`, `historyEntryId: historyEntryId ??
     taken.historyEntryId`, `updatedAt: new Date()`), else insert `{ lorebookId, entryId, branchId, year,
     month, day, fields, historyEntryId: historyEntryId ?? null }` returning the id. It writes no
     `lore_imprints` and no `lore_redlines` row: the caller files those.
2. **`sockets/amendments.ts`**: the entry branch of the create handler calls `writeEntryVersion` inside its
   existing `writeDated` transaction (keep `lockBookCalendar`, `assertDateLands`, `assertOverlayAnchor` where they
   are; `assertAtOrAfterBeginning` now runs inside the writer). On `merged` record the edit-history row exactly as
   today (`cause: "save"`, `by: { userId }`, `keys` = the union of before and after keys, `amendmentId`); on
   `made` record nothing (as today). `updateAmendment`'s re-date uses the moved `assertAtOrAfterBeginning` and
   `ownChangeAt` by import. Delete the local copies; drop imports that become unused. Nothing else in this file
   changes.

Do not touch any other file. `host.ts`, `ownBook.ts`, `imprints.ts`, `redlines.ts` are other workers'.

## Tests

- New `src/lib/server/lorebooks/entryVersions.int.test.ts` (fixtures: copy the pattern of
  `src/lib/server/sockets/amendments.oneVersion.int.test.ts` / `amendments.beginning.int.test.ts` — a test DB
  through `vi.mock("$lib/server/db", …createTestDb)`, a user, a lorebook, entries inserted directly; no hardcoded
  ids). Cases: a first write makes a row and returns `made`; a second write at the same entry, line and date
  returns `merged` with `before` (the earlier fields) and `after` (other keys kept, named keys replaced), and
  still one row; another date, or another line, makes a second row; a held row (`base` set, any book) at that
  date is never merged into; a date before the entry's Beginning throws the exact sentence and
  `beginningRefusal` returns it; the Beginning's own day is allowed; a History entry is not judged; old data with
  two rows at one date: the higher id is merged into; `historyEntryId` given on a merge replaces, absent keeps.
- Re-run unchanged: `src/lib/server/sockets/amendments.oneVersion.int.test.ts`,
  `amendments.beginning.int.test.ts`, `amendments.redlines.int.test.ts`, `amendments.int.test.ts`,
  `amendments.anchor.int.test.ts`. All must pass with no edit to them.
- `npx prettier --check` on your two source files (report pre-existing failures, do not fix them).

Report per the rules file.
