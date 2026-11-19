# REPORT — UI walk of the built app, no model (2026-11-17)

Production build (`build/`, 07:53) on a fresh empty data directory in the session scratchpad, port 5288, no model, no child processes. Stopped with SIGTERM ("shutdown marked clean"); the data directory was deleted afterwards. **Slip:** `AUTO_OPEN_CLIENT=false` was not set, so the server opened one tab in the owner's default browser at :5288 (dead now).

Setup: first run → accounts on → second user `guest1` in a second browser context.

## Works as described

Keep a timeline switch, help and date line (4 March 1850 → Monday); the Lair's sentence; start with no model stops in words ("Sessions can't reply yet. The Reply loadout has no model."); lorebook delete refusal (words, session link, Close only); the two guest switches, pushed live to the guest; guest has no Settings, Runs, notes, Pipelines, admin; prompt row with **Read the wording**; per-pipeline knowledge switches; **Not common knowledge** / **Known by** / **Knows**; step-time-limits card and its three notices (admin only); Inspect run (owner only).

## Defects, ranked

1. **D1 — Phone: the start form goes blank and stays blank.** At 400 px, Sessions → New → tap the *Keep a timeline* label: the panel dialog (`overflow:hidden`, `fixed inset-0`) scrolls by 1120 px and nothing brings it back. Cause seen: the switch's visually hidden `<input>` (`position:absolute`, no positioned ancestor inside the scroller) sits outside the inner scroller; focusing it scrolls the fixed dialog. Other switches low in phone panels are likely affected.
2. **D2 — "Users List failed" toast for a guest** opening Participants (server: `users:list Unauthorized`).
3. **D3 — A lorebook opener for a guest.** Session details still offer **View lorebook** (button and ⋯ item) → empty Lorebooks view + toast "Entries Counts failed — Lorebook not found."
4. **D4 — Wrong seat label.** The guest's list calls the owner's AI-run character "A player's character" (`seatPlayerWords` in `EditSessionForm.svelte` ~1206 falls back to that when the seat's user is the owner).
5. **D5 — The start-date line contradicts invalid fields**: still says "The story begins today, …" above an invalid date.
6. **D6 — The Pipelines card's Prompt goes stale** after a change in the prompt row, until reload.
7. **D7 — Dungeon Crawler never shows the "always keeps story time" sentence** `docs/sessions.md` promises (no Lorebook card at all).
8. **D8 (unclear) — no way for a guest to take an unplayed card-less seat** the owner seated, with the take switch on. May be by design (`castToTake` lists free members; a seated one is held), but the help sentence promises a take.
9. **D9 — Cast-member tab strip truncates to single letters at phone width.**

## Minor

- A common-knowledge entry reads "Known by 0" while its row says "Knows it: common knowledge".
- Entry inspector says "No session is reading this book" while the header says "Read by Book Session".
- After following the delete refusal's session link: 4× Svelte `derived_inert` console warnings.

## Noticed, not done

- "Set passphrase and turn on" sets the passphrase but leaves accounts off; a second press is needed.
- Admin › Users shows the seeded admin as created the day before the pub was made.
- "Add guests" dialog has no accessible name; lorebook rows are announced as "Go to lorebook - ID 4".
- The Reply card repeats "Use this source" 10 times and "Most relationships" 3 times under identical labels.
- New lorebook dialog still says "You can turn it on later" after Keep a timeline is switched on.

## Could not test without a model

Any reply, Prompt details on a generated message, what the knowledge and scene switches filter, summaries, the run inspector on a real turn; an admin who is not the session's owner (two accounts only); scene name / Places / Chronicle for a guest (no scene yet).

Screenshots: `/tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad/walk-1117/shots/`.
