# BRIEF — worker `time-t6c2-w2` (SDK half) — the opt-in query node for entries a speaker does not know

Supervisor: lane `time-t6c2`. SDK repo `/home/jody/github/serene-pub-sdk` (edit it there). App repo
`/home/jody/github/serene-pub` (read only for you). Another session shares both checkouts: touch only the files below.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: **do not run `sdk:build`, `sdk:test` or any vitest at all** — another worker is running tests and the lane runs
one at a time; the supervisor builds and runs your tests after you report. You may type-check: `cd
/home/jody/github/serene-pub-sdk/<package> && npx tsc --noEmit -p .` for `contracts` and `sdk`. Never
`prettier --write`. Never `git checkout / restore / stash` in either repo. Never `kill -9`. Comments state the rule,
not the story (no "lane", no "(opt-in, 2026-11-15)" narration in JSDoc). No other product's name in any file.

## Owner rulings this serves (quoted; do not change them)

- 2026-11-14: "**Knowing a particular entry is a tie** between the cast member and the entry (*has been there*, *was
  told*, *knows*; *kept from* for the opposite). An entry marked **not common knowledge** is read only by those tied
  to it." ★2: "A tie to an entry counts as knowing it". ★3: every entry is common knowledge unless marked.
- 2026-11-14: "Unknown content is left out of the prompt; the model is never told what a character does not know."
  ★6: a narrator, an envoy and a step writing for several characters read everything.
- 2026-11-15: "build what we want best practice into our SDK helper (all features are opt in on invoke)"; opt-in:
  "pipeline/node".
- Plan §5 rule 6: "A filter always shows its cause: *not known by ‹name›*".
- INTEGRATING.md "Handler input types come from the contract": every declared in-port must be read by the host's
  handler (`reads<…>()`), and a definition is additive and `@experimental`.
- ⚠ `core:query/relationships-known@1` is a published name for another thing: **do not name the node or any port
  `known…`.**

## The rule the app implements (for your JSDoc and guide text)

For a reply spoken by one cast member on its own turn, an entry of any type in any lorebook the session reads (its
lorebook and its notes) is **left out** when (a) it is marked *not common knowledge* and the speaker is not tied to
it, or (b) a *kept from* tie wins for it (marked or not). The speaker is tied to an entry by any active relationship
from the speaker to that entry that reads on the reply's line at the reply's date and is not *kept from*: an
ordinary tie ("member of → The Guild") counts, and so do the knowledge ties *was told*, *knows*, *has been there*.
When a knowing tie and a *kept from* tie both read: the later date wins; same date, the nearer line; then *kept
from*. Undated ties count as earliest. With the lorebook's Timeline off, dates play no part. A narrator's turn, an
envoy's and a step writing for several characters (no speaker) read everything. Knowledge ties are left out of the
relationship graph, tie ranking and the ties in the prompt.

**How it reaches the prompt:** the node returns `exclusions` (`{ source, id, reason }`, one per left-out entry for
each of the sources `worldLore`, `characterLore`, `history`; eligibility's alias covers the vector index's
`historyEntry`). A spec opts in by placing the node and wiring its `exclusions` into `core:task/eligibility@1`'s
`exclusions` (beside the lore lanes'), so the entry is blocked whichever mechanism found it (keyword, entity search,
vector search, pinned). Each reason is 🚧 *Not known by ‹name›.* or *Kept from ‹name›.*; the node's receipt says how
many were left out and why, or *Reads everything: not one cast member's turn*.

**Stated limit (not built):** the scene's place listing (a scene's places and their ways, read for the template
with `withLinks`) does not pass eligibility, so a marked place the speaker stands in, or a marked way out of it,
still reaches the prompt. The `lorebook-triggers@1` scan is not filtered either.

## Files owned (only these)

1. **`contracts/src/queries.ts`** — one new definition, placed after `historyEntries` (~1177–1245), copying its
   style (`pin(describeQueryDefinition({…}))`):
   - `export const unknownEntries`, id **`core:query/unknown-entries@1`** (🚧), `i18n: { name: { en: 'Entries not
     known' } }`, `timeoutMs: 2000`, **not** `optional` (a filter that fails must not let what it filters through;
     say so in one JSDoc line).
   - `ports.in`: `scope: S.sessionScope`; `speaker: S.participantRef` (the speaking seat, wired
     `$.input.speaker`; null or unwired, or a reference that names no seat with a cast member, reads everything —
     JSDoc as `characterLore`'s `speaker` ~1120–1137 is written).
   - `ports.out`: `main: S.json` (the left-out entries, `Array<{ entryId: number; reason: string }>`, in entry id
     order) and `exclusions: S.json` (the verdicts above; JSDoc: wire it into `core:task/eligibility@1`'s
     `exclusions`, see `historyEntries`' `exclusions` JSDoc ~1222–1232).
   - Definition JSDoc: the rule above in short, the opt-in, the stated limit, `@experimental`, and "⚠ Not
     `core:query/relationships-known@1` (the speaker's relationships as the prompt reads them)."
   - No params, no slots.
   If the contracts package keeps an explicit list or index of definitions (check how `entriesNamed` ~1540 and
   `earlierScenes` ~1464 are exported and registered: `grep -rn "entriesNamed\|earlierScenes" contracts/src sdk/src
   core-catalog/src --include=*.ts`), register the new one the same way.
2. **`sdk/src/validate.ts`** — one new block after the `firsthand` block (~1319–1370), law **`entry knowledge
   2026-11-15`**, severity `warning`: for each node with `definitionId === 'core:query/unknown-entries'` and
   `definitionVersion === 1`, warn when **no** edge `e` with `e.from === n.key` and `e.fromPort === 'exclusions'`
   reaches a node whose `definitionId === 'core:task/eligibility'` with `e.toPort.split('.')[0] === 'exclusions'`.
   (Edges come from `sdk/src/document.ts` ~297–313: a nested literal `[$.a.exclusions, $.b.exclusions]` yields one
   edge per element with `toPort` `exclusions.<i>`; verify this, and verify a node inside a junction branch, as
   story's `retrieval` junction in `core-catalog/src/genres/story/respond.ts` ~993–1015, is found.) Message 🚧:
   `'${key}' finds the entries the speaker does not know, but its exclusions reach no eligibility check, so nothing is left out`;
   fix 🚧: `wire $.${key}.exclusions into the eligibility check's exclusions, beside the lore reads'`.
3. **`sdk-tests/unknownEntries.test.ts`** (new): the definition's id, ports in/out and shapes, not optional; the
   warning: placed and unwired → one warning with that law; `exclusions` wired straight into eligibility → none;
   wired as one element of a nested list → none; eligibility inside a junction branch → none; wired into a node that
   is not eligibility → warning. Build documents the way `sdk-tests/firsthand.test.ts` does (read it).
4. **`guides/genres-presets-and-routines.md`** — a new section `## What a character does not know` (🚧) right
   after the *What a character was there for* section and its *Another rule* subsection (~399–470): the rule (plain
   prose, short paragraphs), the opt-in wiring as a fenced ```` ```ts ```` snippet (place the node, wire
   `speaker: $.input.speaker`, add its `exclusions` to the eligibility list beside the lore lanes'), what the
   receipt says, the narrator limit, and the stated limit above. **No** fence whose info string contains the word
   `recipe` (the app's recipes test executes those). Match the existing section's register: second person, plain,
   no marketing, sentences short.

## Files readable

Everything in both repos. Especially `contracts/src/queries.ts` (`historyEntries`, `characterLore`,
`earlierScenes`, `entriesNamed`), `contracts/src/tasks.ts` ~180–240 (`eligibility`), `sdk/src/validate.ts`,
`sdk/src/document.ts`, `sdk-tests/firsthand.test.ts`, `guides/genres-presets-and-routines.md` ~380–480,
`INTEGRATING.md` §1p (~1535–1578).

## Out of scope

INTEGRATING.md (the supervisor queues it); any shipped pipeline (no spec places the node); any other definition;
the app.

## Stop and ask when

CLAUDE.md §Decisions applies; a published SDK name would have to change; the contracts package needs a change
outside the new definition (other than registering it where every definition is registered).

## Done means

`npx tsc --noEmit -p .` clean in `contracts` and `sdk`; `npx prettier --check` on your files (report, do not write).
The supervisor runs `sdk:build` and `sdk:test`.

## Report

Write it to `/home/jody/github/serene-pub/plans/briefs/REPORT-time-t6c2-w2.md`: files changed with line ranges,
every new name and sentence, how you verified the edge shapes (nested list, junction), anything you decided,
**Noticed, not done**.
