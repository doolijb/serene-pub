# BRIEF — s4-follow-b-w4 (2026-11-09): the member Sprites tab cascades from the card

Supervisor: lane s4-follow-b. You are a lane-worker. Report in your final message (the harness refuses report files): changed files, tests run and results, open questions, Noticed-not-done.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no `sdk:build`.)

## Owner words (quote, never reinterpret)

- "Not sure why this can't just cascade from the card through the session seat/lorebook api." · "Cast by default cascades. Automatic changes should be overrides in the cast member." · "a card is a seed, not the sole carrier." · "not having a card doesn't make them 2nd class." (2026-11-09)
- Lead's ruling for this lane (2026-11-09): in `buildSpriteList`, when the owner is a member whose own sets don't make the art, attach `fromCard?: { characterId, sets }`, built from the member's card under the **member's** read rule; reuse the cascade rule from `sprites/choices.ts` exactly — if it isn't exported in a callable form, export it, never copy it; send only the card's sprite sets, never any other card data; mark `fromCard` 🚧.

## The rule today (`src/lib/server/sprites/choices.ts`, `spriteChoicesFor`, ~lines 246–268)

"The member's own sets, when it has any with an image, are the art — no card draws them": `memberOwns = ownArt.sets.size > 0` where `ownArt = spriteLabelsForMembers(db, [memberId]).get(memberId)`; else the art is the member's card's (`asRead.activeCardId`, the active card as read), and when that swapped-in card has no art, the member's own (seat) card.

## Build

1. `src/lib/server/sprites/choices.ts` — extract the "does the member's own art win" test into an exported helper, e.g. `memberDrawsOwnSprites(db, castMemberId): Promise<boolean>`, and make `spriteChoicesFor` call it (behaviour unchanged). If the card choice (active card, then the fallback card when it has no art) can be extracted cleanly as well, export it too (e.g. `cardDrawingMember(db, castMemberId)`), else keep the card choice in the new caller but say why. JSDoc one sentence each. Do not change anything else in `choices.ts`.
2. `src/lib/server/sockets/sprites.ts` (the lead's go, this change only) — `buildSpriteList(owner)`: for a `{ castMemberId }` owner, when `memberDrawsOwnSprites` is false, find the member's card: `memberAsRead(db, castMemberId, {})?.activeCardId` (the member at its book's present), falling back to the binding's linked `characterId` when the active card has no sets, exactly as `choices.ts` falls back. If that card has sets (`listSpriteSets(db, { characterId })`), attach 🚧 `fromCard: { characterId, sets }`. No other card fields. The read rule is the member's (`requireReadable` already checked `canReadCastMember` for `characters:listSprites`; every write handler's reply also goes through `buildSpriteList`, so after the member gets art of its own `fromCard` disappears on the next reply). A card owner's list is unchanged. A card-less member (no card) never gets `fromCard`.
3. `src/lib/shared/sockets/types.ts` — `Sockets.Characters.ListSprites.Response` gains `fromCard?: { characterId: number; sets: SpriteSetView[] }` with one JSDoc sentence ("🚧 A cast member's card's sets, sent while the card draws the member — the member has no sprites with pictures of its own; read-only here."). Only this field — lanes s4-follow-a and w1 edit other parts of this file; use exact-string Edits and re-read before editing.
4. **Media access check — do this before building the client.** The client draws a sprite through `mediaRevUrl` → `/media/[id]` → `canViewMedia(file, user.id)` (`src/lib/server/media/index.ts`). Find out whether a reader who may read the member but not its card (someone else's card met only through a shared or provided lorebook) can load the card's sprite files. If they can't, **stop and report** (do not widen media access — that is a ★ for the owner) and build the client so it still says the right words (step 5) even when an image fails.
5. `src/lib/client/components/sprites/SpritesTab.svelte` — display part only. **Lane s4-follow-a is editing this file's reply keys (`replyKey`, interest keys) right now.** Rules: exact-string `Edit` only, never `Write` the file; re-read the lines just before each edit; touch nothing in `replyKey`, `ours`, `LIST_EVENTS`, or the interest `$effect`; prettier `--write` only your own lines.
   - Keep `fromCard` from each list reply (`handleList`) in a `$state` beside `sets`.
   - Member owner, `sets.length === 0` and `fromCard` has sets: instead of the empty state, show the card's sets **read-only** — the same set picker and sprite view with every edit/fill/upload control hidden for those sets (as for a non-owner) — under a muted line (★ copy, build it): `From the card: {name} is drawn with these until they have sprites of their own.` For an editor (`isOwner`), keep the existing ways to start the member's own set under it: the **Upload images** action and `start from the standard set` link, with their existing words.
   - Member owner, own sets exist but `fromCard` is still sent (no own set has a picture yet): draw the member's own sets as today, plus a muted line (★ copy): `Until these have pictures, {name} is drawn with the card's sprites.`
   - Never `‹name› has no sprites.` while `fromCard` is shown. A card owner's tab is unchanged.
   - Follow STYLE-GUIDE §6.7: "An empty state is `EmptyState` … an icon, one sentence, and at most one action"; the muted line style the tab already uses (`text-surface-600-400 … text-xs`).

## Files owned (only these)

`src/lib/server/sprites/choices.ts` (the extraction only), `src/lib/server/sockets/sprites.ts` (`buildSpriteList` + imports only), `src/lib/shared/sockets/types.ts` (the one field), `src/lib/client/components/sprites/SpritesTab.svelte` (display part only), and new tests beside them. Never touch `sprites/fillAction.ts` (serene-pub-43), `imageGen/**`, `registrations/unserved.ts`, `runProgress.svelte.ts`.

## Rules (quoted)

- CLAUDE.md P2: "A module owns its data and every write to it … Two writers of one thing is a bug." (This is a read; nothing writes card data.)
- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx`." "`socket.off(event)` with no handler removes every listener app-wide." "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."
- "An event in `SCOPED_EVENTS` must carry its scope key … in the payload" — the member reply already carries `castMemberId`; keep it.

## Stop and ask when

The media check fails (step 4); a name beyond `fromCard`, `memberDrawsOwnSprites`, `cardDrawingMember` is needed; any copy beyond the two strings; the extraction would change `spriteChoicesFor`'s behaviour.

## Tests (done means)

Capped scope, logged (never pipe vitest into `head`):
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-follow-b-w4-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-follow-b-w4-tests.log'`
An int test that opens a DB inside an `it` needs a 60 s timeout.
1. New `src/lib/server/sockets/sprites.fromCard.int.test.ts` (model on `src/lib/server/sprites/memberSprites.int.test.ts`): a reader who can read the member but not the card gets the card's sets as `fromCard` (and only `characterId` + `sets`); a member with its own sets with pictures gets no `fromCard`; a member with only empty own sets still gets `fromCard`; a card-less member gets none; a reader who can't read the member is still refused; a card owner's list has no `fromCard`; after the member uploads its first sprite, the write's reply carries no `fromCard`.
2. Existing, must stay green: `src/lib/server/sprites/choices.castMember.int.test.ts`, `choices.cardless.int.test.ts`, `memberSprites.int.test.ts`, `ownerWriters.int.test.ts`.
3. New `src/lib/client/components/sprites/spritesTabFromCard.dom.test.ts` (if a DOM harness for SpritesTab exists or is cheap; else say so): member with no sets + `fromCard` → the card's sets drawn, the "From the card" line, no "has no sprites", no edit controls on them, editor still sees Upload / standard set; own empty sets + `fromCard` → the "Until these have pictures" line.
Report `npx tsc --noEmit -p .` errors in your files (12G scope: `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=8192; npx tsc --noEmit -p . > <scratchpad>/s4-follow-b-w4-tsc.log 2>&1'`); if another `tsc --noEmit` is running, wait for it first. Known errors not yours: 3 in `sessionPage/requests/*` waiting on `sdk:build`.

## Report

Final message: changed files; the media-access finding; tests + results; tsc; copy used; open questions; Noticed, not done.
