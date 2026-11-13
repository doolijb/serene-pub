# REPORT playtest3-L3 — 2026-11-04

Lane `playtest3-L3` (★L-3 + ★L-3b). Status question: none relayed.

**Summary.** ★L-3b is built in core and the form: each of Name and Nickname has a *Use from card* switch; an own `""` nickname is stored and means *no nickname in this book*; a blank own name is refused (`OWN_NAME_NOT_TEXT`). The lane's Done-means set is green: 10 files, 0 failures. Two things are **not** done because the files are not mine (queued below): the book file still drops `""` on import and export (Q1, Q2), and 5 cases in 4 non-lane test files still assert the old ★L-3 rule and fail (Q5).

## Changed files (app repo only; no SDK change)
- `src/lib/shared/lorebooks/memberIdentity.ts` (supervisor): `ownNameValue` now trims and **keeps `""`** (null only when absent or not text). `hasOwnNames` is true for non-blank own name text or for any own nickname string. `memberNames`: a blank own name reads as no own name; own nickname `""` → `nickname: null`, else `ownNickname ?? card.nickname || null`. Header rewritten for ★L-3/★L-3b.
- `src/lib/server/lorebooks/castOwnNames.ts` (w1): `normaliseOwnNames` handles each key: absent stays absent; `null` stays `null`; a non-string is refused; text is trimmed. A trimmed `""` is refused for `ownName` and kept for `ownNickname`. `providedCastProblem` is unchanged; it now tells `null` from `""`, which is right because switching to *no nickname* is a change.
- Tests (w1): `memberIdentity.test.ts`, `castPool.test.ts`, `retold.int.test.ts`, `sessionPageProjections.castNames.test.ts`, `castOwnNames.int.test.ts`. Each pinned case keeps its intent:
  - a case meaning "the own name shows" now gives the book `ownNickname: ""`;
  - new cases pin that an own name alone shows the card's nickname (★L-3).
  - `rowProjection.castNames.int.test.ts` was green and is untouched.
- `src/lib/client/lorebooks/cast/memberDraft.ts` (w2): `MemberDraft.ownName` and `ownNickname` are now `string | null`, where `null` means *Use from card* on. `memberDraftOf` reads a stored `""` nickname as off-and-blank, and a blank own name as on. `memberPatch` is unchanged except its comments.
- `memberDraft.test.ts` (w2): fixed the `"  "` case and added null/`""` cases.
- `src/lib/client/lorebooks/cast/CastMemberForm.svelte` (w2):
  - Name and Nickname each get a *Use from card* `Switch`, built like the retold switch, with an sr-only `Name:` / `Nickname:` prefix.
  - On, the input is disabled (`opacity-60`) and shows the card's value; the nickname shows the existing *The card has none.* placeholder when the card has none. Off, the input is bound to the draft.
  - The old "nickname placeholder empties while a Name is typed" rule is removed.
  - All three save controls are disabled while Name is off and blank.
  - The doc comment is updated. The help line *Shown in this book only; the card keeps its own.* is unchanged; it does not state the old rule.
- `castMemberForm.dom.test.ts` (w2): the broken cases are rewritten and new cases added:
  - Nickname switched off and cleared saves `""`;
  - a stored `""` draws the switch off with an empty input;
  - Name off and blank disables Save;
  - Name switched back on saves `null`.
- `docs/lorebook-cast.md` line 34 (w2): the toggle, what on and off mean, why a new name alone still shows the card's nickname, and that an empty name is not allowed. "Clear a field to use the card's again" is removed.
- Briefs: `plans/briefs/BRIEF-playtest3-L3-w1.md`, `plans/briefs/BRIEF-playtest3-L3-w2.md`.

**Decisions I took (inside scope):**
- I wrote the `memberIdentity.ts` change myself before launching the workers, so both built against the same contract.
- Switching *Use from card* **off** pre-fills the field with the card's current value, so the field doesn't jump to blank.
- A blank own name is blocked by disabling Save, with no new copy.
- `castPool.test.ts` and `memberIdentity.test.ts`: I fixed prettier's flags in lines the lane wrote. I checked first that every hunk prettier wanted lay in lane-written lines, then applied its output to those two files.

## Tests run
Command shape: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <files> > …/scratchpad/playtest3-L3-<n>.log 2>&1'`
- **Baseline** (`-0`, before the lane, after the lead's rule change): 8 failed, 91 passed across the 8 lane files.
- **Final** (`-1`): the Done-means set is green — 10 files, **0 failures**:
  - `memberIdentity.test`, `castPool.test`, `sessionPageProjections.castNames.test`, `retold.int`, `castOwnNames.int`, `rowProjection.castNames.int`, `memberDraft.test`, `castMemberForm.dom.test`;
  - plus `retoldBlock.dom.test` and `memberPage.dom.test`.
  - The same run also covered 5 neighbouring reader tests (171 tests in all). **4 cases fail in 3 non-lane files** (`castTag.test`, `characterLoreVisibility.test`, `characters.test`); see Q5.
- **Probe** (`-2`), the other own-name test files: `entryManager.test`, `narrativeGraph.buildReadsStoredCast.int`, `lorebooks.import-export.int`, `sessions.sideCharacter.int`, `chains.sideCharacterExtras.int`, `runStatus.int`, `fireAction.collects.int`. Result: **1 fails** (`entryManager.test`, Q5), 69 pass.
- Done-means item **"import round-trips `""`" is NOT met in this lane.** It needs Q1, Q2 and Q4 in files I don't own.
- Prettier `--check`:
  - clean: `memberIdentity.ts`, `castOwnNames.ts`, `castOwnNames.int.test.ts`, `memberDraft.ts`, `castMemberForm.dom.test.ts`, `castPool.test.ts`, `memberIdentity.test.ts`;
  - still flagged, only on lines the lane did not write: `retold.int.test.ts` and `sessionPageProjections.castNames.test.ts` (long imports and fixtures), `memberDraft.test.ts` (~114, 204, 254), `CastMemberForm.svelte:923` (an existing comment indent) and `docs/lorebook-cast.md` (list indent and emphasis, already flagged at HEAD).

## Stopped, needs owner
- ★L-3b-a (copy, recommended): an off-and-blank Nickname has no placeholder. I recommend *No nickname in this book* as its placeholder, so the empty field says what it means. Trade-off: one new UI string (canon row below). I did not add it.
- ★L-3b-b (consistency, for the owner's eye): the retold switch is "on = Retold here (own)". The new *Use from card* switch is "on = the card's", as ruled. The two switches sit on the same page with opposite meanings for "on". I built it as ruled.

## Canon rows needed
- None new beyond what the lead already wrote in §25 (2026-11-04 round 2b: *Use from card*, `""` = no nickname, own empty name refused).
- The §8 own-name row still reads "a blank save stores NULL" and "`nickname = ownNickname ?? (ownName ? null : card.nickname)` (★L-3, open…)". Both are stale. Suggested replacement: "NULL = *Use from card* (the card's reads through); an own `""` nickname = no nickname in this book; a blank own name is refused; rule `name = ownName || card.name`, `nickname = ownNickname ?? card.nickname` (own `""` → none) (★L-3, ★L-3b ruled 2026-11-04)".
- If ★L-3b-a is accepted: the label *No nickname in this book* (placeholder).

## Queued for other lanes / the lead (exact edits)
- **Q1 `src/lib/server/sockets/lorebooks.ts` ~2680–2683 (import `ownText`).** `t && …` folds `""` to null, so an own empty nickname is lost on import. Replace with:
  ```ts
  const ownText = (v: unknown) => {
  	const t = ownNameValue(v)
  	return t != null && t.length <= LOREBOOK_IMPORT_LIMITS.maxNameChars ? t : null
  }
  ```
  and at ~2710: `ownName: boundCharacterId != null ? ownText(binding?.ownName) || null : null,` (a blank own name is never stored). The `ownNickname:` line stays as it is.
- **Q2 `src/lib/server/utils/lorebookExportBuilder.ts:194`.** `...(binding.ownNickname ? { ownNickname: binding.ownNickname } : {})` → `...(binding.ownNickname != null ? { ownNickname: binding.ownNickname } : {})`. Also `lorebookExportMapper.ts:754`, comment only: "written only when set" → "written when set, `""` included (no nickname in this book)". No format bump; a file without the field imports as before.
- **Q3 `src/lib/server/sockets/lorebooks.ts` ~1677–1679**, stale comment "text or blank (stored as null)" → "text, or null for *Use from card*; an own empty nickname is kept as `""`, an empty name is refused (★L-3b)". The handler needs no code change: `normaliseOwnNames` covers it.
- **Q4 `src/lib/server/sockets/lorebooks.import-export.int.test.ts`**, add after the §0-D case (~665), once Q1 and Q2 land:
  ```ts
  test("an own empty nickname travels as \"\" (★L-3b)", async () => {
  	const { lorebooksCreateHandler, lorebookImportHandler } = await import("./lorebooks")
  	const user = await makeUser("lb-ownnick-empty-user")
  	const card = await makeCharacter(user.id, { name: "Card Empty" })
  	const { lorebook } = await lorebooksCreateHandler.handler(fakeSocket(user.id), { name: "Empty Nick Book" }, noopEmit)
  	await testDb.insert(schema.lorebookBindings).values({ lorebookId: lorebook.id, characterId: card.id, binding: "{{char:1}}", ownNickname: "" })
  	const data = JSON.parse((await dormantExport(fakeSocket(user.id), { id: lorebook.id })).blob.toString("utf-8"))
  	expect(data.extensions.serenepub.bindings[0].ownNickname).toBe("")
  	await testDb.delete(schema.lorebooks).where(eq(schema.lorebooks.userId, user.id))
  	await testDb.delete(schema.characters).where(eq(schema.characters.userId, user.id))
  	const imported = await lorebookImportHandler.handler(fakeSocket(user.id), { lorebookJson: JSON.stringify(data) }, noopEmit)
  	const [row] = await testDb.query.lorebookBindings.findMany({ where: (b, { eq }) => eq(b.lorebookId, imported.lorebook!.id) })
  	expect(row.ownNickname).toBe("")
  	expect(row.ownName).toBeNull()
  })
  ```
- **Q5. Five test cases outside this lane fail.** The lead's ★L-3 rule causes all five; ★L-3b does not. Each means "the own name shows", so add `ownNickname: ""`:
  - `src/lib/client/utils/castTag.test.ts:51`: `{ ...rows[0], ownName: "Aria Nox", ownNickname: "" }`. Retitle line 50 to "an own name with an own empty nickname shows; an own nickname wins".
  - `src/lib/shared/utils/characterLoreVisibility.test.ts:108`: add `ownNickname: ""` beside `ownName: "Vera"`.
  - `src/lib/client/components/sessionPage/projections/characters.test.ts:328` and `:343`: `{ ownName: "Adel", ownNickname: null }` → `ownNickname: ""`.
  - `src/lib/client/components/lorebookForms/entryManager.test.ts:197`: add `ownNickname: ""` beside `ownName: "Vera"`.

## Noticed, not done
- R1 sweep: no reader in `src` carries its own copy of the nickname rule. They all go through `memberIdentity.ts` (`memberShownName` / `memberNames` / `withMemberNames` / `hasOwnNames`). `rowProjection.ts:161` selects own names with `isNotNull`, so `""` rows are included, which is correct.
- `sockets/lorebooks.ts` ~1681 runs `normaliseOwnNames` *before* it drops own names for a background member. A background-member update that sends `ownName: ""` is now refused instead of silently dropped. The form never sends own names for a background member, but another client could.
- The worker reports note that the Switch `onCheckedChange` setters are typed by inference only. No `svelte-check` was run, per the rules; the lead's grouped `check` covers it.

**Lead (2026-11-04):** queued edits applied — import keeps `""` (`ownText`), an imported empty own NAME folds to null, the export writes `ownNickname` when not null, the stale handler comment, the five fixtures (`castTag`, `characterLoreVisibility`, `characters` ×2, `entryManager`), and the Q4 round-trip test. ★L-3b-a (the placeholder *No nickname in this book*) and ★L-3b-b (the two switches' opposite "on") go to the owner.

**Scope review (lead, 2026-11-04): no objection; three low findings, done** — (1) a background member's own names are dropped BEFORE `normaliseOwnNames` again (the silent drop restored; no refusal for another client's `ownName: ""`); (2) the stale handler comment replaced; (3) the `memberDraft.ts:69-70` wrap is prettier's on a line no lane wrote this round — harmless, recorded.
