# BRIEF — worker `time-t6c1-w1` (SDK half) — the firsthand option on the History-entries read

Supervisor: lane `time-t6c1`. SDK repo `/home/jody/github/serene-pub-sdk` (edit it there). App repo
`/home/jody/github/serene-pub`. Another session shares both checkouts: touch only the files below.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: **do not run `sdk:build`, `sdk:test` or any vitest at all** — the supervisor builds and runs the tests after you
report. Never `prettier --write`. Never `git checkout / restore / stash` in either repo. Never `kill -9`.

## Goal

Lane `time-t6b` (built today) added an opt-in per-character filter: in-ports `firsthandFor` / `firsthandBy` on
`core:query/session-history@1` and `core:query/earlier-scenes@1`. This lane extends it to **History entries**:
the same two in-ports on `core:query/history-entries@1`, and `validate()`'s existing warning widened to three
reads. Additive, `@experimental`. No shipped pipeline is changed to wire it.

Owner rulings this serves (quote, don't change): 2026-11-14 "Unknown content is left out of the prompt; the model
is never told what a character does not know." ★6: a narrator or envoy reads everything. 2026-11-15 "Not so much
a seperate history, but a per character filter on what gets put into their context."; "build what we want best
practice into our SDK helper (all features are opt in on invoke)"; opt-in "pipeline/node".

## The rule the app will implement (for your JSDoc and guide text)

When the History-entries read is invoked with `firsthandFor` for one cast member on its own turn:

- A History entry is **left out** for the member when **at least one scene of this session** compiled into it is
  one the member was not there for (a scene counts as "there for" by the scene-summary rule of `earlier-scenes`:
  there for the scene's last message or more than half of its messages, by rules 1 and 2).
- Scenes of other sessions (or of a deleted session) and text a person wrote into the entry are not judged, so an
  entry with none of this session's scenes is always kept (public record).
- The left-out entries are published on the lane's existing **`exclusions`** out-port (`{ source, id, reason }`)
  with the firsthand reason as the sentence, so `core:task/eligibility@1` marks the entry ineligible whichever
  mechanism found it (keyword, entity search, vector search). They are also dropped from the lane's own `main` /
  `hits`.
- Unwired: nothing changes. A narrator's or envoy's turn, or a step for several characters (`firsthandFor`
  null): reads everything.
- Limits: an entry cannot be cut in two, so leaving it out drops everything else that day holds (other sessions'
  scenes, a person's paragraphs); a character that missed one scene of a day loses that day's entry, apart from
  its own lines still in the history window; a compiled scene whose messages were all deleted counts as "was
  there".

## Files owned (only these)

1. `contracts/src/queries.ts` — `historyEntries` (~1177–1213): add `firsthandFor: S.rowIds` and
   `firsthandBy: S.text` to `ports.in`, beside `scope`. Copy the shape and the JSDoc style of the two ports on
   `earlierScenes` (~1458–1485): short, refer to `session-history@1`'s for the rule, plus the History-specific
   rule above in two or three sentences, ending with what unwired does. Add one sentence to the definition's
   JSDoc block that opting in is wiring `firsthandFor`. Do not touch any other definition.
2. `sdk/src/validate.ts` (~1319–1357, the `firsthand` block only): widen from two reads to three
   (`core:query/session-history`, `core:query/earlier-scenes`, `core:query/history-entries`, all version 1). The
   rule: among the three types **present** in the document, if at least one type has a node fed (`wiredFor`) and
   another present type has no fed node, warn on each node of each unfed present type. Law stays
   `firsthand 2026-11-15`. **The two existing messages and fixes must stay byte-identical** for the two-read cases
   they cover today (existing tests check them). Build the message from parts:
   - what the unfed node reads: session-history → `reads every message`; earlier-scenes →
     `reads every earlier scene's summary`; history-entries → `reads every history entry`;
   - the fed reads, in the order session history, earlier scenes, history entries, joined with " and ":
     `the session history` (singular → `leaves out`), `the earlier scenes`, `the history entries` (plural →
     `leave out`); two or more joined → `leave out`;
   - message: `'${key}' ${reads}, while ${fed} beside it ${leaves|leave} out what the speaker was not there for`;
   - fix: `wire firsthandFor (and firsthandBy, if ${fedShort} ${names|name} one) on '${key}' as on ${fedShort}`,
     where fedShort is `the history` for session-history (as today), `the earlier scenes`, `the history entries`;
     singular `names` only when fedShort is exactly `the history`.
   Check against today's two strings that F={history}/unfed scenes and F={scenes}/unfed history reproduce them
   exactly. Update the block's comment to state the rule (no story, no dates beyond the law), and say "was there
   for", never "witness" (fix the existing "witnessed" in that comment).
3. `sdk-tests/firsthand.test.ts` — extend: the declarations test covers `history-entries` too; the validate tests
   cover the third read: history-entries fed alone with session-history present → warning on the history node
   (exact message); session-history fed with history-entries present unfed → warning on the history-entries
   node (exact message); all three fed → no firsthand finding; the two existing two-read cases unchanged. Read
   the file whole first and follow its builder.
4. `sdk-tests/nodeInput.test.ts` / `nodeInput.assert.ts` — only if they enumerate `history-entries`' ports
   today (grep); if they do, add the two names with a `🚧 2026-11-15 time-t6c1` comment like t6b's.
5. `guides/genres-presets-and-routines.md`, section **What a character was there for** (~399–445): add
   `core:query/history-entries@1` to the opening sentence and the `ts nocheck` example (a third `.query(...)`
   with `C.historyEntries.v1({ scope: $.input.sessionScope, firsthandFor: $.input.characterId, params: ... })` —
   check how `respond.ts` ~629 wires it and keep the fragment minimal); a rule **6. History entries** (the rule
   above, plain words, one short paragraph, incl. that the entry is published on `exclusions` so no other way of
   finding it brings it back); in Limits replace "History entries compiled from scenes are not filtered yet."
   with the three limits above; the `validate()` sentence now says "one of the three reads and not another".
   Don't touch the "Another rule" subsection.

Files readable: anything. In particular `core-catalog/src/genres/story/respond.ts` ~625–640 and ~995–1012 (how
the node and its `exclusions` are wired), `contracts/src/tasks.ts` ~190–240 (`eligibility`).

## Rules (quoted)

- NOMENCLATURE R3 "qualify, never the bare noun"; R1 one word, one meaning. The two port names already exist
  (🚧 `firsthandFor` / `firsthandBy`); add **no other new name**. If you find you need one, stop and report it.
- "Comments state the rule, not the story. Published prose says 'was there for', never *witness*."
- It is a **session**, never a *chat* (except chat-completions wire vocabulary). No other product's name in any
  file.
- Guide prose: plain, short sentences, matching the section around it.

## Stop and ask (in your report, without choosing) when

A published name would have to change; a port cannot be added additively; the existing two warning strings cannot
be kept byte-identical; anything outside the files above seems needed.

## Done means

The edits above; `npx prettier --check` on each edited file (report the result; do not fix formatting of lines you
did not touch). Report: changed files with line ranges, the exact new message/fix strings for the
history-entries cases, anything noticed but not done. Report back as your final message.
