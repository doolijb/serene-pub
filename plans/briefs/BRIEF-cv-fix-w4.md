# BRIEF cv-fix-w4 — wire types; provided books keep members pinned

Worker for lane **cv-fix** (supervisor: lane-supervisor, Opus). Repo `/home/jody/github/serene-pub`. Use absolute paths. Report back as your final message (no report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

## Context
- `plans/REPORT-cv-writers-2026-11-05.md` §"Queued" (`shared/sockets/types.ts` needs these additions) and its ★cv-writers-2; `plans/REPORT-cv-member-2026-11-05.md` §"Queued" (`changeLaterVersions?` / `laterVersions`).
- **Owner ruling 2026-11-06:** _Provided-book upgrade → "They stay, with the Update offer" — every member stays pinned, unedited ones too (**reverses cv-writers' ★cv-writers-2 build**)._
- Another worker (w3) runs at the same time on `characters/versions.ts` and `shared/characters/profile.ts`. Don't touch those.

## Files owned (edit only these)
- `src/lib/shared/sockets/types.ts`
- `src/lib/server/sockets/characters.ts` — only the local wire types (~195–216, ~1715–1745) and the places that use them
- `src/lib/server/plugins/providedBooks.ts` — only the upgrade hunk (~1135–1180)
- tests: `src/lib/server/plugins/providedBooks.int.test.ts` (and its siblings `providedBooks*.test.ts` if they pin the move)
- **Do not edit `NOMENCLATURE.md`, `sockets/lorebooks.ts` or `sockets/amendments.ts`** (their local `changeLaterVersions` types are dropped by the next batch).

## Items

### 8. `shared/sockets/types.ts`: the characters wire additions; drop the local types
Today `sockets/characters.ts` declares them as local intersection types (`GetParams`, `GetResponse`, `UpdateParams`, `UpdateResponse`, `ImportCardResponse`, `ImportResolveParams`, `ImportResolveResponse`, ~204–216 and ~1720–1745). Move them into the `Sockets.Characters` namespace (`types.ts` ~166–400):
- `Get.Params.cardVersionId?: number`; `Get.Response`: `cardVersionId?`, `currentCardVersionId?`, `cardVersions?: CardVersionSummary[]`.
- `Update.Params`: `cardVersionId?: number`, `saveAsNewVersion?: { label?: string | null }`. `Update.Response`: `cardVersionId: number`, `currentCardVersionId: number`, `cardVersions: CardVersionSummary[]`, `staying?: StayingMember[]`.
- `ImportCard.Response.conflict`: `currentVersion: CardVersionSummary`, `suggestedLabel: string | null`.
- `ImportResolve.Params.action: "addVersion" | "createNew" | "overwrite"` (⏳ `overwrite` is read as `addVersion` until the wave-3 client sends `addVersion` — keep the doc line), `label?: string | null`. `ImportResolve.Response.cardVersionId?: number`.
- `CardVersionSummary { id; number; label }` and `StayingMember { castMemberId; lorebookId; name; cardVersionId; label }` (🚧) move to `types.ts` (inside `Sockets.Characters`, or beside it if that is how the file shares a type — follow the file's own pattern) and `sockets/characters.ts` imports them (keep a type re-export there only if something else imports them from `sockets/characters` — grep).
- Keep every doc comment the local types carry. Then delete the local types and use `Sockets.Characters.*` directly in the handlers' `Handler<…>` generics.
- Check the client still type-checks: `grep -rn "Characters.Get\|Characters.Update\|ImportResolve\|ImportCard" src/lib/client src/routes --include=*.svelte --include=*.ts` — a field made required on a Response could break a client mock or literal; if so, say where (don't edit client files; list them).

### 16. `shared/sockets/types.ts`: `changeLaterVersions` / `laterVersions`
Add 🚧 `changeLaterVersions?: boolean` to the Params and `laterVersions?: { changed: number; kept: number }` to the Response of `Lorebooks.UpdateBinding` and of cast `Amendments.Create` / `Amendments.Update` (★CV-13's **Change later versions too**: the same changes written onto the member's later authored versions on that line; a session-written one keeps its words). Doc comment on each. Do not touch the local declarations in `sockets/lorebooks.ts` (~1981–1987) or `sockets/amendments.ts` (~1343–1346); they still compile as intersections.

### 15. Provided-book upgrade: every member stays pinned (`plugins/providedBooks.ts` ~1135–1180)
cv-writers made an upgrade move the plugin's own unedited member onto the new card version (`if (cardUpdatedInPlace) { … updateMemberToCardVersion(tx, at.binding.id, current.id) }`). Remove that move: the card still gets its new card version (the overwrite, unchanged), the member's versions keep their parent (pinned to the version they had), and the person sees the Update offer (wave 3's client; the server already answers which members are on an older version). Drop the now-unused `updateMemberToCardVersion` import and the `cardUpdatedInPlace` flag if nothing else reads it. Keep the rest of the hunk (own names and sprite set to the base, the binding's `characterId`, the cast hash).
- Check `castHashNow` (cv-writers: it reads `characters.character_version` so installed hashes stay stable): after the upgrade the member is unchanged, so its recorded `hash` must still say "unedited" on the next upgrade — confirm with a test (two upgrades in a row: the second still treats the member as the plugin's, not `keptEdited`).
- Tests: change `providedBooks.int.test.ts` ~1268 ("an upgrade adds a card version, moves its unedited member onto it…") to the ruling: the card has v2, the unedited member's versions still name v1, the person-edited member stays, the file's own values still reach the base. Rename the test to say so.

## Rules (quoted)
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."
- NOMENCLATURE R3: qualify (_card version_, _cast version_, never a bare _version_ in prose); new names 🚧, grep first; propose §25 rows in your report.
- Tests: targeted only, `npx vitest run --maxWorkers=4 <files>`; **never pipe vitest into `head`**; DB-in-`it` tests need a 60 s timeout; list `/tmp/serene-pub-vitest-*` before and after; delete only dirs your runs left, by name.
- Prettier: only your hunks in old files. `npx tsc --noEmit -p .` must show no error in your files or in any file your type change reaches (client included).

## Stop and ask (in your report; carry on) when
a ★ is unruled, a word is user-visible and new, or a fix needs a file you don't own.

## Done means
`npx tsc --noEmit -p .` clean except known unrelated errors (`arrangeCanvas.dom`, `askers.test.ts`, `arrangeOps.test.ts`); green: `sockets/characters*.test.ts` (`characters.versions.int`, `characterAvatarAndUpdate.int`, `characters.timbre.int`, `characters.importWords.int`), `sockets/import*`, `plugins/providedBooks*`, `providedPrimers.int`.

## Report (your final message)
Changed files; tests with counts; proposed §25 rows; client files a type change reaches; open ★; Noticed, not done.
