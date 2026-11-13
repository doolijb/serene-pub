# PROPOSAL — One "Benched" section for seats no longer in play — 2026-11-10

Status: **RULED 2026-11-10** (both rounds). Builds after the history plan.

## Owner (2026-11-10, verbatim)

"Yes, but we should add a seat section for benched cast members who were in the session but are no longer active. We can probably use this to replace the off toggle on seats"

## Owner rulings (2026-11-10)

- **Shape:** "Also fold Removed in". Removing a seat becomes benching, and existing removed rows become benched (option C: the biggest change).
- **Prompt:** "Leave the block (Recommended)". Benched and fallen characters leave the characters block entirely.
- **Bringing someone back:** "Dragging them back into the seat brings them back and treats them normally, up to the user to manage their status, unless the revival is a part of the story/genre and handled by a function that manages their status".

**What this changes from the recommendation:**
- The bench can't be purely derived from `deceased`. A person dragging a fallen member back must win, even while their cast state still reads deceased.
- So the bench becomes **stored seat state**, written by two kinds of writer: the person (dragging out to Benched, dragging back to a seat), and a genre function that manages status (a death benching, a story revival). The genre writer is opted into (P1).
- **Open design points:**
  1. A pipeline port to bench and unbench a seat, and whether it's turn-tied so a retake undoes it (seat changes aren't turns today).
  2. Folding Removed in: what happens to Reassign, and the boot pass turning removed rows into benched rows. That reshapes data, so it needs a second-boot test.
  3. Player seats can only be benched once `session_personas` gets `is_active` (a migration). Removed player seats would need it once Removed folds in.
  4. The drag interaction on the Participants tab.

## What exists

- **Character seats** (`session_characters`, `schema.ts:4020-4107`) have `isActive` (the **bench**), `removedAt` and `removedName`. **Player seats** (`session_personas`) have no `isActive`.
- **The off toggle** is a per-row Switch in the Participants tab (`EditSessionForm.svelte:2149-2187`, card-less members at `:2235-2276`), held until Save. It sends `sessions:setCastSeatEnabled`, written only by `setSeatEnabled` (`sessions/seats.ts:1621-1641`, commented "the bench"). It is reversible.
- **"The fallen"** (`:2553-2580`) is derived: a player seat retired by the Crawler's `set-seat-name` retire. **"Removed"** (`:2582-2634`) is removed seats, with **Reassign…**.
- **A benched seat today:**
  - It's out of the turns (`state/resolve.ts:2302-2318`).
  - The prompt drops its name and likeness (`promptFields.ts:410-435`) **but still compiles its card into the characters block** (`:390-398`).
  - The lore gate still counts it as seated (`host.ts:4599-4628`), so **nobody reads its private lore**.
- **A dead AI companion** stays seated and enabled. Its genre's `fate` decides its turns.
- **Vocabulary:** "benched" is already the user word (`docs/group-sessions.md:92-98`, `docs/sessions.md:570`), the SDK word (`characters.v1 benched:true`) and NOMENCLATURE:419. There's an existing R1 clash: "departed" means both a removed seat (NOMENCLATURE:353) and the cast state `departed`.
- **Bug:** the lore gate's persona arm (`characterLore.ts:161-169`) ignores `removedAt`, so a removed player seat's lore still reaches every prompt.

## Recommendation (option B, derived, no new column, no migration)

1. **`isBenched(seat)`** = a live character seat with `isActive = false`, **or** one whose member's cast version in force is `deceased`. A death stays the story's own writing, and a retake un-benches by taking the dated version away. Nothing ever writes `is_active` automatically (P1).
2. **Lore:** background member = no live, **active**, non-deceased seat holds it (`seatedMemberIds`). That extends the 2026-11-10 ruling to the bench too. It also fixes the removed-persona bug.
3. **Turns:** `who.active` also drops deceased members. An optional SDK `benchedBy: 'off' | 'fallen'` lets widgets say why.
4. **Prompt (★):** benched cards leave the characters block, not only the names list.
5. **UI (the P3 win: one switch fewer per row):**
   - Rows lose the Switch and gain a **Bench** icon button beside Remove.
   - A new **"Benched"** section, where "The fallen" is today, reads *"In the session, out of the turns. Their lines stay theirs."* Benched rows get **Bring back**, held until Save.
   - Fallen and dead rows show a skull and *"Fell in the story"*, with no button; Back or a retake undoes a death.
   - **Removed** stays its own section (out of the cast, with Reassign).
   - Envoys keep their switch (it seats and unseats a declaration).
   - The section is wired through a domain context, not new direct listeners.
6. **Player seats stay unbenchable** for now (they would need `is_active` and a migration).

## ★ Open

1. **The name "Benched"** (recommended: it's already the user and SDK word).
2. **Removed:** kept separate (recommended), or folded into Benched?
3. **Deceased:** benched by derivation (recommended), or only when a genre writes the bench?
4. **Bring back on a fallen or deceased row:** does nothing (recommended), or writes an `active` cast version?
5. **Benched cards leave the prompt's characters block** (recommended)?
6. **Player seats benchable?** Recommended: not now.
7. **`missing` / `departed`** read as benched too? Recommended: deceased only, for now.

## Size

Small to medium, about 12-15 files: EditSessionForm, the `sessions:get` shape, `host.ts`, `characterLore.ts`, `resolve.ts`, `promptFields.ts`, an optional SDK field, 4 docs, NOMENCLATURE and about 6 tests. No migration.

Note: lane hist-G is already building "deceased reads as background" in `characterLore.ts` / `seatedMemberIds`. A benched-seats lane would extend that same rule to `isActive = false`.

## Revised design (research 2026-11-10, after the owner's rulings)

**Data**
- The bench is stored seat state: `session_characters.is_active` (exists) plus a **new `session_personas.is_active`** (the generated migration adding it takes whatever index `db:generate` assigns: 0152 or later, after `0150_chief_starjammers` (scenes.notes) and the variable-templates session's `0151_shallow_marvel_zombies`. Ask serene-pub-83 before generating.).
- One writer, `setSeatBench(tx, {sessionId, kind, seatId, benched})`, replaces `setSeatEnabled`. **Every** path calls it inside its own transaction: a person's Save, the port, retract and Forward, and guest removal. The annex holds only the record of who benched which seat, and when (P2, challenge 4).
- `removed_at` keeps meaning "not in the cast, never shown": merge victims, envoys switched off, rows the pass can't convert, and the optional mistake-Remove (★2).

**One rule: in play = live and not benched** (`seatInPlay`)
- Applies to: turns (`turnPlan`, `fireTurn`, `speakerRotation`, `dispatchSpeech`, `runTurn`), which seat you speak as (`seatName.ts`), the prompt (`getPromptSessionFromDb`, `host.ts`), the lore gate, and the SDK cast doc (`SessionCastV1.sessionPersonas[].enabled` carries the bench; the Crawler's `liveSeats` filters on it).
- Sheets, access and names keep reading `removed_at` only.
- **Prompt:** the characters block compiles only seats in play, plus the speaker. Benched personas leave the names list, likenesses and the persona block.

**Lore (recommended single rule):** "benched → background". The gate stops reading `nodeState`: a deceased member whose seat is still in play reads as seated (the owner's "treats them normally"). The persona arm counts only player seats in play, which also fixes the removed-player-seat lore leak. **This reverses hist-G's "deceased reads as background" (★1).**

**Port (genre-managed status):** **`core:outlet/set-seat-bench@1`** {seat, benched}.
- Opt-in through a new genre `writes.seats`, **absent = off** (unlike `writes.lore`/`writes.scenes`) (P1).
- **Tied to the turn:** the bench is recorded in a core annex key `seatBenches` (the `rulesetConversions` pattern). A retake or Back puts back `from` only while the seat still reads `to`, so a person's later drag wins. Forward re-applies it.
- **Dungeon Crawler:** a hero's retire now **benches** the old seat instead of unseating it. A companion's death and revival would be new work (★4).

**UI:** rows lose the Switch and Remove, and gain a **Bench** button.
- One **Benched** section, with Characters and Players lists, as dndzones paired with their seated lists, replaces "The fallen" and "Removed".
- **Bring back:** a button, the keyboard path (focus moves, an aria-live line). Rejoins at the end of its list.
- **Fallen rows** are derived and show a Skull and *"Fell in the story"*. Bringing one back says *"They come back as they are; their story still says deceased until you change it."*
- **Reassign…** becomes a ⋯ item on benched carded rows.
- Everything waits for Save, through `sessions:setCastSeatEnabled` widened with `playerSeatId`. Envoys keep their switch.

**Vocabulary:** retired: the "Removed" section, "The fallen" as a section, and the switch copy. Kept: **benched**, **Bench**, **Bring back**. (The departed→removed R1 rename moved to Noticed, not done; challenge 5.)

**Data upgrade** `dataUpgrades/<the generated tag>.ts`, anchored by `afterMigration` to the migration that adds `session_personas.is_active` (runs once):
- Each removed row becomes `is_active=false`, `removed_at=NULL`, keeping `removed_name`.
- **Skipped:** merge victims, envoys, character rows with neither card nor member, **removed rows with no lines** (they stay removed, matching ★2's soft Remove), and **any row, carded or not, whose resolved member a live seat already holds** (K-4's unique (session, member) index).
- **Second-boot test:** run the upgrade and then the seat-members pass twice; the second boot changes nothing.
- **Risks:** the seat-members pass gives converted seats members, which can add cast members to owners' books; old sheets come back as benched; long-removed rows fill Benched; third-party genres reading `sessionPersonas` will see benched seats (SDK changelog).

**★ Open** (all four ruled in the second round)
1. Single lore rule: retire hist-G's "deceased reads as background"?
2. Keep a **Remove** (soft, invisible) for a mistake on a benched seat that never spoke?
3. Removing a guest benches their player seats?
4. The Crawler companion's death and revival: in this programme, or a later Crawler lane?

**Lanes:** L1 data → L2 readers + L3 port → L4 UI → L5 docs and NOMENCLATURE (after L2/L3, never alongside). About 30 files plus the SDK.

## Owner rulings, second round (2026-11-10)
- **★1:** "Probably benched is the one rule, except seat to benched is something managed by the genre/pipelines, not automatically by core." Benched → background is the single lore rule; hist-G's deceased arm is retired. Core never benches on its own; a person or an opted-in genre or pipeline function does (`set-seat-bench@1`, `writes.seats`). (The lead's Participants "nudge" was removed after the challenge: it is not built.)
- **★2:** "Yes, for unused seats". A soft **Remove** on a benched seat with no lines.
- **★3:** "Yes, bench them". Removing a guest benches their player seats.
- **★4:** "In this programme". Dungeon Crawler companion death and revival through the bench port is built here.

## Challenge answers (plan-challenger, 2026-11-10): all accepted
1. **The nudge** was the lead's text inside the rulings and reversed ★1 ("not automatically by core"). Removed; not built.
2. **The upgrade** now skips removed rows with no lines (★2) and any row whose member a live seat holds (K-4), and adds a second-boot test.
3. **The migration and upgrade** are no longer hard-coded to 0150 (hist-B2 takes it); they're anchored to the generated tag.
4. **One writer:** retract, Forward, guest removal and the port all call `setSeatBench`; the annex is only a record.
5. **The departed→removed rename** is out of scope and goes to Noticed, not done. Corrected citations: the seat sense is in NOMENCLATURE §25 :3298/:3307, and there's a third ⏳ meaning at :54/:901; :353 is the background-member row.

## Noticed, not done
- The "departed" R1 clash (seat sense vs the cast state `departed`, plus the transitional meaning): about 90 code uses; propose separately.
