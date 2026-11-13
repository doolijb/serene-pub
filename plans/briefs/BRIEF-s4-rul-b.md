# BRIEF — lane `s4-rul-b` (2026-11-10) — the cast member form in tabs, like the card editor

Supervisor: read `.claude/guides/multi-agent.md`, then `plans/briefs/BRIEF-s4-common.md` (its note about a dev server on :5199 is stale: today the **owner's** `vite dev` runs on :5173, so **no `sdk:build`**; date your report 2026-11-10), then this file, then the last two bullets of `plans/PLAN-sdk-creation-seams-2026-10-30.md`. Then `plans/REPORT-s4-follow-a-2026-11-09.md` goal 8 (cp-10: post-history instructions, creator notes, likeness own-or-follow) and `plans/REPORT-s4-follow-b-2026-11-09.md` (sprites cascade, voice copy, card / card-less save parity). Read STYLE-GUIDE's sections on tabs, forms and the shell before any UI change, and `docs/lorebook-cast.md` / `docs/characters.md` for what each page says today.

## Owner's words (quote them; never reinterpret)

- ★a-4, vetoed. Asked where the three cp-10 blocks should go, the owner answered: *"tabs like card, should probably adapt and reuse the same component/forms"*.
- Cascade principle (2026-11-09): *"Cast by default cascades… a card is a seed, not the sole carrier… not having a card doesn't make them 2nd class."*

## Goal

`src/lib/client/lorebooks/cast/CastMemberForm.svelte` (~1786 lines) becomes a tabbed form **like the card editor** (`src/lib/client/components/characterForms/CharacterForm.svelte` ~334–392 and ~1439–2290: `PanelTabStrip`, `FORM_TABS` Profile · Voice · Notes · Likeness · Speech · Stats, `TAB_FIELDS` so a tab marks itself when a field inside it fails, `hidden={activeFormTab !== …}` panels).

- **Same tabs, same labels, same order** wherever the member has the same fields. Post-history instructions in Voice, Creator notes in Notes, Likeness in Likeness, voice/speech in Speech, as on the card. Each card-followable field keeps its **Use from card** switch; a card-less member gets just the fields.
- **Reuse, don't copy.** Where a tab's body on the card is inline markup, extract it into a component both forms use (props for the owner — card or member — and the follow switch), so the card editor and the member form draw the same fields from one place. `LikenessTab` and `VoiceTab` are already shared; follow their pattern (follow-a gave `LikenessTab` a 🚧 `owner` prop). The card editor must look and behave **exactly** as before: its existing DOM tests are the guard.
- **What only the member has** (From the card, Status in world, amendments, Use from card banners, anything else on the member form today): place each in the tab it belongs to, and propose the placement as ★ with your recommendation, built as recommended. Nothing is dropped.
- Validation: a failing field marks its tab, as on the card.
- Member-page-level tabs that already exist (Gallery, Sprites; `sdk2-1`) stay where they are unless the form's tabs make one redundant; then propose, don't merge.

## Files owned

- `src/lib/client/lorebooks/cast/CastMemberForm.svelte` and new components it needs under `src/lib/client/lorebooks/cast/` or `src/lib/client/components/characterForms/`
- `src/lib/client/components/characterForms/CharacterForm.svelte`: **only** to replace inline tab bodies with the extracted shared components; no behaviour change
- `src/lib/client/lorebooks/cast/memberDraft.ts` only if a field moves between components
- `docs/lorebook-cast.md` (the member page section), `STYLE-GUIDE.md` only if a pattern rule moves
- DOM tests next to these (new ones for the member tabs; the card form's existing tests must stay green unchanged)

Not yours: anything server-side, `StartSessionForm.svelte`, `state/**`, `media/**`, anything named overhear or hidden stats (lanes s4-rul-a / s4-rul-c may still be running or just finished: re-read any shared file from disk before editing). serene-pub-43 owns image generation: stay clear of `dispatchImage.ts`, `imageGen/**`, `matting.ts`, `KoboldCppManagedAdapter.ts`, `sprites/fillAction.ts`, `characters/portrait.ts`, `registrations/unserved.ts`, `runProgress.svelte.ts`. No SDK changes.

## Stop and ask when

The common brief's Decisions apply; a field would be dropped or change behaviour; the card editor's look or behaviour would change; a new name beyond component file names.

## Done means

- DOM tests: the member form shows the card's tabs; each cp-10 field sits in its card tab with Use from card (carded) or plain (card-less); a failing field marks its tab; saving still sends the same payload as before (compare with `memberDraft` tests).
- Existing `CharacterForm`, `LikenessTab`, `VoiceTab`, `CastMemberForm`, `memberDraft`, `memberOwned` tests green (capped scope per the common brief).
- `npm run check` and `npx tsc --noEmit -p .`: no new errors.
- **Prettier: only the lines you changed.** No whole-file `--write` on either form.
- Run a `scope-reviewer` on your diff before reporting; answer each finding once.
- Report: return it in your final message; the lead saves it as `plans/REPORT-s4-rul-b-2026-11-10.md`.

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.*
