# BRIEF — bench-L4: benched seats, the Participants tab (UI)

Design: `plans/PROPOSAL-benched-seats-2026-11-10.md`. Read it all, especially the "UI" bullets, both rulings rounds and the challenge answers (binding: **no "nudge"**). Also read `plans/REPORT-bench-L1-2026-11-10.md`, `plans/REPORT-bench-L2-2026-11-10.md` and `plans/REPORT-bench-L3-2026-11-10.md` once it exists. RULED 2026-11-10. You are a lane supervisor: read `.claude/guides/multi-agent.md` first, delegate the typing to at most 2 `lane-worker` agents inside the files below, and quote into their briefs the rules they need. Read `STYLE-GUIDE.md` by section first (list rows §6.4, buttons §6.1, notices §6.21, a11y §9, writing §10). Before using a Skeleton component, read its section in `AI-TEMP/skeleton-llms-svelte.txt` (grep the `# Component` heading, then `sed -n` that section only).

## Rulings this lane applies (owner, 2026-11-10)

- **Fold Removed into Benched.** One **Benched** section replaces "The fallen" and "Removed".
- **Dragging back brings them back:** "Dragging them back into the seat brings them back and treats them normally, up to the user to manage their status".
- **Soft Remove** stays, only for an unused benched seat.
- **Benched is the one lore rule** (built in L2). **Core never benches automatically**, and there's **no "Deceased… Bench them?" nudge**.

## Goal (`src/lib/client/components/sessionForms/EditSessionForm.svelte`, Participants tab ~2025-2698, and what it calls)

1. **Rows:** the per-row on/off Switch (`~2149-2187`, card-less members `~2235-2276`) and the row's Remove button go. Each seated row gets a **Bench** icon button (aria-label *"Bench ‹name›"*) beside the existing controls.
2. **The Benched section** replaces "The fallen" (`~2553`) and "Removed" (`~2582`).
   - **Intro (copy):** *"In the session, out of the turns. Their lines stay theirs."*
   - **Lists:** two, **Characters** and **Players**. Each is a `dndzone` whose `type` pairs with its seated list (`character-seat` for characters and card-less members, `player-seat` for personas). Drops are allowed only between the pairs, and reordering stays as today (`~2051` dndzone).
   - **Bring back:** each benched row has a **Bring back** button, the accessible equivalent of dragging back (dndzone has no reliable keyboard path, per the comment at `~1192`). A brought-back row joins the end of its list.
   - **After a move:** focus goes to the row's button in its new list, and an `aria-live` line says *"‹name› benched — waits for Save."* / *"‹name› brought back — waits for Save."*
   - **A fallen row** (derived: a player seat via today's `fellInStory`, pointed at benched instead of `removedAt`; a character seat via a `seatBenches` record or its member reading deceased) shows a Skull icon and *"Fell in the story"*. It keeps Bring back. Bringing back a fallen or deceased row shows *"They come back as they are; their story still says deceased until you change it."*, with a link to the cast member.
   - **Reassign…** becomes a ⋯ item on benched carded rows that aren't fallen. It still happens at once.
   - **Remove** is a ⋯ item on a benched row **with no lines** only. It stays held until Save, through the existing remove path (L1's `unseat` soft-removes an unused benched seat).
3. **Save:**
   - bench and bring-back are held until Save, like the rest of the tab;
   - Save sends them through `sessions:setCastSeatEnabled`, **widened with `playerSeatId`** (`src/lib/shared/sockets/types.ts` and the handler in `sockets/sessions.ts`, a `kind: "player"` branch calling `setSeatBench`), before `sessions:update`;
   - benched seats stay in `characterIds`, so the update's "omitted = unseat" diff only fires for a real Remove;
   - the header copy (`~2045`) becomes *"Changes here wait for Save — adding, benching, bringing back and reordering. Reassigning a benched seat's lines happens at once."*
4. **Re-adding a benched persona** brings the seat back instead of refusing (`sessions:addPersona`, "This persona is already in the session.", from the L1 queue). This is a server change in that handler only.
5. **Wiring (Sockets ruling):** one domain context per event family is the only listener, and the only place that toasts. **Don't add direct `useInterest` / `socket.on` calls in the form** for the new events. Route through the existing session domain context the form already uses, or the closest one; check how the toggle's answers are handled today.
6. **Envoys keep their switch.** Card-less seats stop showing in the seated list once benched (`EditSessionForm ~1360`, from the L2 notes).
7. **Undo moves aren't announced** (from L3's queue). Back, Forward, regenerate and delete move seats through `setSeatBench` (`state/write.ts` `retractSeatBenchesAnchoredTo` / `restoreRetractedState`), but nothing announces a `cast-changed`, so open pages show a stale seat until a refresh. Make `retractSeatBenchesAnchoredTo` (and the restore) return the `SeatChange`s, and have the callers (`sessions/rewind.ts`, and the swipe and delete callers in `sockets/sessions.ts`) call `announceSeatChanges` after commit. Add `src/lib/server/state/write.ts` (those two functions only) and `src/lib/server/sessions/rewind.ts` to your owned files. Test that Back announces the unbench.
8. **★L2-1 (a benched guest):** a guest whose only seat is benched is currently asked to sit again. **Propose** (don't build) the smallest composer state, e.g. *"You're on the bench — the owner can bring you back."*, in the report as a ★ with a mock.

## Files owned

- `src/lib/client/components/sessionForms/EditSessionForm.svelte` (the Participants tab), plus any small new components for the Benched section under `sessionForms/`
- `src/lib/shared/sockets/types.ts` (the `setCastSeatEnabled` params only), `src/lib/server/sockets/sessions.ts` (the `setCastSeatEnabled` player branch and `addPersona` re-add only)
- dom and int tests for these (update existing ones that assert the switch, The fallen or Removed)

## Out of scope (write down, never build)

- Readers, the port, data (L1–L3). Docs and NOMENCLATURE (L5): queue copy and names.
- The benched-guest composer state (★L2-1: propose only). Any nudge.

## Stop and ask when

CLAUDE.md §Decisions applies; a needed copy string isn't listed above (propose it as ★); the drag pairing needs a library change; a name beyond the components you create is needed.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. Never `git checkout`, `restore` or `clean` in either repo. **Never run `prettier --write` on a file.**
- Never commit. Never `npm test` or `npm run build` at the SDK root. Never `npm run sdk:build`. Delete only `/tmp/serene-pub-vitest-*` dirs your own runs made, by name — never a glob.
- `$state(new Set())` / `new Map()` is not reactive on mutation; use `SvelteSet` / `SvelteMap`. Untrack reads in effect-called store methods. `socket.off(event)` needs its handler. Views never call `toaster`. Browser code runs on plain-http LAN: no `crypto.randomUUID`, no `navigator.clipboard`.
- Never hand a DOM node to an assertion (compare `x === null` to `true`).
- Int tests that open a DB inside an `it` need a 60 s timeout. Never pipe vitest into `head`. Run vitest in a capped scope: `systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 <files>; echo test-exit=$?'`.
- Scratch files start with `bench-L4-`.

## Done means

- **Targeted dom tests:**
  - Bench and Bring back (button and keyboard path, focus moves, the aria-live line, held until Save);
  - a fallen row shows the skull and its bring-back note;
  - Reassign and Remove only where allowed;
  - Save sends `setCastSeatEnabled` for character and player seats;
  - existing `editSession*.dom.test*` tests green (updated where the ruling changed them).
- **Int tests:** the player branch of `setCastSeatEnabled`; `addPersona` brings a benched persona back.
- **Typecheck:** `npx tsc --noEmit -p .` and `npm run check` clean for your files.
- **No full suite.**

## Report

`plans/REPORT-bench-L4-2026-11-10.md`. If the harness refuses the write, put the full report in your final message. Include changed files, tests and results, copy and names for L5, the ★L2-1 proposal, open ★, **Noticed, not done**.
