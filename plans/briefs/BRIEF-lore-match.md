# BRIEF — build lane `lore-match` — a pipeline updates the entry it already has instead of writing a second

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then, in full:
`plans/REPORT-sense-b1-2026-11-11.md`, `REPORT-sense-b3-2026-11-12.md`, `REPORT-sense-b4-2026-11-12.md` (where a
session's lore writes go, held amendments, Apply), `docs/lorebooks.md` ~194–240, the JSDoc of
`core:outlet/create-lore-entry@1`, `update-lore-entry@1` and `LoreMatch` in
`../serene-pub-sdk/contracts/src/outlets.ts` (~1750–2111), `../serene-pub-sdk/INTEGRATING.md` on outlets and
prompts, CLAUDE.md Hard rules, Principles and "0.6 is in users' hands", NOMENCLATURE §1, §23, §24, §25.
`plans/briefs/BRIEF-sense-clk.md`'s **Verbatim rules** bind you and your workers. Line numbers below are from an
inventory on 2026-11-13: re-read before editing.

Words. A **build lane** is this stream of work; a **channel** is a session's message channel.

## Rulings that bind (owner)

- 2026-11-12, on a branch's lorebook changes: "we need to work on ensuring it doesn't make duplicates, but
  faithfully updating entries or creating children that expand on a particular aspect would be better".
- 2026-11-13, when a pipeline writes about something that already has an entry: **"Let the model rewrite it"** —
  the model is shown the existing entry and returns the updated text, which replaces it; the change still waits
  on the session's card and can be taken back.
- 2026-11-13: **"Two builds: updates first, children next"**. This lane is the first: no children here.
- Model comprehension and replies faithful to the characters and the prompt come first. "Only Apply settles."
  "A turn owns what it wrote." "You're over complicating it": take the plainer shape and say so.

## What is true today

- The way to update instead of duplicating is built and tested: the `match` in-port on `create-lore-entry@1`
  (`LoreMatch`: `{ entryId } | { name } | { key }`; host `findLoreMatch`, `pipelines/runtime/loreMatch.ts` ~24–80)
  finds the existing entry of the same entry type as the session reads it, the session's own book first, then the
  attached lorebook; one hit is updated (`changeLoreEntry`, `host.ts` ~2255–2348: a lorebook entry becomes a held
  amendment, an own-book entry is changed in place), two or more are refused. **No shipped core spec sets it**
  (`core-catalog/src/shared/lore.ts`: `fileLore`'s `matchByName` ~50–80 and `rememberNote`'s `match` ~102–118 have
  no caller), so every core write is a plain new entry.
- A match **replaces** the entry's whole `content` and **renames** it to the name passed (`host.ts` ~2276–2292).
  Nothing checks whether the model ever saw the old text, or that a person wrote it (`provenance: "human"`).
- The model is blind when it writes: Story's sweep (`genres/story/reckon.ts` ~156–184, ~392–421) and Chat's
  *Remember things* (`genres/chat/memory.ts` ~54–96) are shown no existing entries; their answer shape is
  `{ name, content }`.
- A matched write answers `written: false` even when it changed the entry (`host.ts` ~11805–11822).
- `docs/lorebooks.md` ~226 already claims a session "first looks in the notes for one of that name … never a
  second copy"; that is true only for a write that sets `match`.

## The rule to build, in five sentences

When Story's sweep (its lore and cast duties) or Chat's *Remember things* is about to write lore, the step first
reads the entries the session already has **whose name or key appears in the lines the step read**, and the prompt
shows the model each one's name and whole text and says: return an entry only when something about it changed,
under the same name, with its **whole** updated text; return a new name only for something that has no entry.
Each item the model returns is written with a name match within its entry type: no entry of that name creates
one, as today; one entry **the model was shown, matched by its name** is rewritten with the returned text and
keeps its own name; one entry of that name the model was **not** shown is never overwritten, and the returned text
is added to it as a new paragraph, the way a history day takes a second write. Two or more entries of that name
change nothing for that item and the run notes it; it never fails the run. Every change to an existing entry goes
where such changes already go (a held amendment for a lorebook entry, in place for an own-book entry), so the
session's card shows it and Back, a swipe and a regenerate take it with its turn.

## Build

1. **The step reads what exists (its own read; cold review, 2026-11-13).** A routine is its own run: the sweep
   reads only `sessionHistory` and `sessionCast` (`core-catalog/src/genres/story/sweep.ts` ~44–49) and *Remember
   things* the same (`genres/chat/memory.ts` ~53–58); there is no reply retrieval or budget to reuse, and the
   keyword scan would never show a pipeline-made entry (it has no keys, and the scan admits by key). So the step
   adds one read: the entries **of the entry types this step writes** (world lore and character lore for the
   sweep's `lore` and `cast` duties; world lore for *Remember things*) that the session reads, own book and
   attached lorebook as `findLoreMatch` sees them, **whose name (`sameName`) or one of whose keys appears in the
   messages the step read**. A deterministic scan with no model. Use `core:query/entity-search@1` if it answers
   exactly this (it is documented as "how a book with no keywords works", `contracts/src/queries.ts` ~1614–1646,
   and Story's reply wires it, `respond.ts` ~656); otherwise one small new query (🚧 name per §24) bound in
   `bindings.ts`. Capped by a count (🚧 12, a declared param) and by a share of the step's window; an entry too
   long to show whole is left out (it then takes the "not shown" path). Each row carries the entry's **id**, name,
   text and whether a person wrote it (`provenance: "human"`).
   The prompt shows them as a list of `{ name, content }` under one plain heading, with the instruction above and,
   for a person's entry, the sentence that its facts and wording are kept unless the story changed them. Nothing
   is added to the prompt when the list is empty. The answer shape stays `{ name, content }`.
   **The sweep's `scenes` duty (places) is not touched**: it is off by default and places are a later lane.
2. **Write with a match, and know what was shown.** Those steps call the write with `match: { name }`
   (`fileLore`'s `matchByName`, `rememberNote`'s `match`) and pass the **ids** of the entries the model was shown
   (🚧 a new optional in-port on `create-lore-entry@1`, e.g. `shown`; additive; check §24). In the host's create
   case (`host.ts` ~11469–11823), for a write that carries `shown`:
   - **rewrite** only when the one hit's id is in `shown` **and** it was found by its name (`answeringRows` tier 1
     or 2, `shared/lorebooks/describingRow.ts` ~43–51), never by a key term alone: replace `content`; pass no name
     to `changeLoreEntry`, as `fileOntoHistoryDay` does, so the entry keeps its own (do not change
     `changeLoreEntry`, which `update-lore-entry@1` shares and whose name port renames);
   - one hit by name that is **not** in `shown`: append the text as a new paragraph **onto the content as the
     session reads it** (an earlier held change to that entry is part of what it reads, `holdLoreEntryChange`
     ~2211–2213; appending onto the stored row would drop it), never replace;
   - a hit by a **key term only** (the model's name is not the entry's name): not a match for these steps; the item
     is written as a new entry and the run notes which entry's key it met;
   - text equal to what the entry already says changes nothing;
   - two or more hits: no write for that item, a note in the run's receipt naming the candidates, and the run goes
     on (find how the sweep and the memory step meet a refused write today and make this a note, not a halt);
   - a `match` with no `shown` port (a plugin's pipeline, the tool loop) behaves exactly as today.
3. **The result is unchanged.** A matched write keeps answering `matched: true, written: false`: the SDK executor
   reads `written === false` as "wrote nothing" and otherwise raises `core:event/lore-entry-created@1`
   (`sdk/src/executor.ts` ~2109, ~2217), which means a new row (`outlets.ts` ~1897). The receipt already records
   the change as `updated`. Test that no created event fires for a rewrite or an append.
4. **Docs and ledgers in the same change:** `docs/lorebooks.md` ~194–240 (what a session writes; ~226 becomes true
   for these steps and says how), `docs/genre-story.md` (the sweep), the Chat page, `docs/pipelines.md` where lore
   writes are described, the SDK guide for `LoreMatch`, `INTEGRATING.md`, NOMENCLATURE and §25.

## Open ★ to carry into the report (build nothing for them)

- **A rewrite that drops most of the entry.** If the model returns a shown name with only the new fact, the rest
  of the entry is gone; one prompt sentence stands against it. A guard ("a rewrite much shorter than the original
  is appended instead") is cheap and deterministic but narrows the owner's "Let the model rewrite it": the owner's
  call. Measure and report how short the test model's rewrites come back.
- **The reviewer is not told.** Under Review the write waits at the review gate as a plain create
  (`pipelines/runtime/reviewGate.ts` ~331): approving it rewrites or extends an existing entry without saying so,
  and editing the name there leaves `match.name` at the model's original.
- **The assistant's write tool** (`runtime/tools/writeTools.ts`) is not in this lane: nothing tracks what its
  search returned, and its search returns excerpts, not whole entries.
- **Places and rooms** keep their own name checks, which skip instead of update and do not agree with each other;
  the sweep's `scenes` duty has none.
- **The same thing under two names** is not caught; a key-only meeting is noted and written as a new entry.
- **A person as character lore versus a cast member** are different tables; a match never crosses them.
- **Apply does not name-check** a new own-book entry against the lorebook.
- **An own-book entry changed in place** shows no before → after on the session's card.
- **The sweep re-reads its last hundred lines every run**, so an unchanged entry can be returned again; the
  "only when something changed" sentence and the identical-text rule are what stand against churn. Report what the
  test model does.
- **Children** (`anchor_entry_id`, *Part of*): the second build.

## Files owned

SDK: `contracts/src/outlets.ts` (the optional in-port and JSDoc), `contracts/src/queries.ts` only if a new query is
needed, `core-catalog/src/shared/lore.ts`, `core-catalog/src/genres/story/sweep.ts` and `reckon.ts` (the sweep's
`lore` and `cast` arms), `core-catalog/src/genres/chat/memory.ts`, the prompt rows those steps use
(`core-catalog/src/seed/prompts.ts`, the sweep's and the memory's asks only), tests.
App: `src/lib/server/pipelines/runtime/host.ts` (the `create-lore-entry` case only), `pipelines/runtime/loreMatch.ts`,
`pipelines/runtime/bindings.ts` (the new port's wiring and, if needed, the new query), tests, the docs above.

## Out of scope

Children; the sweep's `scenes` duty, places, rooms and the Dungeon Crawler's and the Lair's flows; cast members;
history days; the assistant's tools; matching by anything but name (no fuzzy match, no embeddings); renaming;
`changeLoreEntry` itself; the outlet's result values and the event it causes; Apply; the session's card; the review
gate; `update-lore-entry@1`; any migration, setting or new event.

## Stop and ask when

A published SDK name, port, result value or event would change or go (the one optional in-port and, if needed, one
new query are the changes allowed); the scan cannot be made deterministic; a migration or data pass is needed.

## Done means

Tests: the read returns the entries named in the lines the step read, of the step's types, own book and lorebook,
capped; a sweep that returns a shown entry's name rewrites it (held for a lorebook entry, in place for an own-book
one) and keeps its name; an unshown entry of that name gets a paragraph onto what the session reads, an earlier
held change kept; a key-only meeting writes a new entry and notes it; identical text writes nothing; two entries of
one name write nothing, note it and the run completes; a new name creates; no created event fires for a rewrite or
an append; Back, a swipe and a regenerate take the change; a person-written entry is marked in the prompt; an empty
list leaves the prompt byte-identical to today's; Chat's memory the same; a plugin's `match` without `shown` is
unchanged; the sweep's `scenes` duty is unchanged. The suites that pin today's match pass, updated only where the
rule changed what they pin and never weakened (`runtime/loreSources.int` (g), `host.ownBookRoute.int`,
`host.heldEntryChange.int`, `state/heldAmendments.readers.int`). `npm run sdk:test` for the touched SDK tests;
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` clean. Tests run only inside
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 …"`,
never two runs at once. **One** `npm run sdk:build`, only after `pgrep -af "vite dev"` shows no serene-pub dev
server. Do not re-pin hashes: list every pin that moved and the lead re-pins. Never `git commit`, `stash`,
`checkout` or `restore`. Comments state the rule, not the story. Another session is building in this checkout
(a performance lane): stay off `src/lib/server/utils/llmQueue.ts`, `src/lib/server/plugins/**`,
`src/lib/server/pipelines/scripts/**`, `src/lib/server/pipelines/runtime/liveRow.ts`,
`src/lib/server/messages/store.ts`, `src/lib/server/sockets/entries.ts` and `lorebooks.ts`.

## Report

**Return the full report as your final message** (the lead saves it as `plans/REPORT-lore-match-2026-11-13.md`):
the rule as built in sentences a modder could read; one rendered example of the "what exists" list and the ask;
what each case of a match does; what the test model's rewrites looked like (length against the original, churn);
provisional copy verbatim; changed files in each repo;
tests and results; pins that moved; open ★; **Noticed, not done**.
