# BRIEF — lane `s4-rul-d` (2026-11-10) — members at boot for seats of cards already deleted

Supervisor: read `.claude/guides/multi-agent.md`, then `plans/briefs/BRIEF-s4-common.md` (its note about a dev server on :5199 is stale: today the **owner's** `vite dev` runs on :5173, so **no `sdk:build`**; date your report 2026-11-10), then this file, then the last four bullets of `plans/PLAN-sdk-creation-seams-2026-10-30.md`. Then `plans/REPORT-s4-rul-c-2026-11-10.md` in full: it built `fillSeatsBeforeCardDelete` and moved the boot pass's `resolvable`; you extend that work. This is a small lane: one worker is enough, or do it yourself.

## Owner's words (quote them; never reinterpret)

- ★RF-1 (2026-11-10): *"Yes, if the card is removed/deleted, populate the cast member with the deleted content."* Follow-up: *"…when a deleted card is seated somewhere with no member at all, make a member from the card's content before it goes, so no seat is left empty."*
- Asked about seats of cards deleted **before** the new fill step, with no member anywhere (the soft-deleted card row still exists), the owner answered **"Yes, at startup"**: *"One startup pass fills those seats, and a test pins that a second start changes nothing. No seat stays empty, as your cascade rule asks."*

## Goal

At boot, every **live** seat (character `session_characters` or player `session_personas`) whose card is soft-deleted (`isDeleted`) and that has no member anywhere the session reads (attached, own, ancestor's book) gets a member **minted from the soft-deleted card**, then made card-less with the card's content by the existing conversion, exactly as if `fillSeatsBeforeCardDelete` had run at delete time.

- **Reuse, don't fork.** Lane c's notes: `findOrInsertBinding` returns null for a deleted card (`utils/characterBindingSync.ts` ~386); minted members are named by `syncLorebookBindingsForCharacter`, which finds bindings by `characterId`; `makeMemberCardless` (`cast/cardless.ts` ~178) clears that link. So the mint must be able to read a soft-deleted card, name the member inside the transaction, then convert it. Prefer a parameter on the existing step (for example letting the fill read a soft-deleted card on the boot path) over a second copy. Name any new name in the report and mark it 🚧.
- **Where it runs:** in or beside the existing seat boot pass (`sessions/seatMembers.ts` and its runner; find it from `seatMembers.int.test.ts`). The candidate query must select a session **only** when the pass would change it, or it re-selects on every boot (the drift `REPORT-s4-review-fix-2026-11-09.md` fix 4 was about).
- Book choice: the attached book when `attachedMintable`, else the session's own book (as `resolveSeatMember` mints). A session whose books can take no member is left alone and counted in the pass's log line, not re-selected.
- Only `tx` inside a transaction. No top-level `await` in `db/index.ts`. No migration: this is a boot pass over existing rows. Never seed a fixed id.

## Tests

- A session with a live seat of a soft-deleted card and no member anywhere: after one boot the seat has a member named as the card, holding the card's words, card-less; **a second boot changes nothing** (no rows written, no session re-selected).
- Character seat and player seat; a mintable attached book and an own-book-only session.
- Untouched: a seat whose deleted card already has a member (lane c's paths), a live card's seat, a departed seat, a session whose books can take no member (and it is not re-selected).
- The existing `seatMembers.*`, `seats.*`, `seats.cardDelete.*`, `characters.softDelete.*`, `cast/cardless.*` tests stay green (capped scope per the common brief; DB-in-`it` tests need a 60 s timeout).

## Files owned

- `src/lib/server/sessions/seats.ts` (the fill step and its parameters only), `src/lib/server/sessions/seatMembers.ts`, and the boot runner that calls it (one call site)
- `src/lib/server/utils/characterBindingSync.ts`: only if the mint or name step needs a soft-deleted-card option; ask the lead first if it needs more than a parameter
- tests next to these
- `docs/lorebook-cast.md`: one sentence, if what users see changes (older seats are filled on the next start)

Not yours: anything in the UI, `sockets/**` except reading, `state/**`, `media/**`, the SDK. Lane s4-rul-b may be running (cast member form, client only); you share no files. serene-pub-43 owns image generation: stay clear of `dispatchImage.ts`, `imageGen/**`, `matting.ts`, `KoboldCppManagedAdapter.ts`, `sprites/fillAction.ts`, `characters/portrait.ts`, `registrations/unserved.ts`, `runProgress.svelte.ts`.

## Stop and ask when

The common brief's Decisions apply; the pass would send member events or `SeatChange`s (it should send none: a fill reports nothing); anything beyond live seats of soft-deleted cards with no member.

## Done means

- The tests above, green.
- `npx tsc --noEmit -p .` and `npm run check`: no new errors beyond the 3 that wait on the SDK build (`show-hidden-stats`).
- Queue NOMENCLATURE rows (§25) for the lead.
- Run a `scope-reviewer` on your diff before reporting; answer each finding once.
- Report: return it in your final message; the lead saves it as `plans/REPORT-s4-rul-d-2026-11-10.md`.

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.*
- **Prettier:** only `--write` the lines you changed; never a whole file.
