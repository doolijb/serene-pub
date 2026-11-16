# BRIEF — worker `time-t6b-w1`: the SDK half of the firsthand option (two in-ports on two nodes, one validate warning, tests)

Supervisor: lane `time-t6b` (report to it). Repo of this work: `/home/jody/github/serene-pub-sdk` (the SDK; edit
it there, never in the app's `node_modules`). Never `git checkout`, `git restore` or `git stash` in it: most of it is
uncommitted.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. **Never `prettier --write`.**

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (**You do not run `sdk:build` at all**: the supervisor does.)

Never `kill -9` anything. Another session shares this checkout: touch only the files listed under Files owned.

## Goal

An opt-in option on `core:query/session-history@1` and `core:query/earlier-scenes@1`: for a reply spoken by one cast
member on its own turn, leave out of what the node returns the conversation (and scene summaries) that member did
not witness. Core's host does the filtering (another worker); you declare it in the SDK, warn when a spec sets it on
one node and not the other, and test that.

## The rule (owner rulings; state it in the declarations' comments, the rule and not the story)

Owner 2026-11-14: "Unknown content is left out of the prompt; the model is never told what a character does not
know." ★6: "where one model voices everyone, nothing can be left out" (a narrator or envoy reads everything).
Owner 2026-11-15: "a mixture of per scene, per location (when available)"; "we can assume if a cast member responded
at all within a scene's messages that they were present. We can filter and qualify further depending on their
location. I.e. they responded and then left the room."; Bench: "unreliable … user doesn't want them to respond
automatically but still considers them in scene" (**Bench plays no part**); "Not so much a seperate history, but a
per character filter on what gets put into their context."; "build what we want best practice into our SDK helper
(all features are opt in on invoke)"; opt-in: "pipeline/node".

For a reply spoken by **one cast member on its own turn**, when the pipeline wires the option:

1. **By scene:** a scene is witnessed by a member that **spoke at least once in it** (hidden, rewound and
   swiped-away lines do not count). Its own lines are always kept. Messages in no scene are kept. The open scene
   (the one the reply is written in) is witnessed by its speaker.
2. **By place, when the invoker names a cast-level state slot** (for example a location slot): a message is
   witnessed when the member's value of that slot **in force at that message** equals the message speaker's value
   in force at it (references compare by `entryId`; words trimmed and case-folded). A message whose speaker has no
   value falls under rule 1. With a slot named, rule 2 decides wherever both values exist.
3. **Scene summaries** (`earlier-scenes@1`): kept for a member that witnessed the scene's last message or more than
   half of its messages; else left out.
4. A narrator's turn, an envoy's, and a step writing for several characters read everything: the option does
   nothing there and the receipt says so.
5. The run's receipt says how many messages and summaries were left out and why.

## Build

### 1. `contracts/src/queries.ts` (additive; no existing name changes)

On **both** `sessionHistory` (`ports.in`, ~line 258–309) and `earlierScenes` (`ports.in`, ~line 1411–1413) add two
optional in-ports:

- 🚧 `firsthandFor: S.rowIds` — the speaking character's id, wired as `$.input.characterId` (the same shape the
  reply inlet's `characterId` has, `contracts/src/inlets.ts` ~115). Unwired: no filter and the node behaves exactly
  as today. Wired to a value that is not one character id (a narrator's or envoy's turn, several characters, null):
  nothing is left out and the receipt says so.
- 🚧 `firsthandBy: S.text` — optional: the cast-level stat, by full id or local name (as `stat-trail@1`'s `slotId`),
  for rule 2. Read only with `firsthandFor`.

**In-ports, not parameters**, on the precedent written at `contracts/src/outlets.ts` ~167–175 (`generating`): a spec
writes the slot name as a literal in the node's config; a `params` field would put a structural fact of the
document in the panel as a knob (P3: no new setting). Mark each `@experimental` 🚧 in its comment, say what it is
**not** (not the `session_messages.firsthand_cast_member_ids` column, which keeps existing and is no longer what the
word means; not Bench; not a scene's cast), and give the rule above in a few lines on `sessionHistory`'s port, with
`earlierScenes`' port pointing to it and adding rule 3. Update `earlierScenes`' top doc comment (~1365–1387) with
one sentence for the new port. Comments state the rule, not the story.

### 2. `sdk/src/validate.ts`: one warning

Read how the existing warnings are written (`severity: 'warning'`, e.g. ~302, ~346, ~535; the `fed(n, port)` helper
~179: a port is fed when its config value is not `undefined`/`null`/`false`, or an edge enters it). Add:

- When the document holds at least one `core:query/session-history@1` node **and** at least one
  `core:query/earlier-scenes@1` node, and `firsthandFor` is fed on some node of one of the two types and on **no**
  node of the other type, warn on each node of the other type.
- Sentences (🚧, use these):
  - history filtered, summaries not — message: `'‹key›' reads every earlier scene's summary, while the session history beside it leaves out what the speaker was not there for`; fix: `wire firsthandFor (and firsthandBy, if the history names one) on '‹key›' as on the history`.
  - summaries filtered, history not — message: `'‹key›' reads every message, while the earlier scenes beside it leave out what the speaker was not there for`; fix: `wire firsthandFor (and firsthandBy, if the earlier scenes name one) on '‹key›' as on the earlier scenes`.
- `law`: follow the convention of neighbouring warnings; if they cite a plan or ruling id, use `'firsthand 2026-11-15'`.
  Say what you chose.

### 3. SDK tests (in `sdk-tests/`)

A new `sdk-tests/firsthand.test.ts` (or the existing file that already tests `validate` warnings of this kind, if one
fits better: say which):
- both nodes declare `firsthandFor` and `firsthandBy` as in-ports, not params;
- the warning fires in each direction, on the right node key;
- no warning when both are fed, when neither is, and when the document holds only one of the two node types.

Then find the SDK tests that pin a hash or digest of these definitions (grep `sdk-tests/` for `session-history`,
`earlier-scenes`, `sha`, `digest`, `HASH`, `PIN`) and list them in your report with the old value; **re-pin only a
hash that moved because of this change**, with a dated comment `// 2026-11-15 time-t6b: firsthandFor/firsthandBy
in-ports added`. If you cannot tell whether a hash moves without a full run, list it and leave it.

Run only targeted SDK test files, from `sdk-tests/`, in the capped form (they resolve the packages' sources through
`tsconfig.json` paths, so no build is needed):

    cd /home/jody/github/serene-pub-sdk/sdk-tests && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx tsx --test firsthand.test.ts > /home/jody/github/serene-pub/plans/time-t6b-w1.log 2>&1"

Also run `npx tsc --noEmit -p .` in `sdk-tests/` (capped the same way, output to `plans/time-t6b-w1-tsc.log`).
Never pipe a test run into `head`.

## Files owned

- `/home/jody/github/serene-pub-sdk/contracts/src/queries.ts` (the two nodes' ports and doc comments only)
- `/home/jody/github/serene-pub-sdk/sdk/src/validate.ts` (the one warning only)
- `/home/jody/github/serene-pub-sdk/sdk-tests/firsthand.test.ts` (new) and any SDK test file whose pinned hash moved
  because of this change (the re-pin line only)

## Files readable

Anything in either repo. Useful: `contracts/src/outlets.ts` ~93–200, `contracts/src/inlets.ts` ~80–130,
`sdk/src/validate.ts`, `core-catalog/src/genres/story/respond.ts` ~550–600 (how Story wires the two nodes; **do not
change it**: no shipped pipeline invokes the option), `NOMENCLATURE.md` §1 and §24 in the app root.

## Out of scope (do not build)

Any change to a shipped pipeline or genre; the host binding; the guide page and recipes (a later worker); a
parameter or setting; the `firsthand_cast_member_ids` column, its writer, migration 0165; INTEGRATING.md (queue text
in your report if you think it needs a line).

## Stop and ask (stop, and write it in your report; do not choose) when

- an option cannot be added without changing a published name;
- a name other than `firsthandFor`, `firsthandBy` and the two warning sentences above seems needed;
- a test outside the ones listed fails because of the change.

## Done means

`firsthand.test.ts` passes; `sdk-tests` `tsc --noEmit` 0 errors; the hash pins listed.

## Report

Write your report as your final message (the supervisor reads it): files changed with line ranges, the exact
comment text of the two ports, the warning code, tests run with results (pass/fail counts), hash pins found and what
you did with each, anything noticed and not done.
