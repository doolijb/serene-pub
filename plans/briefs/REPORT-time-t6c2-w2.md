# REPORT time-t6c2-w2 (SDK half)

Status question: none relayed. All four files done.

## Files changed (SDK repo /home/jody/github/serene-pub-sdk)
- contracts/src/queries.ts ~1247-1322: `unknownEntries`, id `core:query/unknown-entries@1`, name "Entries not known", timeoutMs 2000, not optional. In: `scope` (sessionScope), `speaker` (participantRef). Out: `main` (json), `exclusions` (json). No params, slots or bands. JSDoc has the rule, the opt-in, the stated limit, the not-optional line, the relationships-known warning and @experimental. Exported through `export * from './queries.js'`; no explicit registry exists for other definitions (`entriesNamed` is only used via `C.`).
- sdk/src/validate.ts ~1371-1393: law `entry knowledge 2026-11-15`, warning, as briefed (message and fix as specified).
- sdk-tests/unknownEntries.test.ts (new): declaration test, plus warning tests for unwired, direct, nested list, junction branch, and wired to a non-eligibility node.
- guides/genres-presets-and-routines.md ~502-546: `## What a character does not know` after "Another rule". It has a ```ts nocheck fragment (no `recipe` fence).

## Verification
- Edge shapes: ran a throwaway node script, since removed, using the existing dist and `historyEntries`/`worldLore`. A nested list `[$.w.exclusions, $.h.exclusions]` gives edges with toPort `exclusions.0` and `exclusions.1`. A node inside a junction branch is in `doc.nodes` with key `r.on.eligible` and its edges point at that key, so the validate block finds it. The new definition was not in dist, so it was not run.
- `npx tsc --noEmit -p tsconfig.build.json` is clean in contracts and sdk. These packages have no plain tsconfig.json, so I used the build one. The test file is not in either program.
- Prettier: the test file is clean. queries.ts, validate.ts and the guide already differ from prettier output in places I didn't touch; my new blocks do not appear in the diffs.
- No vitest, build or sdk:test run.

## Decisions
- The validate block has no check that the speaker is wired; the brief did not ask for it.
- The guide fragment declares the node as `.query('unknown', ...)`, and its eligibility reads `$.unknown.exclusions`.
- The "not a node that is not eligibility" test injects an edge into the compiled doc, because the builder offers no honest way to wire exclusions into a non-eligibility node.

## Noticed, not done
- The new test imports `C.unknownEntries`, which needs the supervisor's sdk:build first.
- `suppliesOf(C.unknownEntries)` is assumed to list out-ports under `ports`, as the firsthand test uses it. Unverified until built.
