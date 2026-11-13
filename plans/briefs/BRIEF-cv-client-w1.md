# BRIEF cv-client-w1 — the card editor and the card import dialog for card versions (2026-11-06)

Worker (Sonnet) under lane-supervisor cv-client. App `/home/jody/github/serene-pub`. Report back as your final message (the harness may refuse a report file), starting `# REPORT cv-client-w1`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

## Goal
A card now has **card versions** (one row each: `number`, unique per card, the highest is the **current** one; and a **version label**, e.g. `1.0`). The server already speaks it; the editor doesn't yet. Build, in the card editor (`CharacterForm.svelte`) and the card import conflict dialog:

1. **Version picker** (owner ruling: "any card version editable via a picker", shown like _v1.0 · v1.1 current_).
   - `characters:get` answers `cardVersionId` (the one shown), `currentCardVersionId`, `cardVersions: {id, number, label}[]` (by number ascending). It takes `cardVersionId?` to show another version; `character` is then the card AS that version (content columns + `characterVersion` = that version's label).
   - Show the picker in edit mode only, only when the card has more than one version, near the existing **Version** field on the Profile tab (find `bind:value={editCharacterData.characterVersion}` ~line 1625) — or in the hero if that reads better; say which.
   - Option text (decided by the supervisor, flagged ★ for the owner): the label shown as `v<label>` when it starts with a digit, the label as is otherwise, `Version <number>` when the label is null; the current one gets ` · current`. Use a plain `<select class="select">` (or the form's existing select chrome), with an accessible name "Card version".
   - Picking another version: if the form has unsaved changes, ask through the form's existing unsaved-changes modal first (STYLE-GUIDE §6.14 "Ask first, then discard — never the other way round"); then re-send `characters:get { id, cardVersionId }`. The current get is a one-shot `declareInterest` released on first reply (~line 1006–1022) — re-declare it for the re-send. The loaded draft must be clean after the load (`originalCharacterData` snapshot, as `handleCharactersGet` already does).
   - When the shown version is not the current one, one muted line under the picker (★ wording): _Saving changes v1.0 in place; v1.1 is the current version._
2. **Save writes the chosen version.** `characters:update` takes `cardVersionId?` — send the shown one. The **Version** field (`characterVersion`) is that version's label: an in-place save with a changed non-empty label **renames** that version (server ignores empty). Relabel the field **Version label** if it now says just "Version" (check `docs/characters.md` line 84 says **Version**; report the change so the supervisor fixes the doc).
3. **Save as new version.** A second footer button, **Save as new version** (tonal, never a second filled primary — STYLE-GUIDE: "One filled primary per region"), edit mode only. It opens a small portaled dialog (Skeleton `Dialog` + `Portal`, as the form already uses) titled **Save as new version** with one input **Version label**, prefilled with `nextVersionLabel(<label of the highest-number version>)` from `$lib/shared/characters/profile` (empty when it returns null), and buttons **Cancel** · **Save as new version** (filled primary inside the dialog). It sends `characters:update` with `cardVersionId` (the shown one: a new version may be made from an older one) and `saveAsNewVersion: { label }` (label trimmed; empty → `null`).
4. **_N cast members stay on v1.0_** (owner ruling; "each a link"). The update reply carries `staying?: {castMemberId, lorebookId, name, cardVersionId, label}[]` on a new version only, plus `cardVersionId` (the one written), `currentCardVersionId`, `cardVersions`.
   - When `staying` is non-empty, **the form stays open** (today every successful update closes it, `handleCharactersUpdate` → `closeForm()`), now showing the new version (adopt the reply's version list and ids, re-get the card at the new version so the draft is the saved one and clean), and shows one muted line under the cast line in the hero: _3 cast members stay on v1.0: Bianca, Theo, Ada._ — grouped by label when they differ (_2 cast members stay on v1.0: …; 1 stays on v1.1: …_), singular _1 cast member stays on v1.0: Bianca._ Each name is a button that calls `openCastMember(panelsCtx, { lorebookId, castId: castMemberId })` (`./openCastMember.ts`), plain text outside the shell — exactly as `CastLine.svelte` does. Label display as in the picker. Pure words in a small tested function (e.g. in a new `characterForms/cardVersionWords.ts`, which also holds the option-text function).
   - When `staying` is empty or absent, close as today.
   - Note `characters:update` is `emitToUser`: another tab's save reaches this form. The existing guard `res.character?.id !== characterId` stays; additionally only the save THIS form sent may keep it open / move its version (use the existing `isSaving` flag). Also `setavatar`'s `characters:update` emit carries only `{character}` — treat the version fields as optional.
5. **Greetings: one list with a group-only mark** (owner: "merge together any fields where there's an arbitrary duplicate like greeting and additional greetings"; the brief: "the one greetings list with a **group sessions only** mark").
   - Today the Voice tab has **First message**, **Alternate greetings** and **Group-only greetings** (~lines 1740–1830). Replace them with ONE list **Greetings**: each greeting a textarea, a checkbox **Group sessions only**, and a remove icon button (aria-label "Remove greeting N"); a button **Add a greeting** at the foot.
   - The wire still speaks the three columns. Load with `mergeGreetings(firstMessage, alternateGreetings, groupOnlyGreetings)` and save with `legacyGreetingsOf(greetings)` (both from `$lib/shared/characters/profile`): the first unmarked greeting is the opener, other unmarked ones the alternates (empty ones kept: today's swipes), marked ones group-only. So marked greetings come back after the unmarked ones on the next load — acceptable; say so in your report.
   - One help line under the label (★ wording, one sentence — STYLE-GUIDE §10 "Help is one sentence"): _A new session opens with the first greeting and offers the others as swipes; a group session uses the ones marked for it, when there are any._
   - `showAllCharacterFields` off (simplified form): today only **First message** shows. Keep that: show only the first greeting's textarea (no mark, no add) when simplified; the full list when "show all" is on. Check how the form gates fields today and follow it.
   - Keep the draft as a `greetings: {text, groupOnly?}[]` (or keep the three columns in `EditCharacterData` and convert in the view — your call; say which) — but the dirty check must stay derived from saved-vs-draft (STYLE-GUIDE §6.14: "Unsaved means different from what is saved, not 'touched'"; changing and changing back is clean). Update `TAB_FIELDS`, the zod schema, `savedCharacter()`/`characterForSave` (`./strokes`) and any other place that names the three fields, so validation errors still mark the Voice tab.
6. **Creator notes by language** (shape `{text, lang?, variants}`: "notes keep the main note's language").
   - Notes tab today: **Creator notes** textarea + a multilingual map editor (~lines 1920–2000). New: the **Creator notes** textarea plus a small **Language** input beside/under it (placeholder `en`, optional, aria "Language of these notes"); then **Other languages**: each row a language input + textarea + remove; **Add a language**.
   - Wire: columns `creatorNotes` (main text) and `creatorNotesMultilingual` (every language's text, the main one under its `lang`). Load with `creatorNotesOf(creatorNotes, creatorNotesMultilingual)` from `$lib/shared/characters/profile` (gives `{text, lang?, variants}`; variants exclude the main text). Save: `creatorNotes = text || null`-ish as the form did, `creatorNotesMultilingual = { ...(lang ? {[lang]: text} : {}), ...variants }` (empty → `{}`/null as the form did). Put this inverse in a small pure client helper with a test (the server's twin is `cardNotesColumns` in `src/lib/server/characters/cardIO.ts` — read it, don't import it). Language codes trimmed and lower-cased; an empty code row is dropped on save; a duplicate code is a validation error shown on the field.
   - Gate the language field and other languages behind "show all" as the multilingual editor is today.
7. **Import conflict dialog for cards** (owner ruling: identical → nothing; different → **Add as a new version** or **Save as a new card**; "Overwrite in place goes").
   - `CharactersSidebar.svelte` shows `ImportConflictModal.svelte` for both lorebooks and characters (`handleOverwriteCharacterImportConflict` ~line 881 sends `action: "overwrite"`). The lorebook flow keeps its Overwrite: do not change `ImportConflictModal` behaviour for lorebooks (also used by `LorebookActions.svelte`).
   - Make a new `src/lib/client/components/modals/CardImportConflictModal.svelte` for cards. The conflict now carries `currentVersion: {id, number, label}` and `suggestedLabel: string|null`. Title **Character already exists**. Body (★ wording): _You already have "‹name›", from this file or an earlier copy of it, and the file differs from its current version, v1.1._ Then one input **Version label** prefilled with `suggestedLabel`. Buttons: **Cancel** · **Save as a new card** (tonal) · **Add as a new version** (filled primary).
   - **Add as a new version** sends `characters:importResolve { action: "addVersion", label, heldImportId, existingId }` (label trimmed, empty → omit so the server suggests). **Save as a new card** sends `action: "createNew"`. Never send `"overwrite"` from the client again.
   - The reply/toast path stays in `contexts/characterImports.svelte.ts` (the one listener; views never toast — CLAUDE.md Standing rulings: "one domain context per event family … is the only listener, and the only place that toasts"). Update only its stale comment ("keeping both, or overwriting") if you touch it.

## Files owned (edit only these)
- `src/lib/client/components/characterForms/CharacterForm.svelte`
- `src/lib/client/components/characterForms/strokes.ts` (only if `characterForSave` must change)
- new `src/lib/client/components/characterForms/cardVersionWords.ts` (+ `.test.ts`) and a notes/greetings helper module of your naming in the same folder (+ test)
- new `src/lib/client/components/modals/CardImportConflictModal.svelte`
- `src/lib/client/components/sidebars/CharactersSidebar.svelte` (the character conflict hunk only)
- `src/lib/client/contexts/characterImports.svelte.ts` (comment only, if at all)
- new DOM tests next to them (`*.dom.test.svelte.ts`, following `castEditNote.dom.test.svelte.ts`'s mocks)
- existing tests that break because of these changes (fix their expectations only where behaviour moved on purpose; say which)

## Files readable
`src/lib/shared/characters/profile.ts`, `src/lib/shared/sockets/types.ts` (`Sockets.Characters.*`), `src/lib/server/sockets/characters.ts` (~840–1110 update handler; importResolve), `src/lib/server/characters/cardIO.ts`, `CastLine.svelte`, `openCastMember.ts`, `STYLE-GUIDE.md` §6.1, §6.6, §6.14, §10, `docs/characters.md`.

## Out of scope (do not build)
- Any server, shared (`src/lib/shared/**`) or SDK file. Any `docs/*.md` (the supervisor writes the docs). `NOMENCLATURE.md`.
- An **Update ‹member› to card v2** offer, any per-member version info on the cast line, the member page, the admin list.
- No new setting, flag, event or socket field. Don't fix things you notice in passing — list them under Noticed.

## Rules (quoted for you)
- CLAUDE.md: "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`." · "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`." · "`socket.off(event)` with no handler removes every listener app-wide; always pass the handler." · "It is a session, never a chat."
- STYLE-GUIDE §10: "Sentence case everywhere." "A button says what happens." "Help is one sentence." §6.6: dialogs and popovers are portaled. §11: "Every control has a name, a focus ring and a 44px target on touch." "One filled primary per region."
- NOMENCLATURE R3: qualify, never the bare noun — say **card version** / **version label**, never a bare "version" in a name or identifier you add (UI copy "version" is fine where the card is evident).
- If something needs a new user-visible word beyond the ★ texts above, a new name, setting or socket field: stop and put it in your report as a ★ question instead of deciding.

## Done means
- `npx vitest run <your new and touched test files> src/lib/client/components/characterForms src/lib/client/contexts/characterImports.dom.test.svelte.ts --maxWorkers=2` green. Never pipe vitest into `head`.
- `npx tsc --noEmit -p . 2>&1 | grep -E "characterForms|CardImportConflict|CharactersSidebar|characterImports"` empty.
- `npx prettier --check` clean on new files; touched files: only your hunks formatted.
- Report: names and signatures first, changed files, tests run with results, ★ questions, Noticed-not-done, the doc sentences that moved (for the supervisor).
