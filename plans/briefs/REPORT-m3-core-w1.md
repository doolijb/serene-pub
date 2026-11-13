# REPORT m3-core-w1 — a provided book is readable pub-wide (server)

Status question: none relayed.

## Changed files
- `src/lib/server/plugins/providedMarks.ts`: new `providedBooksReadableBy(db, userId, lorebookIds?)` after `isNewAttachOfDisabledBook`, as specced (one select, JS filter; no db import). Import line gained `and`, `isNull`.
- `src/lib/server/utils/ownedBook.ts` `lorebookAccessFor`: after owner/shared/admin, a live provided book answers `"shared"`; `LorebookAccess` doc line added. `findOwnedBook` untouched.
- `src/lib/server/sockets/lorebooks.ts` `buildLorebooksList`: `providedIds` (books only), third arm of the `or`; comment updated. Import added.
- `src/lib/server/sockets/appletLibrary.ts` `runLibraryLorebooks`: same third arm; comment updated.
- `src/lib/server/sockets/sessions.ts`: `checkLorebookOwnership` first line + import only.
- `src/lib/server/sockets/entries.ts` `entries:sessionEntries`: `ownerOnly` skipped for a live provided book. Import added.
- New `src/lib/server/plugins/providedBooksPubWide.int.test.ts` (4 tests): decider unit cases; listed/read/entries/applet door (`canEdit:false`)/attach via sessions:create, sessions:update, applet attach-lorebook/refused lorebooks:update + entries:create (LOREBOOK_NOT_FOUND)/sessionEntries not ownerOnly/write-mode equality; disabled + ownerless invisible; primer row listed (`readOnly` truthy, `bookAccess: "shared"`), readable, attach still refused with the kit sentence.
- Old rule changed in `src/lib/server/lorebooks/starterKits.int.test.ts` (~l.669): "a non-owner's list is all `kind === "book"`" -> "`kind === "book"` or `provided`" (live primer rows now listed). The admin-kit non-visibility assertion (l.666) is unchanged and still passes.

## Tests
New file 4/4 pass. Done list (providedBooks, providedPrimers, primerRowReadOnly, appletLibrary, lorebooks.readerAccess/bookSettings/mutationScoping, content.interestGate, sessions.ownBookCreate/creationModes, starterKits, library/writes, auth/actingPerson): 13 files, 255 tests, all green after the one starterKits edit. No pin moved (interestGate unchanged).
`tsc --noEmit`: no errors in my paths. `prettier --check`: warns on all 8 touched files (I did not run --write; I did not probe whether pre-existing).

## Assumptions
- Seeded the plugin's book by direct insert (plugins row + mark with matching uuid) rather than the file sync; the primer via `syncProvidedPrimers`.
- `readOnly` on a primer row is an object (`{pluginName}`), asserted truthy.
- Refusal of a primer attach at `sessions:create` comes back as `{error}` in the response, not a throw.

## Noticed, not done
- `sessions:create` with `creationMode === "new-world"` uses `assertReadableBook`, so a provided book is now copyable there (intended by "read and copy"); a primer row there is still refused by `kitReadRefusal`.
- Other readers using `findOwnedBook`/own `userId` checks for reads (jump.ts, summarize.ts, per brief) were not touched.
- Prettier warns on every file I touched; likely pre-existing repo state.
