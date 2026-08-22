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
