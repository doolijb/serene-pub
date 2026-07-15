import type Handlebars from "handlebars"
import { PromptBlockFormatter } from "./PromptBlockFormatter"

// Shared between the real prompt builder and the isolated preview compiler so both render identically.
export function registerContextHandlebarsHelpers(
	handlebars: typeof Handlebars,
	{ promptFormat }: { promptFormat: string }
) {
	if (!handlebars.helpers.eq) handlebars.registerHelper("eq", (a, b) => a === b)
	if (!handlebars.helpers.ne) handlebars.registerHelper("ne", (a, b) => a !== b)
	if (!handlebars.helpers.and) handlebars.registerHelper("and", (a, b) => a && b)
	if (!handlebars.helpers.or) handlebars.registerHelper("or", (a, b) => a || b)

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
					this.id !== undefined ? this.id : options.data && options.data.id
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
