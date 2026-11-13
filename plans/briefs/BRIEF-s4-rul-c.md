# BRIEF — lane `s4-rul-c` (2026-11-10) — a deleted card's seats, and start-form books by source

Supervisor: read `.claude/guides/multi-agent.md`, then `plans/briefs/BRIEF-s4-common.md` (its note about a dev server on :5199 is stale: today the **owner's** `vite dev` runs on :5173, so **no `sdk:build`**; date your report 2026-11-10), then this file, then the last two bullets of `plans/PLAN-sdk-creation-seams-2026-10-30.md` ("Owner marks on the follow-up ledger", "Lanes s4-rul"). Then `plans/REPORT-s4-review-fix*.md` (★RF-1), `plans/REPORT-s4-follow-a-2026-11-09.md` goal 1 (the one seat writer, `SeatChange`, `announceSeatChanges`) and `plans/REPORT-s4-follow-c-2026-11-09.md` goal 1 (the start form's surfaced groups). For UI: the STYLE-GUIDE sections you touch and memory `feedback_pickers_explain_why.md`.

## Owner's words (quote them; never reinterpret)

- ★RF-1, approved with note: *"Yes, if the card is removed/deleted, populate the cast member with the deleted content."* Follow-up answer, **"Fallback + new members"**: *"Fill the seat from the session notes' member as recommended, AND when a deleted card is seated somewhere with no member at all, make a member from the card's content before it goes, so no seat is left empty."*
- Cascade principle (2026-11-09): *"Cast by default cascades… a card is a seed, not the sole carrier… not having a card doesn't make them 2nd class."*
- c-3, approved with note: *"Categorize them by source, i.e. a plugin name, another user, a template"*. In the canon a template book is a **starter lorebook** (NOMENCLATURE `starter lorebook` row).

## Goals

Challenger findings (accepted) that shape goals 1–2, with evidence: `findOrInsertBinding` returns null for a deleted card (`utils/characterBindingSync.ts` ~386); `charactersDelete` sets `isDeleted` before its member loop (`sockets/characters.ts` ~1198–1218); minted members are named only after commit (`seats.ts` ~1388–1406) by a sync that finds bindings by `characterId` (`characterBindingSync.ts` ~147), which `makeMemberCardless` clears (`cast/cardless.ts` ~178); after a delete, `memberOfCard` can't find the card's member (`characterId` nulled; `parentVersionId` nulled on detach, `characters/versions.ts` ~840). So the work happens **inside the delete transaction, before `isDeleted` and `makeMemberCardless`**.

1. **One seat-filling step at card delete (RF-1, both halves).** Write **one helper**, called by **both** card-delete writers (`sockets/characters.ts` `characters:delete`, and plugin removal in `plugins/providedBooks.ts` ~1546–1560), inside their transaction and before the card is marked deleted or its members made card-less. For every **live** seat that holds the card and has no member: use the card's member in the session's own book or an ancestor's (the RF-1 fallback) if one exists; else mint one (`findOrInsertBinding`: the attached book when `attachedMintable`, else the session's own book) **and name it inside the transaction** (the post-commit sync can't find it once it is card-less). Then the existing conversion makes every member, old and new, own the card's content. Seat changes go through the one seat writer; a fill reports nothing (keep that). Use only `tx`. Departed seats: not required; say what you did.
2. **`resolveSeatMember` and the boot pass move together.** Apply the RF-1 order change (`attached-find OR own-find OR ((attached-mintable OR own exists) AND card live)`, `REPORT-s4-review-fix-2026-11-09.md:14`) to `resolveSeatMember` (`sessions/seats.ts` ~354–410) **and** to the boot pass's `resolvable` query (`sessions/seatMembers.ts` ~57–105) in the same change. That report's fix 4 was exactly this drift (it re-selected sessions on every boot). Add a **second-boot-changes-nothing** case to `seatMembers.int.test.ts`. This only reaches cards deleted before 2026-11-08 whose members are still linked, which is stored 0.6 data filled at boot.
   - **Not this lane:** minting members at boot for seats of already-deleted cards with no member anywhere (the soft-deleted card row still exists). That is open with the owner as a ★; build nothing for it.
   - Tests: delete a card seated in a session with (a) a member in the attached book, (b) a member only in the session's notes, (c) no member anywhere, on a mintable book and on a session with only its own book, through **both** delete paths. Each live seat ends with a named member holding the card's words. Card-less seats and other sessions are unchanged.
3. **Start-form books by source (c-3).** On `StartSessionForm.svelte`, the books that aren't the asker's own are grouped by where they come from: **a plugin** (by the plugin's name), **another person** (by their name), **a starter lorebook**. Your own books stay first, as today, with follow-c's **How it starts**. Keep every existing start rule (copy-only for other people's surfaced books, provided books read directly, starter lorebooks through `StarterKitPicker`); this goal moves rows, it doesn't change what a row does. If the list payload lacks the plugin name or the sharer's name, add the smallest field to `lorebooks:list` (name it in the report; mark it 🚧). Copy: propose as ★ and build your recommendation (headings such as *From ‹plugin name›* / *Shared by ‹name›* / *Starter lorebooks*). Tests: a DOM or unit test that each source lands under its heading, and the existing start-form tests stay green.

## Files owned

- `src/lib/server/sessions/seats.ts` (`resolveSeatMember` and what goal 2 needs)
- the card-delete paths: `src/lib/server/sockets/characters.ts` (the `characters:delete` handler only), `src/lib/server/plugins/providedBooks.ts` (its card delete only), `src/lib/server/utils/index.ts` (the delete function only, if it is on the path)
- `src/lib/server/sessions/seatMembers.ts` and `seatMembers.int.test.ts`; `cast/cardless.ts` and `utils/characterBindingSync.ts` are readable, not owned (ask if you must change them)
- `src/lib/client/components/sessionForms/StartSessionForm.svelte` (the lorebook picker groups), and `src/lib/client/components/lorebookForms/StarterKitPicker.svelte` only if the grouping needs it
- the `lorebooks:list` server reply, if goal 3 needs a field (find it from `sockets/lorebooks.ts`; that one function only)
- `src/lib/shared/sockets/types.ts`: **the `Lorebooks.List` row only** (lane s4-rul-a owns the `State.*` namespaces; exact-string edits only, no prettier `--write` on it)
- `sockets/sessions.ts`: you are its only owner this round, but only touch it if goal 1 or 2 truly needs it
- docs: `docs/lorebook-cast.md` (the card-delete paragraph), `docs/sessions.md` (start form), `docs/characters.md` (Delete a character)
- tests next to all of these

Not yours: `sockets/state.ts`, `state/**`, `media/**`, `CastMemberForm.svelte`, anything named overhear (lane s4-rul-a / s4-rul-b). serene-pub-43 owns image generation: stay clear of `dispatchImage.ts`, `imageGen/**`, `matting.ts`, `KoboldCppManagedAdapter.ts`, `sprites/fillAction.ts`, `characters/portrait.ts`, `registrations/unserved.ts`, `runProgress.svelte.ts`. No SDK changes in this lane.

## Out of scope

Ordinary (non-surfaced) books shared by other people are still not offered for copying; don't add them. The member-keyed seat map and removal of card-keyed paths are S5.

## Stop and ask when

The common brief's Decisions apply; a migration or a boot pass over stored data; a seat change that would send member events where none were sent before (a-★1 and a-★2 are approved: bench and birth send none); the start form changing what a row does, not just where it sits.

## Done means

- Tests for each goal, plus existing `seats.*`, `sessions.*`, character delete, `providedBooks.*` and start-form tests green (capped scope per the common brief).
- `npx tsc --noEmit -p .` and `npm run check`: no new errors beyond the three that wait on the SDK build (`overhear-seat`, which lane s4-rul-a is renaming; say what you see).
- Run a `scope-reviewer` on your diff before reporting; answer each finding once.
- Report: return it in your final message; the lead saves it as `plans/REPORT-s4-rul-c-2026-11-10.md`.

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.*
