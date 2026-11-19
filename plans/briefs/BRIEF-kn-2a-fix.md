# BRIEF — fix lane `kn-2a-fix` — scope review of lane `kn-2a` (programme 1.2)

Repos `/home/jody/github/serene-pub` (app), `/home/jody/github/serene-pub-sdk` (SDK). Supervisor: read
`.claude/guides/multi-agent.md`, `plans/REPORT-kn-2a-2026-11-16.md`, and `plans/briefs/BRIEF-kn-2.md` (its
rules on git, prettier, tests, `sdk:build` and waiting for other lanes' vitest apply here unchanged; wait with
`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`). Lane `dbg-1` is editing `sdk/src/executor.ts`,
the Turn line and admin files and runs `sdk:build`; lanes `fnd-2c` (`sockets/sessions*.ts`) and `io-1` (lorebook
export / import) are running: do not touch their files. Never commit.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Owner (2026-11-15): "I expect you to close all the leaks as part of the sprint. … a toggle that's on by default,
that way a modder can disable it if they want to do somethign custom."

## Fixes

1. **The guide's recipe for switching the param off does not work.** `guides/genres-presets-and-routines.md`
   shows `C.worldLore.v1({ scope: …, knownToSpeaker: false })` (top level of the node config); bindings read
   `input?.params?.knownToSpeaker` and a node's params come from `config.params` (`sdk/src/document.ts` ~474).
   Verify which spellings really reach the binding; correct the guide and `INTEGRATING.md` §1p to one that does
   (as `lair/reply.ts` ~1261 sets params); make the example a checked one (not `nocheck`) or add an SDK test and
   an app test proving a `false` set that way reaches the binding and the entry comes back. If a top-level key
   silently does nothing, say in the report whether `validate()` already flags an unknown config key (do not add
   a law; report).
2. **Core tools read lore unfiltered.** `entriesFor` (`pipelines/runtime/tools/coreTools.ts` ~369) reads
   `lorebook_entries` without the judgement: a tool call in a run that speaks as a cast member must drop unknown
   entries exactly as the reads do (same host read, same speaker resolution, same standing-place exception);
   a run with no speaker (Chat's assistant, Guide) is unchanged. Test both.
3. **Entry names carried by state values.** `nameLoreRefs` (`state/resolve.ts` ~2061–2085) writes an entry's
   `name` onto every `{ entryId }` reference in state values (items in packs, other members' locations), which
   reach a speaker's prompt through `session-state` (e.g. `lair/reply.ts` ~390–394) unjudged. **Inventory, then
   propose; build only the obvious half:** list every prompt path that prints such a name for a speaking run and
   whose value it is. Build: nothing that changes what a prompt holds, **unless** the inventory shows a case
   with one defensible rule, in which case state the rule and stop for the lead (a ★ in the report with a
   recommendation: e.g. the speaker's own values always keep their names; another member's reference to an entry
   the speaker does not know prints without it). Until ruled, add it to the Limits lines (fix 5).
4. **The standing place for a card-less seat with member form off** (`lorebooks/entryKnowledge.ts` ~372–375)
   falls back to the session's world value although the seat has no place of its own: confirm what the code
   does, and make the docs say exactly that (do not change behaviour; note it for D27).
5. **Docs Limits:** `docs/pipelines.md` and `INTEGRATING.md` §1p ⚠ Limits name what is still not judged: state
   values' entry names (until fix 3 is ruled), `turn-plan` `locationPassage` (D28).
6. **Trace the +3 statements on Story's narrator turn** (2541 → 2544, `plans/kn-2-shas-*.txt` and the baseline
   test's `KN2_SHA_LOG`): a turn with no speaker must load no judgement. Find the three statements; if the
   judgement or the place value is read when nobody speaks, fix it so the count returns to 2541; otherwise
   explain them.

## Files owned

`guides/genres-presets-and-routines.md`, `INTEGRATING.md` §1p, one SDK test; app
`pipelines/runtime/tools/coreTools.ts`, `lorebooks/entryKnowledge.ts`, `pipelines/runtime/host.read.lorebookEntries.ts`
(only for fix 6), their tests, `docs/pipelines.md`, `docs/lorebooks.md`. `state/resolve.ts` is read-only here.

## Done means

New and touched tests green in the capped form (`plans/kn-2a-fix-<n>.log`); the two prompt-baseline tests still
byte-identical; `sdk:build` only if SDK source (not docs) changed; `tsc` 0 errors; `npm run check` 0 errors in
this lane's files.

## Report

Final message = the report (lead appends it to `plans/REPORT-kn-2a-2026-11-16.md`): per fix, what changed, the
test, files; the inventory and ★ for fix 3; **Noticed, not done**. Under about 500 words.
