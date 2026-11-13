# mundi-27a worker rules (quoted by the supervisor; both worker briefs point here — read it whole, it is short)

Repo: `/home/jody/github/mundi-sp` (the Mundi port, AGPL). Never `git checkout` / `restore` / `stash` there; never commit. Nothing goes into the serene-pub repo except your report.

## Verbatim (every implementation brief)
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*
- *"Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`."*
- You do **not** run `sdk:build`, `npm run package` or `npm run build` (the supervisor packages). Never edit `/home/jody/github/serene-pub-sdk/**` (the port reads its `dist` through symlinks).

## What this lane is (seat-cast programme S3, the port's read side) — quoted from the S3 contract
- **"Host fills, consumers read."** Serene Pub now fills identity on its objects: each `state.cast.byId` entry (and `who.user` / `who.owner`, which are entries) carries `ref` (the seat's participant reference), `castMemberId` (**the seat's cast member**) and `cardId` (**the member's active card on the timeline**, null when card-less); seat rows of `core:query/session-cast@1` carry `ref` / `castMemberId` / `cardId`; a message row carries `castMemberId` (the speaker's cast member). Consumers read them "and fall back to today's card form only when a field is absent (a host before S3)".
- **"Look up, never parse."** "A consumer that needs the `state.cast.byId` entry for a ref finds the entry whose `ref` (or `castMemberId`) matches; it never parses a card id out of a ref or a key, and never does `Number(key)`."
- **"Tests on both shapes:** every switched consumer gets a test on today's data (output unchanged) and on S4-shaped data (member refs `seated-member:<id>`, `player-seat:<id>` for carded player seats, member-keyed `byId`)."
- **"No stored key changes, no migration, no removal."** In S3 core still emits the card form (`character:<cardId>`); S4 flips the values in the same fields, and the port must then need no change.
- **Messages (owner ruling ★S3-3):** "a message carries `castMemberId` only (not a `speaker` ref) … readers resolve the ref themselves (through the cast entry whose `castMemberId` matches), falling back to the card."
- **Card id ports stay card ids** (★S3-6, recommended, kept): a `characterId` port (`createMessage`'s, `S.rowIds`) still carries a card id.
- **Saves (★S3-5):** the annex `avatars` values are read as **v1 card ids resolved through each entry's `cardId`**; a **v2 reader** (member ids through `castMemberId`) ships now, **no writer**. "An unknown id re-resolves by its avatar tag (`extensions.mundi.avatar`) — S4's branch remap mints new member ids." **"Phone lanes keep `phone:<cardId>` in S3 (S4 decides)."**
- **Every session has a lorebook** — never write "no book" in a comment, copy or test name.

## The ONE door (already written by the supervisor): `src/engine/identity.ts`
Read it first. Use only these; build no ref and read no key anywhere else. If a helper is wrong or missing, say so in your report and propose the change — don't fork a second copy.
- `castEntries(state)`, `refOfEntry(e)`, `cardOfEntry(e)`, `memberOfEntry(e)`, `entryByRef`, `entryByCard`, `entryByMember`.
- `playerEntryOf(state)`, `playerRefOf(state)` (who.user, else who.owner).
- `refOfSeatRow(row)` for session-cast rows.
- `speakerEntryOf(state, row)` (castMemberId, else characterId), `spokeAsCast(row)`.
- `annexAvatars(annex)` (re-exported by `save.ts`, keep importing it from either), `annexVersionOf(annex)` (1 | 2), `exampleOfAvatar(world, avatar)`, `entryByAvatarKey`, `avatarEntryOf(state, annex, avatar, world?)`, `avatarRefOf(...)`, `avatarCardOf(...)`, `avatarOfCard(state, annex, cardId, world?)`, `avatarOfSpeaker(state, annex, row, world?)`.
- `cardRef(cardId)` ⏳ — the only template: used inside identity.ts for a number that is a card id by definition (a v1 annex value, a phone lane number) when no entry names it. A site may call it only for a phone lane number with no owner, and must say so in a comment.
- `src/engine/phone.ts` `phoneLaneOf(annex, avatar, state?, world?)` / `avatarOfLane(annex, lane, state?, world?)` go through it (v1 output unchanged without `state`; pass `state` wherever the handler has it so a v2 annex resolves).

## The frame's mirror contract (both workers)
`save.hud.cast` rows (`MundiHud`, `src/engine/save.ts`) gain two optional fields, written by the engine **only when the host filled the field on the avatar's entry** (so a pre-S3 host's mirror is byte-identical): `castMemberId?: number | null` (the entry's `castMemberId`) and `cardId?: number | null` (the entry's `cardId`). The row's key stays the annex number (`String(annexAvatars(annex)[avatar])`). The frame (`ui/src`) has no state document and no cast; these two fields are how it finds a card id (v2) and the avatar of a message's `castMemberId`. These reuse the SDK's names with the SDK's meaning — no new word.

## CLAUDE.md rules that apply
- Decide implementation inside the asked scope and name the choice in your report. **Stop and ask** (write it in your report as ★ with one recommendation and its trade-off, don't build it) on anything a user sees or that outlives the change: copy, a new name / setting / port / field beyond the two above, reshaping stored data. Do what was asked, at the size asked; findings go under **Noticed, not done**, never fixed in passing. Say each assumption.
- Match the file's style (tabs, single quotes, no semicolons in `src/`; `ui/src` uses 4 spaces in places — follow the file). Don't reformat lines you didn't change. Comments say *why*, in the port's voice.
- Never pipe vitest into `head`/`tail -n` mid-run in a way that kills it early; run `npx vitest run <files>` and read the summary.
- Typecheck: `npx tsc --noEmit -p tsconfig.check.json` from `/home/jody/github/mundi-sp` (baseline: clean; baseline suite 592/592).
