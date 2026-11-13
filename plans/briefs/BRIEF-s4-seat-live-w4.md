# BRIEF — lane `s4-seat-live`, worker w4 — a card-less seat's stats and sheets exist (`sessionLinks`) (2026-11-08)

Supervisor: lane `s4-seat-live` (seat-cast S4, wave 4 follow-up; **the flip is ON** — `src/lib/server/state/memberForm.ts` `memberFormSwitch = { on: true }`, so `memberFormOn()` is true). Repo `/home/jody/github/serene-pub`. Report in your final message (no report file). Worker w3 runs beside you on other files — no shared files.

## Context (quoted by the supervisor; never reinterpret)

- Owner 2026-11-05: "Everything in session is cast → active card." · "If a cast's feature in a lorebook/session can't survive without a card, then that feature needs to be copied to the cast member." Stats and sheets are such a feature.
- Owner 2026-11-08 ★K-1: a character seat's `state.cast.byId` key is `seated_member:<castMemberId>` (mirrors `player_seat:<id>`).
- A **card-less character seat** is a `session_characters` row with `character_id` NULL, `envoy_slug` NULL, `cast_member_id` set; its ref is `seated-member:<castMemberId>`; its state owner is `{ kind: "seated_member", id: <castMemberId> }`. **The seat filter** = not an envoy, and has a member or a card: `and(isNull(envoySlug), or(isNotNull(characterId), isNotNull(castMemberId)))`.
- **Today's gap:** `state/resolve.ts` `sessionLinks` (~587–760) reads character seats with `innerJoin(characters)` and builds `CastMemberLink { characterId: number, … }` per seat, so a card-less character seat has **no link**: no `state.cast.byId` entry, no `chainFor` link (`chainFor` ~1047 finds a seat owner's link via `castOwnerOf(c)` over `links.cast`), no configs/sheets. The write door already accepts it: `state/write.ts` `assertSessionOwner` `seated_member` branch (~1757) finds the seat by `cast_member_id`.
- Prior shape decisions you build on (lane s4-f-door, accepted by the lead): with the flip on, one link per seat; a carded player seat stays in `links.cast` with `playerSeatId`; links are deduped by `castLinkKey(link)`; a **card-less player seat** is a separate `links.playerSeats` (`PlayerSeatLink`) and `stateFor` (~1660–1740) gives each a `CastEntry` with `id: 0`, `playerSeatId`, `ref: player-seat:<id>`, `castMemberId`, `cardId: seat.seatActiveCardId ?? null`, owner `{ kind: "player_seat", id }`; `configsFor` (~1774–1790) picks the owner the same way.
- ⚠ **Card ids and member ids share one id range** — a wrong-person read is silent. **Never put a member id in `characterId` / `CastEntry.id` / any field read as a card id**; never compare a member id to a card id.

## Goal

1. **Read first (≤20 min), then choose and say why:** grep every reader of `SessionLinks.cast` / `CastMemberLink` / `links.playerSeats` / `CastEntry.id` in `src/lib/server` (state/*, rulesets/*, sockets/state.ts, statTrail, earshot, carries, write, durable, handEdits…). Two candidate shapes:
   - **(A)** card-less character seats go into `links.cast` as a `CastMemberLink` whose card field reads "no card" — only viable if every card-keyed reader stays correct (e.g. `characterId` widened to `number | null`, or a value no serial can equal — `CastEntry.id: 0` is already the card-less player-seat precedent). Every reader must be safe **without** edits outside `resolve.ts`.
   - **(B)** a parallel list beside `playerSeats` (🚧, one JSDoc sentence) that `stateFor`, `configsFor`, `chainFor`, `whoFor` and every other reader **inside `resolve.ts`** handle like `playerSeats`.
   Pick the one that needs **no edit outside `src/lib/server/state/resolve.ts`**; if neither does, **stop and report** the exact outside edits each would need (file:line, before/after) — don't make them.
2. **Build it in `src/lib/server/state/resolve.ts`:** `sessionLinks` reads live character seats with the seat filter (`leftJoin` characters); a card-less seat gets its link/entry: name = its member as read (`seatedCastOf` is already read when any seat has a member — reuse `seatAsRead` keyed `character:<seatId>`), `castMemberId`/`seatMemberId` = the member, `seatActiveCardId` = `asRead.activeCardId` (null when card-less), `isActive`, `position`; `state.cast.byId["seated_member:<M>"]` = an entry with `ref: "seated-member:<M>"`, `castMemberId: M`, `cardId: activeCardId ?? null`, values read off owner `{ kind: "seated_member", id: M }`; `chainFor` for that owner resolves its durable layers through the member (where its book's member values live — the attached book's member, or the own book's: follow what `resolutionChain` needs and how a carded seat's member chain is built) and **no card layer**; `configsFor` gives it its configs; `whoFor` lists it in `who.active` by position when active (read how `who` treats card-less player seats and mirror it); the slug index (`cast[entry.key]`) as for others.
3. Anything else in `resolve.ts` that walks `links.cast` and would now see/miss the card-less seat (`entryOfLink` ~2216, `memberFormRefOf` ~1375, the byId lookup for `nextTurn` ~2374–2393, `personas` ~2319): make it right and list each.

## Files owned (edit only these)

`src/lib/server/state/resolve.ts` and tests next to it: new `src/lib/server/state/resolve.cardlessSeat.int.test.ts`; existing `state/resolve.int.test.ts`, `state/seatMember.int.test.ts`, `state/memberForm.int.test.ts` only if an assertion is stale (say which and why; never delete an assertion).

## Files readable

Everything. Key: `state/resolve.ts` whole (read by ranges: 150–240, 575–780, 1040–1110, 1370–1410, 1640–1800, 2200–2399); `state/owners.ts` (`resolutionChain`, `castOwnerOf`, `OWNER_KINDS`); `state/keys.ts` (`castMemberKey`, `castLinkKey`); `state/write.ts` ~1700–1900 (owner door, `OWNER_ROWS`); `state/seatRefs.ts`; `cast/seatedCast.ts` (`seatedCastOf` — does it include card-less character seats? check); `sessions/seats.ts`; `sessions/seats.cardless.int.test.ts` (harness for making a card-less seat); `state/memberForm.int.test.ts`, `state/seatMember.int.test.ts` (on-mode state tests to copy the setup from); `plans/REPORT-s4-f-door-2026-11-08.md`.

## Out of scope (never built here)

Any file but `resolve.ts` (write.ts, owners.ts, keys.ts, earshot, rulesets, sockets/state.ts, client widgets — queue exact edits). Seating, prompt, turn code. SDK. Docs. NOMENCLATURE (list rows to queue).

## Stop and ask (in your report) when

CLAUDE.md §Decisions applies; the chosen shape needs an edit outside `resolve.ts`; a new exported name beyond one 🚧 link type/field; a migration or stored-data change (there should be none: this is read-side).

## Hard rules (CLAUDE.md)

- Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently.
- Never seed a row at a fixed id. No migration. Never add a top-level `await` to `src/lib/server/db/index.ts`.
- It is a **session**, never a chat.
- An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`.
- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no sdk:build; dev servers are running — don't build.)
- Prettier: `npx prettier --check` changed files; only `--write` lines you changed — never reformat a whole file.
- Never `kill -9` anything. Never `git checkout`/`restore`/`stash`.

## Tests (Done means)

Capped, logged:

```
SP=/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > $SP/s4-seat-live-w4-tests.log 2>&1; echo test-exit=\$? >> $SP/s4-seat-live-w4-tests.log"
```

Must pass, each its own `it` (real DB, flip on, a ruleset/attribute declared the way the existing on-mode state tests do it):
- `stateFor` on a session with a carded seat and a card-less seat M: `byId["seated_member:M"]` exists with `ref: "seated-member:M"`, `castMemberId: M`, `cardId` null, M's name, and its declared cast slots at their defaults; the carded seat's entry is unchanged;
- a state write on owner `{ kind: "seated_member", id: M }` (through the real write path the existing tests use) lands and `stateFor` reads it back on M's entry, not on any other;
- M's configs (`state.configs["seated_member:M"]`) exist (its sheet);
- `who.active` lists M by position when its seat is active; a departed card-less seat has no entry;
- no entry or chain anywhere treats M as a card id (assert a card with id = M, if the test can create one, gets no value from M's write).
Re-run the existing tests: `state/resolve.int`, `state/seatMember.int`, `state/memberForm.int`, `state/owners.test`, `state.seatIdentity.int`, `sockets/state.earshot.int`, `rulesets/memberForm.int`, `rulesets/seatedMemberRefs.int` (grep the paths), ≤10 files per batch. `npx tsc --noEmit -p .` (12G scope, `NODE_OPTIONS=--max-old-space-size=8192`, log `$SP/s4-seat-live-w4-tsc.log`) — no new errors.

## Report (final message)

The reader audit (file:line → safe / needs edit) and the shape chosen with why; changed hunks; decisions (named); tests + counts + log paths; tsc; stopped-and-asked (with exact outside edits if any); Noticed, not done; NOMENCLATURE rows to queue (draft).
