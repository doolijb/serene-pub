# BRIEF — lane `s4-ner`, worker w1 — the vocabulary recognises card-less cast members (2026-11-08)

Supervisor: lane `s4-ner` (report to it; it checks your diff against this brief). Repo: `/home/jody/github/serene-pub`. Use absolute paths.

## Goal

Owner ruling 2026-11-06: **"Entity recognition → card-less cast members recognised as cast members (a `cast_member:<id>` mention kind, stored beside card mentions)."** ★9 (2026-11-08): stored as the **entity key only, no migration**; readers filter out members that no longer exist.

The supervisor has ALREADY changed `src/lib/server/pipelines/ranking/entities.ts`: `EntityRef.kind` is now `"character" | "cast_member" | "entry"` (with a JSDoc paragraph), and a new `parseEntityKey(key): EntityRef | null` sits under `entityKey`. Don't rewrite those; you may fix a bug in them and say so.

Your work:

1. **`loadVocabulary`** (`src/lib/server/annotations/index.ts` ~314–415). Today it `continue`s past any binding (cast member) without a live card (lines ~352–357). Change it so:
   - a member with a **live card** (`characterId != null && cardDeleted !== true`) keeps `{kind:"character", id: characterId}` — unchanged;
   - a member with **no live card** (characterId null, OR its card soft-deleted `characters.is_deleted = true`) contributes `{kind:"cast_member", id: binding.id}` with its names (`bindingNames(binding)` — name ∪ aliases ∪ absorbedAliases) and its amended names (`amendedNames.cast.get(binding.id)` — already gathered by `amendedNamesOf`; reuse, never re-query), and its cast tag goes into `castTags` like a carded member's;
   - **a member with no name at all** (bindingNames empty AND no amended names) contributes **nothing** — neither names nor tag. This is how "blank members contribute nothing" is honoured (a blank member, `isBlankMember` in `sockets/narrativeGraph.ts`, has no card and no name); don't import `isBlankMember`.
   - **Precedence (load-bearing — `buildGazetteer` lets the first claimant keep a name):** push names in this order: carded members' stored names (binding id order) → carded members' amended names → **card-less members' stored names → card-less members' amended names** → entry titles → entry amended names. So every name a carded member claimed before still resolves to that card; a card-less member never takes a name from a carded one, but does take it from an entry titled the same (cast before entries, as the header says).
   - The hash recipe stays as it is: it already hashes `${name}\0${ref.kind}:${ref.id}` per gazetteer name plus `unnamedTags`, so link/unlink moves the hash by itself. **Don't add a boot pass.** Prove it by test (below), not by reading.
2. **Comments that the change makes false — update them in your files, in the house voice (plain sentences, no history narration):** `loadVocabulary`'s doc ("An unbound binding … contributes nothing here … inventing a third kind is a schema decision …", "A member whose card was deleted reads the same way (plan A25)"), `AnnotationVocabulary.castTags` doc if it says "bound to a live card", `entryEntities`' doc ("A background member's tag … names nobody"), and the header line "A session with no lorebook gets the empty vocabulary" — owner rule: **never frame a session as having no lorebook** (every session has its own book or an overlay); reword to say a null `lorebookId` (a caller with no book id) gets the empty vocabulary, without claiming sessions lack books. Also `valuesFor` (~568): `characterId` stays null for a `cast_member` ref (no column, ★9) — add a short comment saying so.
3. **`keyProposal.castRefusal`** (`src/lib/server/pipelines/ranking/keyProposal.ts` ~586–593): refuse `cast_member` exactly as `character` (a name the cast answers to is never a key). Update its doc and the file header's gate-1 line (~41) if it says "character" only.
4. **`src/lib/server/bindingSuggestions/index.ts`** reads only `open:` keys, so a recognised card-less member simply stops being suggested — no logic change. Update any comment there that says an unbound/background binding contributes nothing to the gazetteer. Same for the comment in `src/lib/server/sockets/bindingSuggestions.ts` ~207–216 ("An unbound binding contributes **nothing** to the gazetteer …"): the `added` suppressor still matters (a minted member's name answers to it from the next scan on, but the suggestion row stays until then) — reword the reason truthfully; comment-only, change no code there.

## Files owned (edit nothing else)

- `src/lib/server/annotations/index.ts`
- `src/lib/server/pipelines/ranking/keyProposal.ts`
- `src/lib/server/pipelines/ranking/entities.ts` (only to fix a bug in the supervisor's lines, or comments)
- `src/lib/server/bindingSuggestions/index.ts` (comments only)
- `src/lib/server/sockets/bindingSuggestions.ts` (the one comment block ~207–216 only)
- Tests: `src/lib/server/annotations/castMemberVocabulary.int.test.ts` (new), `src/lib/server/annotations/castTagAnnotations.int.test.ts`, `src/lib/server/pipelines/ranking/keyProposal.test.ts`, `src/lib/server/pipelines/ranking/entities.test.ts`, `src/lib/server/sockets/castMemberLifecycle.int.test.ts` (only the test "a member still linked to it names nobody in the gazetteer", ~421–431), `src/lib/server/sockets/bindingSuggestions.int.test.ts` (only the comment ~431–437, if it becomes false).

## Files readable

Anything. Useful: `src/lib/server/annotations/castTagAnnotations.int.test.ts` (its `makeBook` / `member` / `card` / `entry` helpers and DB setup are the pattern for the new int test), `src/lib/server/annotations/amendedNames.int.test.ts`, `src/lib/server/utils/castMemberCards.ts`, `src/lib/server/db/schema.ts` (`lorebookBindings`, `characters.isDeleted`, `characterVersions`).

## Tests to write

New `castMemberVocabulary.int.test.ts` (DB opened inside `it` → each `it` gets a **60_000** timeout):
- a card-less member is in the gazetteer under `cast_member:<memberId>` (by its name and an alias);
- a member whose card is soft-deleted is in it as `cast_member:<memberId>`, never `character:<card>`;
- a carded member stays `character:<card>`;
- a member with no name and no card contributes nothing (no ref, no castTags entry);
- a card-less member sharing a name with a carded member does not take it (the name still resolves to `character:<card>`);
- a card-less member's amended name (a cast version's `name`, see `amendedNames.int.test.ts` for how one is written) resolves to `cast_member:<id>`;
- the vocabulary **hash changes on link** (set the member's `character_id` to a live card) **and on unlink** (set it back to null) — compare `loadVocabulary(...).hash` before/after;
- an entry naming a card-less member, annotated (`annotateLorebook`), reads back `cast_member:<id>` through `readEntryAnnotations`; and its `{{char:N}}` tag does too.

Update `castTagAnnotations.int.test.ts` "names nobody for a background member or a tag with no member": a **named** background member's tag now names `cast_member:<id>`; a tag with no member still names nobody. Retitle it to say so.
Update the `castMemberLifecycle` test: the member linked to the deleted card is now `cast_member:<memberId>` in the gazetteer (and still not `character:<gone>`); retitle.
`keyProposal.test.ts`: a gazetteer name with a `cast_member` ref is refused like a character (same reason string as the character case).
`entities.test.ts`: `parseEntityKey` round-trips `entityKey` for all three kinds; null for `open:x`, `""`, `cast_member:0`, `cast_member:abc`.

## Run (only these, in a capped scope, logged)

```
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run src/lib/server/annotations/castMemberVocabulary.int.test.ts src/lib/server/annotations/castTagAnnotations.int.test.ts src/lib/server/annotations/amendedNames.int.test.ts src/lib/server/annotations/versionNames.int.test.ts src/lib/server/annotations/queue.int.test.ts src/lib/server/pipelines/ranking/keyProposal.test.ts src/lib/server/pipelines/ranking/entities.test.ts src/lib/server/sockets/castMemberLifecycle.int.test.ts src/lib/server/sockets/bindingSuggestions.int.test.ts --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-ner-w1-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-ner-w1-tests.log'
```
Never pipe vitest into `head`. Don't run tsc / `npm run check` — the supervisor does. Run `npx prettier --check` on each changed file; **only `--write` the lines you changed** (never reformat a whole file; if a file fails only on lines you didn't touch, leave it and say so).

## Rules that apply (CLAUDE.md, quoted)

- "It is a **session**, never a *chat*."
- Owner memory rule "There is ALWAYS a lorebook": never write copy or code comments that frame a session as having no lorebook; say own book / overlay.
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "Never add a top-level `await` to `src/lib/server/db/index.ts`; await `dbReady`."
- No migration, no new table/column/setting, no boot pass. No new exported name beyond what this brief names — if you think one is needed, stop and say so in your report instead.
- Findings outside these files go in your report under **Noticed, not done** — never fixed in passing.
- Existing files have uncommitted work from earlier lanes; edit around it, never revert it.

## Stop and ask (in your report, then stop) when

A test proves a live flow depends on card-less members being absent from the vocabulary; a change seems to need a file not listed above; a new name, setting or migration seems needed.

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (No `sdk:build` is needed for this task.)

## Report

Your final message: changed files (with what changed in each), tests run with the pass/fail counts from the log, every implementation choice you made, Noticed-not-done.
