# BRIEF — lane `s4-ner` (wave 0) — card-less cast members are recognised as cast members

Read `plans/briefs/BRIEF-s4-common.md` first, then plan §34.2 ("Entity recognition") and the 2026-11-06 ruling (plan ~line 1412): **"Entity recognition → card-less cast members recognised as cast members (a `cast_member:<id>` mention kind, stored beside card mentions)."** ★9 (2026-11-08): stored as the **entity key only, no migration**; readers filter out members that no longer exist.

## Goal

- `EntityRef.kind` adds `"cast_member"` (`src/lib/server/ranking/entities.ts:144`).
- `loadVocabulary` (`src/lib/server/annotations/index.ts` ~353–357) stops skipping members without a live card: a member with **no live card** (card-less, or its card soft-deleted) contributes `{kind: "cast_member", id: memberId}` with its shown name and aliases; carded members keep `character:<card>`; blank members contribute nothing. Names from versions are already gathered (`amendedNamesOf`) — reuse, don't duplicate.
- The vocabulary hash includes `kind:id`, so a link/unlink re-annotates on its own (no boot pass). Confirm this by test, not by reading.
- `keyProposal.castRefusal` (`ranking/keyProposal.ts` ~592) refuses the new kind the same way it refuses cards.
- `utils/sceneMentions.ts` (~181–215) and `utils/sceneCastProposal.ts` map a `cast_member:` mention straight to the member (no card hop).
- `bindingSuggestions/index.ts`: whatever reads mention kinds handles the new one (check; change only if needed).
- Every reader of stored mentions tolerates a `cast_member:` key whose member is gone (filtered, never thrown).
- Docs: `docs/embeddings-and-rag.md` and/or `docs/lorebook-cast.md` — one or two sentences that cast members without a card are recognised too. Queue a NOMENCLATURE §25 row (the `cast_member` mention kind) in your report; lane s4-bk-lock holds the file.

## Files owned

`src/lib/server/ranking/entities.ts`, `src/lib/server/annotations/index.ts`, `src/lib/server/ranking/keyProposal.ts`, `src/lib/server/utils/sceneMentions.ts`, `src/lib/server/utils/sceneCastProposal.ts`, `src/lib/server/bindingSuggestions/index.ts`, any other mention reader you find (list it in the report; if it's in a file another wave-0 lane owns — see `BRIEF-s4-bk-lock.md` Files owned — stop and ask), tests next to them, `docs/embeddings-and-rag.md`, `docs/lorebook-cast.md`.

## Out of scope

Making members card-less (lane cl), seating card-less members (lane seat), starter copies re-keying annotations (lanes cl/st), any migration, any SDK change.

## Note on cost

Moving the vocabulary hash triggers one re-extraction per book on the next run; with a model starred that costs model calls. That's accepted (memory "paid retrieval is meant to be used") — mention the size of the effect in the report, don't add a switch.

## Done means

- Tests: a card-less member is in the gazetteer under `cast_member:<id>`; a member whose card is soft-deleted likewise; a carded member stays `character:<card>`; the vocabulary hash changes on link and on unlink; `castRefusal` refuses the new kind; `sceneMentions`/`sceneCastProposal` map it to the member; a stored mention of a deleted member is filtered.
- Existing annotation / ranking / scene-mention test files pass.
- tsc + check: no new errors vs baseline.

## Report

`plans/REPORT-s4-ner-2026-11-08.md`.
