# BRIEF m3b-C-w2 — `answerCreateSession` takes the game's persona; docs for the start form's persona and the world's people

Worker for lane **m3b-C** (supervisor reads your report). Work from `/home/jody/github/serene-pub`. Report to `plans/REPORT-m3b-C-w2-2026-11-05.md`.

"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You never run `sdk:build`; lane m3b-D builds the SDK.)

## Goal
### A. `answerCreateSession` (`src/lib/client/components/sessionPage/requests/navigation.ts` ~139–175)
The SDK's `'create-session'` params gain `persona?: { name: string; description?: string }` (lane m3b-D; final names in `plans/REPORT-m3b-D-2026-11-05.md`): the player the start form offers as a NEW persona. D exports from `@serene-pub/sdk`: `CREATE_SESSION_PERSONA_NAME_MAX = 80`, `CREATE_SESSION_PERSONA_DESCRIPTION_MAX = 2000` (characters, **after trim**). Import them (value import from `"@serene-pub/sdk"`, as `rulesetDocument.ts` does).
Validate after the fields/lorebook checks, refusing in words (throw `Error`, as the function does today):
- `persona` present but `null`, not an object, or an array → `The persona must be an object with a name.`
- `JSON.stringify(persona)` throws → `The persona must be plain JSON.`
- `name` not a string, or blank after trim → `The persona needs a name.`
- trimmed name longer than the name max → `The persona's name is longer than 80 characters.` (build the number from the constant)
- `description` present and not a string → `The persona's description must be text.`
- trimmed description longer than the description max → `The persona's description is longer than 2,000 characters.` (`toLocaleString("en")` of the constant)
Pass only `{ name: trimmed, description?: trimmed }` (an empty description is dropped; other keys are not passed) as `persona` on `deps.panelsCtx.digest.createSession` beside `fields` / `lorebookId` / `fromApplet`. Absent `persona` → no `persona` key. Update the file's 🚧 comment: M3b, the persona is a draft the start form offers; nothing is made until the person's Start.
`src/app.d.ts`'s `digest.createSession` type is NOT yours (the supervisor queues `persona?: { name: string; description?: string }` there). If tsc complains about the extra key, leave it and say so — do not cast it away.

### B. Tests — `src/lib/client/components/sessionPage/requests/navigation.test.ts`
One case per refusal above (each sentence exact), the 80/2,000 boundaries (exactly at the max passes; one over refuses; measured after trim), trimming, the empty description dropped, extra keys not passed, absent persona → no key, a cyclic object → the JSON sentence (note: put the cycle somewhere `JSON.stringify` reaches). Follow the file's existing harness.
Before running: `grep -c CREATE_SESSION_PERSONA_NAME_MAX ../serene-pub-sdk/sdk/dist/index.js ../serene-pub-sdk/sdk/dist/*.js 2>/dev/null | grep -v ':0'` — if the constants are not in the SDK's built `dist` yet, the import is `undefined` at run time: do NOT build, do NOT mock the SDK; finish the code and docs, run the test anyway, and report "blocked on m3b-D's sdk:build" with the result.
Run: `npx vitest run src/lib/client/components/sessionPage/requests/navigation.test.ts` (never pipe into `head`).

### C. Docs (user-facing behaviour; plain words, second person, no code names except in plugins.md)
1. `docs/getting-around.md` §Apps (~141): after "New game opens the ordinary start form with the game's choices already filled in", one or two sentences: a game may bring the person you play as — **Who you play as** shows it marked _New, from the game_, and the confirm reads _Playing as <name> (new)_; it becomes one of your personas only when you press **Start** (it is yours, kept like any persona you write); **Change…** lets you pick one of your own personas instead. A game whose world has its own people may seat them: the confirm then says _Who is in it: the world's own people_.
2. `docs/sessions.md`: the short line at ~327 ("A plugin's game opens from the **Apps** view…") gains one sentence pointing at the above (the game's start makes your persona when you press Start; the world's people join when the game says so; link `./getting-around.md#apps`). Also step 2 of **Start a session** (~16) says an empty name is "named after its cast, such as *Session with Wren*": add that a game's start that brings your persona names it after your persona and the lorebook, such as *Mia in Porto Alto*.
3. `docs/plugins.md` §"Pictures, sound and data that come with a package" or the nearest section about a package's game (read the file; pick the section that already talks about the applet/its genres): ONE sentence on the declaration — a game's session type can declare `castFromLorebook` so that starting it with a lorebook seats that lorebook's own people as the session's characters (switched by one of its yes/no settings when it names one; never a persona card; for a lorebook that comes with a package, only its own people) — and that its `create-session` request may carry `persona` (a name of at most 80 characters and a description of at most 2,000) that the start form offers as a new persona, made only when the person presses Start.
Read each doc's surrounding paragraphs first; match their voice; keep each addition short. Re-read the file right before editing (other programmes edit `docs/`).

## Files owned
`src/lib/client/components/sessionPage/requests/navigation.ts`, `src/lib/client/components/sessionPage/requests/navigation.test.ts`, `docs/getting-around.md`, `docs/sessions.md`, `docs/plugins.md`.
## Files readable
Anything. `plans/REPORT-m3b-D-2026-11-05.md` (D's final names), `../serene-pub-sdk/sdk/src/widgets.ts` (do NOT edit).
## Out of scope
No SDK/server/shared edits; no `src/app.d.ts`; no start-form changes (another worker); no NOMENCLATURE/STYLE-GUIDE edits (the supervisor). No new setting, event or name beyond the sentences above.
## Stop and ask when
CLAUDE.md §Decisions applies, a ★ is unruled, a name is new, or a file outside the set is needed. Put it in your report and do the rest.

## Rules (quoted)
- CLAUDE.md Decisions: "Decide implementation inside the asked scope … name the choice in your report." "Findings along the way go under **Noticed, not done**, never fixed in passing."
- "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."
- "It is a **session**, never a *chat* — except in chat-completions wire vocabulary."
- NOMENCLATURE: a **persona** is "a character the user voices … a **character** with `is_persona` set" — the game's offer is not a persona until Start makes it. R1 one word, one meaning; R3 qualify.
- STYLE-GUIDE §10: "Sentence case everywhere"; "errors say what went wrong and what to do"; "Help is one sentence."
- `docs/<area>.md` is user-facing behaviour; update it in the same change when behaviour moves.
- Tests: "Never pipe vitest into `head`." Targeted tests only.

## Done means
`navigation.test.ts` green (or "blocked on m3b-D's sdk:build" with the run's result); `npx prettier --check` on `navigation.ts` / `navigation.test.ts` (fix only your hunks; never reformat a whole file); report `plans/REPORT-m3b-C-w2-2026-11-05.md`: changed files, choices, tests, questions, Noticed, not done.
