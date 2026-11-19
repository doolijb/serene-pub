# BRIEF — worker task `gs-2a-fix` — scope-review fixes to lane `gs-2a` (a guest gets no compiled prompt; an administrator is a guest inside someone else's session)

Repo `/home/jody/github/serene-pub`. Read first: `plans/REPORT-gs-2a-2026-11-16.md`, the "Cold review
corrections" of `plans/briefs/BRIEF-gs-2.md` (the G6 line: inside a session's own screens an administrator is
the owner or a guest like anyone; administrator screens that take a session only as a filter are untouched).
Re-verify every file:line below.

Owner, 2026-11-16: G5 "The session's owner and administrators only" (Prompt details); G6 "In another person's
session an administrator is a guest"; "a guest sees nothing" of prompts; standing: members never see model
plumbing (connections, models, sampling, loadouts), and an owner who is not an administrator is a member.

Rules: never `git stash / checkout / restore`; `npx prettier --check` only, never `--write`; never commit; no
migration; no SDK edit. Inside `db.transaction` only `tx`. Comments state the rule, not the story. Lanes
`gs-3a` (`sockets/sessions.update.ts`, `sessions/seats.ts`, `EditSessionForm.svelte` seat parts, one function
in `pipelines/runtime/host.ts`) and `tm-2` (story-time reads, `scenes/earlierScenes.ts`,
`state/presencesOnReading.ts`, `sockets/amendments.ts` `cardMemberAt`, `host.ts` ~436–443) are editing: do not
touch their files or regions; re-read any file right before editing. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/gs-2a-fix-<n>.log 2>&1"`,
after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`. `NODE_OPTIONS=--max-old-space-size=10240`
for `npx tsc --noEmit -p .`.

## Fixes (every closed path gets a test asserting on the serialised payload; the owner's path shown unchanged)

1. **Two replies still carry the compiled prompt to a guest.**
   - swipe-left: `src/lib/server/sockets/sessions.messages.ts` 1514–1517 returns the full row: shape it with
     `rowShownTo(updated, socket.user!.id)` like its siblings.
   - `sessionMessages:setSprite`: `src/lib/server/sockets/sprites.ts` 421–427 returns the full row to a guest
     acting on their own character's line: export the shaping helper and use it there.
   Then grep every socket file for a handler that returns or emits a `session_messages` row (`.returning()`,
   `sessionMessage:`, `sessionMessages:`) and confirm each is shaped: list them in your report (file:line →
   shaped by).
2. **The token count's `meta` goes to the owner only.** `sessions:promptTokenCount`
   (`sessions.messages.ts` ~2440) still sends a guest `meta`: lore entry names with why each was kept or cut,
   per-block token counts, history ids, `promptFormat` (`pipelines/runtime/dispatch.ts` 707–764). A guest's
   composer needs only the totals: a non-owner gets `meta: { tokenCounts }` and nothing else (verify what
   `composerFlow.svelte.ts` 99–101, 217–227 reads; keep exactly that). The client's **Details** control is
   absent for a non-owner if it would now be empty. `docs/sessions.md` 653–659 (it says a guest's Details shows
   "Retrieval: every piece of lore considered" and "Sources") states the new rule.
3. **Prompt details shows no model plumbing to an owner who is not an administrator.**
   `PromptDetailsModal.svelte` 111–115 shows **Format** (`meta.promptFormat`) and the token **limit**, both of
   which come from the connection. For a non-administrator owner: Format is absent; the total stays, and the
   limit stays only if the composer already shows that same limit to every member (check; if the composer
   shows it, it is not new information: keep; else absent). An administrator who owns the session sees
   everything as before. Strip the same fields at the server for a non-admin owner (do not rely on the client).
4. **Administrator bypasses inside a session, closed** (each: remove the admin term so the rule is the session's
   own, and pin old → new):
   - `src/lib/server/sockets/media.ts:956` (`spokenScope`): any administrator can read or clear any session's
     spoken audio from inside the session (`SpokenLinesRow.svelte` 53 / 60): only the session's owner. The
     administrator card `KeepSpokenAudioCard.svelte:42` sends no session: verify it is unaffected.
     `docs/sessions.md:730` → "Only the session's owner".
   - `src/lib/server/sockets/pipelines.ts` ~5270 and the `asAdmin` argument at ~5410 (`pipelines:previewRetrieval`):
     an administrator who is a guest can preview the owner's lore, owner-only facts included: remove both.
   - `src/lib/server/sockets/backdrop.ts` 47 / 49: any administrator can rewrite any session's backdrop: drop
     both admin terms.
   - `src/lib/server/sockets/entries.ts:1605` (only picks which session's clock a reply reads at) and `:1682`
     (any administrator can list any session's entries, notes included): drop the terms.
   - **Leave** `entries.ts:1705` (the attached lorebook's owner-only rule: lane `gs-2c`) and `entries.ts`
     2444–2455 (R58, an administrator read across sessions).
   If removing a term breaks an administrator **screen** (a caller under the admin shell), stop on that one and
   report the caller.
5. **Docs and comments:** `docs/users-and-accounts.md:91` → "…their sessions from the admin area; inside a
   session they own nothing extra and enter only as a guest." (fit it to the paragraph); `docs/sessions.md:464`
   "an administrator sees them all" → "an administrator who owns the session"; stale comments that still say
   "owner and administrators" or "unchanged until G6": `pipelines/config/panel/scopes.ts` 72–73,
   `src/lib/shared/sockets/types.ts:7432`, `typedSocket.ts:1469`, `src/lib/shared/sockets/interest.ts:158`;
   NOMENCLATURE §9 **guest** row's stale "Open" text about Prompt details and administrators, and the `gs-2a`
   §25 entry's "every read, push and own reply" made true.
6. Correct `plans/REPORT-gs-2a-2026-11-16.md`: append "Scope review and fix task" (the review refuted the
   branch / create-from concern: `branch.ts` 424–478 copies a fixed field list without `debugMeta`; no 0.6
   code writes a non-null `debugMeta`, only the 0.5.3 import, so these leaks affect imported history;
   `pipelines:previewRetrieval` does refuse an administrator who is not in the session; these fixes).

## Tests

`sockets/sessions.debugMeta.int.test.ts` (extend), a sprite-reply test, the token-count test, tests beside each
closed bypass, the Prompt details DOM test (owner non-admin vs admin owner). `tsc` 0.

## Report (under 350 words)

Per fix: what changed (file:line); the list of message-row handlers and how each is shaped; old → new pins;
anything you stopped on; sentences (★); **Noticed, not done** (e.g. `embedding` on message rows: say how large
it is per row and who needs it on the client, do not change it).
