# BRIEF cv-client-w2 — the member page for cast versions (2026-11-06)

Worker (Sonnet) under lane-supervisor cv-client. App `/home/jody/github/serene-pub`. Report back as your final message (the harness may refuse a report file), starting `# REPORT cv-client-w2`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

## Background
A cast member's words are now **cast versions** (`character_versions` rows): one undated **base** plus dated versions. The member page (Lorebooks › Cast › a member: `CastWorkspace.svelte` + `cast/CastMemberForm.svelte`) still speaks the member row's column names (the server converts); its dated changes list (`time/AmendmentList.svelte` with `subject="cast"`, fed by `amendments:list`'s `cast` rows) now lists cast versions: each row's `fields` is **what differs from the version before it**, in the member form's column names (`name`, `aliases`, `summary`, `description`, `personality`, `scenario`, `firstMessage`, `alternateGreetings`, `exampleDialogues`, `faceMediaId`, `retold`, `ownName`, `ownNickname`, `timbre`, `spriteSet`, `nodeState`, `nodeVisibility`, `characterId`). ★CV-20 (lead, built): the list keeps its words.

## Goal
1. **Change later versions too** (owner ruling ★CV-13: saving an older version says _"2 later versions keep their own words"_, with **Change later versions too**, which writes the same edited fields onto those later versions on the shown line).
   - The server already takes `changeLaterVersions?: boolean` on `lorebooks:updateBinding` (the base save, `writeBase` in `CastWorkspace.svelte` ~line 815) and on `amendments:create` (**Save as of ‹date›**, `fileCastAmendment` in `cast/castSave.ts`), and answers `laterVersions?: { changed: number; kept: number }`. Read `src/lib/server/sockets/lorebooks.ts` ~2205–2310 and `src/lib/server/sockets/amendments.ts` ~1196–1240 and ~1531–1660 for exactly which versions count, and **which reply event carries `laterVersions`** (`fileCastAmendment` waits on the `amendments:list` broadcast today, which may not carry it — if so, also claim the `amendments:create` reply; say what you did). A version a session wrote always keeps its words; the server counts those in `kept`.
   - Before a save, the client counts the later versions from the member's Changes rows it already has (`castAmendmentsFor(castId)`; rows carry `branchId`, `year`/`month`/`day`):
     - a **base** save (Save, or "change them outright"): every row on main (`branchId == null`);
     - a **Save as of ‹date›**: rows on the line being read (`branchId` = the line's id, null = main) dated after the form's moment (`memberMoment`; use `compareDates` from `../sections/historyDates`).
     Put the counting in a pure, tested function (e.g. in `cast/castSave.ts`).
   - When the count for the save about to happen is > 0 and the form is dirty, the form's footer shows one muted line beside the save controls: _2 later versions keep their own words._ (singular _1 later version keeps its own words._) and a toggle button **Change later versions too** (`aria-pressed`, the pressed treatment `preset-pressed` per STYLE-GUIDE §2.4 — "Pressed is not gold"). Pressed, the save sends `changeLaterVersions: true`. The toggle resets after every save and when the member changes. If the two save modes have different counts, the line shows the count for the primary button (Save as of ‹date› while a moment is read, else Save); say how you handled the menu's "change them outright". (Layout is the supervisor's call, flagged ★ for the owner; build it as described.)
   - After the reply, the success toast (the workspace already toasts its own saves — keep it as is, don't add a second) gets one more sentence from `laterVersions` (★ wording): `changed > 0` → _2 later versions changed too._; `kept > 0` → _1 later version keeps its own words._ (both when both). Pure words function, tested.
   - Wire this through `CastMemberForm`'s `onSave` / `onAmend` (e.g. a third argument `{ changeLaterVersions }`) and a prop carrying the counts. No new socket field — they exist in `src/lib/shared/sockets/types.ts` already.
2. **The Changes list words for cast versions** (`time/AmendmentList.svelte`, `subject="cast"` only; the entry list stays word for word):
   - `FIELD_LABELS` lacks the version columns. Add reader words for `description`, `personality`, `scenario`, `firstMessage` and `alternateGreetings` (both say "greetings" — dedupe in `saysWhat`), `exampleDialogues` ("example dialogues"), `faceMediaId` ("face"), `retold` ("what is told in their own words"), `ownName` ("name in this book"), `ownNickname` ("nickname in this book"), `timbre` ("voice"), `name` ("name"). Keep existing labels.
   - The delete confirmation says _"The entry reads as it did without it"_ for a member too. For `subject="cast"` say (★ wording): _Delete the change dated ‹date›? They read as they did without it, from then on._ … keep the `where` clause as it is. Leave the heading **Amendments** and everything else as is.
3. **Greetings are one field now** (owner: "merge together any fields where there's an arbitrary duplicate like greeting and additional greetings"; the server treats a member's opener and alternates as ONE profile field `greetings`, followed or own as a whole — see `memberProfileOf` in `src/lib/server/characters/versions.ts` ~220–250: retelling only one half silently gives the member an own list of both).
   - In the member form's **From the card** block (`cast/retoldRows.ts`, `cast/CastMemberForm.svelte` ~345–380 and ~970–1020, `cast/memberDraft.ts`), replace the two rows **First message** and **Alternate greetings** with ONE row **Greetings**: one list (each greeting a textarea + remove; **Add a greeting**), one retell toggle that sets BOTH `retold.firstMessage` and `retold.alternateGreetings` together. On the wire nothing changes: the list's first item is `firstMessage`, the rest `alternateGreetings`.
   - Empty greetings are kept (they are swipes, §33.1). Today `memberPatch` drops blank alternates with `.filter((g) => g.trim())`; keep every greeting as typed instead, and make sure the dirty check still treats an untouched form as clean.
   - A member whose stored flags differ (one half retold) shows the row as retold (it reads its own list); turning the toggle off follows the card's greetings, turning it on keeps the own list. The card value shown when following is the card's opener + alternates.
   - **No group-only mark on members**: the member wire has no group-only greetings yet (queued to the lead). Don't invent one.
   - `components/sessionForms/SeatMemberSheet.svelte` also uses `retoldRows` — keep it compiling and behaving; report any visible change there.

## Files owned (edit only these)
- `src/lib/client/lorebooks/CastWorkspace.svelte` (the save hunks: `writeBase`, `writeAmendment`, `saveMember`, `amendMember`, the `CastMemberForm` props)
- `src/lib/client/lorebooks/cast/CastMemberForm.svelte`, `cast/castSave.ts`, `cast/retoldRows.ts`, `cast/memberDraft.ts`
- `src/lib/client/lorebooks/time/AmendmentList.svelte`
- `src/lib/client/components/sessionForms/SeatMemberSheet.svelte` (only if `retoldRows` changes force it)
- their tests: `cast/castSave.test.ts`, `cast/retoldRows.test.ts`, `cast/memberDraft.test.ts`, `cast/castMemberForm.dom.test.ts`, `cast/retoldBlock.dom.test.ts`, `cast/memberPage.dom.test.ts`, `lorebooks/lineConformance.test.ts` if it breaks, and new DOM tests (`*.dom.test.ts` next to them, following `castMemberForm.dom.test.ts`)

## Files readable
`src/lib/shared/sockets/types.ts` (`Sockets.Amendments.*`, `Sockets.Lorebooks.UpdateBinding`), `src/lib/shared/lorebooks/retold.ts`, `src/lib/server/lorebooks/retold.ts` (`memberColumnsOfVersion`, `castChangesOfMemberEdit`), `src/lib/server/characters/versions.ts` (`memberProfileOf`), `src/lib/server/sockets/{lorebooks,amendments}.ts` (the ranges above), `docs/lorebook-cast.md`, `docs/lorebook-time.md`, `STYLE-GUIDE.md` §2.4, §6.1, §6.14, §6.21, §10.

## Out of scope (do not build)
- Any server, shared (`src/lib/shared/**`) or SDK file; any `docs/*.md` (the supervisor writes the docs); `NOMENCLATURE.md`.
- An **Update ‹member› to card v2** offer; per-member card version display; the admin lift list; the card editor (`components/characterForms/**`, another worker's).
- No new setting, flag, event or socket field. Don't fix things you notice in passing — list them under Noticed.

## Rules (quoted for you)
- CLAUDE.md: "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`." · "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`." · "`socket.off(event)` with no handler removes every listener app-wide; always pass the handler." · "Sockets: one domain context per event family … is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`." (The workspace's existing save toasts predate this; don't add new toast sites beyond extending the existing success toast's description.) · "Every session has a lorebook — never write 'no book'."
- STYLE-GUIDE §6.14: "Unsaved means different from what is saved, not 'touched'" — the dirty check stays derived; a toggle that only changes how a save is sent is not itself an unsaved change. §10: sentence case; a button says what happens; help is one sentence. §11: every control has a name, a focus ring and a 44px target on touch.
- NOMENCLATURE R3: never a bare "version" in an identifier you add — `laterVersions`, `castVersion…` are fine.
- If something needs a new user-visible word beyond the ★ texts above, a new name, setting or socket field: stop and put it in your report as a ★ question instead of deciding.

## Done means
- `npx vitest run src/lib/client/lorebooks/cast src/lib/client/lorebooks/time src/lib/client/lorebooks/lineConformance.test.ts src/lib/client/components/sessionForms <your new test files> --maxWorkers=2` green. Never pipe vitest into `head`.
- `npx tsc --noEmit -p . 2>&1 | grep -E "lorebooks/(CastWorkspace|cast/|time/AmendmentList)|SeatMemberSheet"` empty.
- `npx prettier --check` clean on new files; touched files: only your hunks formatted.
- Report: names and signatures first, changed files, tests run with results, ★ questions, Noticed-not-done, and the doc sentences that moved (for the supervisor).
