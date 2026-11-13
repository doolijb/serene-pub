# BRIEF — lane `s4-follow-c` (2026-11-09) — surfaced-book start and the seat-changes read

Read these first, in order:
1. `plans/briefs/BRIEF-s4-common.md`. The note in it about a dev server on :5199 is stale. Today the **owner's** `vite dev` runs on :5173, so no `sdk:build`.
2. The last three bullets of `plans/PLAN-sdk-creation-seams-2026-10-30.md`: "Owner marks on the ★ review page", "Owner rulings (2026-11-09, after the review page)" and "Lanes s4-follow-a + s4-follow-b BUILT". Quote the owner's words from there.
3. `plans/REPORT-s4-follow-a-2026-11-09.md` goal 1, which describes the one seat writer and `announceSeatChanges`. Your goal 2 builds on it.
4. For any UI you touch, the STYLE-GUIDE sections for it, and memory `feedback_pickers_explain_why.md`.
5. For SDK work, `../serene-pub-sdk/INTEGRATING.md`, read by section.

## Goal

### 1. Surfaced books: the owner's own start on the book; shared ones stay copy-only
Owner, 2026-11-09: **"Own: start on; shared: copy"**. Before that, on the review page: "If the book is real (surfaced) then it should start on the lorebook. The user should pick to continue the most recently active branch or branch off at a certain point."

- **Today:** `lorebooks.surfaced_from_session_id` (migration 0148) marks a surfaced book. `surfacedBookRefusal` (`lorebooks/ownBook.ts`, called from `sockets/sessions.ts` ~1012) lets only the source session, its branches and its next chapters read the book directly. `StartSessionForm.svelte` ~722–738 puts surfaced books in their own group, and each row there starts in the copy mode.
- **Wanted:**
  - A surfaced book **owned by the asker** is an ordinary book they can start a new session **on**, reading it directly.
  - When they pick it, they choose between two starts:
    - **Continue the most recently active line**: the line the book's most recent write landed on.
    - **Branch off at a point**: a line plus a story date, using the existing `SessionLorebookReading` line/date controls and the existing branch-at reading.
  - A surfaced book **someone else shares** with the asker stays copy-only. That keeps pl3 (2026-11-05) for other people's books; ★B-3 (2026-11-08) is narrowed to them.
- **Where to change it:**
  - Server: `surfacedBookRefusal`, so the owner may read the book directly; `sessions:create`, so the start takes the chosen line or point.
  - Client: the start form's surfaced group, which becomes the owner's books with the two starts, plus the shared books as copy.
- **Rules:**
  - Reuse the line, reading and branch machinery that already exists. No second reading rule.
  - Anything that changes stored data needs a test that a second boot changes nothing.
  - New copy: propose it as ★ and build your recommendation.
- **Tests:**
  - the owner starts on their own surfaced book, both ways;
  - another user's surfaced book is still copy-only;
  - the source session and its branches are unchanged.

### 2. The seat-changes read (genres opt in)
Owner, 2026-11-09: **"Yes, a read genres opt into"**. Before that: "Might also want a flag somewhere that a seat was filled within the last turn, and which seats changed, in case a genre wants to run a pass over them in the background."

**Wanted:**
- Each turn knows the seats added, removed and changed since the previous turn, by seat ref, in member form. This comes from the seat writer's `SeatChange`s, which follow-a built. Never re-diff the seats.
- The SDK can read it as a **typed** field or helper. Plugins never parse refs (the modder rule): give a typed per-seat entry with its kind (character or player seat), the cast member id, and whether it was added, removed or changed.
- A genre may declare a background pass over those changes.
- It is **off unless a genre opts in** (P1). A core genre that doesn't opt in sees no change.

**Design first, inside this lane:**
- Choose where the changes are kept between turns. In order of preference:
  1. derived from existing data;
  2. carried on the turn's existing run or ledger record;
  3. new storage.
- **If new storage or a migration is needed, stop and message the lead with one ★ recommendation before building.** No migration without a go.
- Name the SDK shape by NOMENCLATURE §1 and §24 and mark it 🚧 @experimental. Add one JSDoc sentence per field, and update INTEGRATING and the guide examples in the same change.
- The genre opt-in must reuse an existing declaration surface: a genre shape or recommendation field, or a pipeline trigger. No new setting.

**Tests:**
- a turn after a seat change reads exactly those changes, for card and card-less seats and for character and player seats;
- the next turn reads none;
- a genre that hasn't opted in gets nothing and runs nothing;
- SDK unit tests for the shape.

**Build:** `sdk:build` is blocked while the owner's `vite dev` runs on :5173. Write the SDK side and its tests, then say exactly which app tsc errors wait on the build. **Message the lead before any build;** the lead coordinates it with serene-pub-43.

## Files owned

- `src/lib/server/lorebooks/ownBook.ts`: `surfacedBookRefusal` and the surfaced-book reading.
- `src/lib/server/sockets/sessions.ts`: the `sessions:create` surfaced path only.
- `src/lib/client/components/sessionForms/StartSessionForm.svelte`: the surfaced group and the start choice.
- `src/lib/server/sessions/seats.ts`: where `SeatChange`s are handed to the turn record.
- The turn or run record you choose for goal 2. Name it in your report.
- In the SDK, the turn/session read and genre declaration files you need (`../serene-pub-sdk/sdk/src/…`) plus `INTEGRATING.md`.
- `src/lib/shared/sockets/types.ts`: your own fields only.
- Docs: `docs/sessions.md`, `docs/lorebooks.md`, `docs/pipelines.md`.
- Tests next to all of these.

**serene-pub-43 owns image generation.** Stay clear of `dispatchImage.ts`, `imageGen/**`, `matting.ts`, `KoboldCppManagedAdapter.ts`, `sprites/fillAction.ts`, `characters/portrait.ts`, `registrations/unserved.ts` and `runProgress.svelte.ts`. No other lane runs beside you.

## Stop and ask when

- The common brief's Decisions apply.
- Goal 2 needs new storage or a migration.
- The "most recently active line" can't be read without a new column.
- A core genre's behaviour would change.

## Done means

- Tests for each goal.
- The existing `sessions.*`, `ownBook*`, `seats.*`, `branch.*`, `lorebooks.*` and SDK tests are green. SDK tests can't run before the build; say so.
- tsc and check show no new errors besides the ones waiting on the build.
- Queue NOMENCLATURE rows; the lead merges them.
- Return the report in your final message; the lead saves it as `plans/REPORT-s4-follow-c-2026-11-09.md`.
