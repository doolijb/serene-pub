# BRIEF — worker `kn-4b-w1` — SDK pins, three checked recipes, and the docs for `note-entry-knowledge@1`

Supervisor: lane `kn-4b`. SDK repo `/home/jody/github/serene-pub-sdk`, app repo `/home/jody/github/serene-pub`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You should not need `sdk:build`: you change no SDK source. If you find you must, stop and report instead.)

Also: never `git checkout / restore / stash` in either repo (most of the SDK is uncommitted); never `prettier --write`
or a scratch-copy equivalent; never `npm install` / `npm test` at the SDK root; never `pkill -f` a generic pattern.

## Goal

The SDK now declares `core:outlet/note-entry-knowledge@1` (`noteEntryKnowledge` in
`contracts/src/outlets.ts`, after `updateCastMember`; **read its doc comment first: it is the behaviour you
document**; do not change its shape). A pipeline step notes that one cast member came to know one lorebook entry
(`knowledgeKind` `was_told` | `has_been_there`), or no longer does (`end: true`). In-ports `member`, `entry`
(both `S.json`); out-ports `main`, `tieId`. No shipped genre or preset places it (owner 2026-11-15: "That works,
lets add SDK api for it as well, though we won't plug it in anywhere. Can add some recipes for how to use it.").

Your job: (A) fix SDK tests that pin every definition; (B) three recipes in the guide, each a checked fence and
each validated by an SDK test; (C) the docs and the names.

## Files owned (edit only these)

SDK: `guides/genres-presets-and-routines.md` (the section **What a character does not know**, ~502–539; only
there), `INTEGRATING.md` (§1p only, ~1541+), new `sdk-tests/noteEntryKnowledge.test.ts`, and existing
`sdk-tests/*.test.ts` files only where they pin the set of core definitions (a count, a list, a hash) and the new
outlet breaks them. App: `docs/pipelines.md` (one paragraph), `NOMENCLATURE.md` (§14 rows, §25 ledger).
Not owned: every SDK source file (`contracts/`, `sdk/`, `core-catalog/`, `conformance/`), every app source file.
Another worker is binding the outlet in the app at the same time; you touch no app source.

## A. Pins

Grep `sdk-tests/` for tests that enumerate core definitions or outlets (`updateCastMember`, `linkLoreEntries`,
`core:outlet/`, counts of definitions, registry hashes). Run them; fix only what the new outlet breaks (re-pin
with a `(was …)` note where the file's convention keeps one). List each.

## B. Recipes (the guide's knowledge section, after the rule list or at its end, under a short heading)

Rules for the fences (read the convention at the top of `sdk-tests/guideSnippets.test.ts`): recipes are **spec
fragments, not scripts** — ` ```ts ` fences with a `<!-- prelude: … -->` comment, type-checked by
`guideSnippets.test.ts` (or ` ```playground ` fences, `guides.test.ts`); **never** ` ```js recipe ` (those are
rescore scripts with an app runner map). See the existing checked fence in the same section (`my:spec/reads-everything`).
Fan-out is the SDK's `each` clause, whose `max` is mandatory (`sdk/src/builder.ts` ~300–325; a shipped use:
`core-catalog/src/genres/dungeon-crawler/secrets.ts` 140–152). The outlet is singular: one member, one entry.

1. **Told in the scene** — after a reply, every cast member in the scene comes to know the entries the reply
   named: `core:query/entries-named@1` (`contracts/src/queries.ts` ~1579; `main` rows carry `entryId`, `ids` the
   ids) over the reply, then a **nested `each`**: members × named entries → the outlet with
   `knowledgeKind: 'was_told'` (via `params`; read the guide's own note on why a param must go in the `params`
   slot, not at the node's top level, and use the same spelling: `params: slot.params()` + `.defaults(...)`, or
   find how an outlet's params are set in a spec and use that). Find the node that gives the scene's cast (or the
   session's seats) — candidates: `core:query/session-cast@1`, `cast-presences@1`, the inlet's own ports, the
   session dossier; read before choosing. Say where to place it (an after-reply routine runs with no speaker,
   so `entries-named` reads everything there; on the speaker's own turn `knownToSpeaker` applies) in one sentence.
2. **Has been there** — when a scene closes at a place, its cast comes to know that place's entry
   (`has_been_there`). The `scene-closed` event (`sdk/src/events.ts` ~948–958) carries only the scene and its
   line, so the fragment reads the place itself (the location slot, `core:slot/location@1`, through the read
   that returns state values: e.g. `core:query/session-state@1`) and the scene's cast itself. State in one line
   that programme 1.6 will ship this in core later and this is a recipe.
3. **A model decides** — clearly marked as costing a model call: a judge step (find the oracle a shipped
   pipeline uses for a structured yes/no or a pick; read `contracts/src/oracles.ts`) picks which of the named
   entries the reply actually revealed; only those go through `each` to the outlet.

If a recipe cannot be written with existing nodes, write the rest, and say exactly which node is missing in the
report and in the guide (one sentence). **Do not add nodes or change SDK source.**

Each recipe gets one sentence of purpose above it. Keep each fragment short (a dozen or two lines) and
copyable: another worker will paste each one verbatim into an app integration test.

**`sdk-tests/noteEntryKnowledge.test.ts`** (new, `node:test` + `assert` like its neighbours, e.g.
`sdk-tests/castMember.test.ts`, `knownToSpeaker.test.ts`): (a) the declaration — id, `effects: 'write'`, review
fields `[]`, no `causesEvent`, the two params with their defaults and the enum's two members, ports
`member` / `entry` in, `main` / `tieId` out; (b) each recipe's fragment, the same text as the guide's fence, builds
and passes `validate()` with no error findings (find how neighbouring tests call `validate`).

## C. Docs and names (copy is provisional: mark 🚧 where the file marks provisional words)

- **The guide** (same section, before the recipes, one short paragraph): the outlet; play's two kinds only; it
  refuses (writes nothing, says so in its record) when the lorebook's owner set a hand tie (*Knows* or *Kept
  from*) for that member and entry; a repeat writes nothing; `end` ends only play's ties, and only those on the
  session's own line or in its notes; where it lands (Full on the session owner's own lorebook: the lorebook, on
  the session's line, dated; otherwise the session's notes, never applied to the lorebook); Back and a swipe take
  it back with the reply; it never sets or clears the **not common knowledge** mark (no outlet writes the mark:
  that is the lorebook owner's choice); the limit: a hand tie set later still loses to an earlier dated tie play
  wrote (the later date wins), until that rule is decided.
- **`INTEGRATING.md` §1p**: one bullet with the same facts in its register, naming the app side
  (`pipelines/runtime/host.ts` commit case, `bindings.outlets.ts`, `writeKnowledgeTie` / `endKnowledgeTie` in
  `server/lorebooks/entryKnowledge.ts`, the session's owner as the writer, `loreWriteRefusal` first, imprinted as a
  `relationship` with the reply). Say C39's `LORE_WRITES` does not list it: that list is the writes that take
  `sources`, and this outlet takes none.
- **`docs/pipelines.md`** — one paragraph in the bullet list near *Note it in the scene* (~97), user-facing
  words (sessions, lorebook, Back), no ids except the outlet's name *Note who knows an entry*.
- **`NOMENCLATURE.md`**: in §14 (~955–970), a new row after **knowledge tie**: **Note who knows an entry**
  (`core:outlet/note-entry-knowledge@1`, SDK `noteEntryKnowledge`) 🚧 BUILT 2026-11-16 (lane kn-4b; owner quote
  above) with its params (`knowledgeKind`, `end`), out-port `tieId`, labels (*How they came to know it*, *Was
  told*, *Has been there*, *No longer knows it*) and its charter: *Purpose:* let a pipeline state that a cast member
  came to know an entry in play. *Owns:* nothing; it asks the knowledge module to write. *Does not own:* the tie
  rows and every write to them (`lorebooks/entryKnowledge.ts`), the mark (no outlet), the hand kinds (the
  lorebook's owner on the knowledge screens), the decision (`judgeEntryKnowledge`). ⚠ Not `link-lore-entries@1`.
  ⚠ "note" here is not the session's notes (the own book). Update the **knowledge tie** row's *Writers:* clause to
  add the outlet (play's kinds, written as the session's owner). Then a §25 ledger bullet `- **2026-11-16 (lane
  kn-4b — …; 🚧 provisional; no migration).**` in the style of the neighbouring bullets (~4318–4326): *new* the
  outlet id, `noteEntryKnowledge`, the params, the port, the labels, and the app helper names the other worker
  reports (leave a `‹app helper›` placeholder the supervisor fills in; say so in your report).

Grep each new word across `src`, the SDK and the schema before writing it (NOMENCLATURE §24 step 2); report any
collision.

## How to run tests

Wait first: `until ! pgrep -f "^node .*vitest" >/dev/null && ! pgrep -f "tsx --test" >/dev/null; do sleep 5; done`,
then start immediately. SDK test files only as:
`cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "cd ../serene-pub-sdk/sdk-tests && npx tsx --test noteEntryKnowledge.test.ts guideSnippets.test.ts guides.test.ts docs.test.ts <pin files> > /home/jody/github/serene-pub/plans/kn-4b-w1-<n>.log 2>&1"`
Then `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsc --noEmit -p .` once at the end (report errors in
your files). Never pipe a test run into `head`. `npx prettier --check` the files you changed.

## Stop and ask (in the report) when

A recipe needs a node that does not exist; the outlet's declaration seems wrong for a recipe (say why; do not
change it); a word you need collides; a fix would touch a file you do not own.

## Report (your final message)

Changed files; the three recipes (node chain of each in one line, and the exact fence text location); missing
nodes if any; tests run with pass counts and log paths; pins re-pinned (old → new); new words and grep results;
**Noticed, not done**. Under 500 words.
