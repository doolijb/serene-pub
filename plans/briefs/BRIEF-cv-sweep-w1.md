# BRIEF cv-sweep-w1 — cast tags inside cast versions (A16 restored) + the `castAmendment` leftovers

Read `/home/jody/github/serene-pub/plans/briefs/BRIEF-cv-sweep-wcommon.md` first; its rules bind you.

## Goal
A `{{char:N}}` **cast tag** inside a cast version's text follows its member again, as it does in every other lore text column: a **merge** rewrites the absorbed member's tags to the survivor's (with undo notes), a **delete** writes the member's name in their place (in the merge logs' saved copies too), and an **undo** of a merge puts them back and resolves the restored member's own versions. The rewrite of `character_versions` lives in the versions module (the one writer), and is **registered as a tag site** in `utils/castTags.ts`.

## The rule you restore (NOMENCLATURE §8 **cast tag**, A16, 2026-09-30 — quoted)
"A cast tag **follows its member** (A16, 2026-09-30): a merge rewrites the absorbed member's tags to the survivor's in every lore text column, keeping **undo notes** (`binding_merge_logs.tag_rewrites`), which an undo replays **by position** (the value's **tag positions**), so merges undo in any order; a delete writes the member's name in their place, in the merge logs' saved copies and undo notes too."
And `utils/castTags.ts` itself: "⚠ The list IS the contract: a column missing here keeps an absorbed or deleted member's tag after a merge or delete, and the tag outlives its member."
Why it broke (cv-readers, 2026-11-06): `cast_amendments` was a tag site (`fields`); dated changes and member words now live in `character_versions`, which is no site, and the binding's retold columns are frozen.

## Files owned
- `/home/jody/github/serene-pub/src/lib/server/characters/versions.ts` — add the writer only (no other change).
- `/home/jody/github/serene-pub/src/lib/server/utils/castTags.ts`
- `/home/jody/github/serene-pub/src/lib/server/sockets/narrativeGraph.ts` — only the hunks named below.
- `/home/jody/github/serene-pub/src/lib/server/utils/castTags.test.ts`
- A new test file `/home/jody/github/serene-pub/src/lib/server/sockets/narrativeGraph.castVersionTags.int.test.ts` (or extend `/home/jody/github/serene-pub/src/lib/server/sockets/lorebooks.castTags.int.test.ts` — your call; say which).

## Files readable
Anything. Start with `utils/castTags.ts` (all), `sockets/narrativeGraph.ts` around `rewriteBookCastTags` / `rewriteMergeLogCastTags` (~4305–4400) / `resolveRestoredCastTags` (~4402–4460) / `snapshotMemberStory` (~4599) / `restoreCastVersions` (~4838) / the delete handler (~3640–3710) / the merge's step 9 (~5405) / the undo (~5925–5960); `characters/versions.ts` (`stripNul`, `updateCardVersion` for the in-place update style); `db/schema.ts` `characterVersions` (~9362); `lorebooks.castTags.int.test.ts` for how existing tests drive merge / delete / undo.

## What to build
1. **The writer, in `characters/versions.ts`** (suggested names, 🚧):
   - `CAST_VERSION_TAG_COLUMNS` — the cast-version columns a cast tag can sit in: `name, nickname, aliases, summary, description, personality, scenario, greetings, exampleDialogues, postHistoryInstructions, creatorNotes` (every text-bearing profile column; `rewriteCastTagsDeep` already walks arrays and jsonb).
   - `writeCastVersionTagText(tx, versionId, set)` — writes rewritten cast-tag text onto ONE **cast** version **in place**: refuses a key outside `CAST_VERSION_TAG_COLUMNS`, refuses a card version (`card_id` not null) and an unknown id (throw, like `updateCardVersion`); strips NUL like the other writers; touches nothing else (no `write_order`, `retired_order`, `follows`, parent).
   - **Why in place, retired rows included, no retire step (say this in its JSDoc):** the plan's retire mark (§33.2: "an in-place change of a row some descendant reads … marks the row retired … then inserts the new row") is for a change of *what a reading says*. A tag rewrite is the book renaming a member everywhere at once — the absorbed or deleted member is gone for every line, so a branch reading an old row must see the new tag too; retiring would leave the branch reading a tag that names nobody. Same as every other site (entries are rewritten in place whatever line reads them).
   - Do not import `utils/castTags.ts` from `versions.ts` (keep the dependency one-way: castTags → versions).
2. **The tag site, in `utils/castTags.ts`:** add a `castVersion` site — table `schema.characterVersions`, columns `CAST_VERSION_TAG_COLUMNS`, owner `lorebook_id` (card versions have none, so they are never read) — whose **write goes through `writeCastVersionTagText`**. Give the site spec an optional write delegate used by BOTH `rewriteBookCastTags` and `revertCastTagRewrites` (default: today's `tx.update(t).set(set).where(eq(t.id, id))`). Reference the delegate through a lambda so the `castTags ↔ db/schema` import cycle that already exists cannot bite at module load. Update the header/JSDoc of `CAST_TAG_SITES`.
3. **Drop the ⏳ key:** delete `CastTagRows.castAmendment` (and its comment) in `castTags.ts`; in `narrativeGraph.ts` (undo merge, ~5946) delete the `castAmendment: (await ownedBy(schema.castAmendments))…` lines and **add** `castVersion:` — the ids of `character_versions` whose `cast_member_id` is the restored member (`inserted.id`), read after the versions are restored — so `resolveRestoredCastTags` resolves the restored member's own version text against the book as it stands.
4. **Merge-log saved copies (`rewriteMergeLogCastTags`):** a delete must also write the name into the saved copy's `story.castVersions` rows (`MemberStory.castVersions`, camelCase drizzle keys) for the columns in `CAST_VERSION_TAG_COLUMNS`, as it does for `castAmendments.fields` and `castPresences.note`. (Leave the `castAmendments` retext in place — old logs still carry them.)
5. Nothing else in `narrativeGraph.ts` changes. The merge (step 9) and the delete already call `rewriteBookCastTags`, which now reaches versions through the site.

## Tests (int tests: 60 s timeouts)
- merge: a THIRD member's cast version with `{{char:A}}` in description (and one in greetings or aliases — a jsonb/array column) reads `{{char:S}}` after A is merged into S; a retired row of that member is rewritten too; a card version is untouched;
- undo of that merge puts `{{char:A}}` back (by position) in the version;
- the absorbed member's own version text naming a member merged away since is resolved on undo (via the `castVersion` restored ids);
- delete: a version naming the deleted member reads the member's name; a merge log's saved `castVersions` row naming them reads the name too;
- `writeCastVersionTagText` refuses a card version and an unknown column;
- `castTags.test.ts`: whatever unit coverage the site spec change needs.
Run also: `utils/castTags.test.ts`, `sockets/lorebooks.castTags.int.test.ts`, `sockets/narrativeGraph.deleteNode.int.test.ts`, `sockets/narrativeGraph.mergeSnapshot.int.test.ts`, `sockets/narrativeGraph.undoMergeVectorized.int.test.ts`, `characters/versionsWriter.guard.test.ts`, `characters/frozenColumns.guard.test.ts`, `characters/versions.test.ts`, `characters/versions.write.int.test.ts` — all green.

## Out of scope (write down, never build)
- How the delete computes the name it writes (`nameInProse`, ~3640, reads `lorebook_bindings.name` / the card row) — report under Noticed if you think it should be the member as read.
- `retagImportedBook` / the 0.5 import, the client, docs, NOMENCLATURE.

## Stop and ask when
A test needs a change to an existing expectation; you need a file not listed; a guard allowlist would grow; a name visible outside these files beyond the two suggested ones.

## Done means
The tests above green, `tsc` clean on your files, prettier clean on your hunks. Report per the common brief.
