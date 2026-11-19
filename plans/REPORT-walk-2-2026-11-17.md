# REPORT — second UI walk (2026-11-17 evening): today's changes on the built app, three accounts, no model

Isolated instance of the build on port 5289, fresh empty data directory in the session scratchpad; stopped with SIGTERM ("Database closed and flushed; shutdown marked clean."); data deleted. Three browser contexts: Owner (administrator), guest1 (member), admin2 (administrator guest). Screenshots: `/tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad/walk-1117b/shots/`.

Setup notes: accounts turn on with **one press**; a new user can be made an administrator only after their first sign-in; first-run "What should we call you?" creates no persona.

## Works

Personas groups per person; guest switches appear only after guests are added; add-for-someone; the owner's card given to a guest and saved; **Played by** names; Mara handed to a guest and back; drag to Benched and back; phone width: no horizontal scroll, the panel stays put on a low switch; guest: other groups read-only, takes and hands back a card-less member, **Shared with you**, no "Users List failed", no View lorebook / Settings / Pipelines, nothing false beside an AI-run seat; guest holding the owner's card writes and edits as it, has no card editor; member has no Prompt details, no Inspect run, no token count; core starters read-only with the sentence and Clone; Duplicate works; all four earlier phone fixes hold.

## Defects, worst first

1. **A cross-group drop deletes the seat from the unsaved list** (not refused and restored): Owner's persona dropped onto guest1's group, and Tobin dropped into Owner's group (shots 09, 10, 11).
2. **A member reads the administrator's failure text**: failed rows and the pill show "No model is set for Reply… Use in Reply beside a model in Connections.(Error)"; no "An administrator can see the details."; the step name "Look back over the story · finished" is visible (26, 28).
3. **No speak-as picker** for a person holding several seats; the owner always writes as "Owner" (23).
4. **The character picker lets one cast member be seated twice** (two "Played by, Wanderer") (07); Details › Cast then leaves Wanderer out.
5. **A shared-card copy duplicates the name and the card is offered again**; lines and the scene show two indistinguishable Tobins (18).
6. **The notes book says "Not read by a session"** while the session reads it (37).
7. **The scene cast counts failed rows as speech** (Mara listed through two failed rows) and lists Tobin twice (36).
8. **Raw `{{char:1}}`…`{{char:7}}`** under each name in a starter's cast list (40).
9. Details shows "You: Owner, Tobin" to the guest.
10. The guest's own group has no **Add a seat** field although the switch text says guests can name a seat.
11. Failed rows stack (Send + Continue left two), and one failure shows four times (row, pill, card, toast); each failed row ends with a literal "(Error)" (25).
12. Keyword remove buttons and "Add…" are live in a read-only starter entry and do nothing (32).
13. Toasts cover the composer.
14. Clone of a starter makes another starter; Save as starter gives no feedback; three books named "The Ninth Mile (copy)" (33, 38c).
15. "story clock.You can" missing a space (42a).

Also: **Add a cast member** never appeared in any group; persona-group seats have no "No one" choice (the cross-kind move, MV2); the header avatar stack is clipped; Escape closes the whole dock panel; core starters sit under "Your starter lorebooks".

## Console and server

`derived_inert` ×6 (session settings, lorebooks); one `PasetoDecryptionFailed` with stack right after accounts were turned on; `DispatchError: No model is set for Reply` logged with full stack.

## Could not test

Prompt details and token count for an administrator guest (no successful reply without a model); "the owner cannot send as the card while a guest holds it" (no speak-as picker); plugin lorebooks (none on a fresh pub); Chronicle (no timeline).
