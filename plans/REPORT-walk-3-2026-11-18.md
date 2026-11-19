# REPORT — third UI walk (2026-11-18): last evening's changes on the built app, two accounts, no model

Isolated instance of the build on port 5290, fresh empty data directory in the session scratchpad; stopped with SIGTERM ("Database closed and flushed; shutdown marked clean."); data deleted. Screenshots: `/tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad/walk-1118/shots/`.

## Works

Seat move with **Played by** both ways (inline confirmation, *Moves on Save*, persona ↔ AI, earlier lines keep name and face; a guest's persona to the AI); a cross-group drop returns the seat; Benched and back; the confirmation fits at 400 px. Guest: "You:" lists own seats, card-less characters in Details › Cast, **Shared with you**, cannot write as a moved persona and still edits earlier lines. Locks on an entry, a scene and a cast member with help and list marks; still editable. Scene Edit history rows with names; Restore disabled with unsaved changes. Prompt rows with **Read the wording**; none for a guest. A member's failed row and pill read the generic sentence only; readiness line "No model is set up to reply. Ask your administrator." Starters read-only, no keyword controls, no `{{char:N}}`; a session started from a starter holds the copy in its notes and the starter is unchanged. No story dates with the timeline off; notes header "Read by ‹session›". Earlier phone fixes hold.

## Defects, worst first

1. **Scene restore after a Save is reverted by the next Save.** After a Save the scene form still says *Unsaved changes*; a following Restore applies on the server (a "Restored" row appears) but the Present list does not refresh; pressing Save again quietly reverts the Restore. Restore from a freshly loaded form works (`04-restore-after-save-stale.png`, `04-restore-reverted-by-save.png`).
2. **A member sees model wording in composer › More › What can be attached:** "No model is set for Reply… Use in Reply beside a model in Connections." (`06-guest-attach-plumbing.png`).
3. **Duplicate or missing seats after moves:** the session header's Cast strip reads Mara, Wren, Tobin, Wren, Tobin and a card-less member is missing (survives reload, `01-header-avatars.png`); the scene's lines tooltip lists a name twice; in the notes cast list a character moved to the AI still reads "your persona" (`03-cast-list-lock.png`).
4. **Phone:** at 400 px, after loading `/sessions` directly, **Start** and **Open session** land on Home's "Get started"; navigating from inside the app works (`07-inn-phone-open.png`). Resizing to phone width also sent the page to `/`.
5. **"No session is reading this book"** on a new entry in a session's notes, beside the header "Read by ‹session›" (`03-entry-no-session-reading.png`).
6. Server log: when a guest opens a starter entry, 11 × `entries:redlines: Entry not found or access denied` and `bindingSuggestions:list: Lorebook not found` (requests that should not be sent).
7. After the round trip a persona is listed in both Details › Cast and "You:" (`01-details-wren-twice.png`).
8. A locked cast member has no mark in the *Everything* list (`03-everything-list.png`).

Also: the administrator's own failed row reads "The reply could not be generated. An administrator can see the details." plus the detail line (odd for an administrator); no progress card was seen for either role; seating the owner's card as a guest's persona flags the card as a **Persona**; the admin's Created date shows the day before on a fresh database; the Lorebooks view heads the pub's books "Your starter lorebooks" for the owner and "Ready-made" for a member; one `derived_inert` warning; `PasetoDecryptionFailed` once at the sign-in switch.

## Not tested

The reader's read-only lock line (needs a shared lorebook with a locked entry); anything that needs a model.
