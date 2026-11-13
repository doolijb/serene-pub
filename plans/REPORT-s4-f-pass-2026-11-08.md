# REPORT s4-f-pass (wave 2, flip unit, 2026-11-08) — saved by the lead from the supervisor's hand-back (condensed; startup hunk verbatim)

**Done.** Own-book mint built; `seat-keys` pass over 15 stores with gate tests; **not** in startup. Lane tests pass; tsc 0 → 0; check 0/8 → 0/8. Scope review: one medium (★f-pass-1) + two low (fixed). **No-op boot cost median 32.9 ms** (no marker needed). Worker briefs `plans/briefs/BRIEF-s4-f-pass-w{1,2,3,4}.md`.

**Mint:** `seats.ts` `resolveSeatMember` step 4 — with `mint` and an own book, when no member exists anywhere: `pg_advisory_xact_lock(ownBookId)`, `findOrInsertBinding(tx, ownBookId, cardId)` (a deleted card gets none), answers `mintedIn` so `syncMintedSeatMembers` names it after commit; attached/ancestor members still win; docs cite ★B-5. `seatMembers.ts` fast path gains one `exists` branch.

**Pass:** `sessions/seatKeys.ts` exports `seatKeys(db)`, `SeatKeysReport` `{ sessions, rekeyed (per store), copied, dropped, left, failed }`, `SEAT_KEY_STORES`, `SeatKeyStore`. Stores in order: attribute_values / attribute_configs / zone_contents (set-based; ★K-2 copies first), owner_sheets / attribute_carries (merged pair → survivor seat's row, else newest), state_proposals, zone_towards, annex_core (turnOrder, turnTally incl. `turnsBy` summed, Crawler fates; annex lock), annex_audiences, genre_fields (`speechAutoVoice:`), widget_settings (`chosenImages`, `pickMembers`), message_speakers (`session_messages.metadata.speaker`), message_blocks (addressee, `answered.by`, nested), rewind_taken, annex_deltas (audiences every owner; document only for `core`). One-query union fast path; JSON writes raw SQL (no `updated_at` move), only when changed. Rules: values / who-may-see go to every seat holding the card (★K-2); a designation goes to one seat via `memberFormOf`, hinted by the stored item (candidate `kind`, message `persona_id`/`character_id`); only exact `character:\d+` strings translated; K-2 copies in `rewind_taken` written without `id`; a `chosenImages` entry on a player seat is left + counted (SDK regex accepts only `character:`/`seated-member:`). Left (★K-3): genre presets' widgetSettings, `lorebooks.annex_audiences`, `rankings.speaker_ref`, receipts' portrayals, `session_changes.payload`, Mundi annex, other plugins' delta documents.

**Tests:** new `seatKeys.int` (10), `seatKeys.json.int` (16), `seatKeys.gate.int` (4: Back → pass → Forward → Back via real `rewindTurn`/`forwardTurn`; one session's failure; second run over all 15 stores with K-2 + merged pair + overlapping ids, `to_jsonb` dumps of 11 tables identical; pre-flip backup via `dumpDataDir`/`loadDataDir`), `seatKeys.attic.int` (2: 0.5.3 fixture → upgrade → own books → seat-members → versions → seat-keys). Edited `seats.int`, `seatMembers.int` (new: own-book session gets a member for every live carded seat; second run zeros); outside list (assertions/names only) `seatSites.int`, `sockets/sessions.seatCast.int`. Lane run 12 files 129/129; final 43/43. Measured on a seeded DB (60 sessions, 24k+24k messages…): no-op median 32.9 ms; one candidate 52.5 ms; first flip over 60 sessions 3.6 s.

**Open ★f-pass-1** (scope review, medium): `playHasWritten` (`sessions/bookLock.ts:28-54`) counts any own-book member as play, and `catchUpOfferFor` (`sessions/closeOut.ts:79`) returns null once play has written → a new session on another user's or a provided book loses the catch-up offer as soon as the mint runs. Rec: `playHasWritten` stops counting own-book members a seat of this session holds. → **lead: fixed directly (regression guard; see plan).**

**Decisions:** the pass doesn't mint (relies on `seat-members` first); `left` items recount every run (stay candidates until S5); merged-pair survivor = first character seat holding the member.

**Noticed, not done:** `memberFormTargetsOf` returns a duplicate target when one card sits in two character seats of one member (pass de-dupes); `rewind_taken` pre-filter over-matches harmlessly; several test `session()` helpers make sessions with no own book (production never does).

**NOMENCLATURE rows queued:** seat-writer row — replace "else none yet — S1 never mints into the own book (…)" with "else a new one in the own book (★B-5, 2026-11-08: the book is fixed at start, so an own-book member may count as play; s4-f-pass)"; `seat-members` row — add "since ★B-5 (2026-11-08) a live carded seat of a session with an own book is also a candidate: the own book takes a new member for a live card (s4-f-pass)"; new row ⏳ 🚧 **`seat-keys`** (as summarised above); §25: "2026-11-08 (lane s4-f-pass, plan §34.1, ★B-5/K-2/K-3/K-4 as ruled): own-book mint in `resolveSeatMember` (supersedes S1's 'never mints into the own book'); ⏳🚧 `seat-keys` boot pass (`seatKeys`, `SeatKeysReport`, `SEAT_KEY_STORES`), not in startup until wave 3."

## Startup hunk for wave 3 (verbatim)

```ts
	{
		/**
		 * ⏳ plan §34.1, seat-cast S4: every carded seat's stored keys move from
		 * card form (`session_cast:<cardId>`, `character:<cardId>`) to member
		 * form (`seated_member:<castMemberId>` / `seated-member:<id>` for a
		 * character seat, `player_seat:<seatId>` / `player-seat:<id>` for a
		 * player seat) — owner columns, proposals and the JSON stores holding
		 * seat refs. After `seat-members` (every live carded seat has its
		 * member) and `character-versions`. One transaction per session; a
		 * session that fails is logged and left, and the task reports it to the
		 * launcher's health (`failsHealth`). A restored backup reruns it. Lives
		 * until S5 drops card form.
		 */
		name: "seat-keys",
		failsHealth: true,
		run: async () => {
			const { seatKeys } = await import("$lib/server/sessions/seatKeys")
			const r = await seatKeys(db)
			const moved = Object.values(r.rekeyed).reduce((a, n) => a + n, 0)
			if (moved || r.copied || r.dropped || r.left)
				console.log(
					`[seat-keys] ${r.sessions} session(s): ${moved} row(s) or document(s) moved to member form, ${r.copied} copied, ${r.dropped} dropped, ${r.left} left in card form`
				)
		}
	},
```
