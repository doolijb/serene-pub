# BRIEF — s4-follow-a worker w6 (2026-11-09): the member form owns or follows post-history instructions, creator notes and likeness (client + the cp-10 ripple)

You are a `lane-worker` under supervisor lane `s4-follow-a`. Repo `/home/jody/github/serene-pub` (SvelteKit 5, Svelte 5 runes, TS, Vitest 4 + happy-dom, Skeleton 5, Tailwind 4). Use absolute paths.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no sdk:build.)

## What the previous worker (w5) built — the wire you build on

`RETOLD_FIELDS` (`src/lib/shared/lorebooks/retold.ts`) now has `postHistoryInstructions`, `creatorNotes`, `likeness` after `face`; `true` = the member's own value, absent/false = the card's (followed). The member row (`Sockets.Lorebooks.CastMemberRow` / `CastRowVersion`), `baseColumns` (`CastVersionColumns`) and `lorebooks:updateBinding`'s `lorebookBinding` carry:
- `postHistoryInstructions: string | null`
- `creatorNotes: null | { text: string; lang?: string; variants: Record<string, string> }`
- `likeness: null | { imageMediaId?: number; prompt?: string; negative?: string }`
The server keeps the member's own value while the flag is off (hides, never discards — NOMENCLATURE §8 retold: "Switching a field off **keeps** its text"). It refuses a bad shape in a sentence.

## Goal A — the ripple of the wider `RETOLD_FIELDS` (lead approved these files 2026-11-09: exact-string edits only, limited to what cp-10 requires)

1. `src/lib/server/cast/memberAsRead.ts` ~l.351 `PROFILE_FIELD_OF`: add `postHistoryInstructions: "postHistoryInstructions"`, `creatorNotes: "creatorNotes"`, `likeness: "likeness"` (this is a runtime fix: `followsCard` on rows is built from it). Update the expectations in `src/lib/server/cast/memberAsRead.test.ts` (3 tests: `followsCardFields`, `layerMemberAsRead`) and `src/lib/server/cast/memberAsRead.int.test.ts` (1: the `bindingsForCharacter` followsCard payload) to the 10 fields, and **add one test** that `followsCard` is right for the three: a carded member that owns post-history instructions (flag on) does not list it, and still lists `creatorNotes` and `likeness`.
2. `src/lib/server/sockets/amendments.ts` ~l.1068 `columnsOfMemberRow` / `VersionColumns`: add `postHistoryInstructions: null`, `creatorNotes: null`, `likeness: null` (what tsc asks; nothing more).
3. `src/lib/client/components/characterForms/castBannerWords.ts` `RETOLD_FIELD_WORDS` (~l.47) and its field type / display order (~l.16–60): add `postHistoryInstructions: "post-history instructions"`, `creatorNotes: "creator notes"`, `likeness: "likeness"`; order after the card form's prose fields, the face last as the comment says (decide likeness before or after face and say which).
4. Fixtures: `src/lib/client/lorebooks/cast/castVersionRead.test.ts` ~l.16 and `src/lib/client/lorebooks/cast/memberPageVersions.dom.test.ts` ~l.89 gain the three fields (null).

## Goal B — ★cp-10, the member form (owner approved 2026-11-09)

Owner note on sdk2-1: *"Character card and cast editors should be the same, with additions for whatever the lorebook might provide."* Cascade principle (owner 2026-11-09): *"Cast by default cascades."* · *"a card is a seed, not the sole carrier."* · *"not having a card doesn't make them 2nd class."*

1. `src/lib/client/lorebooks/cast/memberDraft.ts`: `MemberDraft` gains `postHistoryInstructions: string`, `creatorNotes: { text: string; lang?: string; variants: Record<string,string> } | null` (or the text-only shape you need — keep the variants the row had; never drop them on save), `likeness: LikenessDraft` (`{ imageMediaId?, prompt, negative }` from `LikenessTab.svelte`); `memberDraftOf(row)` reads them from the row; `retoldPatch` / `memberPatch` send them (plus the flags); `sameMemberDraft` compares them; `canonicalRetold` handles the three new keys; `draftFollowsRow` stays right. Tests in `memberDraft.test.ts`: round trip; a draft with the flag off still sends its kept value; no change → no patch.
2. `src/lib/client/components/characterForms/LikenessTab.svelte`: an optional 🚧 `owner?: { characterId: number } | { castMemberId: number }` prop (one JSDoc sentence) beside the existing `characterId` — **the card form's call site (`CharacterForm.svelte`) must keep working unchanged** (not ours). With a member owner: the gallery and sprite lists are read with `{ castMemberId }` and listened for on the scoped member keys `interestKey(event, \`member:${id}\`)` (the previous worker scoped those families — see `src/lib/shared/sockets/interest.ts` `SCOPED_EVENTS` and `SpritesTab.svelte` `replyKey()`); the **Describe from image** control (`characters:describeLikeness`) is hidden for a member (it is card-only on the server and belongs to the image-generation session, serene-pub-43 — do not touch its server). The *Avatar* choice reads `avatarUrl`, which the member form passes as the member's face.
3. `src/lib/client/lorebooks/cast/CastMemberForm.svelte` — **exact-string `Edit` only, no whole-file `Write`, no prettier `--write` on this file** (lane s4-follow-b edits its Voice section, ~l.1357–1385: the `<VoiceTab castMember=…>` prop and a muted line under its "Use from card" switch — **leave those lines alone**). Add three blocks, in this order, **after the From the card block (`data-cast-retold`, ~l.1100) and before the sprite set / Voice sections**, each a `panel-inset` like its neighbours:
   - **Post-history instructions** (`data-cast-post-history`): a carded member gets the same **Use from card** switch as Name / Nickname (~l.755–790: `Switch` with `sr-only` field name, label "Use from card"); on = the card's text shown dimmed and disabled; off = the member's own textarea. The textarea copies the card form's field (`CharacterForm.svelte` ~l.2098–2120: `rows="4"`, `placeholder="Stay in character and keep replies short…"`, `title="Placed after the conversation, just before the reply; good for style reminders."`). A card-less member gets the textarea alone, no switch, no card wording.
   - **Creator notes** (`data-cast-creator-notes`): same switch pattern; the textarea edits `creatorNotes.text` (copy the card form's Creator notes field ~l.2130–2150 for label/placeholder/title); the language variants are kept as they came and not edited here (draw nothing extra for them; note it in your report).
   - **Likeness** (`data-cast-likeness`): same switch pattern; off (or card-less) = `<LikenessTab owner={{ castMemberId: member.id }} active … bind:likeness={draft.likeness} avatarUrl={the member's face URL as the form already computes it} />`; on = one muted line *"Uses the card's likeness."* (★ copy). Turning a switch off starts from the member's kept value; if it is empty, start from the card's current value (as Name does with `card?.name`).
   Flip the flag through the draft's `retold` (the same helper the From the card block uses, `setRetold` in `retoldRows.ts`, or a direct flag write — whichever keeps `sameMemberDraft` right). The card's values for the dimmed view come from the row's `character` (the card: `postHistoryInstructions`, `creatorNotes`, likeness in `extensions.serenepub.likeness` — `likenessOfExtensions` in `src/lib/shared/characters/likeness.ts`).
- DOM tests (`castMemberForm.dom.test.ts` or `castMemberFormLater.dom.test.ts`, whichever fits; keep them in the capped scope): a carded member shows the three switches on and the card's text dimmed; switching post-history off shows an editable textarea and Save sends `retold.postHistoryInstructions: true` with the text; a card-less member shows the three fields with no switch.

## Rules you must follow

- STYLE-GUIDE §6.4 edit forms: "A field's hint is its **placeholder** when it describes what to type … and its **`title`** when it explains what the field does." "**The title is the control's label**: a … switch label … that would repeat it is kept for a screen reader only (`sr-only`), never drawn twice."
- Svelte 5 runes. "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`." "`socket.off(event)` with no handler removes every listener app-wide; always pass the handler." Views never call `toaster`.
- "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."
- Memory rule: there is always a lorebook — never frame a session or member as having no lorebook.
- No new setting, event, table or migration. New names only: the `owner` prop and the draft fields. Copy beyond what is quoted here: propose it ★ in your report and build your recommendation.
- Do what is asked at the size asked; findings go under **Noticed, not done**.
- Prettier: `npx prettier --check` changed files; **only `--write` the lines you changed**, never a whole file — and **never on `CastMemberForm.svelte`** at all. If a file fails only on lines you didn't touch, leave it.
- If an `Edit` fails because the file changed since you read it, re-read that range and retry.

## Files owned (edit only these)

Goal A's five files and their named tests; `src/lib/client/lorebooks/cast/memberDraft.ts` (+ test), `src/lib/client/lorebooks/cast/retoldRows.ts` (only if a helper must learn the three keys), `src/lib/client/components/characterForms/LikenessTab.svelte`, `src/lib/client/lorebooks/cast/CastMemberForm.svelte` (the three new blocks + the draft wiring they need), DOM tests next to them.

## Tests (Done means)

Run, capped and logged (scratchpad `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/`):
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub; npx vitest run <files> --maxWorkers=2 > <scratchpad>/s4-follow-a-w6-tests.log 2>&1; echo test-exit=$? >> <scratchpad>/s4-follow-a-w6-tests.log'`
Files: everything you changed + `src/lib/server/cast/memberAsRead.test.ts src/lib/server/cast/memberAsRead.int.test.ts src/lib/client/lorebooks/cast/*.test.ts src/lib/client/components/characterForms/*castBanner*` + any amendments test touching `columnsOfMemberRow` (`grep -rl columnsOfMemberRow src --include=*.test.ts`). Never pipe vitest into `head`. A failing assert on a happy-dom element has OOM-killed VS Code: keep DOM runs in the capped scope.
Then `npx tsc --noEmit -p .` and `npm run check`, one after the other, each under `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=8192; ...'`. Known errors from other lanes: `overhear-seat` (`sessionPage/requests/index.ts`, `overhearSeat.ts`), `CharacterRow` `nickname` in three Characters-view tests, `CharacterRowItem.svelte` 60. Everything else must be clean.

## Report

Final message: changed files, one line each, with Goal A's five listed under **extra files (lead-approved)**; the copy you used (★); tests with pass/fail counts; tsc/check; Noticed, not done.
