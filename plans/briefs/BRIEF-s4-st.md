# BRIEF — lane `s4-st` (wave 5) — starters copy people card-less; provided books hide their carrier cards; Mundi's save writer (mundi-27b)

Read `plans/briefs/BRIEF-s4-common.md`, plan §34.2 ("Starters card-less"), §29 ("Save upgrade (annex v1→v2) → S4, as mundi-27b", ~610–615; ★S3-5 ~649), the 2026-11-08 rulings (★S4-1 hidden carrier cards; ★5 0.6 starter-copied cards stay), and the reports `plans/REPORT-s4-cl-2026-11-08.md` ("For other lanes: st"), `plans/REPORT-s4-chr-read-2026-11-08.md` ("st (wave 5): lift `genuineProvidedMarkSql()`"), `plans/REPORT-s4-seat-live-2026-11-08.md`. Owner rulings to quote: "every starter copies people card-less" (2026-11-05); "Plugins can only ship lorebooks as starters. They contain cast, not cards." (2026-11-05); ★S4-1 (2026-11-08): the provided book keeps its plugin-stamped cards **hidden** as the release carrier (so the plugin-upgrade Update offer works); every starter copy is card-less. Memory: `feedback_plugin_books_are_starters.md`, `feedback_starters_disabled_never_deleted.md`, `project_mundi_port_permission_2026_10_27.md`.

## Goal

1. **Starters card-less:** delete `ownCastCards` (`lorebooks/starterKits.ts` ~531–658); after the registry copy (versions included) every member goes through `makeMemberCardless(tx, id, { cause: 'starter' })` — add `'starter'` to `CardlessCause` (non-unlink causes do the full detach: `follows` resolved, sprite sets / gallery / face / likeness re-owned to the asker, stats copied fill-only). `writePrimerInto` (~822) inserts card-less members with the primer's name and description as their own words (no card minted). `afterKitCopy` (~662) keeps only the cover and the vectorizer queue; `madeFromKit.cards` and the `characters:list` emit (`sockets/sessions.ts` ~1521 — that hunk only) go. `tableRegistry.ts` `remapEntityKey` (~110) remaps `cast_member:` keys to the copy's member ids.
2. **★S4-1 hidden carrier cards:** lift `genuineProvidedMarkSql()` (now private in `cast/characterRows.ts`) into `plugins/providedMarks.ts` as the one SQL hide predicate (the twin of `markedCharacter`, as `shownLorebook` is); switch `characterRows.ts` to it and move its frozen-guard allowlist entry with it (`characters/frozenColumns.guard.test.ts`). Apply the same hide to every **library, picker and search** read of cards: `characters:list`, the character pickers (`CharacterSelectModal`'s source), Jump/search (`jumpSearch`), and anywhere else a card list reaches a person (grep for the card list readers; list each). The provided book's own members stay linked to their hidden cards (that's the carrier); only cards are hidden, never members.
3. **★5:** cards that 0.6 starters already copied into libraries stay — no migration, no cleanup.
4. **mundi-27b** (the port repo `~/github/mundi-sp`; never commit there — the owner commits): the save upgrade's **writer** — annex v2 (avatar → `castMemberId`; phone lanes keep their v1 numbers; presence and avatars keyed by member), reader stays dual until 0.7 (it already reads v2 since mundi-27a, `src/engine/identity.ts`). Branch risk (§29): an unknown member id after a branch re-resolves by avatar tag (`extensions.mundi.avatar`). Run the port's own tests and build its zip as mundi-27a did (`REPORT-mundi-27a-2026-11-05.md` has the commands); record the zip path + sha.
5. Docs: `docs/lorebooks.md` and `docs/getting-started.md` (starters bring cast, not cards; "Copy to my characters" takes one home), `docs/plugins.md` (a plugin's book brings cast; its cards stay hidden as the release carrier — one sentence, modder rule).

## Files owned

`src/lib/server/lorebooks/starterKits.ts`, `src/lib/server/plugins/{providedPrimers,providedBooks,providedMarks}.ts`, `src/lib/server/sockets/starterKits.ts`, `src/lib/server/cast/cardless.ts` (the cause only), `src/lib/server/lorebooks/tableRegistry.ts` (`remapEntityKey` only), `src/lib/server/cast/characterRows.ts` (the predicate switch only), `src/lib/server/characters/frozenColumns.guard.test.ts` (the moved entry), `src/lib/server/sockets/sessions.ts` (~1521 emit only), the card list / picker / search readers you find (list them), `~/github/mundi-sp/**`, `docs/{lorebooks,getting-started,plugins}.md`, tests next to all of these.

**Lane s4-fixes runs beside you** and owns `src/lib/server/state/**`, `sockets/state.ts`, `sockets/lorebooks.ts`, `annotations/index.ts`, `characters/versions.ts`, `sessions/convertRuleset.ts`, `EditSessionForm.svelte`, `docs/{lorebook-cast,sessions}.md`. Don't touch them.

## Out of scope

Copy to my characters (done), the Characters view UI (chr-view), the fold.

## Stop and ask when

Common brief's Decisions apply; a hide would also hide something a person owns and uses (e.g. an admin's own plugin card in their library — is that "every library"? propose); Mundi's save format needs a decision the plan doesn't make.

## Done means

Tests: starting from a primer, an admin kit and a provided book creates **no `characters` rows** for the asker; members' `follows` empty; annotations re-keyed `cast_member:`; sprite sets, gallery and faces present and owned by the asker; a session started from it seats those members (card-less seats work — s4-seat-live); hidden carrier cards appear in no list, picker or search for anyone, while the provided book's members still read their words; plugin upgrade still offers Update on the provided book's members; Mundi port tests green + zip built. tsc + check no new errors. Report `plans/REPORT-s4-st-2026-11-08.md`.
