# BRIEF — adv-E: docs, vocabulary and the style guide for advanced controls

Plan: `plans/PLAN-advanced-controls-2026-11-10.md`. Read all of it, including **§ Build rulings**. Then read the lane reports: `plans/REPORT-adv-{A,B,C,D,F}-2026-11-10.md`. Each has a **Wording notes for lane E** section, and those notes are your work list. You are a lane supervisor: read `.claude/guides/multi-agent.md` first. Delegate the typing to at most 2 `lane-worker` agents (suggested split: w1 = `docs/`; w2 = `NOMENCLATURE.md` + `STYLE-GUIDE.md`), and quote into their briefs the rules they need. No code changes in this lane.

## What is true now (describe exactly this; check the code where a report is unclear)

- **The switch.** One per-user switch, **Show advanced controls**, off by default. It is the first card on Settings › User. It replaced *Show all character fields*: that card and the character form's inline *Show all fields* switch are gone. Accounts that had *Show all character fields* on start with advanced controls on, both on upgrade from pr builds and when restoring from 0.5.3. *Easy character creation* is unchanged.
- **Where controls hide, the line says so.** Wherever a form hides something, one line reads *"Some controls are hidden."* followed by the link **Show advanced controls**, which turns the switch on. No such line appears in the lens track, the message menu, the session header or the Author's note.
- **Hidden never means changed.** Stored values stay and keep working. The switch is a preference, never a permission. Admin and the Sampling, Models, Loadouts and Connections views are unchanged. Session settings' **Advanced** fold (P5) is unchanged in both modes.
- **Sessions** (lane B, plus lane F's fixes; read both reports):
  - The start form hides the rules choice and How strict. When the switch is off, the adopted-rules sentence and the "runs in words" hint stay as plain text.
  - The edit form's Settings tab hides Actions, How replies are made, On revision, Rules options, Pipelines, Retake ask and Session data.
  - *Where this session's story stands* is read-only. The owner reads *"Turn on advanced controls to change them."*
  - The session preset switch, the lorebook choice, starter kits, creation modes and start asks stay.
- **The session view** (lanes C and F): *Branch from here* is gone from the message menu. The Layout button, *Customize layout* in the header menu and *Customize layout* in the full-screen menu are gone; everyone keeps their layout. The Author's note hides its depth, its interval and the *Sent as* fold.
- **Characters and lorebooks** (lane D, plus the lead's follow-ups in the plan):
  - The character form shows the common fields only.
  - The entry tuning fold (regex, case, chains, priority, conditions) is hidden.
  - Book settings hides Rules and Calendar. Writes from sessions and the story's present stay.
  - The **Graph** and **Lives** lenses and their Alt+Shift shortcuts (4 and 6) are hidden, and an address naming either opens List.
  - *See in graph* and the *Build graph* buttons are hidden.

## Work

1. **Docs:** update each page named in the reports' wording notes and the plan's item 24.
   - `docs/themes-and-settings.md`: the User tab list (:47), with the new first card and *Show all character fields* removed.
   - `docs/characters.md`: :117 and :123.
   - `docs/sessions.md`.
   - `docs/session-layout.md`.
   - `docs/lorebooks.md`: :69, :101, :119, :123, and see-in-graph/build-graph wherever they are described.
   - `docs/lorebook-time.md`: Calendar, 75-96.
   - `docs/lorebook-cast.md`: :167, *Show as › Lives*.
   - `docs/genre-story.md`: the Author's note.
   - Also any other page that `grep -n "Show all\|Customize layout\|Branch from here\|Graph lens\|Lives"` shows describing a now-hidden control.
   - **How to write it:** say it once per page, plainly, in the house voice. Don't scatter "(advanced)" tags. Follow the existing docs voice and STYLE-GUIDE §6.9 (documentation pages) and §10 (writing).
   - Then run `npm run docs:build`, so `src/lib/generated/docs/` matches.
2. **NOMENCLATURE.md:** read §1, §24, the §25 ledger's row shape (copy a recent row such as "Models view tidy shelf … 2026-11-08") and §23.
   - **Add an `advanced controls` row** with its P6 charter:
     - purpose: keep everyday surfaces short;
     - why: P3/P4;
     - owns: the per-user switch and the hidden line;
     - not: a permission, the admin views, the **Advanced fold** or `advanced: true` on a FieldDecl (both unchanged and shown in both modes; R1, the switch never acts on them).
   - **Add rows** (🚧, 2026-11-10) for:
     - `user_settings.show_advanced_controls`, wire `showAdvancedControls`;
     - `userSettings:updateShowAdvancedControls`, with its `:error`, handler `userSettingsUpdateShowAdvancedControls` and type namespace `Sockets.UserSettings.UpdateShowAdvancedControls`;
     - helper `showsAdvancedControls`;
     - component `AdvancedHiddenLine`;
     - SDK `ViewerV1.advancedControls?` (this replaced the plan's `SessionDossier.advancedControls`; say so);
     - `SessionLorebookReading`'s `lockedByAdvanced`;
     - the lens helpers `lensesShown` and `lensShown`, and `LensTrack`'s `advanced` prop;
     - `ActionListDeps.advancedControls`.
     - Put each where its group lives (§26 Shell for the switch and the line, §9 Session for the session ones, §12 Extensions or the widget area for `ViewerV1`). If no section fits, use the §25 ledger only.
   - **§23 Retired words:** *Show all character fields* / *Show all fields* (the settings card and the inline switch), replaced by **Show advanced controls**. Note that the column `show_all_character_fields` and its event stay unread until the RC1 squash.
   - **§25 ledger:** one entry, *advanced controls — 2026-11-10 (owner GO; PLAN-advanced-controls-2026-11-10, lanes adv-A…F)*.
3. **STYLE-GUIDE.md §6.21 (Notices):** add the **hidden line** pattern. It is one muted line at the foot of a form that hid something: *"Some controls are hidden."* plus the quiet `anchor` link **Show advanced controls** (§6.1). It is static, it counts nothing, and it is shown only when something was actually hidden for this viewer. It is never a toast. Forms keep a hidden editor mounted when its draft lives inside it (the calendar).

## Files owned

`docs/*.md` (only the pages above and any the grep finds), `src/lib/generated/docs/**` (only through `npm run docs:build`), `NOMENCLATURE.md`, `STYLE-GUIDE.md`.

## Out of scope (write down, never build)

Any code; plan files; the reports. Wording you think the UI itself should change goes under **Noticed, not done**.

## Stop and ask when

A report and the code disagree about what's hidden (describe the code, and flag it); a name needs choosing; NOMENCLATURE has a collision under R1.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. Never `git checkout`, `restore` or `clean` in either repo. Never run `prettier --write` on a file.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server". (This lane needs no `sdk:build`.)
- Read `NOMENCLATURE.md` and `STYLE-GUIDE.md` by section (`grep -n "^## \|^### "`, then `sed -n`), never whole.
- Scratch files start with `adv-E-`.

## Done means

- `npm run docs:build` succeeds.
- Any docs tests pass (`grep -rl "docs" src --include=*.test.ts | grep -i -E "docs|help"`; run those in a capped scope: `systemd-run --user --scope -p MemoryMax=4G -p MemorySwapMax=0 --quiet bash -c 'npx vitest run <files>; echo test-exit=$?'`).
- Every row named above exists.

## Report

`plans/REPORT-adv-E-2026-11-10.md`. If the harness refuses the write, put the full report in your final message. Include pages changed, rows added, tests, **Noticed, not done**.
