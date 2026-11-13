# BRIEF s4-sdk2-w4 — client: member Sprites tab draws; Backdrop answers a card-less member; docs (lane s4-sdk2, wave 6) — 2026-11-08

Supervisor: lane `s4-sdk2`. Repo: **`/home/jody/github/serene-pub`**. Absolute paths only. Report in your final message: changed files, tests run with results, decisions (each named), open ★ (one recommendation + trade-off), Noticed-not-done.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.*

- **Prettier:** `--write` only lines you changed (a whole-file `--write` re-sorts classes and reflows markup other work owns); if a file fails only on lines you didn't touch, leave it and say so.
- A worker beside you (w3) owns the server and `src/lib/shared/sockets/types.ts` / `typedSocket.ts`; it is changing the `Sockets.Characters` fill / express / portrait types to this shape — code against it (if `tsc` disagrees at the end because w3 isn't finished, say so; don't edit its files):
  - `PreviewSpriteFill.Params`, `FillSprites.Params`, `ExpressSprite.Params`, `PreviewPortrait.Params`, `GeneratePortrait.Params`: `characterId?: number` **or** `castMemberId?: number` (exactly one) plus their other fields as today;
  - their responses and the `SpriteFill.Progress` / `Portrait.Progress` pushes carry only the owner's key: `characterId` for a card, `castMemberId` for a member. A member's replies have no `characterId`, so they are **not** scoped: listen on the bare event key and keep only replies whose `castMemberId` is yours (s4-cp's pattern in `SpritesTab.svelte` — `ours(msg)`, bare interest keys for a member).
- Lane `s4-fold` runs beside: never touch `SessionViewPanel`, `LorebooksWorkspace`, `docs/lorebooks.md`, `docs/sessions.md`.

## Rules your work rests on (quoted)

- **Ruling ★7 (2026-11-08):** "Member sprite-set editor + portrait/sprite-fill actions taking an owner (card or member) in S4."
- **Member art rule** (s4-cp, `cast/memberAccess.ts`): whoever may edit the member's lorebook writes (and draws); a share recipient, a session guest and an administrator read only. On the member page `SpritesTab` gets `isOwner={!readOnly}` (= may edit the book). **No admin exception for a member.**
- **Sockets:** one domain context per event family is the only listener and the only place that toasts; views register listeners for local state and **never call `toaster` / `notify`** for socket results. `socket.off(event)` always with the handler. `SvelteSet` / `SvelteMap`, never `$state(new Set())`. Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.
- It is a **session**, never a chat. Every session has a lorebook (own book or overlay) — never write copy or docs that frame a session as having none.
- **Docs** (CLAUDE.md): `docs/<area>.md` is user-facing behaviour; update it in the same change when behaviour moves; plain words, no internal names.

## Goal

1. **`src/lib/client/components/sprites/SpritesTab.svelte`** — s4-cp hid generation for a member owner (`canFill = memberId == null && …`, "Generation is the card's; a member owner never draws", the fill `$effect` returns early on `cardId == null`, `previewSpriteFill` / `fillSprites` / `expressSprite` emits use `characterId: cardId`). Un-hide:
   - `canFill`: a card → `isOwner || admin` (as today); a member → `isOwner` only.
   - Every fill / preview / express emit sends `ownerKey` (the existing `{ characterId } | { castMemberId }`), not `characterId: cardId`.
   - Interests: a card keeps its scoped keys; a member declares the bare `characters:previewSpriteFill`, `characters:spriteFill`, `characters:fillSprites`, `characters:expressSprite` (and their `:error`s, already bare) and every handler drops a reply that isn't `ours(msg)` (check `handlePreview`, `handleFillProgress`, `handleFillError`, `handlePreviewError`, `handleExpressed`, `handleExpressError`).
   - **Re-express for a member:** the offer depends on `images:drawingSheet`, which today answers only `{ characterId }` (`sockets/images.ts`, `shared/sockets/imageGen.ts` — not yours, not w3's). Make the express path owner-generic, but keep the drawing-sheet ask card-only for now, with one comment line that a member's ask waits on `images:drawingSheet` taking `castMemberId`. Report the exact few lines that would turn it on.
   - Update the head comment (~8–11) and the fill block's comment (~429): a member owner draws too, for whoever may edit its lorebook.
   - No new visible words.
2. **`src/lib/client/components/sessionPage/requests/characterImages.ts`** — `WidgetRequests['character-images']['params']` (SDK, built) is now `{ characterId?: number | null; castMemberId?: number | null; cursor?: string }`: exactly one; refuse both or neither with _"Name a character or a cast member, not both."_ A `characterId` must be a cast member's card (`m.cardId === id || m.characterId === id`); a `castMemberId` must be a member of `characters.v1` (`m.castMemberId === id`), else _"that cast member is not in this session"_. Add an optional dep `readMemberGallery?: (castMemberId: number) => Promise<readonly Pick<Sockets.Media, "uuid" | "url" | "kind">[]>`; when the page didn't wire it, reject with _"that cast member's images could not be read"_. Same paging and `{ ref, src }` mapping for both. Update the head comment. **Do not edit** `pageAsks.ts` or `requests/index.ts` (not this lane's): instead write, in your report, the exact hunk that wires `readMemberGallery` in `src/lib/client/components/sessionPage/pageAsks.ts` (beside `readCharacterGallery` ~416: `characters:listGallery { castMemberId }`, reply key = the bare `characters:listGallery`, match `data.castMemberId === castMemberId`, error match the same) and adds the field to the deps type in `requests/index.ts` (~287), so the supervisor can queue it.
3. **`docs/images.md`** — read it whole first. Add, where portrait and sprite fill are described: **Fill empty sprites** works on a cast member's Sprites tab too (on their lorebook page), for whoever can edit that lorebook; the new pictures belong to the lorebook's owner and stay with that cast member. And the Backdrop chooser lists the pictures of someone in the session who has no character card (their own pictures). Don't promise re-express or Generate portrait for a cast member (their doors aren't open yet) — put the sentences you'd add for them in your report.

## Tests (Done means)

- `src/lib/client/components/sprites/spritesTab.memberOwner.dom.test.ts` (s4-cp) pins "no Fill for a member" — flip it: an editor member sees **Fill empty sprites** and its preview emit carries `castMemberId` and no `characterId`; a read-only member (`isOwner=false`) sees none; a card still behaves as before. Look at `spriteReexpress.dom.test.svelte.ts` too and keep it green.
- `src/lib/client/components/sessionPage/requests/characterImages.test.ts`: a card-less member (`cardId: null`, `castMemberId: 7`) answered through `readMemberGallery`; both / neither refused; a castMemberId not in the cast refused; a carded member still answered through `readCharacterGallery`; `readMemberGallery` missing → the sentence. Keep `requests/index.test.ts` green.
- Run in a capped scope (heavy DOM tests have OOM-killed VS Code; never pipe into `head`):
  `cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-sdk2-w4-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-sdk2-w4-tests.log'`

## Files owned

`src/lib/client/components/sprites/SpritesTab.svelte`; `src/lib/client/components/sprites/spritesTab.memberOwner.dom.test.ts`; `src/lib/client/components/sessionPage/requests/characterImages.ts` + `characterImages.test.ts`; `docs/images.md`.

## Out of scope / stop and ask

- A Generate portrait door for a cast member (the member page has no Gallery tab — the supervisor raises it); `CastWorkspace.svelte`, `EntityGalleryTab.svelte`, `pageAsks.ts`, `requests/index.ts`, `sockets/images.ts`, `interest.ts`; any new visible words; Scene Portraits.
