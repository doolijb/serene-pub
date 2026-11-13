# BRIEF m3b-D-w1 — SDK: `SessionShape.castFromLorebook` and `create-session.persona`

Lane m3b-D (supervisor reads your report). Work in `/home/jody/github/serene-pub-sdk` (sibling of the app at `/home/jody/github/serene-pub`).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Never `git checkout` / `restore` / `stash` in `../serene-pub-sdk` — most of it is uncommitted.

## Goal (owner rulings 2026-11-05)
Ruling ★M3-4 "The book seats its cast, genre-declared": a genre declares that attaching the lorebook seats its cast members as the session's characters, whoever owns the cards; off for every other genre (P1: "A *new* automatic behaviour is off in core until a genre opts in"). Ruling ★M3-3 "Make the persona from the wizard": the launcher's wizard sends the player it made; Serene Pub's start form offers it as a NEW persona, created on the person's Start, owned by them.

## Items
1. **`sdk/src/descriptors.ts`, `SessionShape`** (beside `lorebook?:`, ~line 1028): add
   `castFromLorebook?: { field?: string }`. Doc comment (🚧, `@experimental`), saying: what it is — at session create, the lorebook attached to the new session seats its cast members as the session's characters (character seats), in the book's order, whoever owns the cards; `field` names a declared `boolean` field of this shape that switches it per session (absent = always for this genre); a persona card is never seated; for a provided book only the cards it brought (their provided mark) are seated; at create only — never on a later attach or update; off unless a genre declares it (P1); the person still sees who is in it on the start form's confirm. Say what it is **not** (NOMENCLATURE §24 rule 5): not `characters: { min }` (a bound on picks), not a cast binding (the book's member ↔ card link), not the start form's character picker.
2. **`sdk/src/genres.ts`, `genre()`** — validate beside the `fullscreen`/`applet` checks (~line 1100), throwing a sentence prefixed `${id}.shape.castFromLorebook` like those do:
   - not a plain object, or `field` present but not a non-empty string → refuse;
   - `field` names no declared field of `shape.fields`, or a field whose `type` is not `'boolean'` → refuse ("…must name a boolean field of this shape; '<field>' is …");
   - the shape has no `lorebook` (no attachment picker, so no book is ever attached) → refuse;
   - the shape's `characters` capability is absent or has `max: 0` (no character seats permitted, so every seat would be refused) → refuse.
   Every sentence says what to do (like the existing ones).
3. **`sdk/src/widgets.ts`, `'create-session'`** (~line 2063): params gain `persona?: { name: string; description?: string }`. Doc: 🚧 (M3b) the player the start form offers as a NEW persona — the person may pick an existing one instead; Serene Pub creates the card on the person's Start, as their own; nothing is created without that press. Export, from the same module and from the package index (`sdk/src/index.ts` — check how widgets exports are re-exported), two constants with a one-line doc each:
   `export const CREATE_SESSION_PERSONA_NAME_MAX = 80` and `export const CREATE_SESSION_PERSONA_DESCRIPTION_MAX = 2000` (characters, after trimming; the host refuses longer in words). These names are final — the client lane builds against them.
4. **`guides/frames.md`**, section "An applet: your frame outside any session" (~line 178): update the `create-session { genre, fields, lorebookId? }` bullet to name `persona?`, and add ONE short paragraph after the bullet list: `persona: { name, description? }` (≤ 80 / ≤ 2,000 characters) makes the start form offer that player as a new persona the person may keep or swap for one of their own; the card is created only when they press Start, and is theirs. Also one sentence for `castFromLorebook: { field: 'examples' }` in a shape: the attached lorebook's own people join a new session as its characters when the switch field is on. Plain prose, no new code fence (fences in guides are type-checked; if you add one it must compile, with a `<!-- prelude: -->` like the existing one).
5. **Tests** — new `sdk-tests/genreCastFromLorebook.test.ts` in the style of `sdk-tests/genreFullscreen.test.ts` (node:test + assert/strict): accepted with no field; accepted with a boolean field; refused: field missing from `fields`, field of another type, no `lorebook`, no `characters`, `characters: { min: 0, max: 0 }`, non-object. And a type-level/value check for the request: a `WidgetRequests['create-session']['params']` (find the exact map type name in widgets.ts) object with `persona` compiles, and the two constants equal 80 and 2000. Also assert the declaration survives `genre()` unchanged on the returned `shape` (the app stores the shape whole).

## Run
- `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test genreCastFromLorebook.test.ts genreFullscreen.test.ts` and any existing test touching `create-session` or the frames guide (`grep -ln "create-session\|frames.md" *.test.ts`; run those files by name).
- `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsc --noEmit` (typechecks the suite against the sources).
- Do NOT run `sdk:build`; the supervisor does it once.
- `npx prettier --check` on files you created.

## Rules
- NOMENCLATURE R3 "Qualify, never abbreviate to the bare noun"; §24 rule 5 "Say what it is **not**, in the declaration, if a near-neighbour exists." Do not invent any other new name; if you think one is needed, stop and say so in the report.
- Decisions (CLAUDE.md): "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing 'for later'."
- Re-read a file immediately before editing it (other lanes edit this tree); additive hunks; never reformat.

## Files owned
`sdk/src/descriptors.ts`, `sdk/src/genres.ts`, `sdk/src/widgets.ts`, `sdk/src/index.ts` (export lines only), `guides/frames.md` (that section), `sdk-tests/genreCastFromLorebook.test.ts` (new). Readable: all of the SDK.

## Out of scope
Any app (`serene-pub`) file; the CLI/packager (the shape is carried whole — confirm by reading, report if not); the core-catalog genres.

## Stop and ask when
A name other than those above seems needed; an existing test breaks for a reason outside your change.

## Report
`/home/jody/github/serene-pub/plans/briefs/REPORT-m3b-D-w1.md`: changed files (with line ranges), tests run and results, anything noticed-not-done.
