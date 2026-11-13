# BRIEF lay-W-w3 — a stage of portraits stays a corner, not the whole zone (2026-11-06)

Lane lay-W (supervisor: lay-W). Worker: lane-worker (Sonnet). App: /home/jody/github/serene-pub.

"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
"Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`."

## Goal
After lay-W-w1, a Fit panel measures its widget's natural height (the host un-constrains the box for one read and
reads the root's rect, so a root's own `max-block-size` is honoured). On a phone (390x844) a Scene Portraits **stage**
(the common layout's *Last character* / *Last persona*, always a Fit panel in the shipped layouts) now wants its picture's
full natural height (≈ 540px at 350px wide), and the Fill panel above it (Scenario / World) is squeezed to its tab strip.
Cap the stage: the widget's root, when `data-arrangement="stage"`, never draws taller than 40% of the small viewport
height. At 1440x900 that is 360px (natural there ≈ 383px — nearly unchanged); on a phone ≈ 338px.

## Files owned
- `src/lib/client/styles/widgets.css` (§scene-portraits only)
- `src/lib/client/styles/widgets.parts.test.ts`

## What to build
1. In widgets.css §scene-portraits, right after the "A stage: the first two, large, side by side …" rule for
   `[data-widget-part~="scene-portraits.stage"]` (≈ line 6080), add one rule with a two-line comment ("A stage never
   takes more than 40% of the screen's height: in a Fit panel its picture's natural height would crowd out the panel
   above it, on a phone the whole zone."):
   ```css
   [data-widget-part~="scene-portraits.root"][data-arrangement="stage"] {
   	max-block-size: 40svh;
   }
   ```
   Keep it inside `@layer sp-widgets`. No other change. Don't touch `height: 100%` on the root.
2. Add one test to `widgets.parts.test.ts` (same `leafRules` helper): a leaf rule whose selector names
   `scene-portraits.root` and `data-arrangement="stage"` sets `max-block-size: 40svh`. Strings/booleans only.

## Rules (quoted)
- widgets.css header: "Every rule sits in the cascade layer `sp-widgets` … anything UNLAYERED beats it whatever its
  specificity: a style preset row or a person's own style … always wins over the default." (So a person's style can
  lift the cap.)
- STYLE-GUIDE §6.16: style by part (`[data-widget-part~="…"]`), the markup carries no look.
- No new part, token or custom property.

## How to run (capped scope, never bare; log to a file)
```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub && timeout 900 npx vitest run src/lib/client/styles/widgets.parts.test.ts src/lib/client/styles/widgets.fill.test.ts src/lib/client/styles/widgets.narrow.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/8810127e-6750-4726-9a7d-7b92f1fb52cd/scratchpad/lay-W-w3-t.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/8810127e-6750-4726-9a7d-7b92f1fb52cd/scratchpad/lay-W-w3-t.log'
```
then `grep -E "Test Files|Tests|FAIL|×|test-exit" <log>`. Never pipe vitest into `head`. `npx prettier --check` the test file.

## Out of scope / stop and ask
Everything else. Stop and report if the cap seems to need anything beyond this one rule.

## Done means
Tests green in a capped run. Report: the line range of the new rule, test counts.
