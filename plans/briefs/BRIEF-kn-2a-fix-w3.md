# BRIEF — worker `kn-2a-fix-w3` (docs): Limits lines, the lore tools, two corrections

Supervisor: lane `kn-2a-fix` (`plans/briefs/BRIEF-kn-2a-fix.md`). SDK repo `/home/jody/github/serene-pub-sdk`,
app repo `/home/jody/github/serene-pub`. Docs only: no code, no tests to write.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (Do not run `sdk:build`: nothing here needs it.)

Also: never `git checkout / restore / stash` in either repo; never `prettier --write`; never `npm` at the SDK root.

## Facts (verified by the supervisor)

- **Member form is ON in every shipped build** (`src/lib/server/state/memberForm.ts`: `memberFormSwitch = { on: true }`
  since S4, 2026-11-08). "Card form" is the ⏳ OFF case, reachable only in tests. A previous edit got this
  backwards in two places (below).
- **The lore tools are now judged.** `coreTools.ts` `entriesFor` passes `knownToSpeaker: true` to the host's
  `lorebook_entries` read, so `search_entries`, `get_entry` and `read_summary`, called by the model during a run that
  speaks as a cast member's card, leave out the entries that member does not know, exactly as the lore reads do; a run
  with no speaker is unchanged. **Gap:** a card-less seat's id does not reach a tool (`ToolContext` carries only
  `currentCharacterId`), so a card-less seat's tool calls read everything. No shipped genre offers these tools on a
  cast member's turn (only Chat, whose assistant is no cast member), so no shipped behaviour changes.
- **Entry names carried by state values are not judged.** The session's state names every `{ entryId }` reference
  in a value with the entry's title (an item in someone's inventory, someone's location, what lies in a place or
  about the world). On a cast member's own turn those names reach the prompt unjudged: the Lair's delver voice prints
  them through `{{stateSummary}}` (each party member's line, the world's values, the scene's place) and `{{location}}`;
  a template on a speaking run can print them through `{{state.*}}`. Awaiting the owner's ruling.

## Goal

1. **Guide** `guides/genres-presets-and-routines.md`, section *What a character does not know*:
   a. Rule 5's ⏳ sentence says "While seats are stored in card form (on in every shipped build)". Correct it to say
      card form is the transitional off state and member form is on in every shipped build, e.g. "⏳ With seats stored
      in card form (off in every shipped build since member form, S4), a seat with no card has no state owner of its
      own, so it stands in the session's world value."
   b. The section still ends with a stale **"Limits:"** list and a **`validate()` warns when the node's
      `exclusions` …** paragraph left over from the retired `core:query/unknown-entries@1` node (they describe a
      node, eligibility exclusions, unfiltered triggers and an unfiltered place listing — all no longer true).
      Delete that list and that paragraph. Fold the true limits into the existing **"Not covered:"** paragraph:
      add (i) entry names carried by state values (an item in an inventory, a location, what lies in a place),
      which print by name in `{{stateSummary}}`, `{{location}}` and a template's `{{state.*}}`, unjudged;
      (ii) a card-less seat's calls to the lore tools.
   c. One sentence, beside "The host drops the entries at the source …": the lore tools a model calls during a
      reply (`search_entries`, `get_entry`, `read_summary`) read through the same host read and leave out the same
      entries.
   Check nothing else in the section contradicts the param model (no "placed", "exclusions", "node" for the filter).
2. **`INTEGRATING.md` §1p**, the `knownToSpeaker` bullet only:
   a. The ⏳ sentence "(`memberFormOn()` false, every shipped build)" is backwards: make it "(`memberFormOn()`
      false; on in every shipped build since S4)" or equivalent.
   b. In "Where it applies", add the lore tools sentence (`tools/coreTools.ts` `entriesFor` passes
      `knownToSpeaker: true`).
   c. In "⚠ Limits", add: entry names carried by state values (`state/resolve.ts` `nameLoreRefs` names every
      `{ entryId }` in a value; they reach a speaker's prompt through `session-state`, e.g. `{{stateSummary}}`,
      `{{location}}`, `{{state.*}}`) are not judged, pending a ruling; and a card-less seat's tool calls read
      everything (`ToolContext` carries no `currentCastMemberId`). `turn-plan@1`'s `locationPassage` is already
      there: keep it.
3. **`docs/pipelines.md`**, section *What a character does not know* (user voice, plain sentences, no code names
   beyond what the section already uses):
   a. **Which steps** bullet: add that the lore tools the AI can call during a reply (search the lorebook, read an
      entry, read summaries) leave out the same entries.
   b. **Limits** paragraph: add that names held in stats (an item someone carries, where someone is, what lies in a
      place) still reach a character's prompt by name (the Lair's party summary, for one), and that a seat with no
      character card reads everything through those tools. Keep the existing limits.

## Files owned

SDK `guides/genres-presets-and-routines.md` (that section only), `INTEGRATING.md` (that bullet only); app
`docs/pipelines.md` (that section only).

## Out of scope

Any code; any other section; NOMENCLATURE; new names.

## Stop and ask when

A fact above does not match the code you read; another part of the owned sections seems wrong in a way not listed.

## Tests — how

Before the run: `until ! pgrep -f "^node .*vitest" >/dev/null && ! pgrep -f "tsx --test" >/dev/null; do sleep 5; done`, then
`cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "cd ../serene-pub-sdk/sdk-tests && npx tsx --test guideSnippets.test.ts guides.test.ts docs.test.ts > /home/jody/github/serene-pub/plans/kn-2a-fix-w3-1.log 2>&1"`
(never piped into `head`).

## Done means

The three SDK test files green; the edits above made and nothing else.

## Report

Final message: per file, the sentences changed (old → new, short); test result and log path. Under 350 words.
