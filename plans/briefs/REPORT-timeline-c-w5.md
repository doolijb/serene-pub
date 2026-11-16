# REPORT — timeline-c-w5

Status question: none relayed.

## Changed files
- docs/sessions.md: new section "A timeline for a new session" (preset/genre default, what is unchanged, the offer, its three cases, Start always allowed, Create a lorebook asks Keep a timeline); "Where the session reads its lorebook" now covers the read-only Line, real-time messages, Summarize without History entry, the page re-reading on a flip.
- docs/genres.md: one paragraph "A genre expects a timeline, or doesn't" (default by story time; preset may override; mandate for the Lair and Dungeon Crawler; lorebook decides afterwards).
- docs/genre-story.md: Minimal row clause corrected ("On a lorebook with a timeline..."), plus its own notes start without one.
- docs/lorebook-time.md: "Setting the switch" (start screen's New lorebook now asks) and "What you won't see" (read-only Line variants, session clock/history choices, still-drawn-but-refused items; Edit Session's notes-reading clock not documented as hidden).
- NOMENCLATURE.md: Timeline row (Does not own corrected; built facts and names); keepsTime row (derived default, timeline mandate, preset's timeline default, what each is not); no separate PresetDefaults/genreFields row exists for this, so nothing added there; new §25 entry at the end.

## Collisions
None. Each new name grep'd in src, sdk/src, core-catalog/src: only lane timeline-c's own uses (looseEnds.ts `timeline?` is lane b's).

## Docs now wrong elsewhere / Noticed, not done
- Not checked beyond my five files: docs/summarization.md line 32 (Scene needs a History entry) is now wrong with the timeline off; docs/session-layout.md (Chronicle widget) and docs/genre-lair.md / genre-dungeon-crawler.md may deserve a mandate sentence; docs/lorebooks.md Session notes section on defaults.
- `npx prettier --check` reports the four docs as unformatted; I did not verify whether that predates my edits (they were already modified in the tree), and did not run --write.
- Sessions.md section placed between "Start a session" and "How it starts"; the Story-Living/Rule Based/Lair claims follow the brief's facts, not a code read.
- Assumption: the genres.md anchor `#the-basics` in sessions.md links to the existing "The basics" heading.
