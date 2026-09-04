/**
 * What core's shipped variable layouts are, and how one gets rendered.
 *
 * Deliberately free of any database import. The node that renders these is a
 * Task, and a Task is handed no services (F11) — a module it imports reaching
 * the schema would compile and run and still be the wrong shape. The seeding
 * half lives in `seedVariableTemplates.ts`, which reads from here.
 *
 * ## Every source here is a byte-parity constant
 *
 * Each one reproduces, in template source, exactly what 0.5 put in a prompt —
 * indentation, headings and fences included. That is the whole gate on this
 * feature: the layouts become configurable and *nothing changes* until somebody
 * deliberately changes one. `variableTemplates.parity.test.ts` asserts source
 * and `codeDefault` produce identical output, so the two cannot drift apart in
 * a way that only shows up in someone's prompt.
 *
 * ## Why JSON is the default and stays the default
 *
 * The obvious reading of "characters are stringified JSON in a prompt" is that
 * somebody took a shortcut. It is the opposite: the JSON shape was A/B tested
 * against prose before 0.1.0 and measurably improved how reliably models hold a
 * character. So prose is a supported choice, never an accidental one — which is
 * why the shipped rows are immutable and reaching prose means duplicating.
 *
 * ## Two rows per variable, because the heading moved
 *
 * Through 0.5 the headings and fences lived in the context template —
 * `Assistant Characters (AI-controlled):` and a ` ```json ` fence were typed
 * into `DEFAULT_CONTEXT_TEMPLATE` around `{{{characters}}}`. They belong here
 * instead: the template's job is message blocks, placement and loops, with no
 * opinion on how the data is presented, and "wrap this in a fence" is
 * presentation.
 *
 * So each wrapped variable ships **two** immutable rows — the titled block
 * (what a fresh install selects, reproducing 0.5 byte for byte) and the bare
 * content. The bare row is not vestigial: a context template that writes its
 * own headings needs a layout that does not, or the prompt gets both. That is
 * what `migrateContextWrappers` pins for anyone whose template is their own.
 */

import { renderTemplate } from "$lib/server/pipelines/prompt/renderers"

/**
 * A heading and delimiters, applied to a body.
 *
 * The same function produces the row's `source` (applied to the content
 * template's source) and its `codeDefault` (applied to the content expression's
 * output), so a row and its floor cannot disagree about where a newline goes.
 * Writing the two out separately is exactly the transcription error the whole
 * parity gate exists to catch, and there is no reason to make it possible.
 */
export type Wrap = (body: string) => string

/**
 * A shipped row's structural identity: does it add the heading and fence, or
 * is it the bare value? There are only ever these two, and which one a row is
 * cannot change without it becoming a different row — which is exactly the
 * property a seed key needs and a display name does not have.
 */
export type VariantKind = "wrapped" | "content"

export interface ShippedVariableTemplate {
	variableId: string
	/** The key this renders under — also how the template's scope is keyed. */
	key: string
	name: string
	/**
	 * Which of the two rows this is — the structural identity `seedKeyFor`
	 * keys on, so `name` stays free to change.
	 */
	variant: VariantKind
	source: string
	/** The in-code expression this row reproduces, byte for byte. */
	codeDefault: (value: unknown) => string
	/**
	 * This layout names the keys the variable declares, rather than handing the
	 * whole value to `JSON.stringify`.
	 *
	 * Recorded rather than inferred from the source because it changes what the
	 * row *promises*: an explicit layout reproduces the code default for every
	 * value of the declared shape, and renders the declared shape and nothing
	 * else for anything outside it. A passthrough promises the stronger thing —
	 * identical bytes for any value at all — and the parity test has to hold
	 * each of them to its own contract.
	 */
	explicit: boolean
	/** The row a fresh install points at, and whose expression is the floor. */
	isDefault: boolean
}

/**
 * What every passthrough did before this feature existed: nothing.
 *
 * Coerces the way Handlebars' `{{{x}}}` does — nullish becomes empty, anything
 * else becomes `String(v)` — rather than the narrower `typeof v === 'string'`
 * this started as. Every value that reaches these keys today is already a
 * string (`interpolate()` and `joinWithAnd()` both guarantee one), so the two
 * are indistinguishable in practice and the narrow version passed every
 * realistic test. It was still wrong: the floor and the shipped layout would
 * have disagreed on an array or a number, which is a divergence waiting for
 * whoever changes what an upstream node emits. Found by feeding both an array.
 */
const asWritten = (v: unknown): string => (v == null ? "" : String(v))

/**
 * The code floor for `currentDate`, from its parts.
 *
 * Every layout keeps its in-code expression so a dangling template reference or
 * a failed seed still emits today's bytes, and this is that expression for the
 * one variable whose formatting *moved* into the template. It has to agree with
 * the shipped source character for character — `variableTemplates.parity.test`
 * renders one against the other, so the two cannot drift apart quietly.
 */
const asCurrentDate = (v: unknown): string => {
	if (v == null) return ""
	const d = v as { year?: number; month?: number; day?: number }
	if (d.year == null) return ""
	let out = String(d.year)
	if (d.month != null) out += `-${String(d.month).padStart(2, "0")}`
	if (d.day != null) out += `-${String(d.day).padStart(2, "0")}`
	return out
}

/** `JSON.stringify(x, null, 2)`, which is what the JSON layouts replaced. */
const asIndentedJson = (v: unknown): string => {
	const out = JSON.stringify(v, null, 2)
	return out === undefined ? "" : out
}

/**
 * `JSON.stringify(x)` — no indent, which is what Assemble's two produced.
 *
 * Empty becomes `""` rather than `undefined`, and the difference is worth being
 * sure about rather than assuming: the builders return `undefined` for an empty
 * set precisely so `{{#if worldLore}}` stays falsy, and `""` is falsy to
 * Handlebars in exactly the same way. `{{{worldLore}}}` renders nothing for
 * both. So the prompt is unchanged, and the value is now always the string the
 * layout produced rather than sometimes a layout and sometimes an absence.
 */
const asMinifiedJson = (v: unknown): string => {
	const out = JSON.stringify(v)
	return out === undefined ? "" : out
}

/**
 * A list of objects, rendered key by key instead of handed to `JSON.stringify`.
 *
 * This is slice 4's whole point: the shipped default stops being an opaque
 * `{{{json characters 2}}}` and becomes something an admin can edit. "Drop
 * `personality`" is now a deletion and "rename `nickname` to `alias`" is a
 * rename — both of which used to be code changes, which is the exact inversion
 * the variable-layout feature was supposed to end.
 *
 * ## Byte parity, and the two places it is easy to lose
 *
 * The output must equal `JSON.stringify(value, null, 2)` exactly. Two traps:
 *
 * **Presence, not truthiness.** `{{#if description}}` drops an empty-string
 * description, and `JSON.stringify` keeps it — `"description": ""`. It also
 * drops a `null`, which personas really do carry (`resolveContextInput` builds
 * them by hand and nothing strips a null the way `compileCharacter` does). So
 * every optional key is guarded on `(ne x undefined)`, which is the only test
 * that means "this key is absent from the object".
 *
 * **The first key carries no comma.** `name` is always present, so every later
 * key can emit its own leading `,\n` inside its own guard. Trying to put the
 * comma *after* each field needs to know whether anything follows it, which
 * Handlebars cannot answer without listing the combinations.
 *
 * ## What this does not do
 *
 * It renders the keys the variable *declares* and no others. A node that puts
 * an extra field on a character is already outside the shape its slot promised
 * (`renders: { characters: 'core:var/characters@1' }`), but the field will now
 * be dropped rather than passed through — so that case is asserted in the
 * parity test rather than left to be discovered. `{{{json characters 2}}}` is
 * still a valid layout for anyone who wants the old passthrough.
 */
const objectList = (key: string, fields: readonly string[]): string => {
	const [first, ...rest] = fields
	const optional = rest
		.map(
			(f) =>
				`{{#if (ne ${path(f)} undefined)}},\n    ${json(f)}: {{{jsonValue ${path(f)}${f.includes(" ") ? " 4" : ""}}}}{{/if}}`
		)
		.join("")
	return (
		`{{#if ${key}.length}}[\n` +
		`{{#each ${key}}}  {\n    ${json(first!)}: {{{jsonValue ${path(first!)}}}}${optional}\n` +
		`  }{{#unless @last}},{{/unless}}\n` +
		`{{/each}}]{{else}}[]{{/if}}`
	)
}

/** `extra lore` is not a bare Handlebars path; `this.[extra lore]` is. */
const path = (field: string): string =>
	/^[A-Za-z_$][\w$]*$/.test(field) ? field : `this.[${field}]`

/** The key as it appears in the JSON, quoted and escaped the same way. */
const json = (field: string): string => JSON.stringify(field)

/**
 * A record, rendered entry by entry instead of handed to `JSON.stringify`.
 *
 * A record's *keys* come from the data — a lorebook entry's name, a history
 * entry's date — but its *shape* does not, and that was the distinction worth
 * getting right: "there is no fixed key list" is not the same as "there is
 * nothing to make explicit". The structure here is `key: value, key: value`,
 * and putting it in the template is what lets an admin render world lore as
 * prose, change the separator, or drop the fences, none of which was reachable
 * while the whole object went to one stringify call.
 *
 * ## The literal brace, and why the template looks like that
 *
 * `{` immediately followed by `{{#each` is a parse error — Handlebars reads the
 * three braces as a triple-stash. Minified JSON has no whitespace to separate
 * them, so the template writes a space and then removes it with Handlebars'
 * own whitespace control (`{{~#each`). That is a real feature doing exactly
 * what it is for, rather than a helper invented to dodge the lexer.
 */
const recordEntries = (key: string): string =>
	`{{#if ${key}}}{ {{~#each ${key}}}{{{jsonValue @key indent=0}}}:` +
	`{{{jsonValue this indent=0}}}{{#unless @last}},{{/unless}}{{/each~}} }` +
	`{{else}}{}{{/if}}`

/**
 * `JSON.stringify(x, null, 1)`, which is what the narrative graph produced.
 *
 * One space, not two, and the difference reached every prompt that had a
 * relationship in it — `buildGraphContextData`'s caller has always stringified
 * at indent 1.
 */
const asGraphJson = (v: unknown): string => {
	if (v == null) return ""
	const out = JSON.stringify(v, null, 1)
	return out === undefined ? "" : out
}

/**
 * An object with a known, fixed set of optional sections.
 *
 * The narrative graph's three sections are each conditional, and none of them
 * is guaranteed present — so the "first key always exists" trick that makes
 * `objectList` readable does not apply here. Instead each section emits a
 * trailing comma when *something after it* is present, which is knowable
 * because the section list is fixed and short. That is the whole reason this is
 * a different function rather than a parameter on the other one.
 */
const optionalSections = (key: string, sections: readonly string[]): string => {
	// `(or a (or b c))` — the helper takes two, so more than two nests.
	const any = sections
		.slice(0, -1)
		.reduceRight((acc, name) => `(or ${name} ${acc})`, sections.at(-1)!)

	const body = sections
		.map((name, i) => {
			const after = sections.slice(i + 1)
			const follows = after.length
				? after
						.slice(0, -1)
						.reduceRight(
							(acc, n) => `(or ${n} ${acc})`,
							after.at(-1)!
						)
				: null
			const comma = follows ? `{{#if ${follows}}},{{/if}}` : ""
			// The first section's `{{~#if` eats the space that separates the
			// opening brace from it — see `recordEntries` for why the space has
			// to be there at all.
			const open = i === 0 ? "{{~#if " : "{{#if "
			return (
				`${open}${name}}}\n ${json(name)}: ` +
				`{{{jsonValue ${name} indent=1 offset=1}}}${comma}{{/if}}`
			)
		})
		.join("")

	return (
		`{{#if ${key}}}{{#with ${key}}}{{#if ${any}}}{ ${body}\n` +
		`}{{else}}{}{{/if}}{{/with}}{{/if}}`
	)
}

/** `Title:` above a ` ```json ` fence — what the cast and lore blobs sat in. */
const jsonBlock =
	(title: string): Wrap =>
	(body) =>
		`${title}\n\`\`\`json\n${body}\n\`\`\``

/** `Title:` above a `"""` fence — what the free-form text blocks sat in. */
const quotedBlock =
	(title: string): Wrap =>
	(body) =>
		`${title}\n"""\n${body}\n"""`

/** One variable: how its content renders, and what 0.5 wrapped it in. */
interface VariableDefinition {
	variableId: string
	key: string
	/**
	 * The value and nothing else.
	 *
	 * Doubles as the **absence rule**. `renderVariable` renders nothing at all
	 * when this comes back empty, which is what keeps a heading from appearing
	 * above nothing now that the heading is no longer inside the template's
	 * `{{#if}}`. It has to be decided here rather than by an `{{#if}}` inside
	 * the layout: Handlebars calls an empty array empty, and an empty cast has
	 * always rendered a literal `[]` inside its fence.
	 */
	content: {
		name: string
		source: string
		render: (v: unknown) => string
		/** See `ShippedVariableTemplate.explicit`. */
		explicit?: boolean
	}
	/** The heading and fence 0.5's context template wrote around it. */
	wrapper?: { name: string; wrap: Wrap }
}

/**
 * One entry per key any node declares in a `variables` slot.
 *
 * The `{{{` triple stash is not stylistic — escaping is on in the render path,
 * and a double stash would turn every quote in the JSON into `&quot;`. It
 * matters more now than it did: a wrapped value carries the fence's own `"""`
 * characters, so a context template that reads one of these through a double
 * stash gets `&quot;&quot;&quot;` in the prompt.
 */
const VARIABLES: VariableDefinition[] = [
	{
		variableId: "core:var/instructions@1",
		key: "instructions",
		content: {
			name: "As written",
			source: "{{{instructions}}}",
			render: asWritten
		},
		wrapper: { name: "Titled block", wrap: quotedBlock("Instructions:") }
	},
	{
		variableId: "core:var/characters@1",
		key: "characters",
		content: {
			name: "JSON",
			// The field list *is* the shape `core:var/characters@1`
			// declares, in the order `compileCharacter` builds the card —
			// `JSON.stringify` writes keys in insertion order, so the order
			// here is a parity constant and not a preference.
			source: objectList("characters", [
				"name",
				"nickname",
				"description",
				"personality",
				"extra lore"
			]),
			render: asIndentedJson,
			explicit: true
		},
		wrapper: {
			name: "Titled JSON block",
			wrap: jsonBlock("Assistant Characters (AI-controlled):")
		}
	},
	{
		variableId: "core:var/personas@1",
		key: "personas",
		content: {
			name: "JSON",
			// `description` is optional here for a different reason than a
			// character's: personas skip `compileCharacter`, so nothing strips
			// a null and the key arrives present-and-null. Guarding on
			// presence rather than truthiness is what keeps that byte-identical.
			source: objectList("personas", ["name", "description"]),
			render: asIndentedJson,
			explicit: true
		},
		wrapper: {
			name: "Titled JSON block",
			wrap: jsonBlock("User Characters (player-controlled):")
		}
	},
	{
		variableId: "core:var/scenario@1",
		key: "scenario",
		content: {
			name: "As written",
			source: "{{{scenario}}}",
			render: asWritten
		},
		wrapper: { name: "Titled block", wrap: quotedBlock("Scenario:") }
	},
	{
		variableId: "core:var/example-dialogue@1",
		key: "exampleDialogue",
		content: {
			name: "As written",
			source: "{{{exampleDialogue}}}",
			render: asWritten
		}
		// No wrapper: the default template renders example dialogue inside the
		// post-history reminder, off `postHistory.exampleDialogue` — a
		// different value with a different heading, which this variable does
		// not reach.
	},
	{
		variableId: "core:var/post-history-instructions@1",
		key: "postHistoryInstructions",
		content: {
			name: "As written",
			source: "{{{postHistoryInstructions}}}",
			render: asWritten
		}
	},
	{
		variableId: "core:var/character-names@1",
		key: "characterNames",
		content: {
			name: "As written",
			// Already joined into one string upstream (`joinWithAnd`), so this
			// is a passthrough and not a list rendering. A layout wanting the
			// names one per line has to change the producing node, not this.
			source: "{{{characterNames}}}",
			render: asWritten
		}
	},
	{
		variableId: "core:var/persona-names@1",
		key: "personaNames",
		content: {
			name: "As written",
			source: "{{{personaNames}}}",
			render: asWritten
		}
	},
	// ── Assemble's own ──────────────────────────────────────────────────
	//
	// Minified, unlike the cast blobs — `JSON.stringify(obj)` with no indent
	// argument, which is what these two were. Do not "tidy" them to match the
	// others: the whitespace is prompt content, and the legacy engines produced
	// exactly this.
	{
		variableId: "core:var/world-lore@1",
		key: "worldLore",
		content: {
			name: "JSON",
			source: recordEntries("worldLore"),
			render: asMinifiedJson,
			explicit: true
		},
		// The trailing space after the colon is a byte that reached every 0.5
		// prompt. It looks like a typo and is not safe to tidy inside a parity
		// constant; change it deliberately, in its own commit, or not at all.
		wrapper: {
			name: "Titled JSON block",
			wrap: jsonBlock("World lore: ")
		}
	},
	{
		variableId: "core:var/history@1",
		key: "history",
		content: {
			name: "JSON",
			source: recordEntries("history"),
			render: asMinifiedJson,
			explicit: true
		},
		wrapper: {
			name: "Titled JSON block",
			wrap: jsonBlock("Story history:")
		}
	},
	/**
	 * ⚠ These two were one layout on `core:var/speaker-relationships@1`, whose
	 * source was `optionalSections(…, ['yourRelationships',
	 * 'howOthersRegardYou', 'legendaryFigures'])` under a single
	 * `Your relationships:` heading.
	 *
	 * That is the one place 0.6 deliberately changes 0.5's prompt bytes.
	 * Everything else in this file moved a wrapper without altering it —
	 * `contextTemplateWrappers.test.ts` proves it by rebuilding 0.5's template
	 * from 0.6's — and this block is the recorded exception. The reason is that
	 * what the speaker thinks of Brannoc and what Rell thinks of the speaker
	 * are opposite claims, and one heading over both invited the model to read
	 * them as one list.
	 */
	{
		variableId: "core:var/relationships-perspectives@1",
		key: "relationshipsPerspectives",
		content: {
			// A flat record keyed by the other character's name, so the whole
			// value renders at once — no section guards, because there are no
			// sections any more. Indent 1, which is what the graph has always
			// stringified at and what the other half still uses.
			name: "JSON",
			source: "{{{json relationshipsPerspectives 1}}}",
			render: asGraphJson,
			explicit: true
		},
		wrapper: {
			name: "Titled JSON block",
			wrap: jsonBlock("Your relationships:")
		}
	},
	{
		variableId: "core:var/relationships-known@1",
		key: "relationshipsKnown",
		content: {
			name: "JSON",
			// Still two optional sections — an install with no legendary
			// figures has no key at all — so this half keeps the guards.
			source: optionalSections("relationshipsKnown", [
				"howOthersRegardYou",
				"legendaryFigures"
			]),
			render: asGraphJson,
			explicit: true
		},
		wrapper: {
			name: "Titled JSON block",
			wrap: jsonBlock("How others regard you:")
		}
	},
	{
		variableId: "core:var/current-date@1",
		key: "currentDate",
		content: {
			// ⚠ Was `{{{currentDate}}}` against a value `formatDate` had
			// already turned into `"412-03"`. The parts arrive separately now,
			// so the separator, the order and the padding are all in the
			// source below — which is the difference between a layout for this
			// variable and a layout that could not change anything about it.
			//
			// Byte-identical to what `formatDate` produced, which the parity
			// corpus checks: year, then `-MM` if there is a month, then `-DD`
			// if there is a day.
			name: "Numeric",
			source:
				"{{currentDate.year}}" +
				"{{#if (isSet currentDate.month)}}-{{pad currentDate.month 2}}{{/if}}" +
				"{{#if (isSet currentDate.day)}}-{{pad currentDate.day 2}}{{/if}}",
			render: asCurrentDate,
			// Explicit: this source names the fields it renders, so the parity
			// test has to feed it dates rather than strings. Without the flag
			// it fell through to the string cases and was **vacuous** — the
			// `isSet` guard could be swapped for a bare `{{#if}}`, which drops
			// a zeroth month, and every test stayed green.
			explicit: true
		},
		// Not a heading and a fence, but the same thing in kind: wording the
		// template supplied around a value. A user who wants the date stated
		// differently — or as a bare date — changes it here.
		wrapper: {
			name: "Sentence",
			wrap: (body) => `The current date in the story is ${body}.`
		}
	}
]

const definitionByKey = new Map(VARIABLES.map((v) => [v.key, v]))

/** Every row core seeds, default first within each variable. */
export const SHIPPED_VARIABLE_TEMPLATES: ShippedVariableTemplate[] =
	VARIABLES.flatMap((v) => {
		const content: ShippedVariableTemplate = {
			variableId: v.variableId,
			key: v.key,
			name: v.content.name,
			variant: "content",
			source: v.content.source,
			codeDefault: v.content.render,
			explicit: v.content.explicit ?? false,
			isDefault: !v.wrapper
		}
		if (!v.wrapper) return [content]
		const wrapped: ShippedVariableTemplate = {
			variableId: v.variableId,
			key: v.key,
			name: v.wrapper.name,
			variant: "wrapped",
			source: v.wrapper.wrap(v.content.source),
			codeDefault: (value) => {
				const body = v.content.render(value)
				// Nothing to wrap is nothing at all. Through 0.5 the whole
				// block sat inside `{{#if worldLore}}`, so an absent value
				// produced no heading and no fence; that has to stay true now
				// that the heading has moved inside the value.
				return body === "" ? "" : v.wrapper!.wrap(body)
			},
			explicit: v.content.explicit ?? false,
			isDefault: true
		}
		return [wrapped, content]
	})

/** The row a fresh install selects for a key, and the floor for that key. */
export const shippedByKey = new Map(
	SHIPPED_VARIABLE_TEMPLATES.filter((t) => t.isDefault).map((t) => [t.key, t])
)

/** Every row core ships for a key, default first. */
export const shippedRowsByKey = new Map<string, ShippedVariableTemplate[]>(
	VARIABLES.map((v) => [
		v.key,
		SHIPPED_VARIABLE_TEMPLATES.filter((t) => t.key === v.key)
	])
)

/**
 * The heading and fence 0.5 wrote around a variable, if it wrote one.
 *
 * Exported so a template written against 0.5 can be reconstructed from a 0.6
 * one — which is what the parity corpus needs to keep comparing the two
 * releases rather than comparing 0.6 against itself.
 */
export const wrapFor = (key: string): Wrap | undefined =>
	definitionByKey.get(key)?.wrapper?.wrap

/**
 * A shipped row's stable identity.
 *
 * Keyed on `variant` rather than `name`. It was the name, which meant renaming
 * a shipped layout minted a *different* key: the seeder found nothing to update,
 * inserted a second row, and left the original orphaned — still in the picker,
 * still selected by anyone who had chosen it, and now diverging from the code
 * that was supposed to define it. A variable has exactly one wrapped row and one
 * bare one, and no rename changes which is which.
 *
 * Migration `0113` re-keyed the rows seeded under the old scheme.
 */
export const seedKeyFor = (t: {
	variableId: string
	variant: VariantKind
}): string => `pipeline-variable-template:${t.variableId}:${t.variant}`

/**
 * What the `variables` slot resolves to, per key, once dereferenced.
 *
 * `engine` is required and non-null. It used to be `string | null | undefined`,
 * which read as "core's default if absent" — and since `renderVariable` passes
 * it straight to `renderTemplate`, that absence was a layout being rendered in
 * whatever core ships rather than in what it was written in. The row's column
 * is NOT NULL now, so every path that builds one of these has a real engine to
 * hand; requiring it here is what makes a path that *doesn't* fail to compile
 * rather than fail silently at render time.
 */
export type ResolvedLayouts = Record<
	string,
	{ engine: string; source?: string } | undefined
>

export class VariableLayoutError extends Error {}

/**
 * Render one variable through whichever layout resolved for it.
 *
 * **The code default is the floor.** No layout, an empty source, or a key
 * nothing shipped — all of them fall through to the in-code expression, which
 * still emits today's bytes. That is what makes a failed seed, a dangling
 * reference, or a disabled plugin cost a customization rather than a prompt.
 *
 * A layout that *is* selected and *does* throw is a different case, and it
 * refuses rather than degrading. Falling back silently there would leave
 * someone staring at default output while the panel shows their template
 * selected, with nothing anywhere saying the two disagree — the exact failure
 * this whole layer exists to prevent. The message names the variable, because
 * the raw engine error does not.
 */
export async function renderVariable(
	layouts: ResolvedLayouts | undefined,
	key: string,
	value: unknown
): Promise<string> {
	const def = definitionByKey.get(key)

	// Absence, decided in code and before any layout runs. Through 0.5 the
	// heading and fence sat inside the context template's `{{#if}}`, so a
	// variable with nothing in it produced nothing; now that the wrapper lives
	// in the layout, that guard has to live somewhere the layout cannot lose.
	// Not an `{{#if}}` inside the source, for two reasons: Handlebars calls an
	// empty array empty, so an empty cast would stop rendering the `[]` it has
	// always rendered — and a user editing their own layout could delete the
	// guard and get a heading above nothing without ever meaning to.
	if (def && def.content.render(value) === "") return ""

	const shipped = shippedByKey.get(key)
	const floor = () =>
		shipped ? shipped.codeDefault(value) : asWritten(value)

	const chosen = layouts?.[key]
	if (!chosen?.source) return floor()

	try {
		return await renderTemplate(chosen.engine, {
			template: chosen.source,
			variables: { [key]: value }
		})
	} catch (err: any) {
		throw new VariableLayoutError(
			`the layout selected for '${key}' could not be rendered: ` +
				`${err?.message ?? err}. Fix it in the pipeline's settings, or ` +
				`switch that setting back to the one Serene Pub ships.`
		)
	}
}
