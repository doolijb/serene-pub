# BRIEF — worker task `wt-1b-fix2` — the speaker-in-cast switch, when off, is off for every read of the run

Repos `/home/jody/github/serene-pub-sdk` (edit it there; never `git checkout / restore / stash` in it) and
`/home/jody/github/serene-pub`. Read first: `plans/REPORT-wt-1b-2026-11-17.md` (all of it, incl. the last
section), `plans/REPORT-kn-2a-2026-11-16.md` (how `knownToSpeaker` is declared on eight query definitions and
read at the host's lore read from the query that asked), `plans/REPORT-kn-5-2026-11-16.md` and the
`wt-1b-fix` notes (the panel's ganged table). Re-verify every file:line.

Rules: both repos are staged by the lead: run no git command that changes the index or the working tree;
`npx prettier --check` only, **never `--write`**; no migration. `npm run sdk:build` from the app root only
after `pgrep -af "vite"` shows no dev / preview server (the Svelte language server's esbuild does not count)
and no vitest is up (`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`). SDK tests:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npm run sdk:test > plans/wt-1b-fix2-<n>.log 2>&1"`
(four known failures); app tests the same capped way with `npx vitest run --maxWorkers=3 <paths>` (always at
least one path). No other lane is editing.

## The problem

The param `speakerInCast` is declared only on `earlier-scenes@1` and `history-entries@1`. The judging now
happens in the host's lore read for **every** reader, and a read that does not carry the param follows the
default (on). So when an administrator switches *Only scenes the speaker was in* off for a pipeline, the
history lane and earlier scenes stop judging, but search by meaning, triggers, listings, entity reads and
tools in the same run still replace or drop history days: "off" is not off, and one run can hold the whole day
from one lane and a replaced copy from another.

## Do

1. **Declare the param wherever a read can hand a run a history entry and already carries `knownToSpeaker`**
   (`contracts/src/queries.ts`: the eight definitions at ~856, ~1081, ~1626, ~1810, ~2001, ~2299, ~2694, ~4155
   after today's edits: find them; `history-entries@1` and `earlier-scenes@1` already have it): the same
   boolean, default `true`, placed after `knownToSpeaker`, the same label and a description fitted to each read
   (one sentence). No `@2`; no removal or rename. The host read takes the value from the query that asked, the
   way it takes `knownToSpeaker` (lane `wt-1b-fix` reads it only from the history lane,
   `pipelines/runtime/bindings.retrieval.ts` ~492: generalise to every binding that passes `knownToSpeaker`).
   Core tools (which carry no params) follow the pipeline's default as today: say so.
2. **The panel's one switch covers them all:** with the param on more reads, the ganged entry for
   `speakerInCast` (`pipelines/config/panel/ganged.ts`) gathers every member of the pipeline, as the
   `knownToSpeaker` entry does; its home stays where `wt-1b-fix` put it unless that read is absent (then the
   same fallback the first param uses). One switch off → every read of that pipeline off → the prompt is
   byte-identical to before lane `wt-1b` even with search by meaning returning the day.
3. **Rebuild and re-pin:** `sdk:build`; registry hashes for the changed queries re-pinned with "(was …)" (app
   `pipelines/boot/registryHashes.test.ts`, SDK pins); tests that enumerate a read's params
   (`boot/retrievalModeCull.int.test.ts`, `boot/lorebookTriggerControls.int.test.ts`,
   `config/panel/index.int.test.ts`, `structuralCompat.test.ts`, `sdk-tests/*`): old → new in the report.
   An existing install picks the new declarations up through the boot's republish pass (cite the pass and the
   test that a second boot changes nothing).
4. **Close the two proof gaps:** in `pipelines/runtime/speakerInCast.reply.int.test.ts`, a case with
   embeddings **on** in the fixture (or the vector read stubbed to return the half-missed day at the binding
   level, inside a real reply run) asserting at **prompt** level that the missed scene's text appears nowhere;
   and the same through the real `story-side-character` pipeline. And the case this task exists for: the
   switch off → the prompt equals the pre-`wt-1b` prompt with search by meaning returning the day.
5. Docs: `docs/pipelines.md` (the switch covers every read of the pipeline), `INTEGRATING.md` / the guide where
   the param's reads are listed, `NOMENCLATURE.md` §25. Append the outcome to
   `plans/REPORT-wt-1b-2026-11-17.md`.

Full capped `npm run sdk:test` after the last SDK edit: failing tests by name.

## Report (under 300 words)

The reads that now carry the param; how the host read gets it; the panel; hashes re-pinned (old → new); the
three new prompt-level proofs; SDK suite result; anything you stopped on.
