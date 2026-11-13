# BRIEF s27-S3G-w2 — core-catalog view-models, widget components and Scene Portraits copy read host-filled identity (seat-cast S3)

Worker for lane **s27-S3G** (supervisor: lane-supervisor, Opus). You type; you do not decide names, copy or scope. Report back to the supervisor as your final message (no report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal
Core-catalog's widget view-models and components stop **building** participant refs from card ids and stop **parsing** card ids out of refs. They read the identity the host now fills in, and fall back to today's card form only when that field is absent (a host from before S3). Output on today's data must not change, except where an item below says otherwise.

### What the host fills (SDK names, built by lane s27-S3K — use exactly these; all optional `?:`)
- `SessionCharacterV1` (members of `characters.v1`): **`ref`** (now typed `ParticipantRef`), **`castMemberId`** (the seat's cast member), **`cardId`** (the member's active card on the timeline; null when card-less). ⏳ `characterId` stays (removed in S5).
- `SessionStateOwnerV1`: **`ref`**, **`castMemberId`**. `OwnerRefV1.kind` / owner kinds gained 🚧 **`seated_member`** (its `id` is the cast member id) beside ⏳ `session_cast` (its `id` the card).
- `ConversationCastV1` rows (both lists): **`ref`**, **`castMemberId`**.
- `MessageV1`, `ChannelLaneV1.latest`, `TurnHistoryMessage`: **`castMemberId`** (the speaker's cast member). No speaker ref on messages — readers resolve the ref themselves through the cast entry whose `castMemberId` matches.
- `senderRefOf(m, refOfMember?)`, `spokenRefsSince(messages, refOfMember?)`, `roundRobinOrder(…, refOfMember?)` in `sdk/src/turnOrder.ts`: optional lookup, cast member id → that seat's `ref`; absent or a miss → today's card form.
- `SessionSceneImageV1.ref` widened to `ParticipantRef | null`.
- `set-chosen-image` params: `{ memberRef?: \`seated-member:${string}\`; characterRef?: string; mediaRef: string | null }` — 🚧 `memberRef` names the member; ⏳ `characterRef` accepted until S5.
- New ref kind 🚧 `seated-member:<id>`; ⏳ `character:<id>` stays readable until S5. In S4 every player seat is `player-seat:<seatId>`, carded or not.

### The rules (quoted from the lane contract, BRIEF-s27-S3-common.md)
- "**Host fills, consumers read.** … read them and fall back to today's card form only when a field is absent (a host before S3). SDK `castMemberId` = **the seat's cast member** … `cardId` = the member's **active card on the timeline**."
- "**Look up, never parse.** A consumer that needs the `state.cast.byId` entry for a ref finds the entry whose `ref` (or `castMemberId`) matches; it never parses a card id out of a ref or a key, and never does `Number(key)`."
- "**Tests on both shapes:** every switched consumer gets a test on today's data (output unchanged) and on S4-shaped data (member refs `seated-member:<id>`, `player-seat:<id>` for carded player seats, member-keyed `byId`)."
- "**No stored key changes, no migration, no removal.**"
- Card ids and member ids share one number range: a card-form fallback must never match a *different* person — fall back only when the row/owner carries no `ref` of its own.
- **Exported API:** these are `@experimental` published functions. Never rename or remove an export, never change a required parameter's type. Widen with **optional trailing parameters** or optional fields. A genuinely new export needs the supervisor first (it is a new name).

## Items (line numbers approximate)
All under `/home/jody/github/serene-pub-sdk/core-catalog/`.
1. `src/shared/ui/conversation/itemValues.ts` (~92–131): `itemSpeakerOf(row, refOfMember?)` — envoy first (unchanged); then, when `row.castMemberId != null` and the lookup finds a ref, that ref; else today's logic, passing `refOfMember` through to `senderRefOf`. `ItemRow` gains optional `castMemberId?: number | null`. `itemValuesOf(row, facts)`: `facts` gains optional `refOfMember?`. `characterLine`: true when `role !== 'user'` and the speaker's ref kind is `character` **or** `seated-member`. Wire the lookup in core-catalog's own callers (`src/shared/ui/conversation/messageVerbState.ts` ~208, and wherever the component passes rows) from the conversation cast rows (`castMemberId` → `ref`), when that cast is in reach; if it is not, report where it would come from rather than threading new props through many files.
2. `src/shared/ui/conversation/formAnswer.ts` (~42–100): `FormSession` rows gain optional `ref?: string | null` and `castMemberId?: number | null`. `canAnswerForm`: when any seat row carries a `ref`, match the addressee against the rows' `ref`s (a persona row → that seat's person answers: `userId ?? persona.userId === viewer.userId`; a character row → `false`, the AI's); a `seated-member:<id>` addressee also matches a row whose `castMemberId` equals the id; a `player-seat:<id>` addressee matches the persona row whose seat `id` equals it **whether or not the seat has a card** ("a carded player seat answers its own form" — lane brief; ★27-3: every player seat is keyed `player-seat:<id>`). With no `ref` on any row, today's logic exactly (the carded-seat change above applies in both cases — say so in the code comment and the test). Unaddressed, `envoy:` and `user:` unchanged.
3. `src/shared/ui/attendance/index.ts` (~70–145) **and the one SDK line**: in `/home/jody/github/serene-pub-sdk/sdk/src/widgets.ts`, `AttendeeV1.personaRefs` (~567) widens from `` `character:${number}`[] `` to `ParticipantRef[]` (already imported there); rewrite **only** its doc comment's ⏳ sentence to say it widened (each seat's `ref` as `characters.v1` carries it). **Touch nothing else in `widgets.ts`.** `AttendancePersonaView.ref` widens to `ParticipantRef`; `characterIdOf` goes: the matched member `m` gives `characterId: m.cardId ?? m.characterId` (what `open-character` opens — a card id); a ref with no matching member is left out as today. Check `components/shared/attendance/*.svelte` still compiles.
4. `src/shared/ui/places/index.ts` (~150–160): owners of kind `session_cast` **or** `seated_member` place a face; its `ref` is `owner.ref` when present, else `` `character:${owner.id}` `` for `session_cast`, `` `seated-member:${owner.id}` `` for `seated_member`.
5. `src/shared/ui/scene-portraits/portraits.ts`:
   - `chosenImagesOf` (~185): accept lines keyed `character:<digits>` **or** `seated-member:<digits>` (★S3-8: stored lines become `seated-member:<id>=<image>`, old ones rekeyed in S4; in S3 the store may hold either).
   - `scenePortraitsOf` (~357–385): a member's `chosenRef` = the entry under `m.ref`, else under `` `seated-member:${m.castMemberId}` `` when `castMemberId != null`. `ScenePortrait` gains `castMemberId: number | null` (and keep `characterId`; galleries use `cardId ?? characterId` — add `cardId: number | null` if the widget needs it).
   - `stateOwnerKeyOf(state, characterId, member?)` (~340–348): optional third parameter `{ ref?, castMemberId? }`; first the owner whose `ref === member.ref` or whose `castMemberId === member.castMemberId` (both non-null), of kind `session_cast` or `seated_member`; else today's `session_cast` + `o.id === characterId` match **only for an owner that carries no `ref`**. `scenePortraitsOf` passes `m`.
   - `pinnedPortraitsOf` / `characterIdOf` (~405–424, ⏳ deprecated): match the pin's `ref` against the owners' `ref` first; today's parse only as the no-`ref` fallback.
6. `src/shared/ui/session-state/stateView.ts`: the cast owner filters (~480, ~532) and any other `session_cast` kind test also take `seated_member`; `pickOwners` (~545) also matches `o.ref` (lower-cased) when present; look at ~584 and treat `seated_member` like `session_cast` where the code means "a cast owner"; the machinery-words guard (~763) also lists `seated_member` and `seated-member`.
7. Components (`components/shared/…`):
   - `messages/SessionComposer.svelte` (~1020, 1040, 1048): each `<sp-avatar ref=…>` takes the seat's `ref` from the conversation cast's persona row whose `personaId` matches, else today's `` `character:${personaId}` ``. One small local function; no new props unless the cast is not in reach (then report).
   - `messages/TurnLine.svelte` (~244) `avatarFor`: pass any ref of kind `character`, `seated-member` or `player-seat`. First read the app's `sp-avatar` (read-only: `/home/jody/github/serene-pub/src/lib/client/components/hostElements/SpAvatar.svelte` and the page's `participantOf` in `src/routes/sessions/[id]/+page.svelte` ~752) and `NextCharacterBlock`: if passing `player-seat:` would change what is drawn today for a card-less player seat, keep `player-seat:` out and say so.
   - `messages/SessionMessage.svelte` (~623): `open-character` keeps the card id — **no change**.
   - `scene-portraits/ScenePortraitsWidget.svelte` (~191): `chooseImage` sends `{ memberRef: \`seated-member:${member.castMemberId}\`, mediaRef }` when `member.castMemberId != null`, else ⏳ `{ characterRef: member.key, mediaRef }`. Galleries / `character-images` / sprite sets keyed by the card: use `cardId ?? characterId` where a card id is requested (~88–160). Leave the `persona:${characterId}` data attribute (~231) alone.
   - `backdrop/BackdropWidget.svelte` (~102–247): galleries requested by `cardId ?? characterId`.
8. **Scene Portraits help text** (`src/registry/widgets.ts`, ★S3-8 ruled: reworded, no raw refs — "a picker-style sentence; the stored-line format note moves out of user copy"):
   - `chosenImages.description` becomes exactly: `'Pick each character's image on its face in the widget. A character with none shows its avatar.'` (mind the apostrophe in a single-quoted TS string — use double quotes or an escape, matching the file's style).
   - Its JSDoc (dev-facing) says the stored line is `seated-member:<id>=<image ref>` 🚧 (★S3-8), with ⏳ `character:<id>=<image ref>` still read until S4 rekeys them.
   - `pickMembers`' JSDoc (~476): "a name as the session shows it, or a member's `ref` (🚧 `seated-member:<id>`; ⏳ `character:<id>`)". Its user `description` is already ref-free — leave it.
   - grep the rest of `src/registry/widgets.ts` for raw refs (`character:`, `session_cast`, `player-seat:`) inside `label` / `description` strings and **list** them in your report; change none.

## Tests — Done means
Write **one new file** `/home/jody/github/serene-pub-sdk/sdk-tests/seatCastViews.test.ts` (node:test + `node:assert/strict`, in the style of `coreScenePortraits.test.ts`, `sessionStateView.test.ts`, `coreAttendance.test.ts`, `corePlaces.test.ts`). For items 1–6, each on:
- **today's data** (no `ref`/`castMemberId`/`cardId`) → output as before;
- **S3-filled card form** (`ref: 'character:3'`, `castMemberId: 7`, `cardId: 3`) → output as before;
- **S4 shape** (`ref: 'seated-member:7'`, `castMemberId: 7`; a carded player seat `ref: 'player-seat:4'`; owners `{ kind: 'seated_member', id: 7, ref: 'seated-member:7', castMemberId: 7 }`; a message row with `castMemberId: 7`) → the right person;
- **the collision case** (card id 3 and member id 3 are different people) → never the other person;
- formAnswer: a carded player seat addressed `player-seat:<id>` is answerable by its person.
If the component tests (`coreScenePortraitsComponent.test.ts`) can observe a request cheaply, add one case there that `chooseImage` sends `memberRef` for a member with `castMemberId`; otherwise say so.
**Never hand a DOM node to an assertion** (a failing assert on a happy-dom element has OOM-killed the editor): compare `x === null` to `true`.

Run, inside a memory cap, writing output to a file and then reading it (never pipe a test runner into `head`/`tail`):
```
systemd-run --user --scope -p MemoryMax=3G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test seatCastViews.test.ts coreAttendance.test.ts corePlaces.test.ts coreScenePortraits.test.ts scenePortraits.test.ts coreScenePortraitsComponent.test.ts sessionStateView.test.ts conversationVerbState.test.ts conversationSlashPalette.test.ts coreConversationComponent.test.ts seatedMemberShapes.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/66e86768-ea43-4e92-bc4d-5f956a670b22/scratchpad/s27-S3G-w2-tests.txt 2>&1'
```
plus `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsc --noEmit -p .` and `cd /home/jody/github/serene-pub-sdk/core-catalog && npx svelte-check --workspace components --tsconfig ./tsconfig.json --threshold error` (each to a scratch file `s27-S3G-w2-*.txt`).
- Any test file that pins hashes or goldens and moves because of your change (the registry text, view-model code): **do not repin**; list it (file:line, recorded → computed). The supervisor repins.
- A failure that also fails without your change — list it as pre-existing (judge by the assertion's subject; never stash).
- The app (`/home/jody/github/serene-pub`) calls `itemValuesOf`/`itemSpeakerOf` (`src/lib/shared/actions/itemValues.ts`, `src/lib/server/pipelines/entities/publishedValues.ts`) and `canAnswerForm` (`src/lib/client/utils/formAnswer.ts`): your signatures must keep those compiling unchanged (they read the SDK via its dist, so you cannot run the app check — keep every change optional/additive and say so).

## Files owned (edit only these)
- `/home/jody/github/serene-pub-sdk/core-catalog/src/shared/ui/conversation/{itemValues,formAnswer,messageVerbState}.ts`
- `/home/jody/github/serene-pub-sdk/core-catalog/src/shared/ui/attendance/index.ts`
- `/home/jody/github/serene-pub-sdk/core-catalog/src/shared/ui/places/index.ts`
- `/home/jody/github/serene-pub-sdk/core-catalog/src/shared/ui/scene-portraits/portraits.ts`
- `/home/jody/github/serene-pub-sdk/core-catalog/src/shared/ui/session-state/stateView.ts`
- `/home/jody/github/serene-pub-sdk/core-catalog/components/shared/messages/{SessionComposer,TurnLine,conversation.svelte}.svelte|.ts` (i.e. `SessionComposer.svelte`, `TurnLine.svelte`, `conversation.svelte.ts`), `components/shared/scene-portraits/ScenePortraitsWidget.svelte`, `components/shared/backdrop/BackdropWidget.svelte`, `components/shared/attendance/*.svelte` (only if the widened type forces it)
- `/home/jody/github/serene-pub-sdk/core-catalog/src/registry/widgets.ts` — only the Scene Portraits `chosenImages` / `pickMembers` text
- `/home/jody/github/serene-pub-sdk/sdk/src/widgets.ts` — **only** `AttendeeV1.personaRefs`' line and its doc comment
- `/home/jody/github/serene-pub-sdk/sdk-tests/seatCastViews.test.ts` (new); one added case in `coreScenePortraitsComponent.test.ts` if cheap
## Files readable
Anything in `/home/jody/github/serene-pub-sdk`, `/home/jody/github/serene-pub` (read-only).

## Out of scope (never build)
The genre scripts (`core-catalog/src/genres/**`, `src/shared/reckoning.ts` — worker w1), any other SDK file, the app, mundi, stored data, repinning, NOMENCLATURE, docs, other help text.

## Stop and ask (finish what you can, then put it in your report) when
- a change needs a new exported name, a new user-visible word beyond the copy given above, or a stored-data change;
- a site cannot switch without parsing a ref or guessing;
- threading the cast lookup to a caller would mean new props across several components.

## Working rules (CLAUDE.md and the guides)
- Edit **hunks only**. Most of this repo is other people's uncommitted work (several of your files are already modified by others): never reformat a file, never run `prettier --write` on an existing file. `npx prettier --check` your new test file only.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You do not need `sdk:build`; do not run it.)
- Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.
- Svelte 5 runes: `$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`. Components never toast.
- Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.
- Targeted tests only. Scratch files in `/tmp/claude-1000/-home-jody-github-serene-pub/66e86768-ea43-4e92-bc4d-5f956a670b22/scratchpad/`, starting `s27-S3G-w2-`.
- Mark fallbacks ⏳ (removed in S5) in short code comments. It is a **session**, never a chat. Every session has a lorebook — never write "no book".

## Report (final message)
Changed files with the hunks in one line each · what switched (file → field read) · what still builds card form and why · where the cast lookup comes from in each caller · TurnLine's `player-seat:` decision · raw refs found in other registry copy · tests run with exact counts · pins that moved · pre-existing failures · anything you stopped on · Noticed, not done.
