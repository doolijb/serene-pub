# BRIEF — worker `s4-rul-a-w3` (2026-11-10) — card stats refused at the session sheet (★s4-fb-1); the seater edits hidden stats while showing them (★s4-fb-3)

Supervisor: lane `s4-rul-a`. Repo `/home/jody/github/serene-pub`. Use absolute paths.

Context: worker w2 has just renamed *overhear* to **hidden stats** (names only). The pieces you build on are:
- `state/earshot.ts` `hearingWithHiddenStats(hearing, links, memberIds)`;
- in `sockets/state.ts`: `callerHearing`, `callerView`, `hiddenStatsShownMembers`, `seatsSeatedBy`;
- the `state:get` param `showHiddenStats?: string[]`, kept per connection in `socket.data.hiddenStatsShown`;
- the owner-row field `showingHiddenStats`;
- the test file `src/lib/server/sockets/state.hiddenStats.int.test.ts`.

Read those first.

## Goal 1 — card stats are edited in the card editor (★s4-fb-1)

The owner approved, word for word: refuse card stats at the session sheet with **"Card stats are edited in the card editor."** and update the test.

- In `src/lib/server/sockets/state.ts`, `stateSet` and `stateConfigure`: right after `owner(...)` resolves the target, refuse a `target.kind === "card"` with exactly that sentence. Use the file's `refuse(emit, event, sentence)`; in `stateSet`, use `reply.emitToUser` so the refusal carries the `requestId`. Put it before `handEditRefusal` and before any write.
- Don't change `state/write.ts`: `setValue` / `configure` keep their own `card` rule for other callers. Don't touch `state:setCarry` (it also calls `owner(...)`).
- `src/lib/server/sockets/state.ownerScope.int.test.ts`:
  - the test at ~243–257 ("its book, its place, its member, and the writer's card") drops the card from the written list;
  - add a test that `state:set` **and** `state:configure` on the caller's **own** card and on another user's card are both refused with "Card stats are edited in the card editor." and write no row;
  - update the other card expectations in that file (~225, ~266, ~285, ~288) to the new sentence where the socket now answers first;
  - leave ~291–292 alone: they call `configure` directly and still pin the write layer's rule.
- Grep the other server tests that send a `card` owner through `state:set` / `state:configure` (`grep -rn 'kind: "card"' src/lib/server --include=*.test.ts`) and update any that now meet the door. List them.
- Check whether any session UI still offers a card-owned stat control. The client's `requests/setAttributeValue.ts` already refuses a `card` owner ("session layer only"), and `describeState` builds no `card` owner row. Confirm by grep; if you find another offer, **report it, don't edit it**.

## Goal 2 — the seater edits hidden stats while showing them (★s4-fb-3)

The owner vetoed "read-only" and answered **"Seater may also edit"**: *"While Show secrets is on, the person who seated the AI character can also change and configure its hidden stats and answer its hidden proposals."* (*Show secrets* is now **Show hidden stats**.)

The hearing rule still holds (NOMENCLATURE `earshot` row, plan A28 2026-09-30): *"A person **changes** such a value only where they hear it: `state:set` and `state:configure` refuse otherwise, and `state:decide` answers a pending change the caller does not hear as _Proposal not found._"* So **showing becomes hearing**: the connection's shown seats join the caller's hearing for that caller's hand edits and proposals, exactly as they already do for reads. Nobody else gains anything: `hiddenStatsShownMembers` keeps only seats the caller seated (`seated_by_user_id`) and asked to show.

Hand edits are judged by **`sheetLatitudeAllows`**, the one pure judge (NOMENCLATURE ~3280: *"the one pure judge of a person's hand edit, shared by the host's write gate and the sheet's edit controls (P2: one decider)"*). Its order: *"watcher → only the owner locks → earshot → lock → item moves → sheet latitude → `changedBy`"*. **No second decider.** Keep the latitude, lock and `changedBy` checks as they are. Change only the `heard` input.

- `src/lib/server/state/handEdits.ts` `handEditRefusal` (~609–640): add an optional third parameter `known: { links?: SessionLinks; hearing?: Hearing } = {}` and pass it to `handEditJudge(db, q.sessionId, q.userId, known)`. `handEditJudge` already uses `known.hearing` (~182–193). Add a one-sentence doc line. Other callers (`give.ts`) stay as they are.
- `src/lib/server/sockets/state.ts`:
  - `stateSet` and `stateConfigure`: read `links = await sessionLinks(db, sessionId)` and `hearing = await callerView(socket, sessionId, links)`, and pass `{ links, hearing }` to `handEditRefusal`.
  - `stateProposals`: list with `callerView`, not `callerHearing`.
  - `stateDecide`: the "Proposal not found." gate (~1747) and the reply's `proposals` / `state` (~1758) use `callerView`.
  - `describeState`: hand the judge the view, `handEditJudge(db, sessionId, viewerUserId, { links, hearing: viewHearing })`, so the sheet's `editable` / `handLocked` agree with the write gate.
  - Leave `carriesOnWire` / `state:setCarry` and `givePiece` alone. If `givePiece` now disagrees with `state:set` for a shown seat, put it under Noticed.
  - Comments: rewrite the doc of `callerView` (~381, it says "never a write gate or a proposal"), the `describeState` param docs for `viewHearing` / `hearing` ("`hearing` stays the write gate's"), and `hearingWithHiddenStats` in `state/earshot.ts` ("read-only (never a write gate)"). Say what is true now: the caller's hearing for reads, hand edits (judged by `sheetLatitudeAllows`) and proposals, and cite ★s4-fb-3 (owner, 2026-11-10).

**Configure: expected outcome, don't work around it.** `sheetLatitudeAllows` refuses every `configure` by anyone but the session owner (`owner-locks`, before earshot is asked; SDK `sdk/src/sheetLatitude.ts:197`). So the seater's `state:configure` stays refused with *"Only the session owner changes how a stat is set up."* even with the view on. Changing that needs a change to the SDK judge, which the supervisor is raising with the owner as a ★. **Don't** pass a different `role`, skip the judge, or add a special case. Pin today's refusal in the test, with a comment naming the open ★.

### Tests — `src/lib/server/sockets/state.hiddenStats.int.test.ts`

It already has a case where the seater's write on the holder-only value is refused exactly as before. Replace that case with these:
- **Seater, view on:** `state:set` on that seat's holder-only value is written. A pending proposal on that value is listed by `state:proposals` and can be decided (accept and reject both answered; seed the proposal the way `src/lib/server/sockets/state.earshot.int.test.ts` does). `state:configure` is still refused with the owner-locks sentence (the open ★).
- **Seater, view off** (or never asked): `state:set` is refused (unheard), the proposal is not listed, and `state:decide` answers "Proposal not found."
- **A third user** (another guest who did not seat it), even sending `showHiddenStats` with that seat's ref: refused for set and decide, and the proposal is not listed, whether the seater's view is on or off.
- **The session owner:** unchanged; sets and decides as before.
- Cover the carded seat and the card-less seat if the existing fixture already has both.
- The seater must be a guest who plays (`session_guests.is_player = true`): a watcher is refused by `watching` first. Use a slot with no `changedBy`. If the fixture makes any of that impossible, say so; don't loosen the judge.

Every `it` that opens a DB gets a 60 s timeout.

## Docs — `docs/stats-and-states.md` ~232

Rewrite the last two sentences of that paragraph in plain user words:
- the guest who seated the character can turn on **Show hidden stats** on its sheet to see its hidden stats, on their own screen only, until they leave the session; the AI still plays the character;
- while it is on, they can also **change** those values and **answer the changes proposed** to them;
- who can change a whisper: the people who play the character, the session's owner, and the person who seated it while showing its hidden stats.

Don't promise *configure* (open ★). Keep the paragraph's voice: short sentences, no code names.

## Run

Capped scope, logged:

```
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run src/lib/server/sockets/state.hiddenStats.int.test.ts src/lib/server/sockets/state.ownerScope.int.test.ts src/lib/server/state/earshot.hiddenStats.test.ts src/lib/server/state/earshot.test.ts src/lib/server/sockets/state.earshot.int.test.ts src/lib/server/sockets/state.int.test.ts <any other test file you changed> --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-rul-a-w3-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-rul-a-w3-tests.log'
```

Also run, in the same way into `s4-rul-a-w3-tests2.log`, every other `src/lib/server/**/*.test.ts` whose name starts with `state.` or `handEdits` or contains `sheetLatitude`. Find them with `ls src/lib/server/sockets/state.*.test.ts src/lib/server/state/*handEdit*.test.ts`. Never pipe vitest into `head`.

## Files owned

- `src/lib/server/sockets/state.ts`, `src/lib/server/state/handEdits.ts`, `src/lib/server/state/earshot.ts` (the doc comment only)
- `src/lib/server/sockets/state.hiddenStats.int.test.ts`, `src/lib/server/sockets/state.ownerScope.int.test.ts`, and any other server test that sends a card owner through `state:set` / `state:configure` (list each)
- `docs/stats-and-states.md` (that paragraph)

## Files readable

`src/lib/server/state/write.ts` (`decideProposal` ~2835, `assertSeatDecider` ~3080, `assertMayDecide`), `src/lib/server/state/give.ts`, `../serene-pub-sdk/sdk/src/sheetLatitude.ts`, `src/lib/client/components/sessionPage/requests/setAttributeValue.ts`.

## Rules you work under (quoted)

- CLAUDE.md P2: *"A module owns its data and every write to it … Two writers of one thing is a bug."* and the decider charter above: one judge.
- CLAUDE.md: *"Inside `db.transaction(async (tx) => …)` use only `tx`."*
- CLAUDE.md: *"Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing 'for later'."*
- CLAUDE.md: *"It is a **session**, never a *chat*."* Use plain user words in the docs.
- No new exported names beyond the optional `known` parameter. If you need one, stop and report it.
- Prettier: run `npx prettier --check` on the files you changed, but only `--write` the lines you changed. Never reformat a whole file you didn't otherwise edit; `sockets/state.ts`, `earshot.ts` and `handEdits.ts` already fail the check on lines nobody here wrote. Leave those and say so.
- `src/lib/server/sockets/sessions.ts` and `src/lib/server/sessions/seats.ts` belong to another lane. Don't touch them. A `seats.ts` tsc error from that lane is not yours.

## Stop and ask (in your report) when

- a test can't pass without changing the judge, a role, or `write.ts`;
- you'd need a new name or a stored-data change;
- the owner's words and the code disagree on anything besides `configure`.

## Done means

All the test files above pass. Report (your final message): the changed files, the exact refusal points, test results with counts and log paths, the card-UI check result, Noticed-not-done.

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.*
