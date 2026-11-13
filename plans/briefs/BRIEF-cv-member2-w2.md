# BRIEF cv-member2-w2 — client: the member page reads versions (B2), the member page's Update offer (B1), member group-only greetings (B5)

Worker (Sonnet) for lane-supervisor cv-member2. App `/home/jody/github/serene-pub`. Use absolute paths. Hand back your report as your final message (no report file). A server worker is changing the server side at the same time; you build against the **wire contract**, which is already written.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

## The contract (read first: `src/lib/shared/sockets/types.ts`)
- `Sockets.Lorebooks.CastMemberRow` = the binding row + `CastRowVersion`: the row's frozen columns, `characterId` and `character` are **the cast version in force at the book's present on main** — owner 2026-11-06: the member page shows and saves **"The most recently active"** version. Plus `castVersionId` (that version), `groupOnlyGreetings`, `baseColumns: CastVersionColumns | null` (the member's base version — what it reads before its first change), `cardVersion`, `cardCurrentVersion` (`{id, number, label}`), `behindCard`.
- `BindingList.Response.present`: the book's present on main (`{year, month, day}` or null).
- `Amendments.CastRow.columns: CastVersionColumns` — the whole version in column names with its parent's card (`characterId`); `fields` stays "what changed from the version before" for the Changes list's words (★CV-20 — unchanged).
- `Amendments.List.Response.laterVersions?` — now delivered on the `amendments:list` broadcast that answers your own cast create/update, so `fileCastAmendment`'s reply carries it (no change needed beyond checking).
- `lorebooks:updateMemberToCardVersion { castId }` → `{ lorebookId, castId, moved, cardVersion, lorebookBinding }`, scoped on `lorebookId`; `:error` on refusal (registered in `typedSocket.ts` and `interest.ts` already).
- `UpdateBinding.Params.lorebookBinding.groupOnlyGreetings?: string[]`.

## Files owned (edit only these)
- `src/lib/client/lorebooks/LorebooksWorkspace.svelte` — only the cast-reading hunks (`resolveCast`, `inhabitants`, `livesMembers`, `castAsOfCounts` if it folds, the `lorebooks:bindingList` handler keeping `present`) and passing what CastWorkspace needs.
- `src/lib/client/lorebooks/CastWorkspace.svelte`
- `src/lib/client/lorebooks/castPool.ts` (the `CastRow` type)
- `src/lib/client/lorebooks/cast/castSave.ts`, `cast/CastMemberForm.svelte`, `cast/retoldRows.ts`, `cast/memberDraft.ts`
- New: `src/lib/client/lorebooks/cast/castVersionRead.ts` (+ `.test.ts`), `src/lib/client/lorebooks/cast/CardUpdateOffer.svelte` and `src/lib/client/lorebooks/cast/cardUpdateWords.ts` (+ tests) — a later worker reuses both in `CastLine.svelte`, so keep their props generic (`castId`, `lorebookId`, `memberName`, `cardVersion`, `cardCurrentVersion`).
- Test files under `src/lib/client/lorebooks/cast/` and `src/lib/client/lorebooks/castPool.test.ts` (fixtures need `columns` / the new row fields; `castSave.test.ts` fails `tsc` today for that reason).

## Files readable
`src/lib/shared/lorebooks/amendments.ts` (`castAsOf`, `applyAmendments`, `amendmentsAsOf`, `amendmentsForAppearance`, `NEVER_AMENDED`), `src/lib/client/components/characterForms/cardVersionWords.ts` (`versionLabelText` — use it for every version label), `src/lib/client/components/characterForms/cardDraft.ts` (`greetingsOfColumns`, `greetingColumnsOf` — reuse for the member list), `CharacterForm.svelte` (the card's greetings list with **Group sessions only** — match its look and words), `src/lib/client/utils/awaitReply.ts`, `plans/REPORT-cv-client-2026-11-06.md` (what cv-client built here and why).

## What to build
### 1. B2 — read versions, drop the diff fold
Today `resolveCast` folds the Changes rows' **diffs** (`fields`) onto the row with `castAsOf` — the stopgap. Replace it with one pure helper in `castVersionRead.ts`, used by `resolveCast`, `inhabitants` (per appearance, with `amendmentsForAppearance`), `livesMembers`, and CastWorkspace wherever it folds (`baseSaveWarning`):
- Start from `{ ...row, ...row.baseColumns }` (when `baseColumns` is null, the row as it is).
- Overlays = the member's Changes rows with `fields` replaced by `columns`; fold with `castAsOf` at `{ moment, line }`, where the moment is the one being read, else — on **main** only — `present` (no present → null, main's head). On a branch at "now", null as today.
- A carded version's `name: null` never overwrites the row's `name` (the row's name, aliases come from the server as today; only a card-less version's own `name` applies).
- When the moment is null on main and nothing else differs, the result must equal the row the server sent (it is the same pick); write that as a unit test.
- `resolvedCast`'s re-join of `character` when `characterId` moved stays.
- The moment shown in the UI stays null at "now" ("At now there is no choice to offer"); only the fold uses `present`.

### 2. ★CV-13 count after the shown version
`laterVersionCount`'s base save now counts the main rows **after the shown version** (`row.castVersionId`): when it is the base (no Changes row has that id), every main row (today); otherwise main rows dated later than it, or on the same date with a higher id. The **Save as of** count is unchanged. Update `castSave.test.ts` and `castMemberFormLater.dom.test.ts` accordingly.

### 3. B1 — the member page's Update offer
`CardUpdateOffer.svelte`, shown on the member page next to where the page names the member's card, only when the row has `behindCard` and a `cardCurrentVersion`, and the viewer can edit the book (the page's existing edit gate):
- A muted line, then a **tonal** button (not filled — one primary per surface, STYLE-GUIDE §6.1):
  _On card v1.0; the card is on v1.1._ **Update Bianca to card v1.1** — labels through `versionLabelText(label, number)`; the name is the member's shown name. These words are provisional (★, from cv-client's proposal); keep them in `cardUpdateWords.ts`.
- Press → `awaitReply({ event: "lorebooks:updateMemberToCardVersion", params: { castId }, replyKey: interestKey("lorebooks:updateMemberToCardVersion", lorebookId), errorEvent: "lorebooks:updateMemberToCardVersion:error", match: (d) => d.castId === castId, … })`. Disabled while waiting. On success say nothing: the re-sent cast list makes the offer disappear. On failure show the server's sentence inline under the button (no toast — see Rules).

### 4. B5 — group-only greetings on the member
- The member's draft carries `groupOnlyGreetings`; the member **Greetings** row (one list, cv-client) shows, while retold, each greeting with **Group sessions only** (as the card form does) and keeps the marked ones in the list. Reuse `cardDraft.ts`' `greetingsOfColumns` / `greetingColumnsOf` to go between the three columns and one `{text, groupOnly?}` list. As on the card, marked greetings come back after the unmarked ones on reload (the wire is three columns).
- `memberPatch` sends `groupOnlyGreetings` when it changed; the dirty check sees it; **Save as of** sends it in `fields` too.
- Following the card: unchanged (shows the card's greetings, read-only).

## Rules (quoted by the supervisor; your work depends on them)
- CLAUDE.md standing ruling: "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."
- "Sockets: one domain context per event family (provided by both shells) is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`." The lorebooks family has no domain context, so the new offer **does not toast**: it reports failure inline. Don't add toasts; don't remove existing ones.
- "`socket.off(event)` with no handler removes every listener app-wide; always pass the handler." "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."
- STYLE-GUIDE §6.1: "One primary button per surface … Secondary actions are tonal." §9: every interactive element is a real `button` with an accessible name; "Never an interactive inside an interactive"; nothing hover-only; targets 44px on touch. §10: sentence case; "A button says what happens"; "Help is one sentence."
- Every session has a lorebook — never write "no book". It is a **session**, never a *chat*.
- Nomenclature R1/R3: use only the contract's names and the new files above; any other new user-facing word, setting or event → stop and report. The words in §3 are provisional ★ — say so in your report.
- Decide implementation inside this scope and name each choice; anything beyond → stop and report.

## Tests (Done means)
- `castVersionRead.test.ts`: before the first change reads the base; at a moment after a change reads that version whole; on main at "now" reads at `present` (a change dated after the present does not apply) and equals the row; a branch line; a carded version's null name keeps the row's name; per appearance with a life-point change.
- A DOM test (new file, e.g. `cast/memberPageVersions.dom.test.ts`, mounting the member page the way `memberPage.dom.test.ts` does) — **a link and an unlink at a present show correctly on the page**: (a) after a link at the present the row is carded (`characterId`, retold flags as the carrier follows) with `baseColumns` card-less holding own words and an earlier Changes row card-less → at "now" the form reads the card's fields under **From the card**; at the earlier moment it reads the member's own words; (b) after an unlink the row is card-less holding the card's words, earlier rows carded.
- `CardUpdateOffer` DOM test: shown only when behind; the words; press emits the event with `castId`; a reply re-enables; an `:error` shows its sentence inline; no toaster call.
- A DOM test that marking a greeting **Group sessions only** sends `groupOnlyGreetings` on Save.
- Run, `--maxWorkers=2`, never piped into `head`:
  `npx vitest run src/lib/client/lorebooks/cast src/lib/client/lorebooks/castPool.test.ts src/lib/client/lorebooks/time src/lib/client/lorebooks/lineConformance.test.ts src/lib/client/lorebooks/lineConformance.screens.dom.test.ts src/lib/client/lorebooks/lorebooksWorkspace.counts.dom.test.ts src/lib/client/components/characterForms --maxWorkers=2`
  and `npx tsc --noEmit -p .` — no errors in your files (server-side errors from the other worker may show; list them, don't fix them). List `/tmp/serene-pub-vitest-*` before and after; delete only your own, by name.

## Report (final message)
Names and signatures first; changed files; tests with counts; the provisional words (★); choices you made; anything you stopped on; Noticed, not done.
