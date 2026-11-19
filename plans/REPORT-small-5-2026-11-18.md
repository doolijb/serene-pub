# REPORT small-5 — WK2 (a lock passes added art) and SM3 (no genre means every field) — 2026-11-18

Saved by the lead from the worker's hand-back. Brief: `briefs/BRIEF-small-5.md`; plan `PLAN-provided-mirror-wk2-sm-2026-11-18.md` §1, §4.

**WK2.** Both outlet lock blocks are gone from `pipelines/runtime/host.ts` (`offer-media`, `attach-sprite`); art a run makes is added to a locked cast member. `sprites/index.ts` `ensureDefaultSpriteSet(db, owner, { flagDefault })`; for a locked member `sprites/attach.ts` passes `flagDefault: false` (never creates or promotes a default set) and returns the run note "'‹name›' is locked, so this run added its sprites without making a default set." An existing default set takes the sprite with no note. A run never sets a face, locked or not: `update-cast-member` carrying a face throws "A face is chosen by a person, not by a run, so this write does not change it." (existing).
**SM3.** The four `"core:genre/chat"` fallbacks in `host.ts` are gone; `sessions/annexFields.ts` `declaredAnnexFields`, `annexFieldFor`, `annexFieldsOfOwner` take an optional `genreId`; none means every field. No shipped annex field is lorebook-scoped, so nothing shipped becomes newly writable; only a plugin's field declared with `scope: 'lorebook'` and a `genre` is affected.
**Tests.** `castMemberLock`, `annex`, `host.ownBookFull` green; `castMemberLock` + `sprites/`, `portrait.int.test.ts`, `sessions/`: 120 files, 912 tests green; `tsc` 0.
**Docs.** `docs/lorebook-cast.md`, `docs/pipelines.md`, NOMENCLATURE (lock row, §25).
**Noticed.** `prettier --check` warns on three touched files. No scope review run (small, two-part task; covered by the grouped verification).
