/**
 * Card strokes on or off — ONE switch for the whole app (DESIGN-card-strokes
 * §A; plans/DESIGN-card-strokes-and-dowry-2026-10-11.md).
 *
 * **Paused by the owner on 2026-10-11** ("disable strokes for now in core and
 * in the sdk, we will revisit later"). Off means nothing stroke-shaped is
 * shown or written: a card is its prose, as before strokes. The card dowry,
 * the card Stats tab and `cardState:*` are NOT gated — they stay live.
 *
 * What stays while this is off (so switching it back on is this one line):
 * the `characters.strokes` column (always written `[]` when prose is saved),
 * the SDK shapes (`Stroke`, `compileStrokes`, `CHARACTER_CARD.strokes`), the
 * socket types and `characters:countStrokeTokens` (which refuses), the
 * components, the `card-strokes` binding and `compileCharacter`'s stroke path
 * (no core spec places the step), the `strokeList` helper/filter, and every
 * stroke test — each runs under `vi.mock` of this module with `true`.
 *
 * Shared (not server-only) so the client and the server read one value.
 *
 * Gated sites — keep this list current:
 * - client `characterForms/StrokeField.svelte` — textarea only; no Split, no
 *   Add stroke, no stroke list
 * - client `characterForms/strokes.ts` `characterForSave` — the saved
 *   character carries no `strokes` key
 * - client `characterForms/CharacterForm.svelte` — no strokes loaded into
 *   the draft (description stays required), `strokes` never sent on create
 *   or update (via `characterForSave`), no stroke validation, no token
 *   recount
 * - client `characterForms/CharacterViewPanel.svelte` — no stroke rows
 * - server `characters/strokes.ts` `applyStrokesToCard` — pass-through that
 *   stores `strokes: []` whenever prose is written
 * - server `sockets/characters.ts` `characters:update` — no recompile of sent
 *   prose from stored strokes; `characters:countStrokeTokens` refuses
 * - server `characters/cardIO.ts` `planCardImport` — ignores
 *   `extensions.serenepub.strokes`, never turns a plain book into strokes
 *   (every embedded book is held); `mergeStrokeBook` and
 *   `serenepubStrokesAndDowry` add no stroke entries / no `serenepub.strokes`
 *   on export (the entries another install's strokes wrote are dropped from
 *   a held book on import: their text is already in the compiled prose)
 * - server `pipelines/prompt/promptFields.ts` `compileCharacter` — fields
 *   read the prose columns, never a compile of stored strokes
 * - server `pipelines/entities/variableLayouts.ts` `core:var/characters@1` —
 *   the pre-strokes layout and floor, byte for byte
 * - shared `utils/templateAssist.ts` — `strokeList` not offered in the
 *   template editor's assist docs (`templateCompletions.test.ts` exempts it
 *   from the "every helper documented" check while off)
 * - test fixture `pipelines/prompt/liquidParity.fixtures.ts` — the Liquid
 *   characters port follows the layout
 */
export const STROKES_ENABLED = false as const
