# BRIEF — worker task `gs-3a-fix` — ledger rows and three small leftovers of lane `gs-3a` (guest seat switches)

Repo `/home/jody/github/serene-pub`. Read first: `plans/REPORT-gs-3a-2026-11-17.md`,
`plans/REPORT-gs-2a-2026-11-16.md` (its fix section), `NOMENCLATURE.md` §1, §24, the §9 rows **seat**,
**guest**, **session owner**, and the last five §25 entries (for the house format). Re-verify file:line.

Rules: never `git stash / checkout / restore`; `npx prettier --check` only; never commit; no migration; no SDK
edit. Comments state the rule, not the story. A read-only review of lane `tm-2` is running; no other lane is
editing. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/gs-3a-fix-<n>.log 2>&1"`,
after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`. `NODE_OPTIONS=--max-old-space-size=10240`
for `npx tsc --noEmit -p .` and `npm run check`.

## Do

1. **NOMENCLATURE.md:** 🚧 rows with charters (purpose, why it exists, what it owns, what it does not and who
   does: P6) for **Guests can bring their own characters** (`sessions.metadata.guestsBringOwn`), **Guests can
   take cast members** (`sessions.metadata.guestsTakeCast`) and the read `sessions:castToTake`, in the group
   where **seat** / **guest** live; one §25 entry for lane `gs-3a` quoting the owner (2026-11-16: "So two
   settings, both on by default." / "Keep: any guest may take a card-less cast member's seat") and listing the
   new names (`writeGuestSeatSwitches`, `guestsBringOwn`, `guestsTakeCast`, `sessions:castToTake`, the four
   sentences); bring the **guest** row's "Open" text up to date (ruled: the session page and the participants
   list read-only, no notes, no prompts, no Prompt details; still open: the owner seating for a guest, shared
   cards; Edit session for a guest and the notes are ruled and not yet built).
2. **The picker's group label for a guest on an attached lorebook** reads "Untitled lorebook" and merges both
   books under it (the cast read returns no book names): the guest's picker shows one plain group with the
   existing label the form uses for "cast members" (no lorebook name: a guest does not see the lorebook), in
   the seat component that renders `sessions:castToTake`. DOM test.
3. **The session page's entry points with *bring their own* off:** the page still offers a guest **Take a
   seat** and **Add your persona**, which are then refused. Make them absent for a guest when the switch is off
   (the session already carries the switches to every member), with no other change to the page. Find the
   components; DOM test for each (guest, switch on → shown; off → absent; owner → shown).
4. **Reordering:** with a switch off the client hides a guest's reorder control but the server still accepts
   the reorder. Reordering does not add, remove or change who plays a seat: leave the server as it is, and say
   so in one sentence in `docs/sessions.md` "What guests may seat" only if that section claims otherwise
   (read it; do not add a sentence that is not needed).

Append a "Fix task" section to `plans/REPORT-gs-3a-2026-11-17.md`.

## Report (under 250 words)

Per item: what changed (file:line), the rows added, tests and counts with log names, anything not done.
