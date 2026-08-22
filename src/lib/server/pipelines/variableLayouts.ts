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

import { renderTemplate } from "./renderers"

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

export interface ShippedVariableTemplate {
	variableId: string
	/** The key this renders under — also how the template's scope is keyed. */
	key: string
	name: string
	source: string
	/** The in-code expression this row reproduces, byte for byte. */
	codeDefault: (value: unknown) => string
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
	content: { name: string; source: string; render: (v: unknown) => string }
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
			// Two spaces, and the number is load-bearing: the whitespace goes
			// into the prompt, so this is a parity constant rather than a
			// formatting preference.
			source: "{{{json characters 2}}}",
			render: asIndentedJson
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
			source: "{{{json personas 2}}}",
			render: asIndentedJson
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
			source: "{{{json worldLore 0}}}",
			render: asMinifiedJson
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
			source: "{{{json history 0}}}",
			render: asMinifiedJson
		},
		wrapper: {
			name: "Titled JSON block",
			wrap: jsonBlock("Story history:")
		}
	},
	{
		variableId: "core:var/speaker-relationships@1",
		key: "speakerRelationships",
		content: {
			name: "As written",
			// A passthrough, not `{{{json …}}}`: `buildGraphContext` already
			// returns a JSON string at indent 1, so stringifying here would
			// encode it a second time and put escaped quotes in the prompt.
			source: "{{{speakerRelationships}}}",
			render: asWritten
		},
		wrapper: {
			name: "Titled JSON block",
			wrap: jsonBlock("Your relationships:")
		}
	},
	{
		variableId: "core:var/current-date@1",
		key: "currentDate",
		content: {
			name: "As written",
			source: "{{{currentDate}}}",
			render: asWritten
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
			source: v.content.source,
			codeDefault: v.content.render,
			isDefault: !v.wrapper
		}
		if (!v.wrapper) return [content]
		const wrapped: ShippedVariableTemplate = {
			variableId: v.variableId,
			key: v.key,
			name: v.wrapper.name,
			source: v.wrapper.wrap(v.content.source),
			codeDefault: (value) => {
				const body = v.content.render(value)
				// Nothing to wrap is nothing at all. Through 0.5 the whole
				// block sat inside `{{#if worldLore}}`, so an absent value
				// produced no heading and no fence; that has to stay true now
				// that the heading has moved inside the value.
				return body === "" ? "" : v.wrapper!.wrap(body)
			},
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

export const seedKeyFor = (t: { variableId: string; name: string }): string =>
	`pipeline-variable-template:${t.variableId}:${t.name}`

/** What the `variables` slot resolves to, per key, once dereferenced. */
export type ResolvedLayouts = Record<
	string,
	{ engine?: string | null; source?: string } | undefined
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
export function renderVariable(
	layouts: ResolvedLayouts | undefined,
	key: string,
	value: unknown
): string {
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
		return renderTemplate(chosen.engine, {
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
