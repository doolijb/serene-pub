# BRIEF — lane `s4-chr-read` (wave 4) — the Characters view's read: one row per character, paged and permission-filtered

Read `plans/briefs/BRIEF-s4-common.md`, plan §34.4 ("Read") and §27 lines ~538–539 (owner 2026-11-05: "Give each character badges: card, cast." refined the same day to "the cast badge is probably redundant, any card that's been used will be a cast" → **one badge, Card**, plus a reach line), the rulings ★C-1 ("Characters") and ★5 (0.6 starter-copied cards stay), and pl3 ("Sharing a lorebook doesn't make it useable, but clone able"). NOMENCLATURE §1, §24 and the Characters/cast rows before naming anything.

## Goal

1. **`src/lib/server/cast/characterRows.ts`** (new; the cast read module owns it; reads only): one row per character — key = the linked card (`lorebook_bindings.character_id`) or, for a card-less member, the member. Read members at the book's present (`membersAsRead`) and cards via `cardsNow`. Row: key, shown name, summary (lead line), face, `hasCard`, the card id if any, reach facts (`lorebookCount`, the one book's name, or "in ‹session›'s notes"), "follows its card / has its own words", tags/favourite/persona flags for card rows.
2. **Permission filter:** the asker's own cards; members in books the asker owns (`kind='book'`); `kind='book'` books shared with them; live provided books (`providedBooksReadableBy`) — **excluding plugin-stamped hidden carrier cards (★S4-1) as card rows** (their members still appear as cast of the provided book); with `inMyStories: true` also the own books of sessions they own or belong to (`ownBookAccessFor`); never an admin's view of someone else's books.
3. **Socket 🚧 `characters:page { cursor?, limit, filters, requestId }` → `{ rows, nextCursor, requestId }`** in new `src/lib/server/sockets/characterRows.ts`, replying only to the asking socket; in `GATED_EVENTS` and the `socketEgress` allowlist; **not** in `SCOPED_EVENTS` (per user, no scope key). No server push of pages. Filters: `hasCard: true|false`, `lorebookId`, `sessionId`, `follows: 'card'|'own'`, `favorites`, `personas`, `tags`, `inMyStories`, `q` (name search). Keyset paging on (lower(shown name), key) using stored names (`characters.name` / `lorebook_bindings.name`); **verify by test** that `lorebook_bindings.name`/`character_id` track the book's present after the cv lanes — if not, stop and ask.
4. Shared types: put the payload/row types in a new `src/lib/shared/characters/characterRows.ts` and **append one new namespace block** for `characters:page` to `src/lib/shared/sockets/types.ts` (+ the typed event map entry) — lane s4-seat owns that file this wave; touch nothing else in it and say exactly what you appended.
5. Docs: none user-facing yet (chr-view writes them in wave 6); queue NOMENCLATURE rows (🚧 `characters:page`, `characterRows`).

## Files owned

`src/lib/server/cast/characterRows.ts`, `src/lib/server/sockets/characterRows.ts` (+ its registration where sockets are loaded — one line), `src/lib/shared/characters/characterRows.ts`, the appended block in `shared/sockets/types.ts`, `src/lib/shared/sockets/interest.ts` (`GATED_EVENTS`), the egress allowlist file (find it), tests next to these.

## Out of scope

Any UI (chr-view, wave 6); Copy to my characters (cp); seating.

## Done means

Tests: the permission matrix (own card, private book, shared book, provided book incl. a hidden carrier card not listed as a card row, admin can't see others', guest under In my stories); one row for a card + its members (reach counts), a card-less member its own row, an unused card "Not in a lorebook yet"; each filter; keyset stability across inserts between pages; gate + egress tests; `requestId` echoed. tsc + check no new errors. Report `plans/REPORT-s4-chr-read-2026-11-08.md`.
