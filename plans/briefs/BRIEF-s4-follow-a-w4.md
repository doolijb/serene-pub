# BRIEF — s4-follow-a worker w4 (2026-11-09): member replies get a scope key; delete from a member's gallery

You are a `lane-worker` under supervisor lane `s4-follow-a`. Repo `/home/jody/github/serene-pub` (SvelteKit 5, Svelte 5 runes, TS, Vitest 4, Drizzle + PGlite, Socket.IO 4). Use absolute paths.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no sdk:build.)

Background: a **cast member** (a `lorebook_bindings` row) has its own sprite sets and its own **member gallery** (table `cast_member_files`; NOMENCLATURE §18: "written only by 🚧 `addToMemberGallery` (`media/index.ts`; P2) … `characters:listGallery`, `characters:uploadGalleryImage` and `characters:reorderGallery` take `{castMemberId}` beside `{characterId}` (list by the read rule, upload and reorder by the edit rule, `canEditCastMember`…); delete is still card-only, ★cp-del"). Member replies of the gallery and sprite families carry `castMemberId` top-level and no `characterId` (`sockets/sprites.ts` ~l.50–75, `sockets/characters.ts` `galleryErrorKey` ~l.2394).

## Goal A — ★cp-scope-1 (owner approved 2026-11-09): scope keys for member replies

1. In `src/lib/shared/sockets/interest.ts` `SCOPED_EVENTS` (~l.194–231), the gallery family (`characters:listGallery`, `characters:uploadGalleryImage`, `characters:deleteGalleryImage`, and `characters:reorderGallery` if it is listed or replies) and the sprite family (`characters:listSprites` … `characters:testSprite`, the ten under "Sprites: every reply and cascade carries the owner id top-level") take the extractor
   `(payload) => payload?.characterId ?? (payload?.castMemberId != null ? \`member:${payload.castMemberId}\` : null)`
   — define it once as a private helper in that file and reuse it. Leave the fill/express/portrait/likeness/describe extractors as they are (image generation belongs to another session, serene-pub-43). Update the comments above ("carry the owner id top-level" → say card or member).
2. Switch every client listener of those events that listens **for a member** to the scoped key `interestKey(event, \`member:${memberId}\`)`:
   - `src/lib/client/components/sprites/SpritesTab.svelte` `replyKey()` (~l.64–72) — **only that function and its comment**; lane s4-follow-b is editing the rest of this file right now.
   - `src/lib/client/components/gallery/EntityGalleryTab.svelte` (its interest declarations ~l.380–400).
   - `src/lib/client/lorebooks/cast/CastMemberForm.svelte` `OWN_LIST_EVENTS` (~l.372–410): `declareInterest(interestKey(event, \`member:${memberId}\`), …)`.
   - `grep -rn "characters:listSprites\|characters:listGallery\|characters:uploadGalleryImage\|characters:deleteGalleryImage\|characters:reorderGallery" src/lib/client` for any other member listener; report each and convert it only if it's in a file above.
   Drop the "pending the lead's ruling" comments; keep the `ours(msg)` filters (cheap, harmless).
- Gate test: extend `src/lib/shared/sockets/scopedReplies.test.ts` (or `gatedEvents.test.ts`, whichever tests `SCOPED_EVENTS` extractors): a card payload scopes on the card id; a member payload `{ castMemberId: 5 }` scopes on `member:5`; a payload with neither scopes on nothing — for one gallery and one sprite event at least, plus a loop over the whole family. If a client DOM test pins the bare key (`castMemberForm.dom.test.ts`, a SpritesTab or EntityGalleryTab test), update it.

## Goal B — ★cp-del (owner approved): delete a picture from a member's gallery

1. `src/lib/server/media/index.ts`: 🚧 `removeFromMemberGallery(db, castMemberId, fileId)` → `boolean` (whether a link was removed). One JSDoc sentence + the P2 line ("the media module owns `cast_member_files`; `addToMemberGallery` adds, this removes"). Deletes the `cast_member_files` link, then deletes the **file** only when nothing else uses it — the same conservative rule as `releaseSpriteFile` (`src/lib/server/sprites/index.ts` ~l.597–628, not ours, read it): no sprite points at it, no character version (card or cast, retired included) has it as `face_media_id`, no other member's gallery links it, it's no card's gallery picture (`files.character_id` set), and it belongs to no session or message (`files.session_id` / `message_id`). Use `deleteFile` from the same module. Pass the handle you are on.
2. `src/lib/server/sockets/characters.ts` `charactersDeleteGalleryImage` (~l.2557–2600): accept `{ castMemberId, mediaId }` beside `{ characterId, mediaId }` (exactly one owner, as the list/upload handlers in this file do — reuse their owner parsing). Member path: the **edit rule** `canEditCastMember` (`src/lib/server/cast/memberAccess.ts`); refused → *"Cast member not found or access denied"* (match the upload handler's member refusal wording if it has one; report the sentence). Removes via `removeFromMemberGallery`; a file not in that member's gallery → refusal *"That picture is not in this cast member's gallery."* Reply `{ success: true, castMemberId }`; then re-send `characters:listGallery` for the member exactly as the member upload path does. Errors carry `galleryErrorKey(params)`.
3. `src/lib/shared/sockets/types.ts`: `Sockets.Characters.DeleteGalleryImage.Params` / `.Response` take `castMemberId?` beside an optional `characterId` (one JSDoc sentence each). **Only that namespace** — another worker (w3) is editing the `Sessions` namespace of this file now; if an `Edit` fails because the file changed, re-read that range and retry; never `Write` the whole file.
4. `EntityGalleryTab.svelte`: the member Gallery tab shows **Delete** for editors (the same `isOwner`/editor gate the member upload uses there) and `confirmDelete()` sends `ownerKey` instead of requiring `cardId`; `handleDeleteOk` accepts the member reply. *Set as avatar* and *Use as likeness image* stay card-only. Update the component's comments that say a member's gallery has no delete.
- Tests: an int test (find `grep -l "deleteGalleryImage\|addToMemberGallery" src/lib/server --include=*.test.ts`, e.g. a `sockets/characters.*gallery*.int.test.ts` or `media/*.int.test.ts`; else add `src/lib/server/sockets/characters.memberGalleryDelete.int.test.ts`): an editor deletes a member picture → link gone, file deleted when nothing else uses it; a file the card also uses (or a sprite) → link gone, file kept; a non-editor is refused and nothing changes; a picture not in the member's gallery is refused. A DOM test for EntityGalleryTab if one exists (`find src/lib/client -name "*ntityGallery*test*"`): a member owner with an editor shows Delete; else say none exists.

## Rules you must follow

- "Sockets: one domain context per event family (provided by both shells) is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`." "An event in `SCOPED_EVENTS` must carry its scope key (`sessionId`, `lorebookId`…) in the payload, or `emitToUser` silently sends nothing." — so every member reply/error of these families must carry `castMemberId` top-level; check the delete reply and error do.
- "`socket.off(event)` with no handler removes **every** listener app-wide; always pass the handler." "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."
- "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."
- "Inside `db.transaction(async (tx) => …)` use only `tx`."
- Deleting a user's picture is data deletion: only the conservative rule above; when unsure whether something uses a file, keep the file.
- New names allowed: `removeFromMemberGallery`, the private extractor helper, `castMemberId` on the delete params — 🚧, one JSDoc sentence each. No other new name, setting, event or table; stop and report if you need one.
- Do what is asked at the size asked; findings go under **Noticed, not done**.
- Prettier: `npx prettier --check` changed files; **only `--write` the lines you changed** — never reformat a whole file. If a file fails only on lines you didn't touch, leave it.

## Files owned (edit only these)

`src/lib/shared/sockets/interest.ts`, `src/lib/shared/sockets/types.ts` (`Characters.DeleteGalleryImage` only), `src/lib/server/media/index.ts`, `src/lib/server/sockets/characters.ts` (`charactersDeleteGalleryImage` only), `src/lib/client/components/sprites/SpritesTab.svelte` (`replyKey` only), `src/lib/client/components/gallery/EntityGalleryTab.svelte`, `src/lib/client/lorebooks/cast/CastMemberForm.svelte` (`OWN_LIST_EVENTS` interest keys only), and tests next to these.

## Tests (Done means)

Run, capped and logged (scratchpad `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/`):
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub; npx vitest run <files> --maxWorkers=2 > <scratchpad>/s4-follow-a-w4-tests.log 2>&1; echo test-exit=$? >> <scratchpad>/s4-follow-a-w4-tests.log'`
Files: your new/changed tests + `src/lib/shared/sockets/scopedReplies.test.ts src/lib/shared/sockets/gatedEvents.test.ts src/lib/client/lorebooks/cast/castMemberForm.dom.test.ts src/lib/client/lorebooks/cast/castMemberFormLater.dom.test.ts` + existing sprite/gallery tests (`grep -rl "listGallery\|addToMemberGallery\|sprites.memberOwner" src --include=*.test.*`). DOM tests run in happy-dom: keep them in this capped scope (a failing assert on a happy-dom element has OOM-killed VS Code). Never pipe vitest into `head`. DB-in-`it` tests need a 60 s timeout.
Then `npx tsc --noEmit -p .` (12G scope, `NODE_OPTIONS=--max-old-space-size=8192`) and `npm run check` after it (same scope). Baselines: tsc has 3 errors from another lane (`sessionPage/requests/index.ts`, `overhearSeat.ts`); check 0 errors / 8 warnings. Report any new ones.

## Report

Final message: changed files, one line each; per goal what changed; the refusal sentences used; every member listener found and what you did; tests with pass/fail counts; tsc/check; Noticed, not done.
