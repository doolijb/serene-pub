/**
 * Core's Liquid engine: the LiquidJS instance a `core:template/liquid@1` row is
 * rendered by, and the same instance the template validator parses with.
 *
 * Liquid sits **beside** Handlebars rather than replacing it. Both engines see
 * the identical context object and are expected to produce identical bytes from
 * equivalent sources — `liquidParity.test.ts` asserts exactly that against the
 * shipped templates — so everything configured here is chosen to make that
 * equivalence hold rather than to be idiomatic Liquid.
 *
 * ## The three settings parity depends on
 *
 * - **`jsTruthy: true`.** Stock Liquid treats `""`, `0` and `[]` as truthy;
 *   only `nil` and `false` are falsy. Every context variable arrives as a
 *   string that is `""` when the variable is empty, so under stock truthiness
 *   `{% if scenario %}` would emit a heading above nothing on every prompt that
 *   has no scenario. JS truthiness is what `{{#if}}` already means here.
 *   ⚠ It does not close the gap for arrays: `[]` is truthy in JavaScript and
 *   falsy in Handlebars. `{% if xs != empty %}` is the form that survives.
 * - **`greedy: false`.** Bounds `{%-`/`-%}` to the line rather than letting it
 *   swallow every consecutive blank character. Handlebars removes a standalone
 *   block tag's own line and nothing more; with `greedy` left at its default a
 *   trim would eat the blank lines the templates use to separate blocks, and no
 *   spelling of the fixture could recover them.
 * - **`strictFilters: true`.** A misspelled filter refuses at parse time
 *   instead of silently rendering the unfiltered value, which is the failure
 *   that reaches a model as a prompt nobody wrote.
 *
 * `strictVariables` stays **false**, matching Handlebars: an absent context
 * variable renders empty. Variables that the contract does not supply are
 * reported as warnings by `templateValidation.ts`, which is a better place for
 * that news than a render that dies mid-prompt.
 *
 * ## What is refused
 *
 * `{% include %}`, `{% render %}` and `{% layout %}` are replaced by tags that
 * throw at PARSE time, and the filesystem is stubbed out underneath them. A
 * context template is a row in a table; there is no directory it could
 * legitimately read, and an engine that can open files is one an admin-authored
 * template can use to read the install.
 *
 * Output escaping is left off (`outputEscape` unset), because a prompt is plain
 * text — the same reason the Handlebars path renders through `{{{...}}}`.
 */

import { Liquid, Tag, Hash } from "liquidjs"
import type {
	Context,
	Emitter,
	Template,
	TagToken,
	TopLevelToken
} from "liquidjs"
import type { CompletionTemplate } from "$lib/shared/constants/completionTemplates"
import { PromptBlockFormatter, type BlockRole } from "./PromptBlockFormatter"
import {
	CONTEXT_LIQUID_REFUSED_TAGS,
	LIQUID_PARSE_LIMIT
} from "./templateCheckOptions"

/**
 * Hard ceiling on one render, in milliseconds.
 *
 * Liquid has no recursion and no user functions, but `{% for %}` over a large
 * collection with a `{% cycle %}` inside it is enough to make a template that
 * does not finish. Matches the in-process budget a plugin engine gets nowhere
 * near (`engineHost.ts` boxes those at 3s across a worker round trip).
 */
const LIQUID_RENDER_LIMIT_MS = 3_000

/** Objects one render may allocate, the `concat`/`join` runaway ceiling. */
const LIQUID_MEMORY_LIMIT = 100_000_000

/**
 * The filesystem Liquid gets: none.
 *
 * Belt and braces behind the refused tags. Nothing in core reaches these, and
 * a plugin that re-registered `include` would find them here rather than a
 * working loader.
 */
const NO_FILESYSTEM = {
	exists: async () => false,
	existsSync: () => false,
	readFile: async (): Promise<string> => {
		throw new Error("templates are rows, not files")
	},
	readFileSync: (): string => {
		throw new Error("templates are rows, not files")
	},
	resolve: (): string => {
		throw new Error("templates are rows, not files")
	},
	contains: async () => false,
	containsSync: () => false
}

/**
 * `{% include %}` and friends: a parse-time refusal that names the tag. The
 * sentence lives with the names (`templateCheckOptions.ts`) so the SDK's
 * checker refuses in the same words.
 */
function refusedTag(message: string) {
	return class extends Tag {
		constructor(
			token: TagToken,
			remainTokens: TopLevelToken[],
			liquid: Liquid
		) {
			super(token, remainTokens, liquid)
			throw new Error(message)
		}
		*render() {}
	}
}

/**
 * `{% systemBlock %}…{% endsystemBlock %}` and its two siblings.
 *
 * Named exactly as the Handlebars helpers are, camelCase and all, so porting a
 * template between the two engines is a change of delimiters rather than a
 * change of vocabulary.
 *
 * `assistantBlock` takes an optional `id:` — `{% assistantBlock id: m.id %}`.
 * Handlebars reads it off the block's implicit `this`; Liquid has no implicit
 * scope, so the loop variable is named. Its one job is the seed line: the
 * placeholder message carries `id === -2` and its closing delimiter is omitted
 * so the model continues that turn instead of starting a new one.
 */
function blockTag(role: BlockRole, promptFormat: string | CompletionTemplate) {
	return class extends Tag {
		private readonly args: Hash
		private readonly body: Template[] = []

		constructor(
			token: TagToken,
			remainTokens: TopLevelToken[],
			liquid: Liquid,
			parser: { parseStream: (t: TopLevelToken[]) => any }
		) {
			super(token, remainTokens, liquid)
			this.args = new Hash(token.args, liquid.options.keyValueSeparator)
			const body = this.body
			parser
				.parseStream(remainTokens)
				.on("template", (tpl: Template) => body.push(tpl))
				.on(`tag:end${token.name}`, function (this: any) {
					this.stop()
				})
				.on("end", () => {
					throw new Error(`tag ${token.getText()} not closed`)
				})
				.start()
		}

		*render(ctx: Context, emitter: Emitter): Generator<unknown, void, any> {
			const hash = yield this.args.render(ctx)
			const content = yield this.liquid.renderer.renderTemplates(
				this.body,
				ctx
			)
			emitter.write(
				PromptBlockFormatter.makeBlock({
					format: promptFormat,
					role,
					content: String(content),
					includeClose: hash.id !== -2
				})
			)
		}

		/** So `analyzeSync` can see the variables the body references. */
		*children(): Generator<unknown, Template[]> {
			return this.body
		}
	}
}

/** `{{ n | pad: 2 }}` — the Handlebars `pad` helper, as a filter. */
const padFilter = (n: unknown, width: unknown = 2) =>
	n == null
		? ""
		: String(n).padStart(typeof width === "number" ? width : 2, "0")

/** `{{ value | json }}` / `{{ value | json: 2 }}` — the `json` helper. */
const jsonFilter = (value: unknown, indent: unknown = 0) => {
	const out = JSON.stringify(value, null, (indent as number) ?? 0)
	return out === undefined ? "" : out
}

/**
 * `{{ value | jsonValue: 4 }}` / `{{ value | jsonValue: indent: 1, offset: 1 }}`
 *
 * The positional argument is an indent OFFSET, not an indent — a value nested
 * two levels inside a `JSON.stringify(_, null, 2)` is printed as though four
 * spaces were added to every line but its first, and this reproduces that
 * rather than approximating it. LiquidJS hands keyword arguments through as
 * `[name, value]` pairs, so both spellings land in the same rest parameter.
 */
const jsonValueFilter = (value: unknown, ...args: unknown[]) => {
	let indent: unknown = 2
	let offset: unknown = undefined
	for (const arg of args) {
		if (Array.isArray(arg)) {
			const [key, val] = arg as [string, unknown]
			if (key === "indent") indent = val
			else if (key === "offset") offset = val
		} else if (offset === undefined) offset = arg
	}
	const out = JSON.stringify(value, null, indent as number)
	if (out === undefined) return ""
	const pad = " ".repeat(Number(offset) || 0)
	return pad ? out.split("\n").join("\n" + pad) : out
}

export interface ContextLiquidOptions {
	/**
	 * The resolved `completion_templates` ROW when the caller loaded one, and
	 * only then the key.
	 *
	 * A bare key resolves against the BUILT-INS only, so passing one where a
	 * row exists renders eight formats correctly and silently substitutes the
	 * default for every other row in the table — the same rule the Handlebars
	 * path states at its own registration site.
	 */
	promptFormat: string | CompletionTemplate
}

/**
 * A configured LiquidJS instance.
 *
 * ⚠ **One per render.** The block tags close over `promptFormat`, so a shared
 * instance would pin every prompt on the install to whichever connection
 * rendered first — the same reason `renderers.ts` calls `Handlebars.create()`
 * per render.
 */
export function createContextLiquid({
	promptFormat
}: ContextLiquidOptions): Liquid {
	const liquid = new Liquid({
		// See the module header: these three are what byte parity rests on.
		jsTruthy: true,
		greedy: false,
		strictFilters: true,
		// Absent variable renders empty, exactly as `{{{missing}}}` does.
		strictVariables: false,
		// Prompts are plain text. No escaping, in either engine.
		outputEscape: undefined,
		// Prototype properties are not template-reachable.
		ownPropertyOnly: true,
		// Nothing to cache when every instance renders one template once.
		cache: false,
		// Unreachable behind the refused tags; set so a re-registration finds
		// no working loader rather than the process's own directory.
		root: [],
		partials: [],
		layouts: [],
		relativeReference: false,
		fs: NO_FILESYSTEM,
		parseLimit: LIQUID_PARSE_LIMIT,
		renderLimit: LIQUID_RENDER_LIMIT_MS,
		memoryLimit: LIQUID_MEMORY_LIMIT
	})

	for (const [name, message] of Object.entries(CONTEXT_LIQUID_REFUSED_TAGS))
		liquid.registerTag(name, refusedTag(message) as any)

	liquid.registerTag("systemBlock", blockTag("system", promptFormat) as any)
	liquid.registerTag(
		"assistantBlock",
		blockTag("assistant", promptFormat) as any
	)
	liquid.registerTag("userBlock", blockTag("user", promptFormat) as any)

	liquid.registerFilter("pad", padFilter)
	liquid.registerFilter("json", jsonFilter)
	liquid.registerFilter("jsonValue", jsonValueFilter)

	return liquid
}
