import type Handlebars from "handlebars"
import { PromptBlockFormatter } from "./PromptBlockFormatter"

// Shared between the real prompt builder and the isolated preview compiler so both render identically.
export function registerContextHandlebarsHelpers(
	handlebars: typeof Handlebars,
	{ promptFormat }: { promptFormat: string }
) {
	if (!handlebars.helpers.eq)
		handlebars.registerHelper("eq", (a, b) => a === b)
	if (!handlebars.helpers.ne)
		handlebars.registerHelper("ne", (a, b) => a !== b)
	if (!handlebars.helpers.and)
		handlebars.registerHelper("and", (a, b) => a && b)
	if (!handlebars.helpers.or)
		handlebars.registerHelper("or", (a, b) => a || b)

	/**
	 * `{{pad n width}}` — a number as a fixed-width, zero-padded string.
	 *
	 * Exists so a *date* can be a date. `currentDate` used to arrive
	 * pre-formatted as `"412-03"`, built by `formatDate` in TypeScript, which
	 * made it the one context value whose layout could not change the thing
	 * the layout is for: separators, ordering, whether the month is padded,
	 * whether it is a number at all. The variable carries `{year, month, day}`
	 * now and the shipped layout does the formatting, which needs exactly this
	 * much arithmetic and no more.
	 */
	if (!handlebars.helpers.pad)
		handlebars.registerHelper("pad", (n: unknown, width: unknown) =>
			n == null
				? ""
				: String(n).padStart(typeof width === "number" ? width : 2, "0")
		)

	/**
	 * `{{#if (isSet x)}}` — present, as distinct from falsy.
	 *
	 * `{{#if}}` alone cannot tell an absent month from month zero, and a story
	 * with a zeroth month is a thing somebody will build. Every other
	 * "optional part of a value" question in a layout has the same shape.
	 */
	if (!handlebars.helpers.isSet)
		handlebars.registerHelper("isSet", (v: unknown) => v != null)

	// `{{{json value indent}}}` — the one helper a variable template needs to
	// reproduce what TypeScript does for it today. Every context variable is
	// currently stringified in code (templateContext.ts, assemble.ts) at one of
	// three indents, so the indent has to be an argument or the shipped
	// templates can't hit byte parity: characters/personas are `null, 2`,
	// worldLore/history are minified, speakerRelationships is `null, 1`.
	//
	// SafeString because escaping is ON in the render path (renderers.ts sets no
	// `noEscape`), and JSON is full of quotes. Callers still want the triple
	// stash for clarity, but this makes the double stash safe too.
	if (!handlebars.helpers.json) {
		handlebars.registerHelper("json", function (...args: any[]) {
			// Handlebars always appends its options object; the indent is
			// optional, so read positionally from what's left after dropping it.
			args.pop()
			const [value, indent] = args
			// JSON.stringify(undefined) returns the *value* undefined, not a
			// string — SafeString would then render "undefined" in the prompt.
			const out = JSON.stringify(value, null, indent ?? 0)
			return new handlebars.SafeString(out === undefined ? "" : out)
		})
	}

	// `{{{jsonValue x}}}` — one value, stringified the way it would be if it
	// were sitting at that position inside a larger `JSON.stringify(_, null, 2)`.
	//
	// This is what lets a shipped layout name its keys instead of handing the
	// whole object to `json`. "Drop personality" becomes a deletion and "rename
	// nickname to alias" becomes a rename, which is the inversion this feature
	// exists for — with `json` still there for whole-object rendering.
	//
	// The positional argument is an **indent offset**, not an indent. A nested
	// object two levels down is stringified by `JSON.stringify` as if its own
	// output had four spaces added to every line but the first, so that is
	// exactly what this does: `{{{jsonValue lore 4}}}` reproduces the nesting
	// rather than approximating it.
	//
	// `indent=` and `offset=` name the same two numbers where positional order
	// would be a guess: `{{{jsonValue yourRelationships indent=1 offset=1}}}`.
	if (!handlebars.helpers.jsonValue) {
		handlebars.registerHelper("jsonValue", function (...args: any[]) {
			const options = args.pop()
			const [value, positional] = args
			// `indent=` because not every block is written at two spaces — the
			// narrative graph is stringified at one, and a layout that could
			// not say so would be a byte off in every prompt that has one.
			const hash = options?.hash ?? {}
			const indent = hash.indent ?? 2
			const offset = hash.offset ?? positional
			const out = JSON.stringify(value, null, indent)
			// Same reason as `json`: SafeString would render the *value*
			// undefined as the text "undefined".
			if (out === undefined) return new handlebars.SafeString("")
			const pad = " ".repeat(Number(offset) || 0)
			return new handlebars.SafeString(
				pad ? out.split("\n").join("\n" + pad) : out
			)
		})
	}

	if (!handlebars.helpers.systemBlock) {
		handlebars.registerHelper(
			"systemBlock",
			function (this: any, options: any) {
				return PromptBlockFormatter.makeBlock({
					format: promptFormat,
					role: "system",
					content: options.fn(this)
				})
			}
		)
	}
	if (!handlebars.helpers.assistantBlock) {
		handlebars.registerHelper(
			"assistantBlock",
			function (this: any, options: any) {
				const messageId =
					this.id !== undefined
						? this.id
						: options.data && options.data.id
				return PromptBlockFormatter.makeBlock({
					format: promptFormat,
					role: "assistant",
					content: options.fn(this),
					includeClose: messageId !== -2
				})
			}
		)
	}
	if (!handlebars.helpers.userBlock) {
		handlebars.registerHelper(
			"userBlock",
			function (this: any, options: any) {
				return PromptBlockFormatter.makeBlock({
					format: promptFormat,
					role: "user",
					content: options.fn(this)
				})
			}
		)
	}
}
