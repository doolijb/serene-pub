# REPORT m3b-D-w1 (SDK)

Status question: none relayed.

## Changed files (SDK repo, /home/jody/github/serene-pub-sdk; line ranges are post-edit)
- `sdk/src/descriptors.ts` 1029-1046: `SessionShape.castFromLorebook?: { field?: string }` after `lorebook?:`, with a 🚧 `@experimental` doc comment that says what it is and what it is not (not `characters: { min }`, not a cast binding, not the start form's character picker).
- `sdk/src/genres.ts` 1114-1135: in `genre()`, after the `applet` check, refusals prefixed `${id}.shape.castFromLorebook`.
  - The declaration is not a plain object (null and arrays included).
  - `field` is present but not a non-empty string.
  - `field` names nothing in `shape.fields`.
  - `field` names a non-boolean field.
  - The shape has no `lorebook`.
  - `characters` is absent or has `max: 0`.
  - Each sentence says what to do.
- `sdk/src/widgets.ts`: 1455-1460 adds the two exported constants `CREATE_SESSION_PERSONA_NAME_MAX = 80` and `CREATE_SESSION_PERSONA_DESCRIPTION_MAX = 2000`, each with a one-line doc. 2068-2078 adds `persona?: { name: string; description?: string }` to `WidgetRequests['create-session'].params`, with a 🚧 M3b doc.
- `sdk/src/index.ts`: not changed. It already has `export * from './widgets.js'`, so the constants are exported from the package.
- `guides/frames.md`: line 201 names `persona?` in the `create-session` bullet. Lines 210-214 add one prose paragraph covering `persona` and `castFromLorebook: { field: 'examples' }`. There is no new code fence.
- `sdk-tests/genreCastFromLorebook.test.ts` (new, prettier-clean):
  - accepted with no field and with a boolean field;
  - refused for each case above (including an empty or non-string `field` and several non-object values);
  - the declaration survives `genre()` unchanged on the returned `shape`;
  - a type-level check that a `WidgetRequests['create-session']['params']` object with `persona` compiles;
  - the two constants equal 80 and 2000.

## Tests run
- `npx tsx --test genreCastFromLorebook.test.ts genreFullscreen.test.ts`: 17/17 pass.
- `npx tsx --test genreCastFromLorebook.test.ts plugin.test.ts scaffoldPlugin.test.ts`: 154/154 pass. These are the existing tests that mention `create-session`.
- `npx tsx --test guides.test.ts guideSnippets.test.ts`: 40/40 pass.
- `npx tsc --noEmit` in `sdk-tests`: clean.
- `npx prettier --check` on the new test file: clean.
- I did not run `sdk:build` or `npm test`.

## Shape is carried whole (confirmed by reading)
`genre()` returns `shape: lorebookReadOptional(props.shape)` (genres.ts around line 1218). That only rewrites `lorebook: 'required'`, so `castFromLorebook` passes through untouched. The test asserts this. I did not read the CLI or packager.

## Assumptions
- A `field` of `''` or whitespace counts as "not a non-empty string" and gets the "must be the name of a boolean field" sentence.
- `castFromLorebook: {}` is accepted, and means always seat for this genre.
- I added no new names beyond the three the brief gave: `castFromLorebook`, `CREATE_SESSION_PERSONA_NAME_MAX` and `CREATE_SESSION_PERSONA_DESCRIPTION_MAX`.

## Noticed, not done
- The `CREATE_SESSION_PERSONA_*_MAX` limits are only documented. The SDK does not validate a persona against them, because the brief leaves that to the host.
- Other lanes have uncommitted hunks in the same files. I did not touch them: descriptors.ts ~990, genres.ts ~341/462, widgets.ts ~498/2439/3021.
