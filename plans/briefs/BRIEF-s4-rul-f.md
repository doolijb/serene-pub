# BRIEF — lane `s4-rul-f` (2026-11-10) — boot: make members of old deleted cards card-less

Supervisor: read `.claude/guides/multi-agent.md`, then `plans/briefs/BRIEF-s4-common.md` (its :5199 note is stale: the **owner's** `vite dev` runs on :5173, so **no `sdk:build`**; date your report 2026-11-10), then this file, then the last four bullets of `plans/PLAN-sdk-creation-seams-2026-10-30.md`. Then `plans/REPORT-s4-rul-c-2026-11-10.md` and `plans/REPORT-s4-rul-d-2026-11-10.md` — the delete-time fill and the boot fill you sit beside. Small lane: one worker, or do it yourself.

## Owner's words (quote them; never reinterpret)

- ★RF-1 (2026-11-10): *"Yes, if the card is removed/deleted, populate the cast member with the deleted content."*
- 2026-11-10, asked about "cast members still linked to a card deleted before the card-less conversion become card-less with the card's content, like newer deletes": **yes, build it**.

## Goal

A boot pass: every cast member (`lorebook_bindings`) still linked to a **soft-deleted** card (`characters.isDeleted`) — left from deletes before the ★3 card-less conversion — is made card-less with the card's content by the **same** steps a delete runs today (`sockets/characters.ts` `charactersDelete` ~1185–1235: `resolveFollows`, then `makeMemberCardless(tx, id, { cause: "card-delete" })`; `cast/cardless.ts`). Reuse them; no second converter.

- Where: a startup task in `startup/index.ts`, placed **after `character-versions` and before `seat-keys`** (challenger, accepted; evidence: `seat-members` ~294 runs before `character-versions` ~315; `resolveFollows` only changes existing `character_versions` rows (`versions.ts` ~802–818), so before the lift it would detach nothing and the card's words would be lost; and once a member is card-less, `knows()` (`seatMembers.ts` ~69) and `memberOfCard` (`utils/castMemberCards.ts` ~95–125) can't find it, so running before `seat-members` would let step 1 mint a **second** member for the same card). After `seat-members` has filled seats with the still-linked member, this pass makes it card-less, which matches the delete handler's order (fill, then convert; `characters.ts` ~1197–1232).
- Where such members come from: deletes before ★3, and the attic ETL (`attic/etl/lore.ts` ~80–81 copies `characterId` without checking the card is deleted).
- The candidate query selects only members the pass would change, so **a second boot changes nothing** and selects nothing.
- One transaction per card (or per member — say which and why); only `tx`; a card that throws is logged by ids and left; mark the task like its neighbours (⏳ "delete at the RC1 squash" if it only serves old data — say which).
- No migration, no events (nothing is connected at boot), no `SeatChange`.

## Tests

- **Attic-shaped data (challenger):** a member linked to a deleted card, **no versions yet**, and a seat with no member. After one full boot (all tasks in order): exactly **one** member, card-less, holding the card's words, and seated. Second boot changes nothing.
- A member linked to a soft-deleted card: after one boot it is card-less, holds the card's words (via `membersAsRead`), follows nothing; second boot: nothing written, nothing selected.
- A seat holding that member keeps it and still reads the card's words.
- Untouched: a member of a live card; an already card-less member; a member whose deleted card was handled by lane c / d.
- Existing `seatMembers.*`, `seats.*`, `characters.softDelete.*`, `cast/cardless.*` tests green (capped scope; DB-in-`it` needs 60 s).

## Files owned

- `src/lib/server/startup/index.ts` (one task entry), a new module for the pass under `src/lib/server/cast/` or `src/lib/server/sessions/` (your choice, named in the report), or `src/lib/server/sessions/seatMembers.ts` if you place it there
- `src/lib/server/cast/cardless.ts`: read; edit only if a soft-deleted card can't be read by it today (ask the lead first if more than a parameter)
- tests next to these
- `docs/lorebook-cast.md` ~177: one clause if what users see changes

Not yours: anything client-side (lane s4-rul-e runs beside you on the cast member form; you share no files), `sockets/**` beyond reading, `state/**`, `media/**`, the SDK. serene-pub-43 owns image generation: stay clear of `dispatchImage.ts`, `imageGen/**`, `matting.ts`, `KoboldCppManagedAdapter.ts`, `sprites/fillAction.ts`, `characters/portrait.ts`, `registrations/unserved.ts`, `runProgress.svelte.ts`.

## Stop and ask when

The common brief's Decisions apply; anything beyond members of soft-deleted cards; a change to what a live card's member reads.

## Done means

- The tests above, green. tsc / check: no new errors (the SDK is built now: tsc 0, check 0 errors / 8 warnings).
- Queue NOMENCLATURE §25 rows for the lead.
- Report one line on members swapped onto another card: the delete handler's `resolveFollows({ cardId })` (`characters.ts` ~1215) also resolves their versions, but a candidate query keyed on `lorebook_bindings.character_id` never selects them. Say whether your pass covers them; don't widen scope to fix it.
- Run a `scope-reviewer` on your diff; answer each finding once.
- Report in your final message; the lead saves it as `plans/REPORT-s4-rul-f-2026-11-10.md`.

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.*
- **Prettier:** only `--write` the lines you changed; never a whole file.
