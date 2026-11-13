# BRIEF s4-tidy-w2 — member pictures in the app: Backdrop page dep (Q1), re-express for members (Q2), member Gallery tab (★sdk2-1)

Supervisor: lane `s4-tidy` (seat-cast S4, wave 6). Repo `/home/jody/github/serene-pub`. Use absolute paths. Report back in your final message; do not write a report file.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You have no reason to run `sdk:build`.)

**Prettier:** `npx prettier --check` changed files; only `--write` the lines you changed — never reformat a whole file. If a file fails only on lines you didn't touch, leave it and say so.

## Rulings this rests on (quote; never reinterpret)

- Owner ★7 (2026-11-08, as recommended): "Member sprite-set editor + portrait/sprite-fill actions taking an owner (card or member) in S4."
- ★sdk2-1 (built as recommended under ★7): a **Gallery** tab on the member page (`CastWorkspace.svelte`) reusing `EntityGalleryTab.svelte` with an owner prop.
- Memory rule: there is ALWAYS a lorebook — never write copy that frames a session as having no lorebook.
- Words: it is a **session**, never a chat. A **character card** is the item; a **cast member** lives in a lorebook.

## Hard rules

- `socket.off(event)` always with the handler. Prefer `declareInterest(...)` releases as the files already do.
- `SvelteSet` / `SvelteMap`, never `$state(new Set())` for mutated collections (don't refactor existing ones you don't otherwise touch).
- Sockets: views register listeners for local state and **never call `toaster`/`notify` for socket results in new code**; the one domain context toasts. (Existing `notify` calls inside `EntityGalleryTab` stay as they are; don't add new ones for member replies beyond mirroring the card path's existing behaviour.)
- Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.
- An event in `SCOPED_EVENTS` must carry its scope key in the payload. Member-form replies are not scoped yet (★cp-scope-1 unruled): member listeners use the **bare** interest key and filter on `castMemberId`, exactly as `SpritesTab.svelte` does for `owner.castMemberId` (read its `ownerKey`, `ours(msg)`, `replyKey()` first and mirror them).

## Goal

### Q1 — Backdrop chooser lists a card-less member's own pictures (from `plans/REPORT-s4-sdk2-2026-11-08.md`, verbatim in substance)

- In `src/lib/client/components/sessionPage/pageAsks.ts` beside `readCharacterGallery` (~416) add `readMemberGallery(castMemberId)`: `awaitReply` on `characters:listGallery { castMemberId }`, replyKey `interestKey("characters:listGallery")`, errorEvent `characters:listGallery:error`, match on `castMemberId`, fallbackError `"that cast member's images could not be read"`; returns `reply.images`. Pass it wherever `readCharacterGallery` is passed (~772).
- `src/lib/client/components/sessionPage/requests/index.ts` (~287): import `MemberGalleryRead` (from `requests/characterImages.ts`, already exported by lane s4-sdk2 — read it, don't edit it) and add to the deps `/** 🚧 A card-less member's gallery (`characters:listGallery { castMemberId }`). */ readMemberGallery?: MemberGalleryRead`.
- Then in `docs/images.md` (~64, where the Backdrop chooser is described) restore: *"Its chooser also lists the pictures of someone in the session who has no character card: their own pictures."*
- Test: extend the existing test for `pageAsks` / `requests` (find it: `grep -rln "readCharacterGallery" src --include=*.test.ts`), or `requests/characterImages.test.ts` if the dep is wired there — a `character-images` request with `{ castMemberId }` reaches `readMemberGallery` and answers its images.

### Q2 — Re-express from neutral for a member's sprites

- `src/lib/server/sockets/images.ts` `imagesDrawingSheet` (~516): add a `castMemberId` branch beside the `characterId` one: the asker may ask when `canEditCastMember` (`src/lib/server/cast/memberAccess.ts`) allows; reply shape as the card branch (`sheet: null, drops: [], castMemberId, expressions`), only an admin sees `sheet`/`drops`; echo `castMemberId`. No sheet is an answer (catch → nothing offered).
- `src/lib/shared/sockets/imageGen.ts`: `ImageDrawingSheetParams` gains `castMemberId?: number | null` and `ImageDrawingSheetResponse` gains `castMemberId?: number`, each with one 🚧 JSDoc sentence like their `characterId` twins.
- `src/lib/client/components/sprites/SpritesTab.svelte` express `$effect` (~700–740, the block that asks `images:drawingSheet` for a card only): replace the card-only block with `releases.push(declareInterest<any>("images:drawingSheet", handleSheet)); socket.emit("images:drawingSheet", ownerKey)` and start `handleSheet` with `if (!ours(msg)) return`. Change nothing else in SpritesTab.
- Then in `docs/images.md`: *"Re-express from neutral is on a cast member's sprites too, for whoever can edit their lorebook, when the image model supports expressions."*
- Tests: server — extend `src/lib/server/sprites/memberReexpress.int.test.ts` or add `src/lib/server/sockets/images.drawingSheet.member.int.test.ts`: an editor of the member's book gets `expressions` with `castMemberId` echoed; someone who can't edit gets nothing offered. Client — extend `src/lib/client/components/sprites/spritesTab.memberOwner.dom.test.ts` (find it): a member-owned tab emits `images:drawingSheet` with `{ castMemberId }` and a reply for another owner is ignored.

### ★sdk2-1 — Gallery tab on the member page

- `src/lib/client/components/gallery/EntityGalleryTab.svelte`: replace `entityId: number` with `owner: { characterId: number } | { castMemberId: number }` (JSDoc: whose gallery; a cast member's gallery is the member's own pictures, `cast_member_files`). Derive `ownerKey` and `ours(msg)` like SpritesTab. Emit list/upload/reorder/previewPortrait/generatePortrait with `...ownerKey` (the server takes `{castMemberId}` on `characters:listGallery`, `uploadGalleryImage`, `reorderGallery` (lane s4-cp) and `characters:previewPortrait` / `generatePortrait` (lane s4-sdk2) — confirm each in `src/lib/server/sockets/characters.ts` and `sockets/portrait.ts` before relying on it). **Card-only, hidden for a member** (not built server-side, not asked for): delete (★cp-del), **Set as avatar** (`characters:setAvatar`), **Use as likeness** (`characters:setLikenessImage`). Member listeners: bare interest keys, filter by `castMemberId`; card listeners unchanged (scoped on `characterId`). `currentAvatarMediaId` stays (null for a member).
- `src/lib/client/components/characterForms/CharacterViewPanel.svelte` ~580: the one mount line `entityId={character.id}` → `owner={{ characterId: character.id }}`. **This is the only edit allowed in that file.**
- `src/lib/client/lorebooks/CastWorkspace.svelte`: add `{ value: "gallery", label: "Gallery", icon: Icons.Images }` to `memberTabs` after Sprites (check `Icons.Images` exists in `@lucide/svelte`; the card page's Gallery tab icon is the one to match — find it in `CharacterViewPanel.svelte`), and a tabpanel `id="cast-member-gallery"` mirroring the Sprites panel (~1987–2003): mounted only while open, `<EntityGalleryTab owner={{ castMemberId: selectedMember.id }} entityName={selectedMember.name} isOwner={!readOnly} currentAvatarMediaId={null} />`. Generate portrait works there for an editor (server side done by s4-sdk2).
- Docs `docs/images.md`, in the portrait/gallery part: *"A cast member's portraits can be generated too. The new pictures belong to the lorebook's owner and stay with that cast member."* Also check `docs/lorebook-cast.md` lists the member page's tabs (it names a Sprites tab, added by lane s4-cp) — **don't edit lorebook-cast.md** (another worker owns it next); tell me the line where a "Gallery" sentence belongs and the sentence you'd write.
- Tests: `src/lib/client/lorebooks/cast/memberPage.dom.test.ts` expects the tab count — update it (six tabs); new `src/lib/client/lorebooks/cast/memberGallery.dom.test.ts` (mirror `memberSprites.dom.test.ts`): the Gallery tab mounts `EntityGalleryTab`, asks `characters:listGallery { castMemberId }`, shows no delete / Set as avatar / likeness for a member, Upload only when editable. Any existing `EntityGalleryTab` DOM test must stay green with the new prop (update its mount props).

## Files owned (edit only these)

`src/lib/client/components/sessionPage/pageAsks.ts`, `src/lib/client/components/sessionPage/requests/index.ts`, `src/lib/server/sockets/images.ts`, `src/lib/shared/sockets/imageGen.ts`, `src/lib/client/components/sprites/SpritesTab.svelte` (express effect only), `src/lib/client/components/gallery/EntityGalleryTab.svelte`, `src/lib/client/components/characterForms/CharacterViewPanel.svelte` (the one mount line), `src/lib/client/lorebooks/CastWorkspace.svelte` (the tab entry + panel only; **don't touch the comment at ~222** — another worker renames it), `docs/images.md`, the tests named above.

**Never touch** (another session is editing them): `src/lib/server/sprites/fillAction.ts`, `src/lib/server/images/**/dispatchImage.ts`, `../serene-pub-sdk/core-catalog/src/shared/portrait.ts`. Also not: `requests/characterImages.ts`, `sockets/portrait.ts`, `sockets/sprites.ts`, `sockets/characters.ts` (read only).

## Out of scope

Member gallery delete, member avatar/likeness from the gallery, scoped keys for member replies (★cp-scope-1), any SDK file, NOMENCLATURE (the supervisor writes canon). No new names beyond `readMemberGallery` (deps field), the `castMemberId` fields above and the `owner` prop.

## Stop and ask (report and stop that part) when

a server event you need doesn't take `castMemberId`; a user-facing word not quoted above is needed (propose it, ★); a file outside the list would change.

## Tests — how to run

Only targeted files, capped, logged:
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub && npx vitest run <files> --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-tidy-w2-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-tidy-w2-tests.log'`
Never pipe vitest into `head`. DB-in-`it` int tests need a 60 s timeout. Also run neighbours: `memberSprites.dom`, `memberPage.dom`, `spritesTab*.dom`, `requests/characterImages.test.ts`, `sprites/memberGenerate.int`, any `EntityGalleryTab`/gallery DOM test.

## Done means

The tests above pass; neighbours green; prettier clean on your lines.

## Report (final message)

Changed files with one line each; tests with counts; decisions; stops; the lorebook-cast.md sentence + line; Noticed, not done.
