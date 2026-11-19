# BRIEF — worker `kn-4b-w2` — bind `core:outlet/note-entry-knowledge@1` in the app

Supervisor: lane `kn-4b` (`plans/briefs/BRIEF-kn-4b.md`; you need not read it, everything is here).
App repo `/home/jody/github/serene-pub`. The SDK is already built with the outlet; do not edit the SDK.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You should not need `sdk:build` at all.)

Also: never `git checkout / restore / stash` in either repo; never `prettier --write`; never `pkill -f` a generic pattern; no migration; no `npm run build`, no full `npm test`.

## Goal

The SDK now declares (in `/home/jody/github/serene-pub-sdk/contracts/src/outlets.ts`, `noteEntryKnowledge`, read
its doc comment first) a write outlet by which a pipeline notes that **one cast member came to know one lorebook
entry** in play, or no longer does:

- id `core:outlet/note-entry-knowledge@1`, `effects: 'write'`, `review: { fields: [] }`, no `causesEvent`;
- in-ports `member` (`S.json`: `character:<cardId>`, `seated-member:<castMemberId>`, `player-seat:<seatId>`, or a
  cast member id number) and `entry` (`S.json`: an entry id, a write result, or a name);
- params `knowledgeKind` (enum `was_told` | `has_been_there`, default `was_told`) and `end` (boolean, default false);
- out-ports `main` and `tieId` (both `S.writeResult`).

Bind it and write its host commit, so it behaves exactly as below.

## Files owned (edit only these)

- `src/lib/server/lorebooks/entryKnowledge.ts` — **shared with live lane `kn-4a1`**: add new exports only, never
  reshape or rewrite existing functions; re-read the file right before every edit (it changes under you); small
  targeted `Edit`s, never `Write` of the whole file. kn-4a1 may add an optional `tx` parameter to
  `writeKnowledgeTie` / `endKnowledgeTie`; your calls must work with either shape (passing the transaction's
  `tx` as the first `db` argument works with both: the functions open `db.transaction`, which on a `tx` is a
  savepoint). If kn-4a1 has by then added a list of hand kinds / play kinds, reuse it instead of adding your own.
- `src/lib/server/pipelines/runtime/host.ts` — one new `case "core:outlet/note-entry-knowledge":` in the
  `commit()` switch, placed after the `core:outlet/link-lore-entries` case (~7189). Nothing else in host.ts.
- `src/lib/server/pipelines/runtime/host.loreWrites.ts` — the helper(s) the case needs, added to its `export {…}` list (~910).
- `src/lib/server/pipelines/runtime/bindings.outlets.ts` — one binding beside `core:outlet/link-lore-entries@1` (~916),
  `reads<typeof C.noteEntryKnowledge>(…, { ports: ["member", "entry"], params: ["knowledgeKind", "end"] })`, with a
  short doc comment, `ok(await ctx.commit(input))` as its siblings.
- `src/lib/server/pipelines/config/panel/flows.ts` — one line in `OUTLET_WRITES` (~147):
  `"core:outlet/note-entry-knowledge": "notes who knows a lore entry",`.
- Pinned tests that the new definition breaks (only where they pin it): `src/lib/server/pipelines/boot/registryHashes.test.ts`
  (re-pin with a `(was …)` note beside the changed value, as the file's own convention does),
  `src/lib/shared/conformance/wiring.test.ts` (if a conformance check demands a placement, excuse the outlet with
  the reason `"owner 2026-11-15: an SDK API no shipped pipeline places"`), `boot/declaredReads.test.ts`,
  `config/panel/flows.test.ts`, and any other test that enumerates every outlet. Say each one in the report.
- New test file `src/lib/server/pipelines/runtime/host.noteEntryKnowledge.int.test.ts`.

Not owned (do not edit): `lorebooks/ownBook.ts`, `lorebooks/imprints.ts`, `messages/writes.ts`, everything else.
If you find you need one of them, stop and say so in the report.

## Behaviour (the rules; each is from the lane brief's cold-review corrections, which rule)

1. **Session and genre.** No `scope.sessionId` → `HostScopeError` (as the link case words it). Then
   `const noLore = await loreWriteRefusal(db, sessionId)`; if set, throw `HostScopeError(\`${node.key}: ${noLore}\`)`
   — a genre whose lorebook is a reference writes no lore. Exactly as the link case does (host.ts ~7210).
2. **Who writes.** The person passed to `writeKnowledgeTie` / `endKnowledgeTie` is the **session's owner**
   (`sessions.user_id` of `scope.sessionId`), never `scope.userId` (which can be a member).
3. **Where it lands** — use `sessionLoreWriteTo(db, sessionId, turnMessageId)` (host.loreWrites.ts ~308), as the
   link case does:
   - route `book` (the session's lorebook, owned by the session's owner, lore write mode **Full**) → the tie is
     written to that lorebook, on the session's line: inside the transaction take
     `line = await forkedLoreLine(tx, sessionId, target)` and pass `branchId: line.branchId`,
     `historyEntryId: line.historyEntryId` to `writeKnowledgeTie`. Exception, as a link with a notes end does:
     when the member's binding or the entry exists only in the session's notes (`notesBesideBook` /
     `notesRowAnswering`, host.loreWrites.ts ~446 / ~480), the tie is written to the notes instead (as below).
   - route `own-book` (Review changes, Off, a lorebook someone else owns, or no lorebook) → the tie is written to
     the session's notes (`target.lorebookId`) with `branchId: target.line.branchId` (null) and
     `historyEntryId: target.line.historyEntryId`. `writeKnowledgeTie` already reaches the attached lorebook's
     members and entries from the notes book (entryKnowledge.ts ~457–465). It is **never applied** to the
     lorebook (Apply already excludes knowledge ties, `ownBook.ts` ~1598; do not change that). The result's
     `notes` carries the receipt sentence 🚧 *Kept in this session's notes: a tie noted in play is never applied
     to the lorebook.*
   Play never writes into a book the session's owner does not own.
4. **Member.** A number → `resolveCastMember` (`pipelines/runtime/castMember.ts` ~50; it refuses an overlay and a
   member outside the session's books). A string → `seatOf(db, sessionId, ref)` (`sessions/seats.ts` ~1989;
   handles `character:`, `seated-member:`, `player-seat:`), its `castMemberId`; no seat or no cast member → refuse
   with a sentence (reuse `resolveCastMember`'s for the non-`character` forms by calling it). Refusals are
   `HostScopeError(\`${node.key}: …\`)` (catch `CastMemberRefusal` as the update-cast-member case does, ~7171).
5. **Entry.** Resolve `p.entry` with `resolveLoreLinkEnd(tx, lorebookId, p.entry, node.key, reading, "link",
   undefined, line.alsoReads)` exactly as the link case resolves `from` (book route: the attached book and the
   forked line's reading; notes route: the notes and `target.line`, `alsoReads` the attached lorebook). A name
   nothing answers to, or two entries answer to, is refused by it.
6. **Precedence — refuse over the owner's hand.** Inside the transaction, before writing: if an **active hand
   tie** (`knowledge_kind` `knows` or `kept_from`, `status = 'active'`) exists from the member to the entry in
   any book the session reads (its lorebook and its notes, `BOOKS_READ` in entryKnowledge.ts ~233), write
   nothing and return `written: false` with the receipt note 🚧 *Not noted: the lorebook's owner set
   ‹Knows | Kept from› for ‹member name› and ‹entry name›.* (member name: `membersAsRead(…).shownName`, as
   `loadEntryKnowledge` does ~302; entry name: the resolved row's name; fall back to `cast member <id>` /
   `entry <id>`). Never end or change a hand tie. (Why: today the later date wins and a dated tie beats an
   undated hand tie, entryKnowledge.ts 155–170; that is DISCUSS-LATER D39 and is not changed here.)
7. **Once.** If a live play tie of the **same kind** for the pair already exists and reads on the session's line
   (in the notes: always; in the lorebook: `rowReadsOnLine(row, line)` without date, `shared/lorebooks/lineReading.ts`
   ~365), write nothing and return `{ id, tieId: id, …, written: false }` with that tie's id. Cast→entry rows have
   no unique index and `writeKnowledgeTie` always inserts, so this check is yours.
8. **End (`end: true`).** End play's live ties (both play kinds) for the pair with `endKnowledgeTie`, but only
   the ones this session may end: ties in the session's notes, and — on the `book` route only — ties in the
   lorebook whose `branch_id` is the session's own line (`line.branchId`, non-null). Any other live play tie for
   the pair stays, and the receipt says 🚧 *‹n› tie(s) noted elsewhere stay: a session ends only the ties on its
   own line or in its notes.* Hand ties are never ended. Return `written: false` when nothing was ended.
9. **Taken back with the reply.** Imprint inside the same transaction, as the link case does (host.ts ~7230–7290):
   `turnAnchor = await imprintAnchor(sessionId)` (read before the transaction); `anchor = turnAnchor ??
   linkAnchorOf(sessionId, null, target)` (for a notes write; on the book route a press with no turn files no
   imprint). A written tie: `imprintMade(tx, anchor, { lorebookId: tieBook, subject: "relationship", subjectId:
   tieId })` — Back / a swipe then deletes the row (`lorebooks/imprints.ts` ~366–385, ~554–572). An ended tie:
   `imprintField(tx, anchor, { lorebookId, subject: "relationship", subjectId: id, field: "status" }, "active",
   "resolved")` — Back restores it. No run artifact is recorded (`record(...)`): `update-cast-member` keeps none,
   and adding a kind to `RunArtifact` would be a new name.
10. **One transaction.** All of steps 4–9's reads and writes that touch rows run inside one `db.transaction(async
    (tx) => …)` that also takes `pg_advisory_xact_lock` on the target book as the link case does. **Inside it use
    only `tx`** — the outer `db` deadlocks PGlite silently (`db/transactionGuard.ts` throws in tests). Pass `tx` as
    the handle to every helper and to `writeKnowledgeTie` / `endKnowledgeTie`. After the write,
    `lorebookReads.clear()` (the host's per-run read cache; the update-cast-member case does it) so a later read
    in the same run sees the tie.
11. **Result.** Written: `{ id: tieId, tieId, lorebookId, route: "book" | "own-book", notes? }`. Check how the
    executor fills the out-port `tieId` from the result (compare `create-lore-entry`'s `entryId`, ~7150) and make
    `tieId` reach its port. Writer errors from `writeKnowledgeTie` (`That cast member is not in this lorebook.`,
    `That entry is not in this lorebook.`) become `HostScopeError(\`${node.key}: …\`)`.

Lookup helper in `entryKnowledge.ts` (new export, read-only, takes its handle, no static import of `$lib/server/db`,
the file's convention): e.g. `knowledgeTiesOfPair(db, { sessionId, castMemberId, entryId })` → every **active**
knowledge tie (any kind) from the member to the entry in the books the session reads, each
`{ id, kind, lorebookId, branchId, inNotes }` (`inNotes`: the row's lorebook is this session's notes). The host
partitions hand vs play from it. Add a one-line doc comment with 🚧. If you add names beyond that one function,
list them in the report (they are new names: keep them non-exported where you can).

## Tests — `host.noteEntryKnowledge.int.test.ts` (new)

Model the setup on the existing ones: `pipelines/runtime/host.ownBookFull.int.test.ts`,
`host.ownBookRoute.int.test.ts`, `state/ownBookRoute.undo.int.test.ts` (Back / swipe retraction),
`pipelines/runtime/bindings.entryKnowledge.int.test.ts` and `bindings.entryKnowledge.reads.int.test.ts` (marks,
ties, `loadEntryKnowledge`). Any `it` that opens a DB gets a 60 s timeout. Cases:

1. Full, own lorebook, `was_told`: the tie lands in the lorebook on the session's line, dated, `tieId` returned;
   with the entry marked not common knowledge, `loadEntryKnowledge` for that member no longer leaves it out.
2. Same with `has_been_there`.
3. A repeat of 1 → `written: false`, same id, one row.
4. `end: true` ends play's tie (status `resolved`); a hand `knows` tie on the same pair (another member or the
   same entry) is untouched.
5. A hand `kept_from` (and separately `knows`) tie exists → `written: false`, the receipt note, no row written,
   the hand tie unchanged.
6. Review changes (not Full) → the tie is in the session's notes, the lorebook has none; the judge reads it.
7. A lorebook someone else owns → notes.
8. An entry outside the books the session reads, and a member outside → refused (the run halts with the sentence).
9. A reference-lorebook genre (`writes.lore` refuses) → refused.
10. Back removes a written tie with the reply (book route and notes route); a swipe removes it too (one case
    is enough if the swipe goes through the same retraction).
11. Back after `end: true` restores the ended tie to `active`.

Pins: run `boot/registryHashes.test.ts`, `shared/conformance/wiring.test.ts`, `boot/declaredReads.test.ts`,
`config/panel/flows.test.ts`, `boot/specHashes.test.ts`, `runtime/receipts.int.test.ts`; fix only what the new
outlet breaks.

## How to run tests

Before each run wait for other lanes' vitest: `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`,
then start immediately. Only ever as:
`cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/kn-4b-w2-<n>.log 2>&1"`
Never pipe vitest into `head`. At the end, once: `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .`
(report the count of errors in your files; others' errors are not yours). `npx prettier --check` your files.

## Stop and ask (in the report) when

A rule above cannot be met without editing a file you do not own, a migration, or a new visible behaviour; the
retraction does not remove a tie; a hand tie would have to be ended or overwritten; you would add a name not listed
here.

## Report (your final message)

Changed files; the commit case's structure in 5 lines; tests run with pass counts and log paths; pins re-pinned
(old → new); any copy you wrote (mark 🚧); anything you could not do; **Noticed, not done**. Under 500 words.
