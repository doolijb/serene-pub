# BRIEF — worker `time-t6f-w2` (app tests for Story's and the Lair's knowledge filter)

Supervisor: lane `time-t6f`. App repo `/home/jody/github/serene-pub`; SDK `/home/jody/github/serene-pub-sdk`
(read only for you). Report path: your final message (the supervisor reads it). Keep it under ~400 words.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

**You never run `sdk:build`** (the supervisor does). Never `git checkout / restore / stash`. Never `prettier --write`.
Never `kill -9`. Never pipe vitest into `head`/`tail` (SIGPIPE leaks PGlite temp dirs): redirect to a log file and
read the log. Comments state the rule, not the story. No other product's name in any file. An int test that opens
a DB needs `vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`. Inside `db.transaction(async (tx) => …)`
use only `tx`.

**Test runs — strictly one at a time across the lane, and only in this form** (another worker shares the lane; the
lock serialises you):

```
cd /home/jody/github/serene-pub && flock /home/jody/github/serene-pub/plans/time-t6f.lock \
  systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet \
  bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t6f-w2-<n>.log 2>&1"
```

Before your first run, also check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` for a peer session's
run; if one is up, wait for it to finish (re-check every few minutes) rather than starting yours.

## Owner ruling, 2026-11-15 (in his words)

- Should Story and the Lair use the knowledge filter on a character's own turn: "Yes. It should be cheap enough, i think."

## Context

Another worker is placing `core:query/unknown-entries@1` in two SDK specs (not built yet; the supervisor runs
`sdk:build` after you report step 2 below):

- Story's reply `core:spec/story-respond`: node `gather.unknownEntries.read`, `speaker: $.input.speaker`, its
  `exclusions` wired into the `eligible` step (the `retrieval` junction's `on` branch).
- The Lair's delver voice (`core:spec/lair-reply`, `voiceBranch`, reached by **Pick who speaks** on a delver):
  node `via.turn.channel.story.pick.picked.unknownEntries`, speaker the voice's own, exclusions into that branch's
  `eligible`.

The node (binding `src/lib/server/pipelines/runtime/bindings.ts` ~2909; decision
`src/lib/server/lorebooks/entryKnowledge.ts` `loadEntryKnowledge` ~238) leaves an entry out of a cast member's own
turn when it is marked *not common knowledge* and the speaker has no active tie to it (or a *kept from* tie wins).
No speaker / not a cast member (a narrator turn) reads everything. Nothing marked and no *kept from* tie: one
statement, receipt `NOTHING_MARKED_RECEIPT`. Writers: `setEntryCommonKnowledge(db, { userId, entryId,
notCommonKnowledge: true })`, `writeKnowledgeTie(...)` (read its signature) — the lorebook's owner only. Receipt
notes: `ctx.log` → the node's `NodeReceipt.notes` (see `src/lib/server/pipelines/runtime/receipts.int.test.ts` for
reading a run's receipts).

## Goal

1. Write **one new test file** `src/lib/server/pipelines/runtime/unknownEntries.reply.int.test.ts` that drives the
   real reply road with only the model faked:
   - **Story** — model it on `src/lib/server/pipelines/runtime/speakerLore.cardless.int.test.ts` (runReply,
     `bootstrapPipelines`, a `core-story-minimal` preset, a fake adapter). Capture the assembled prompt the way
     `src/lib/server/pipelines/runtime/earshot.int.test.ts` ~75–100 does (`withCompiledPrompt(p)` → keep `p`). World:
     a carded cast member A seated, a world-lore entry E in the session's lorebook whose keys match the user's line
     (use the helpers in `$lib/server/utils/lorebookEntries`, e.g. `entryInsert` / `WORLD_LORE_TYPE_ID`, as
     `src/lib/server/pipelines/parity/productionParity.int.test.ts` does), with distinctive content.
   - **Lair** — model it on the "B15 · Pick who speaks" test in
     `src/lib/server/sockets/sessions.lairCastRows.int.test.ts` (~703–728: `via: "pick"`, `ref: character:<id>`):
     the delver's own prose prompt. (It may be simpler to put the Lair half in a second new file
     `src/lib/server/sockets/sessions.lairUnknownEntries.int.test.ts` reusing that file's harness shape; your call,
     say which in the report.)
   - Cases, for each genre:
     a. **nothing marked**: the speaker's prompt holds E's content. Log, with `console.info`, a sha256 of the
        assembled prompt and the run's total statement count (count with the `$client.query` wrapper used in
        `src/lib/server/pipelines/runtime/bindings.firsthand.int.test.ts` ~195–208, wrapped around the reply call).
        Make the prompt deterministic across fresh runs (fixed message `createdAt`, names without counters); assert
        two fresh nothing-marked worlds in one file run give the same hash.
     b. **the receipt shows the node's line**: on the nothing-marked run, the `unknown-entries` node's receipt notes
        hold the nothing-marked sentence.
     c. **marked, untied**: after `setEntryCommonKnowledge`, A's own-turn prompt lacks E's content.
     d. **narrator reads it** (Story: `turn: { kind: "respond" }` with no `characterId`; Lair: skip if the Lair has
        no narrator turn through a spec carrying the node — the Castellan's own turns read everything and do not
        place the node, so asserting E present on a Castellan narrate turn is fine if the harness has it): E present.
     e. **tied**: with a `knows` knowledge tie from A's cast member to E (A's member is `seatOf(...).castMemberId`
        / the seat's `castMemberId`), A's prompt holds E again.
2. Run the file(s) now, **before the build**. Expected now: (a) passes (record its hash and statement count: this is
   the baseline), (d) passes, (b), (c) fail because the specs do not place the node yet; (e) passes trivially.
   Anything else failing is your bug; fix it. Then **stop and report** with the baseline numbers per genre and
   the log path. Do not wait for the build.

## Files owned

The new test file(s) above. Nothing else.

## Files readable

Anything in either repo.

## Out of scope

Any change to non-test code, the SDK, docs, other tests, specHashes re-pins (the supervisor handles those).

## Stop and ask when

The harness needs a change to non-test code; E cannot reach the Story prompt with nothing marked (say why); the
Lair pick road cannot be driven; anything needs a new name outside the test file.

## Done means

The file(s) written; one run before the build with the expected pattern above; `npx prettier --check` on the new
file(s). Report: file paths, test names, the baseline hash and statement total per genre, the log path, and any
`/tmp/serene-pub-vitest-*` dir your run left (by name).
