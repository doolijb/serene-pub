# DISCUSS LATER — items that need the owner before they can move

Any session picking up `plans/PLAN-programme-2026-11-15.md` reads this file too. An item leaves this list only
when the owner rules on it (then it goes into the programme) or withdraws it. Add new items at the bottom with a
date; never delete one silently.

| # | Added | Item | What is needed from the owner |
|---|---|---|---|
| D1 | 2026-11-15 | **Provisional names and sentences.** Every lane report ends with 🚧 names, receipts, warnings and refusals awaiting a yes (about thirty added on 2026-11-15: `REPORT-time-t5b / t6b / t6c1 / t6c2 / t6f / t7c / t7d`, earlier ones in the plans' ★ lists). SDK 1.0 ships with 0.7, so they become permanent by default. | One naming pass: the lead prepares a single table (name, where, alternative); the owner marks each. |
| D2 | 2026-11-15 | **Whole-repo format.** Most files a lane touches fail `prettier --check`; lanes may not run `--write`. | A moment when nothing is in flight in either repo, and a go. |
| D3 | 2026-11-15 | **Managed model processes on Windows and macOS** are mock-tested only (`processTree`, the watchdog). | Whether someone can run the real path on each OS before 0.6 goes wider, or it ships as is. |
| D4 | 2026-11-15 | **Icon artwork.** The icon set's body is 99% opaque (alpha 251–254), which is what broke the Linux tray; the launcher now snaps alpha (`launcher/internal/tray/icon.go`). | Re-export `static/icon-x*.png` with a fully opaque body (then `go generate ./assets` in `launcher/`), or keep the snap. |
| D5 | 2026-11-15 | **Launcher rebuild** so the tray fix reaches a running install. | When to build and restart. |
| D6 | 2026-11-15 | **Auto-advance in Story**: plain on / off, or keep *Next turn* / *Whole round* as Story's own option (a user-facing choice is removed otherwise). | The choice. Blocks lane 2.3's last step only. |
| D7 | 2026-11-15 | **Line picker modal, "extend the lines in either direction"**: what extending creates (lead's reading: forward = a new line from the chosen point; backward = reading from before the line's first dated entry). | Confirm or correct. Blocks lane 2.5's design. |
| D8 | 2026-11-15 | **A preset's values are copied into a session** at creation and on switch, so later preset edits do not reach running sessions. | Whether that should change (behaviour change). |
| D9 | 2026-11-15 | **Open ★ of today's lanes** that are behaviour, not names: ★T7D-1 (how the delta prints), ★T7D-2 (free-form: finer parts empty vs an under / over marker), ★T6F-2 (a closed scene with no lines and no stored cast is left out for everyone), ★T6C2-5 (a notes tie counts as the nearest line), ★S6-b (each dead setting), ★S8-a/b (who may stop a run; finished runs linger). | A yes / no each; the lead's recommendation is in the report or plan named. |
| D10 | 2026-11-15 | **Older open ★ lists**: sensible engine ★S1–S9, speech ★1–★15, card stats ★C1–C5, visual novel ★6–★10 / ★B–★D, Mundi ★M3-3/4, story playtest ★S8/★R (see MEMORY.md). | A pass when the owner wants one. |
