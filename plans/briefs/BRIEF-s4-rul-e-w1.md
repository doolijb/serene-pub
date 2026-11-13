# BRIEF — s4-rul-e-w1 (2026-11-10) — tests: a card-less member's own words save and read back

You are a `lane-worker` for lane `s4-rul-e` in `/home/jody/github/serene-pub`. Tests only: no production code changes.

## Background

Owner, 2026-11-10, on "a cast member with no card has no Description, Personality, Scenario, Greetings or Example dialogues on its form": **"Build it now"**. Cascade principle (owner 2026-11-09): *"a card is a seed, not the sole carrier… not having a card doesn't make them 2nd class."*

The supervisor changed `src/lib/client/lorebooks/cast/memberDraft.ts`: `memberPatch(draft, linked)` for a card-less member (`linked === false`) now carries, besides `name`, the member's own `description`, `personality`, `scenario`, `firstMessage`, `alternateGreetings`, `groupOnlyGreetings` and `exampleDialogues` (new private helper `wordsPatch`; empty text → `null`, greetings as typed, empty ones kept). Still **no** `retold`, `faceMediaId`, `ownName` or `ownNickname` for a card-less member. A carded member's patch is byte-for-byte unchanged (same keys, same order). Read the file first.

Storage already holds these for a card-less member (`memberProfileOf` in `src/lib/server/characters/versions.ts` ~180–262: "Card-less: every field is own"); the server save `writeMemberEdit` / `writeShownEdit` in `src/lib/server/sockets/lorebooks.ts` (~1618–1800) picks them with or without a card. Another worker (w2) is editing `CastMemberForm.svelte` and the member DOM tests at the same time — don't touch those.

## Files owned

1. `src/lib/client/lorebooks/cast/memberDraft.test.ts` — update and add.
2. New `src/lib/server/sockets/lorebooks.cardlessWords.int.test.ts`.

Read-only: everything else. If a test shows the server does **not** save or read back one of the seven fields for a card-less member, do not change server code: stop, record the exact failing assertion and what you traced (file:line), and report.

## Tests to write

### `memberDraft.test.ts`
- The test "a background member's patch carries no retold fields" (~205) asserts `not.toHaveProperty("description")`; that is now intended to change. Replace it with: a card-less member's patch carries its own seven words fields (empty text as null, greetings as typed, an empty greeting kept) and still no `retold`, `faceMediaId`, `ownName`, `ownNickname`.
- A card-less draft whose description (and, separately, a greeting) changed is dirty (`sameMemberDraft(…, false)` false); an untouched one is clean, and `changed`-style comparisons of `memberPatch(draft,false)` vs `memberPatch(pristine,false)` differ only in the edited key.
- A carded member's patch keys and order are unchanged: assert `Object.keys(memberPatch(memberDraftOf(<a carded row>), true))` equals the exact list (summary, nodeState, nodeVisibility, spriteSet, aliases, timbre, postHistoryInstructions, creatorNotes, likeness, ownName, ownNickname, description, personality, scenario, firstMessage, alternateGreetings, groupOnlyGreetings, exampleDialogues, faceMediaId, retold) — verify against the file; if the order differs from this list, the file wins, record it.
- Keep every other existing test passing unedited.

### `lorebooks.cardlessWords.int.test.ts`
Model it on `src/lib/server/sockets/lorebooks.versionOnlyKeys.int.test.ts` (same `vi.mock("$lib/server/db")`, `createTestDb`, data dir with prefix `serene-pub-vitest-cardless-words-`, `releaseDataDir` in `afterAll`, `vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`, `updateLorebookBindingHandler.handler`, `membersAsRead(db(), [id], { reading: MAIN_HEAD })`).
1. **A card-less member edits each of the five and reads them back.** Insert a card-less member with `insertCastMember` (`characterId: null`, some starting words). Send an update with the seven keys (as `memberPatch(draft, false)` would give them — you may import `memberPatch`/`memberDraftOf` from `$lib/client/lorebooks/cast/memberDraft` if it imports cleanly in the node test env; otherwise write the literal object and say so). Then `membersAsRead` returns the new description, personality, scenario, the greetings (opener, alternates; check how a card-less member's group-only greetings come back and assert what the read actually gives, documenting it), and example dialogues. Also assert the update response's `lorebookBinding` carries them.
2. **A member made card-less by a card delete keeps the card's words and can edit them.** Insert a card with description/personality/scenario/firstMessage/alternateGreetings/exampleDialogues and a carded member that follows them; run `makeMemberCardless` (`src/lib/server/cast/cardless.ts`; see `src/lib/server/cast/cardless.int.test.ts` "a card-less member" / "card delete" for how it's called, inside a transaction using only `tx`) — or the card delete handler if simpler. Assert `membersAsRead` shows the card's words on the now card-less member; then update its description through `updateLorebookBindingHandler` and assert the read shows the new description while the other fields keep the card's words.
3. **A carded member is unchanged**: one carded member update of a retold description (`retold: { description: true }`, `description: "…"`) still reads back as before (short; guards the shared helper).

## Rules

- CLAUDE.md: inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently. Never seed a row at a hardcoded id. An int test that opens a DB inside an `it` needs a 60 s timeout. It is a **session**, never a *chat*.
- Don't fix anything else you notice; list it under "Noticed, not done".

## Commands

- Tests, capped scope, logged (never pipe vitest into `head`):
  `cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run src/lib/client/lorebooks/cast/memberDraft.test.ts src/lib/server/sockets/lorebooks.cardlessWords.int.test.ts --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-rul-e-w1-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-rul-e-w1-tests.log'`
- Afterwards list `/tmp/serene-pub-vitest-cardless-words-*` and delete only those your run left, by full name.
- Don't run tsc / `npm run check` / `npm test`; the supervisor does.
- Prettier: `npx prettier --check <file>`; `--write` is fine on your new file; on `memberDraft.test.ts` only your changed lines.

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (This lane runs no `sdk:build` at all.)
- Never `git checkout` / `restore` in either repo. Don't start a dev server.

## Report (your final message)

Changed files; each test and what it asserts; pass/fail counts (log path); anything the server didn't do as expected (file:line); prettier result; Noticed, not done.
