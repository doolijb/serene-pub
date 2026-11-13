# BRIEF — lane `s4-bk-lock` (wave 0) — no swapping books + cast-name push gaps

Read `plans/briefs/BRIEF-s4-common.md` first, then plan §34.0, §34.3 and the 2026-11-08 rulings.

## Goal

1. **A session keeps the lorebook it started with** (★27-10 + ★B-5 "fixed at start"). `bookChangeRefusal` (`src/lib/server/sessions/bookLock.ts:62`) becomes unconditional: any `lorebookId` different from the stored one is refused, before or after play; the **same** value is accepted (old clients post every field). Keep `playHasWritten` only if another reader uses it.
2. **Close every path that changes `sessions.lorebook_id` after create**, except surfacing (`shareAsLorebook`, kept) and the ones listed under Out of scope:
   - `sessions:update` (`sockets/sessions.ts` ~6267–6350 checks, ~6542 write, ~6556 `ownBookFor` resync) — refused through `bookChangeRefusal`.
   - `sessions:setLorebook` (`sockets/summarize.ts:508-600`) and its client door `attachLorebookToSession.ts` — removed, with their UI: LorebooksWorkspace "Read into this session" / "Stop reading" + the replace dialog (~1868–1894); LorebookActions create-and-read-in (~432).
   - SummarizeLoreModal (~761–775) attach-existing / create-and-attach: the summary writes into **the book the session already reads** (its own book or overlay). If that isn't a small change, stop and ask with a recommendation.
   - Library `attach-lorebook` op (`library/writes.ts:473-506` → `setSessionBook` :314, undo/redo :579, :637): route through `bookChangeRefusal` now, so a different book is refused in words. **Do not remove the op or the SDK outlet** — lane f-sdk removes both in wave 1.
3. **Edit form:** the Lorebook `Select` (`EditSessionForm.svelte` ~2396–2441) becomes a read-only line. Words (§34.3, ruled with ★B-2's batch):
   - own book: _"This session's lorebook is its own notes, and a session keeps the lorebook it started with. Share them as a lorebook to build on them in other sessions."_
   - overlay: _"This session reads ‹book name› and keeps it. Share its notes to ‹book name›."_ (no merge sentence — fold arrives in wave 6)
   - refusal (server, old clients, Guide): _"A session keeps the lorebook it started with."_
4. **Stale copy:** `SHARE_REFUSALS.noBook` (`shared/lorebooks/sessionNotes.ts:42`), EditSessionForm "With no lorebook" (~2492), the `bookLock.ts` header (1–19) and any comment promising a switch before play. Never frame a session as having no lorebook.
5. **Cast-name push gaps** (`plans/REPORT-cast-push-2026-11-06.md` Noticed): `amendments:place` / `amendments:unplace` (`sockets/amendments.ts` ~2330 / ~2401) call `tellMemberSessions(io, db, lorebookId, castId)` (`sessions/memberSessions.ts`); `deleteBranch` (~2052) → `pushSessionToParticipants` per moved session beside `announceSessionsMoved` (~2281). Fork needs nothing.
6. **Docs:** `docs/lorebooks.md` §"Reading a book into a session" (~174–176) and `docs/sessions.md` — a session keeps the book it started with; how to build on its notes (Share as a lorebook). NOMENCLATURE §25 rows for the retired event/door and the lock's new meaning (you hold NOMENCLATURE.md in wave 0; lane s4-ner queues one row to you — merge it from their report if they finish first, else leave it for the lead).

## Files owned

Server: `src/lib/server/sessions/bookLock.ts`, `src/lib/server/sockets/sessions.ts` (only the update handler's book checks and the stale copy), `src/lib/server/sockets/summarize.ts`, `src/lib/server/library/writes.ts` (the attach op's refusal only), `src/lib/server/sockets/amendments.ts` (push lines only), `src/lib/shared/lorebooks/sessionNotes.ts`, `src/lib/shared/sockets/types.ts` (removed event types only).
Client: `EditSessionForm.svelte`, `LorebooksWorkspace.svelte`, `LorebookActions.svelte`, `SummarizeLoreModal.svelte`, `attachLorebookToSession.ts` (delete), and any client file whose only use was the removed door.
Docs/canon: `docs/lorebooks.md`, `docs/sessions.md`, `NOMENCLATURE.md`.
Tests next to all of the above.

## Out of scope (never build here)

- Removing `cloneWithChanges` and its menu items — lane bk-fold, wave 6, together with fold.
- Next chapter's surfaced-book reading (★B-3) — wave 6.
- The SDK outlet `core:outlet/attach-lorebook@1`, `host.ts` / `flows.ts` / `receipts.ts` / `announce.ts` mentions — lane f-sdk, wave 1.
- Anything in `seats.ts`, `state/**`, the key flip.

## Stop and ask when

Common brief's Decisions apply; a removed UI leaves a feature with nowhere to go (e.g. summarize-into-lorebook); a test proves a live flow depends on swapping (Guide/applet starts, imports, branch).

## Done means

- Int tests: `sessions:update` refuses a different `lorebookId` before play and after, accepts the same id; the library attach op refuses a different book in words; `sessions:setLorebook` is gone (a client emit gets no handler); place/unplace/deleteBranch push `castNames` (extend `lorebooks.memberSessionPush.int` or its neighbour).
- DOM tests: the edit form shows the read-only line (both book kinds), and the lorebook workspace has no Read into / Stop reading.
- Every existing test file that referenced the removed door/event updated or deleted with a reason.
- tsc + check: no new errors vs baseline.

## Report

`plans/REPORT-s4-bk-lock-2026-11-08.md`.
