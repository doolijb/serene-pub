# BRIEF s4-tidy-w3 — Scene Portraits for card-less cast members (SDK core-catalog widget)

Supervisor: lane `s4-tidy` (seat-cast S4, wave 6). SDK repo `/home/jody/github/serene-pub-sdk` (app `/home/jody/github/serene-pub`). Use absolute paths. Report back in your final message; do not write a report file.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.*

**In this task: do NOT run `sdk:build` or any build of core-catalog at all.** Another session is editing `core-catalog/src/shared/portrait.ts`; the supervisor clears the build with the lead and runs it. Never `git checkout` / `restore` / `stash` in the SDK repo (most of it is uncommitted). Never touch `core-catalog/src/shared/portrait.ts`.

**Prettier:** `npx prettier --check` changed files; only `--write` the lines you changed.

## Background

A **card-less cast member** is someone seated in a session who has no character card (owner rulings 2026-11-05 "Everything in session is cast → active card"; ★6/★4, 2026-11-08). In the `characters` section the host sends such a member with `cardId: null`, `castMemberId: <id>`, `characterId` ⏳ (0 or a stand-in until S5), and a `ref` (`seated-member:<id>`). Lane s4-sdk2 fixed the **Backdrop** widget for them (`/home/jody/github/serene-pub-sdk/core-catalog/components/shared/backdrop/BackdropWidget.svelte`): galleries keyed by the member's `ref`, and a private `nameOf(m)` that names the gallery to the host as `{ castMemberId }` when `m.cardId === null && m.castMemberId != null`, else `{ characterId: m.cardId ?? m.characterId }` — never both. Read that file's `nameOf`, its gallery map and its `character-images` request first, and its test `/home/jody/github/serene-pub-sdk/sdk-tests/coreBackdropComponent.test.ts`.

The SDK `character-images` widget request takes `{ characterId?, castMemberId?, cursor? }` — exactly one owner (`sdk/src/widgets.ts`, typed by s4-sdk2). Modder rule (owner 2026-11-08): plugins never parse ref strings — key by `ref` as an opaque string, never split it; typed, host-filled fields decide.

## Goal

`/home/jody/github/serene-pub-sdk/core-catalog/components/shared/scene-portraits/ScenePortraitsWidget.svelte` ~98–180 keys galleries by `cardOf(p) = p.cardId ?? p.characterId` and asks `character-images` by `characterId` only, so a card-less member's chooser asks the wrong owner (or card 0). Make the same change as Backdrop:
- galleries (`galleries`, `asking`, `nextPage`, the chosen-image lookup ~150–180, the chooser pages, the ⋯ "more" button ~406) keyed by the member's `ref`;
- the request names the owner through the same private `nameOf` rule (`{ castMemberId }` for card-less, else `{ characterId }`).
- **Leave the sprite-set menu (`changeSpriteSet(cardOf(member), …)` ~88–95, ~302–312) as it is** unless the host already hides it for card-less members — check what `canChangeSpriteSet` is for a card-less member (app side: `grep -rn "canChangeSpriteSet" /home/jody/github/serene-pub/src/lib/server`) and report; don't change sprite-set behaviour.
- Check `set-chosen-image` (what it sends for a member — grep the widget and `sdk/src/widgets.ts`): if it needs a card and a card-less member can't be served, **report it, don't invent a new param**.
- Keep `cardOf` only if something still needs it; mark anything ⏳ that is.

Test: extend `/home/jody/github/serene-pub-sdk/sdk-tests/coreScenePortraitsComponent.test.ts` (or a new `coreScenePortraitsCardless.test.ts` modelled on `coreBackdropComponent.test.ts`): a card-less member's gallery is asked by `{ castMemberId }` (no `characterId`), a carded one by `{ characterId }`, and its chosen image is found. These tests mount the **built** module (`core-catalog/dist/components/scene-portraits.js`), so you **cannot run them yet** — write them, typecheck them (`cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsc --noEmit`), and say so. The supervisor builds and runs them.

## Files owned (edit only these)

- `/home/jody/github/serene-pub-sdk/core-catalog/components/shared/scene-portraits/ScenePortraitsWidget.svelte`
- `/home/jody/github/serene-pub-sdk/sdk-tests/coreScenePortraitsComponent.test.ts` or the new test file

## Out of scope

Any other SDK file, INTEGRATING (unless the widget's documented behaviour changes — then propose the sentence in your report), spec pins/goldens, the app repo, `portrait.ts`.

## Stop and ask when

a new param or name would be needed; a golden or spec hash would move; anything outside the two files.

## Done means

The widget change and the test, `sdk-tests` typecheck clean (or only pre-existing errors — list them), prettier clean on your lines. Report: changed files, what you checked about sprite sets and `set-chosen-image`, the exact command the supervisor should run after the build, Noticed, not done.
