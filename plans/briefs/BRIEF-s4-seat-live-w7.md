# BRIEF — lane `s4-seat-live`, worker w7 — end-to-end int test: a card-less seat plays (2026-11-08)

Supervisor: lane `s4-seat-live` (seat-cast S4, wave 4 follow-up; **the flip is ON** — `src/lib/server/state/memberForm.ts` `memberFormSwitch = { on: true }`). Repo `/home/jody/github/serene-pub`. Report in your final message (no report file). Worker w8 runs beside you on docs — no shared files.

## Context (quoted by the supervisor; never reinterpret)

- Owner 2026-11-05: "Everything in session is cast → active card." · ★S2b-1 "Still theo": the person who seated a cast member keeps acting for that seat. · ★4 (2026-11-08): background member = not seated in this session. · ★6 (2026-11-08): a named "Take a seat" mints a card-less member in the session's book.
- A **card-less character seat**: `session_characters` row, `character_id` NULL, `envoy_slug` NULL, `cast_member_id` = M; ref `seated-member:M`; state owner `{ kind: "seated_member", id: M }`; its lines `character_id` null, `cast_member_id` M, `metadata.speaker = "seated-member:M"`.
- ⚠ Card ids and member ids share one id range — in fixtures, make at least one card whose id could equal a member id where cheap, and assert nothing crosses.
- This lane already built every piece and unit/int-tested each (read these tests — they are your harnesses; copy their setup, mocks and model fakes): `src/lib/server/sessions/fireTurn.cardless.int.test.ts`, `src/lib/server/pipelines/runtime/speakerLore.cardless.int.test.ts`, `src/lib/server/pipelines/runtime/host.sessionCast.cardless.int.test.ts`, `src/lib/server/pipelines/prompt/promptFields.cardless.test.ts`, `src/lib/server/connections/stops.cardless.test.ts`, `src/lib/server/pipelines/runtime/dispatch.cardless.int.test.ts`, `src/lib/server/pipelines/runtime/pickSprite.seatedMember.int.test.ts`, `src/lib/server/state/resolve.cardlessSeat.int.test.ts`, `src/lib/server/sessions/seatName.mint.int.test.ts`, `src/lib/server/messages/permissions.cardless.int.test.ts`, `src/lib/server/sessions/seats.cardless.int.test.ts`, `src/lib/server/utils/replyRoad.int.test.ts`.

## Goal

ONE new int test file, `src/lib/server/sessions/cardlessSeat.e2e.int.test.ts`, that drives a card-less seat **through the real handlers** (the same entry points production uses — `fireTurnEntry` / `runReply` / the message verb for regenerate / the state write door / `canActOnMessage` / `writeSeatName`; fake only the model and embedding calls, the way the harnesses above do). One shared fixture (`beforeAll`, 60 s): owner + guest; a session with its lorebook; member **M** (card-less, seated by the **guest** via `seatCast({ castMemberId: M, seatedBy: guest })`), member **N** (card-less, seated), member **B** (not seated); a carded seat **C**; private lore for M, N and B; a ruleset/attribute slot as the state tests declare one; a sprite set on M (as `pickSprite.seatedMember.int` does).

Each its own `it`:
1. firing M's `seated-member:M` turn-order entry runs a turn **as M** (the run's speaker `seated-member:M`, `currentCastMemberId = M`, not a narrator turn);
2. the compiled prompt (capture it from the fake model call or the receipt) names M on the seed line and carries M's member description, and **not** as the narrator;
3. that run's retrieved private lore includes M's entry and not N's or B's;
4. the stop list sent to the model does not contain `M:` and does contain `N:`;
5. the written reply row: `character_id` null, `cast_member_id` M, `metadata.speaker = "seated-member:M"`, content = the fake reply (not empty);
6. regenerate that row (the real verb handler path the harnesses use) → re-driven as M; the row keeps all three stamps;
7. the sprite pick for M's line is from M's own sprite set (`castMemberId` path);
8. a state write on `{ kind: "seated_member", id: M }` lands and `stateFor` shows it on `byId["seated_member:M"]` only;
9. `canActOnMessage` on M's line: the guest who seated M → true; the owner → true; a second guest → false;
10. a named Take a seat (`writeSeatName`, a player, no seat) creates exactly one new card-less member in the session's lorebook and a player seat holding it.

If an assertion fails because the product is wrong (not the test), **do not fix product code** — keep the `it` (mark it `it.fails` only if the supervisor's brief rule allows: it does not; leave it failing) and report the failure with the evidence (expected/received, file:line you traced it to).

## Files owned (edit only these)

`src/lib/server/sessions/cardlessSeat.e2e.int.test.ts` (new).

## Files readable

Everything (the harnesses above first).

## Out of scope

Any product file. Other test files. Docs. NOMENCLATURE.

## Stop and ask (in your report) when

A step can't be reached through a real handler without changing product code; a product bug is found (report it, don't fix it).

## Hard rules (CLAUDE.md)

- Inside `db.transaction(async (tx) => …)` use only `tx`. Never seed a row at a fixed id (let ids be generated). No migration.
- An int test that opens a DB inside an `it` needs a 60 s timeout; `beforeAll` too. Never pipe vitest into `head`.
- It is a **session**, never a chat.
- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no sdk:build; don't build.)
- Never `kill -9` anything. Never `git checkout`/`restore`/`stash`.

## Tests (Done means)

```
SP=/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run src/lib/server/sessions/cardlessSeat.e2e.int.test.ts --maxWorkers=2 > $SP/s4-seat-live-w7-tests.log 2>&1; echo test-exit=\$? >> $SP/s4-seat-live-w7-tests.log"
```

All ten pass (or each failure reported as a product finding with evidence). `npx tsc --noEmit -p .` (12G scope, `NODE_OPTIONS=--max-old-space-size=8192`, log `$SP/s4-seat-live-w7-tsc.log`) — no new errors. `npx prettier --check` the file.

## Report (final message)

The file; which real entry point each `it` drives and what is faked; results + log path; tsc; product findings (if any) with evidence; Noticed, not done.
