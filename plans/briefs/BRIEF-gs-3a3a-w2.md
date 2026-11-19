# BRIEF gs-3a3a-w2 — HM1: a seat holding the session owner's card is the card owner's to change, whoever plays it

Repo `/home/jody/github/serene-pub` (app). The SDK repo `../serene-pub-sdk` is **read-only**: no edit, no build.
Supervisor: lane `gs-3a3a`. Report: your final message, under ~450 words.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`: don't run one.)

Also: run **no git command that changes the index or the working tree**. Never `prettier --write`, never pipe prettier's output into a file. No migration, no `npm run build`, no full test run.

## The ruling (owner, 2026-11-17, quoted)

HM1 (the sheet of the owner's character a guest plays): "Session owner via their own card or cast in the lorebook. Granular permissions later to allow co-editin". Lead's reading, ruled for this lane: for a seat whose **card belongs to the session's owner** and whose **person is a guest** — a player seat (`session_personas`, person = `user_id`, a row with `user_id` null reads its card's owner) holding the owner's card, or an AI-played character seat (`session_characters`, person = its seater `seated_by_user_id`) holding the owner's card and handed to a guest with **Played by** — **only the card's owner changes its sheet**, in play and outside it; the guest still speaks as it and takes its turns. **One named function holds the decision**, so a later co-editing permission widens one place.

This reverses, for that case only, the player rule at `state/handEdits.ts` ~431–435 ("A live seat's character is its player's, whoever owns the card", scope review 2026-11-05) and what lane gs-3a2 left as built through `seaterOf` (~245–246, ~444–450).

**Not changed (waits for the owner, HM2):** every **card-less** seat a guest plays (their own named seat, a card-less member they took or were handed, a shared-card copy) keeps today's rule. A card owned by anyone other than the session's owner keeps today's rule (e.g. the existing test "a live seat's character is its player's, whoever owns the card": Bo's card played by Cara — both guests — stays as it is). `canEditCastMember` (`cast/memberAccess.ts` 107–150) already asks the card's owner outside play: **leave it**. `assertSeatDecider` (`state/write.ts`, who decides a held change) is not this: leave it.

Project rules (CLAUDE.md, quoted): "Inside `db.transaction(async (tx) => …)` use only `tx`." · "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing." · Comments state the rule, never the history.

## Files owned (only these)

- `src/lib/server/state/handEdits.ts` — the "whose" decision and the `not-theirs` sentence for the new case.
- New test `src/lib/server/state/handEdits.cardOwner.int.test.ts`.
- `src/lib/server/state/handEdits.int.test.ts` — only if an existing expectation changes **exactly in an HM1 row** (session owner's card, guest person); then update it with a one-line comment citing HM1 (2026-11-17). Any other changed expectation: don't edit, report it.

Not yours: everything else (`state/write.ts`, `cast/memberAccess.ts`, `state/resolve.ts`, sockets, client, docs, NOMENCLATURE). Live lanes' files (`wt-1a`: `scenes/liveScenes.ts`, `utils/sceneCast*.ts`, `sockets/scenes.ts`, `utils/activityStore.ts`; `ap-2a`: `plugins/providedMarks.ts`, `sockets/lorebooks.ts`, `utils/ownedBook.ts`, `lorebooks/ownBook.ts`, `state/durable.ts`, `shared/lorebooks/primerRow.ts`) may show `tsc` errors: not yours, judge only your files.

## Build

1. A named, exported, pure function in `handEdits.ts` (name ★ provisional, keep it): 
   ```ts
   /** 🚧 … purpose, the HM1 rule with the owner's words, card-less and other cards keep their person, the one place a co-editing permission widens. */
   export function seatSheetHolder(q: { cardOwnerId: number | null; personId: number | null; sessionOwnerId: number | null }): number | null
   ```
   Returns whose sheet the seat is: the card's owner when `cardOwnerId != null && cardOwnerId === sessionOwnerId`; otherwise `personId` (today's). The "card owner" is the one `handEditJudge` already reads (the owner of the member's **active** card, `learnCharacters`/`cardFacts`).
2. Use it in `whose` (~419–465) so that **only HM1 rows change** and every other row gives exactly today's answer:
   - `player_seat` owner: a carded seat whose card owner is the session's owner and whose person is not the session's owner → the session's owner's: `role === "owner"` → `own`, a player → `other`. Add the card owner to `SeatFacts` (built ~350–364 from `characters.get(rowKey(r))?.userId`) so the function can read it.
   - `role === "player"`, a carded owner (`session_cast` / `card` / `seated_member` with a card / `cast_member`): the player seat holding it (`playerSeatOf`) → same rule; else a character seat (`seaterOf`, then `factsOfOwner`) whose card owner is the session's owner → `other` for the guest.
   - `role === "owner"`, a carded owner: today "a live seat's player is somebody else" → `other`; with HM1 a player seat holding the owner's own card → `own`.
   - Card-less (`seated_member` with no card; a card-less `player_seat`): untouched.
   - Keep `userId` null (the owner's view) behaving as today outside HM1 rows.
   Update the comment block at ~431–435 to state the rule as it now is.
3. `notTheirs` (~468–487): for an HM1 refusal to the guest who plays it, today's words ("only ‹name›'s player or the session's owner can change their sheet.") are wrong (the guest IS its player). New sentence (★ provisional): `` `${name} is the session owner's card, so only they change its sheet.` `` (fallback name "That character"). Every other refusal keeps its words.
4. `describeState`'s `editable` / `handLocked` read the same judge: nothing to change, but test it (below).

## Tests (`handEdits.cardOwner.int.test.ts`; copy the setup of `handEdits.int.test.ts`)

The matrix, one row each, asserting `judge.whose(owner)` from the **session owner** and from the **guest**, and `refusal` for a free `set` under the players' level **as-ruled** ("honour mode on") and **no-edits** ("honour mode off"; owner level default):
- card ∈ { session owner's card, guest's own card, card-less } × person ∈ { session owner, guest } × seat kind ∈ { player seat, character seat }.
  (A guest's card with the owner as person is not reachable by any door — S2; build it as data anyway and assert today's answer.)
- Name in a comment which rows changed (expected: session owner's card × guest person × both seat kinds; nothing else).
- Plus: the new sentence for the guest; `state:get` (`describeState`) for the guest shows the owner's-card seat not `editable`, and for the owner `editable`; a card-less member the guest took (character seat, seater guest) stays the guest's.
Run: the new file, `src/lib/server/state/handEdits.int.test.ts`, `src/lib/server/state/handEdits.cardless.int.test.ts`, `src/lib/server/sockets/state.seatIdentity.int.test.ts` — one run:
`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done; systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/gs-3a3a-w2-<n>.log 2>&1"` (never pipe vitest into `head`; int tests that open a DB inside a test need a 60 s timeout). `tsc`: `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .`, your files only.

## Report

Files changed; the function and where `whose` calls it; the full matrix as a compact table (before → after per cell, marking changed cells); the sentence; tests (log path, counts); existing expectations changed and why; tsc and prettier `--check` for your files; **Noticed, not done**.
