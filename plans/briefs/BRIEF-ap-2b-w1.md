# BRIEF — worker `ap-2b-w1` — a new session on a live provided lorebook starts on a copy in its notes, and the cast is seated from the copy

App repo `/home/jody/github/serene-pub`. Supervisor: lane `ap-2b`. SDK is read-only.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`: do not run one.)

The repo is staged by the lead: run **no git command that changes the index or the working tree** (`git diff` / `git status` to read are fine). Never run prettier with `--write` or pipe its output into a file. No migration, no boot pass, no rewrite of stored rows. No `npm run build`, no full test run.

## Owner rulings this work applies (quoted)

- 2026-11-17 AP2: "Let's just clone the starter lorebook instead on session start so we are never superimposing on something that can get deleted."
- 2026-11-05: "Plugins can only ship lorebooks as starters. They contain cast, not cards." Seating: "the session's book" = **the attached book, else its starter copy** (for every genre that declares `castFromLorebook`, primers and admin starters included).
- Standing: a session keeps the lorebook it started with (a next chapter and a branch keep reading it).

## Rules you must follow (from CLAUDE.md)

- Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently.
- Comments state the rule, never history (no "now", "used to", "was", "today", dates of change). `src/lib/shared/conformance/commentHistory.test.ts` checks it.
- No new user-facing sentence. Reuse the existing ones named below. No new setting, event, table or flag.
- New internal code names allowed in this brief only: `KitCopy.members`, `KitCopy.seated`, the `bookFromKit` option `seatCast`, the optional third parameter of `makeCopyCardless`, and renaming the private class `StartDateRefusal` to `CreateRefusal`. Anything else new: stop and ask in your report.

## Files owned (edit only these)

- `src/lib/server/lorebooks/starterKits.ts`
- `src/lib/server/sockets/sessions.shared.ts` (only `checkLorebookOwnership` and its comment)
- `src/lib/server/sockets/sessions.create.ts`
- New test file `src/lib/server/sockets/sessions.providedStart.int.test.ts`
- Existing test files that fail because of this change (re-pin only; see "Re-pins")

Readable: anything. Not yours (never edit): `sessions/seatBookCast.ts`, `sessions/seats.ts`, `plugins/providedBooks.ts`, `plugins/providedMarks.ts`, `lorebooks/foldInParent.ts`, client files, docs, NOMENCLATURE, `pipelines/**`, `sockets/sessions.ts`, `sockets/sessions.pipelines.ts`.

## Build

### A. `lorebooks/starterKits.ts`

1. **`resolveKit`** (lorebookId branch, ~162–176): the row is a kit when `sessionId IS NULL` and (`kind = 'starter_kit'` **or** `liveProvidedBookSql()` is true). `liveProvidedBookSql` is exported from `$lib/server/plugins/providedMarks` (already imported there for `isDisabledProvidedBook`, `markedBook`). `kitOfRow` keeps refusing a disabled provided row as unknown. Update the doc comment above `resolveKit` to the rule (a starter lorebook or a live provided lorebook of any book kind; a lorebook kept at uninstall is not live, so not a kit).
2. **`kitReadRefusal`** (~262–275): also select `provided: liveProvidedBookSql()`; refuse with the existing `kitIsNotReadSentence(row.name)` when `kind === STARTER_KIT_KIND` **or** `provided`. Update its comment to say a live provided lorebook of any kind is started from, never read.
3. **`KitCopy`** gains:
   - `members: IdMap` (import the type from `$lib/server/lorebooks/tableRegistry`): the kit row's member id → the copy's member id; an empty map for a primer with no row. Fill it from `duplicateLorebookRows(...).maps.bindings`.
   - `seated: number[]`: the copy's members the genre seats (only when `seatCast` was passed; else `[]`).
4. **`bookFromKit`** opts gains `seatCast?: { isAdmin: boolean; exclude: ReadonlySet<number>; excludeMembers: ReadonlySet<number> }` (`excludeMembers` are **the kit row's** member ids; map them through the member map). When given, call `bookCastToSeat` (`$lib/server/sessions/seatBookCast`, dynamic import) **on the copy, with `tx`**, `{ lorebookId: copyId, userId: opts.userId, isAdmin, exclude, excludeMembers: mapped }`, and put the result's `castMemberId`s in `seated`. Placement matters:
   - book source: after the `update(...).set(own…)` (the copy must already carry `sessionId`: `bookCastToSeat`'s access check reads the copy as the session's notes through `ownBookAccessFor`) and **before** `makeCopyCardless` (so `bookCastToSeat`'s persona-card and picked-card exclusions still see the copy's cards).
   - primer source: after `writePrimerInto`.
   Document the option in one comment line (what it is for: the genre's `castFromLorebook` seating reads the starter copy).
5. **`makeCopyCardless`**: export it, with an optional third parameter `members?: readonly number[]` — when given, only those members of `lorebookId` are made card-less and only their annotations are rewritten (the merge of a provided lorebook into a session's notes uses it; the notes hold other members too). Without it, behaviour is exactly as now. Keep it on `tx` only.

### B. `sockets/sessions.shared.ts` — `checkLorebookOwnership` (~119–142)

A live provided lorebook is never admitted as a new session's attached lorebook; only the session that already reads it keeps it (a next chapter passes the session it follows as `sessionId`). Shape:

```ts
const [book] = await db.select({ sessionId, kind, provided: liveProvidedBookSql() }).from(lorebooks).where(eq(id)).limit(1)
if (!book) return false
if (book.provided) {
  if (sessionId == null) return false
  // the session already reads it, and the provided-read rule still admits it
  const [reader] = select sessions.lorebookId where sessions.id = sessionId
  if (reader?.lorebookId !== lorebookId) return false
  if (!(await providedBooksReadableBy(db, userId, [lorebookId])).has(lorebookId)) return false
} else if (!(await findOwnedBook(db, userId, lorebookId))) return false
if (await isNewAttachOfDisabledBook(db, lorebookId, sessionId)) return false
return book.sessionId == null && book.kind === "book"
```

Rewrite its doc comment to the rule (drop the "Pub wide" paragraph and the ★M3-core-1 note only if they no longer describe the code; keep the starter-lorebook and session-notes rules). Its only caller is `sessions.create.ts`.

### C. `sockets/sessions.create.ts`

1. **Next chapter keeps its lorebook.** In the `next-chapter` block (~91–138) keep the followed lorebook id in a local (e.g. `followedLorebookId`). Skip `kitReadRefusal` when `creationMode === "next-chapter"` and `params.session.lorebookId === followedLorebookId`; pass `params.from` as `checkLorebookOwnership`'s third argument in that same case. Branch (~72–90) is unchanged.
2. **Picked members of the kit row.** In the `castMemberIds` check (~540–567): `const kitBookId = startKit?.source === "book" ? startKit.row.id : null`; the book the members must belong to is `kitBookId ?? (creationMode === "new-world" ? null : lorebookId ?? null)`. Update the comment (the kit row's members are copied into the notes and mapped there). `sameMemberRefusal` (~529–536) gets `lorebookId: kitBookId ?? sessionDataWithoutTags.lorebookId ?? null`.
3. **The genre's switch, read once.** Compute whether `castFromLorebook` seats (the existing `on` logic at ~494–500, the switch field or always) once, before both uses. The attached-book path (`lorebookId != null`) is unchanged.
4. **Seat from the copy.** When `startKit` and the switch is on, pass `seatCast: { isAdmin: !!socket.user!.isAdmin, exclude: new Set([...characterIds, ...personaIds]), excludeMembers: new Set(castMemberIds) }` to `bookFromKit` inside the create transaction. Right after it, inside the same transaction, when `kitCopy.seated.length > 0`: run `shapeViolations(flooredShape, { characters: characterIds.length + castMemberIds.length + seated.length, personas: personaIds.length, hasLorebook: true })` and on a violation throw the transaction's refusal with the existing words `This session does not fit '${genreName}': ${violations.join("; ")}.` so nothing is made; and when the total seats exceed 1 and the row is not yet a group, update `sessions.is_group` to true (and the returned row). Rename the private class `StartDateRefusal` to `CreateRefusal` (comment: the create transaction's refusal, thrown to roll back, returned as `refuse`); its existing date use stays.
5. **Seating.** After the transaction: for a kit start the seated cast is `kitCopy.seated` as `{ castMemberId, cardId: null }`, and the picked `castMemberIds` are seated as `kitCopy.members.get(id) ?? id` (keep `castMemberIds` itself for counts; use a separate local for the ids to seat). In the seats loop the `new-world` card branch (~959–977) applies only to a cast seated from the attached book, never from a kit copy.
6. Update the comment at ~490–492 to the rule: the book seats its cast, genre-declared: the attached book, else the starter copy.

## Tests

Find fixtures in: `src/lib/server/lorebooks/applyWritePredicate.int.test.ts` (a plugin's provided lorebook of kind `book`, live / disabled / kept at uninstall; a member and the enabling administrator), `src/lib/server/plugins/providedBooksPubWide.int.test.ts`, `src/lib/server/lorebooks/starterKits.cardless.int.test.ts` (`adminKit`, card-less checks), `src/lib/server/sockets/sessions.castFromLorebook.int.test.ts` (a fixture genre declaring `castFromLorebook`, persona member exclusion).

New `sessions.providedStart.int.test.ts` covers:
1. A member starts on a live provided lorebook of kind `book` sent as `starterKit: { lorebookId }`: `session.lorebookId` is null; the notes (`ownBookOf`) hold the copy (same entry and member names); the notes carry no `provided` mark; every notes member is card-less (`character_id` null); the provided lorebook's rows (its `lorebooks` row, entries, bindings) are byte-identical before and after; a second session makes its own copy (different notes id, its own members).
2. The same for a live provided lorebook of kind `starter_kit` (a primer row), briefly.
3. Forged: `sessions:create` with `session.lorebookId` = the provided lorebook (no `starterKit`) is refused with `kitIsNotReadSentence(name)` and makes nothing; `checkLorebookOwnership(providedId, userId)` is false for the member **and** for the enabling administrator; true for a member passing a session id that already reads it (live).
4. An existing session reading a provided lorebook (rows as today's code creates them: insert the `sessions` row with `lorebook_id` = the provided id and its own notes overlaying it, e.g. through `insertOwnBook` with `overlayOf`) — a `next-chapter` from it reads the same provided lorebook; a `branch` of it reads it too.
5. Seating, fixture genre with `castFromLorebook`: started on the provided lorebook of kind `book` seats **the copy's** members (every seat's `castMemberId` is a notes member, none is a provided-lorebook member), the persona member left out as on an attached book; a picked card-less member of the provided lorebook (`castMemberIds`) is accepted and its seat is the copy's member; a genre without the declaration seats nobody from it; an admin starter kit seats from its copy too.

### Re-pins

Run, after your change: `src/lib/server/sockets/sessions.castFromLorebook.int.test.ts`, `src/lib/server/sockets/sessions.seatCast.int.test.ts`, `src/lib/server/sockets/seatedBy.int.test.ts`, `src/lib/server/plugins/providedBooksPubWide.int.test.ts`, `src/lib/server/plugins/providedBooks.int.test.ts`, `src/lib/server/lorebooks/notesShown.realCreate.int.test.ts`, `src/lib/server/lorebooks/starterKits.int.test.ts`, `src/lib/server/lorebooks/starterKits.cardless.int.test.ts`, `src/lib/server/plugins/primerRowReadOnly.int.test.ts`, `src/lib/server/plugins/providedPrimers.int.test.ts`. A test that **attaches a live provided lorebook at `sessions:create`** now meets the new rule: re-pin it — if it is about starting, start through `starterKit` and assert on the copy; if it is about a session that reads a provided lorebook, build that session's rows directly (as in test 4). Never weaken an unrelated assertion. List every re-pin in your report as *test name: before → after*. A failure you cannot explain by this change: stop and report it, don't "fix" it.

## Done means

- Each test run as: first `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`, then
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/ap-2b-w1-<n>.log 2>&1"` (always at least one path; one run at a time; never pipe vitest into `head`). Read the log with `tail`/`grep`.
- Green: the new file and every file listed under Re-pins; also `src/lib/server/sockets/sessions.createNotesTimeline.int.test.ts` and `src/lib/server/sockets/sessions.rulesIncompatible.int.test.ts` (kit paths).
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` → report errors in your files (0 expected).
- `npx vitest run src/lib/shared/conformance/commentHistory.test.ts` (same wrapper) — no finding in your files.
- `npx prettier --check` on your changed files.

## Report

Write to `/home/jody/github/serene-pub/plans/ap-2b-w1-report.md`: changed files (with the functions touched), what the copy keeps (read `bookFromKit` and `duplicateLorebookRows`/`copyLorebookTables`: timeline switch, cast, covers, knowledge ties, sprites, places), tests run with pass counts and log paths, every re-pin (before → after), assumptions, **Noticed, not done**.
