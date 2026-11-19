# BRIEF — worker task `gs-2c-fix` — scope-review fixes to lane `gs-2c` (the notes closed to a guest)

Repo `/home/jody/github/serene-pub`. SDK not touched. Read first: `plans/REPORT-gs-2c-2026-11-17.md`.
Re-verify every file:line.

Owner, 2026-11-16: "A guest neither opens nor edits the notes"; "Guests can only see the session detail view,
and manage cast/cards they own."; "In another person's session an administrator is a guest". Enforce at the
server; every closed path gets a test on the serialised payload; the owner's path is shown unchanged.

Rules: both repos are staged by the lead: run no git command that changes the index or the working tree;
`npx prettier --check` only, **never `--write`**; no migration. Inside `db.transaction` only `tx`. Comments
state the rule, not the story. Do **not** edit `src/lib/server/sockets/sessions.overlay.ts` (its rule waits on
the owner). A worker task `gs-2d` is editing SDK shared widgets only (`../serene-pub-sdk/core-catalog/components/shared/`)
and will build the SDK: no overlap. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/gs-2c-fix-<n>.log 2>&1"`
(always pass at least one path: an empty path list starts the whole suite), after
`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`. `NODE_OPTIONS=--max-old-space-size=10240` for
`npx tsc --noEmit -p .`.

## Fixes

1. **`scenes:list` sends a guest only what the page shows.** `buildSceneList` (`src/lib/server/sockets/scenes.ts`
   233–237) drops only the embedding columns: every guest (the reply and the broadcast) gets each scene's full
   `summary` (even one waiting for the owner's review) and its `notes`, which the page never renders
   (`SceneDivider` shows a status; the host reduces the text to true / false: `liveSceneProjection.ts:117`,
   `scenesFlow.svelte.ts:354`). For a non-owner leave out `summary` and `notes` and send `hasSummary` (and
   whatever boolean the client already derives for notes), shaped per recipient in the broadcast the way
   message rows are (`messages/debugMeta.ts` / `broadcastToSessionUsers`: reuse the pattern, one owner lookup
   per broadcast). The client reads the boolean when the text is absent. Tests: guest's reply and push carry
   no summary or notes text; owner unchanged; the guest's page still shows the same status.
2. **A guest still manages the card they brought.** A guest's own card's cast member lives in the notes, and
   `canEditCastMember` (`src/lib/server/cast/memberAccess.ts:104`, via `findOwnedBook`) now refuses them, which
   blocks that member's sprites (`sockets/sprites.ts:175`), portrait (`sockets/portrait.ts:82`),
   `sockets/characters.ts:2519` and `sockets/images.ts:572`. The owner's rule is "manage cast/cards they own":
   `canEditCastMember` (and `canReadCastMember` if it has the same gap) also allows a caller when the member is
   **linked to a character card the caller owns and seated in a session the caller is in**: nothing else of
   the notes opens by this. Update the stale comments in `memberAccess.ts` (8–10, 44–46, 93–95: "members" of
   the notes may edit). Tests: a guest who brought their own card can read and edit that member's sprites and
   portrait; cannot touch another member of the notes, the owner's carded members, or a card-less member they
   merely play (unless that already worked through the seat rule: say what the seat rule gives today and keep
   it).
3. **Pin a guest's own sheet edit.** Add to `sockets/sessions.notesGuestAccess.int.test.ts` a `state:set` by a
   guest on the sheet of a notes member linked to a card the guest owns: it lands (as before the lane).
4. **Administrators do not receive other people's scene-summary drafts.** `activityStore.getFor`
   (`src/lib/server/utils/activityStore.ts` 386–388) sends every activity to every administrator, including a
   `scene_summarize` activity's `pendingResult.content` and `raw` (the draft text for someone else's notes;
   `app.d.ts` 603–611), and `navigateToScene` (`ActivitySidebar.svelte` 268–280) opens it with no owner check
   (unlike `navigateToIndexedBook` 248–249). Strip `pendingResult` from an administrator's copy of an activity
   they do not own (they still see that the activity exists, as today), and guard `navigateToScene` with the
   same owner check `navigateToIndexedBook` uses. Tests for both.
5. **One more run test.** `pipelines/runtime/host.guestTurnNotes.int.test.ts` covers one `create-lore-entry`
   commit: add a guest's turn that writes through the knowledge-tie outlet (`note-entry-knowledge`) and one
   that updates an entry: both land in the notes.
6. **The name says what it checks.** `isSessionMember` (`lorebooks/ownBook.ts:624`, private) now means "is the
   session's owner": rename it `isSessionOwner` and its callers in that file.

Append a "Scope review and fix task" section to `plans/REPORT-gs-2c-2026-11-17.md` (the review's clean checks:
`redlines.ts` `entryAndBook` already goes through `findOwnedBook`; `lorebooks:get` `{lorebook: null}` carries
nothing; `sessions:places`, `scenes:openScenes`, `state:*` send only what the page shows; no pipeline path
passes the speaking guest's id to a notes helper; these fixes).

## Report (under 300 words)

Per fix: what changed (file:line); for fix 2 the exact rule and what the seat rule already gave; tests and
counts with log names; `tsc`; anything not done.
