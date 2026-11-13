# BRIEF — bench-L4-w2: benched seats, the Participants tab (client)

Supervisor: bench-L4. Repo: `/home/jody/github/serene-pub`. The owner ruled the design on 2026-11-10 (`plans/PROPOSAL-benched-seats-2026-11-10.md`). Read only its "Revised design → UI" bullets, "Owner rulings, second round" and "Challenge answers". The data and server sides are built: a seat is **in play** when it's live and not benched (`inPlay(row)` in `src/lib/shared/sessions/inPlay.ts`, which reads `removedAt` / `isActive`). Both seat tables (`session_characters`, `session_personas`) now carry `isActive`. A removed row (`removedAt` set) means "not in the cast, never shown".

## Owner rulings this applies (2026-11-10, verbatim where quoted)

- **Fold Removed into Benched.** One **Benched** section replaces "The fallen" and "Removed".
- "Dragging them back into the seat brings them back and treats them normally, up to the user to manage their status."
- A soft **Remove** stays, but only for an unused benched seat (one with no lines).
- Core never benches automatically, and there's **no "Deceased… Bench them?" nudge**. Don't build any prompt that suggests benching.

## Goal (`src/lib/client/components/sessionForms/EditSessionForm.svelte`, the Participants tab ~2036-2700, plus the script it calls)

### 1. Model

- Today the seated lists hold every live row, including benched ones (`handleSessionsGet` ~1316): `selectedCharacters` (carded character seats, by card id), `selectedMembers` (card-less character seats, by cast member id), `selectedPersonas` (carded player seats, by persona card id) and `playerSeats` (card-less player seats, by seat id). The per-row switch drafts are `activeDraft` and `memberActiveDraft`.
- New model: each of the four lists holds **seats in play in the draft**. Four new lists hold the **benched in the draft**: `benchedCharacters`, `benchedMembers`, `benchedPersonas`, `benchedPlayerSeats`. Same row shapes.
  - Load splits each list by `inPlay(row)`. Removed rows go in neither.
  - Delete the switch machinery (`activeDraft`, `memberActiveDraft`, `savedActive`, `shownActive`, `savedMemberActive`, `shownMemberActive`, `activeChanges`, `memberActiveChanges`, `toggleCharacterActive`) and the `Switch` import if nothing else uses it. **The Envoys switch stays** (`envoyDraft`, `setEnvoySeat`); it seats and unseats a declaration.
  - Delete `removedCharacters`, `removedPersonas` and `fallenSeats` with their sections. `fellInStory` is reworked (§4).
- **`data` stays the full set.** In the `data` effect (~729) and in `handleSave` (~1093):
  - `characterIds` = seated then benched card ids, and `characterPositions` follows that same order.
  - `castMemberIds` = seated then benched members.
  - `personaIds` = seated then benched personas.
  - `playerSeats` = seated then benched card-less player seats.
  - **Why:** the server's `sessions:update` unseats anything omitted, so a benched seat must stay in these lists. Only a real Remove (§5) leaves them out.
  - The handlers that rebuild `data` after an add or remove (`handleAddCharacter`, `handleRemoveCharacter`, `handleAddPersona`, `handleRemovePersona`) must keep the benched rows too.
- **Bench changes:** a derived list of the seats whose draft side differs from their saved side.
  - A row in a seated list whose saved row is benched → `enabled: true`.
  - A row in a benched list whose saved row is in play → `enabled: false`.
  - Each change names its seat:
    - a carded character by `characterId`;
    - a card-less character seat by `castMemberId`;
    - a carded persona by `playerSeatId`, the live `session.sessionPersonas` row's `id` for that `personaId`;
    - a card-less player seat by `playerSeatId`, its id.
- The dirty check (`participantSwitchesDirty`, read by `isDirty`) counts bench changes in place of the old switch changes. You may rename it.
- **Save:** `commitParticipantChanges` sends one `sessions:setCastSeatEnabled` per bench change, `{ sessionId, characterId | castMemberId | playerSeatId, enabled }`. Each is counted in `participantWritesInFlight`, and they go **before** `sessions:update`, which is already the order. The params type already has `playerSeatId?: number` (`src/lib/shared/sockets/types.ts`, `Sockets.Sessions.SetCastSeatEnabled.Params`). The server half is another worker's.

### 2. Seated rows

- A **saved** seated row (its seat exists in `session`):
  - the switch goes (cards ~2149-2187, card-less members ~2235-2276);
  - the red X Remove button goes;
  - it gets a **Bench** icon button: `aria-label="Bench ‹name›"`, `title="Bench"`, lucide `Armchair` at 16px, in the ghost icon-button style the row's ↑/↓ use. It sits beside the existing controls.
  - A card-less player seat shows Bench only where it shows its rename today (`mine`).
- An **unsaved** seated row ("Ready to add", added in this draft) keeps its "Ready to add" and its X, which drops the pending add as today. It gets no Bench, because a seat that doesn't exist yet can't be benched before Save.
- The header copy (~2045) becomes exactly: *"Changes here wait for Save — adding, benching, bringing back and reordering. Reassigning a benched seat's lines happens at once."*

### 3. The Benched section

- It replaces "The fallen" (~2553) and "Removed" (~2582), in the same place: after Personas, before Guests. Show it when `session` is loaded and at least one seat is saved.
- Heading **Benched**. Intro, the same muted 12px line the Envoys card uses: *"In the session, out of the turns. Their lines stay theirs."*
- Two lists:
  - **Characters**, only where `showCharactersSection`;
  - **Players**, only where `showPersonasSection`.
  - Each has a small label as its heading (12px, muted). Each list has `aria-label` "Benched characters" / "Benched players".
- **Drag pairing** (svelte-dnd-action, `type` option):
  - The seated Characters `dndzone` (~2062) and the Benched Characters `dndzone` both get `type: "character-seat"`, over carded rows only.
  - The seated Personas `dndzone` (~2401) and the Benched Players `dndzone` both get `type: "player-seat"`, over carded persona rows only.
  - Drop `dropFromOthersDisabled: true` on the seated zones so the pairs can trade. Zones of different types never trade; that's the library's own `type` rule.
  - Reordering inside a zone stays as today.
  - Grips and dragging are on whenever a row has somewhere to go, not only at length > 1.
  - Card-less members and card-less player seats aren't in any dndzone today. They stay button-only: below their zone, in a plain list, like the seated lists draw them.
  - An **unsaved** row dropped on the bench goes back to the end of its seated list on finalize, silently.
  - An empty benched zone must still take a drop. Give it a min height of one row (`min-h-11`) and a dashed `border-surface-200-800` edge, but **only while a drag is in progress** (STYLE-GUIDE §6.7: "A drop target shows its hint only while … over it … never a permanent footer"). With no drag and no rows, the list draws nothing, but the section's intro stays.
- **A benched row** uses the seated row's anatomy: the face (`Avatar`, or the `UserRound` icon for a card-less player seat), the name, one muted meta line, then the actions.
  - **Bring back:** a `btn btn-sm preset-tonal` reading **Bring back**, with `aria-label="Bring back ‹name›"`. It moves the row to the **end** of its seated list.
  - A ⋯ `RowMenu` (`src/lib/client/components/menus/RowMenu.svelte`; `triggerLabel` *"More actions for ‹name›"*), only when it has an item:
    - **Reassign…** (icon as today's button has none: use `ArrowRightLeft`). Only on **carded** rows (character or persona) that are **benched on the server** (saved benched, not just benched in this draft) and **not fallen**. It calls the existing `openReassignModal(type, cardId, name)`, and it still happens at once.
    - **Remove**, `destructive: true`, after a separator. Only on rows **benched on the server** whose saved row says it has no lines (§4 `seatHasNoLines`). It opens the existing confirm (`confirmRemoveCharacter` / `confirmRemoveMember` / `confirmRemovePersona`; a card-less player seat drops from `benchedPlayerSeats` the way today's X dropped it from `playerSeats`). The confirm drops the row from the draft, so Save omits it and the server soft-removes the unused benched seat. This is L1's `unseat`; don't change the server.
- You may put the benched row in a new component, e.g. `src/lib/client/components/sessionForms/BenchedSeatRow.svelte`. Keep the form's logic in the form.

### 4. Fallen rows, and the two server facts

Make a small pure module, `src/lib/client/components/sessionForms/benchedSeats.ts`, with unit tests in `benchedSeats.test.ts`:

- `seatFellInStory(session, row, kind: "character" | "player"): boolean`. True when either holds:
  - **(a)** the row carries a host-filled `fellInStory === true`. Read it duck-typed, `(row as { fellInStory?: unknown }).fellInStory === true`. This is a **proposed** server field that doesn't exist yet (★, the supervisor reports it). Absent means false.
  - **(b)** for a player seat only, today's `fellInStory` rule (~928) pointed at **benched** instead of removed. The row is live and benched, and the session has a later live card-less player seat of the same player: `o.id > row.id && !o.removedAt && o.personaId == null && o.userId === player`, where `player = row.userId ?? row.persona?.userId`.
- `seatHasNoLines(row): boolean`. True only when the row carries a host-filled `hasLines === false`, read duck-typed the same way. It's a **proposed** field; absent means false, so Remove is hidden.
- A fallen benched row shows a `Skull` icon (16px, `aria-hidden`, muted) and *"Fell in the story"* as its meta line. It keeps **Bring back** and has no Reassign.
- **Bringing back a fallen row:** while the brought-back row is in a seated list and still differs from its saved side, show one muted 12px line under that row: *"They come back as they are; their story still says deceased until you change it."*
  - Follow it with a link to the cast member when the row has a `castMemberId` and the session has a book (`session.lorebookId ?? session.ownBookId`).
  - Build the href from the lorebook route helpers in `src/lib/shared/lorebooks/loreRoute.ts`: `"/lorebooks" + toHash(...)` over `reduce(...)` with `openBook`, then `openCastMember` with `castId`. Check how `src/lib/client/admin/sections/plugins/IdPage.svelte` and `toHash` build one.
  - Link text: **Open ‹name› in the lorebook**. It's proposed copy; the supervisor reports it.
  - Use the quiet `anchor` link class the form already uses (look near `docsHref(`).

### 5. After a move: focus and the live line

- After **Bench** or **Bring back** (the buttons), focus moves to the row's own action button in its new list. That's its **Bring back** after a bench, or its **Bench** after a bring back.
  - Find the button after `await tick()`.
  - Use a `data-seat-action="<character|member|persona|player>:<id>"` attribute queried inside the tab panel's element. Never use a global `document.getElementById`: the form can mount twice.
- One visually hidden line in the Participants panel, `<p class="sr-only" aria-live="polite">`, says *"‹name› benched — waits for Save."* or *"‹name› brought back — waits for Save."* (exact strings, em dash). A drag that moves a row across a pair says the same line, with no focus move.
- The refusal toast in `handleSetCastSeatEnabled` (~1640) keeps `notify.error`. Only its title changes from the retired switch copy to *"Seat not benched or brought back"* (proposed; the supervisor reports it). **Don't add any `useInterest` / `socket.on` in the form**, and don't call `toaster`. The existing `useInterest("sessions:setCastSeatEnabled", …)` is the form's one listener for this event, and it stays.

## Files owned (edit only these)

- `src/lib/client/components/sessionForms/EditSessionForm.svelte`: the Participants tab and the script it calls. Leave every other tab alone.
- New: `src/lib/client/components/sessionForms/benchedSeats.ts`, `benchedSeats.test.ts`, and optionally `BenchedSeatRow.svelte`.
- Dom tests:
  - new `src/lib/client/components/sessionForms/editSessionBench.dom.test.svelte.ts`;
  - update `editSessionSaveParity.dom.test.svelte.ts`, `editSessionCastMembers.dom.test.svelte.ts` and `editSessionPlayerSeats.dom.test.svelte.ts` where they assert the switch, The fallen, Removed or a seated row's Remove.

## Files readable

Anything. In particular the existing `editSession*.dom.test.svelte.ts` (how they mount the form and fake the socket), `RowMenu.svelte`, `src/lib/shared/sessions/inPlay.ts`, `src/lib/shared/sessions/playerSeat.ts`, and `node_modules/svelte-dnd-action/README.md` for the `type` option. For any Skeleton component, read its section only: `grep -n "^# Menu" AI-TEMP/skeleton-llms-svelte.txt`, then `sed -n` that range.

## Rules (quoted)

- STYLE-GUIDE §6.6: "An action menu is **`RowMenu`** … Items are data — `{ label, icon, onSelect, destructive?, disabled?, href?, title? }` or `{ separator: true }`, falsy entries dropped … the destructive row … sits after a separator … **The kebab's name** … is _More actions for ‹name›_ (`triggerLabel`) … Do not hand-build a menu from a `Popover` and buttons."
- STYLE-GUIDE §6.1: "Secondary actions are tonal … A destructive action is never the primary."
- STYLE-GUIDE §9:
  - "Every interactive element is a real `button`, `a` or input with an accessible name; icon-only buttons carry `aria-label`."
  - "**Never an interactive inside an interactive.**"
  - "Targets are 44px on touch." Rows keep `min-h-11`.
- STYLE-GUIDE §10:
  - "Sentence case everywhere."
  - "No filler: a screen with nothing to say says nothing."
  - "Help is one sentence."
- STYLE-GUIDE §6.21: toasts go through `src/lib/client/utils/notify.ts`, never the raw toaster.
- CLAUDE.md Sockets ruling: "one domain context per event family … is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`."
- CLAUDE.md: "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`." "`socket.off(event)` with no handler removes **every** listener app-wide; always pass the handler." "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`." Untrack reads in effect-called store methods.
- It's a **session**, never a *chat*. Say **seat** and **benched**; never "disabled", "switched off" or "removed" for a benched seat.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. Never `git checkout`, `restore` or `clean` in either repo. **Never run `prettier --write` on a file.**
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no sdk:build: never run one.)
- Never hand a DOM node to an assertion (compare `x === null` to `true`). A failing assert on a happy-dom element has OOM-killed VS Code. Never pipe vitest into `head`. Run vitest in a capped scope: `systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 <files>; echo test-exit=$?'`.
- Scratch files start with `bench-L4-`.

## Out of scope (never build)

- Any server change.
- The composer state for a benched guest.
- Any nudge or automatic bench.
- Docs and NOMENCLATURE.
- Other tabs.

## Stop and ask when

You need any copy string not quoted above, a name beyond the new files and the module's two functions, or a library change for the drag pairing. Report it and don't decide it.

## Done means

- `editSessionBench.dom.test.svelte.ts` covers:
  - **Bench**, for a carded character, a card-less member, a carded persona and a card-less player seat: the row moves to Benched, focus lands on its Bring back (`document.activeElement === button` compared as a boolean), and the live line reads exactly. Nothing is emitted before Save. Save emits `sessions:setCastSeatEnabled` with `characterId` / `castMemberId` / `playerSeatId` (the persona's **seat** id) and `enabled: false`, before `sessions:update`, and the update's `characterIds` / `personaIds` / `castMemberIds` still hold the benched ids.
  - **Bring back** on a saved-benched row: it moves to the end of its seated list, focus lands on its Bench, the live line reads exactly, and Save emits `enabled: true`.
  - **The keyboard path:** the Bench and Bring back buttons are real buttons reachable by focus, and pressing one moves focus as above.
  - A **fallen** player row (rule (b)) and a character row carrying `fellInStory: true` show the Skull and "Fell in the story". Bringing one back shows the note (and the link when a book and a cast member exist).
  - **Reassign** shows only on saved-benched carded non-fallen rows. **Remove** shows only on saved-benched rows with `hasLines: false`. Neither shows on a seated row. Removing a benched row drops its id from the update.
  - An **unsaved** row has no Bench and keeps its X.
- `benchedSeats.test.ts` green.
- The existing `editSession*.dom.test.svelte.ts` green, updated where the ruling changed them.
- `npx tsc --noEmit -p .` shows no error in your files, and `npm run check` shows no error or warning in them. Grep its output for your file names; other lanes' errors aren't yours.
- `npx prettier --check` on your files: report the result.

## Report

Your final message:
- changed files;
- tests run, with pass counts;
- every user-visible string you added;
- any departure from this brief and why;
- **Noticed, not done**.
