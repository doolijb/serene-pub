import Handlebars from "handlebars"
import { registerContextHandlebarsHelpers } from "$lib/shared/utils/contextHandlebarsHelpers"
import { PromptFormats } from "$lib/shared/constants/PromptFormats"
import { buildMockTemplateContext } from "./mockTemplateContext"
import { parseSplitChatPrompt } from "./utils"

export type PreviewMessage = { role: string; content: string }

// Compiles a draft (possibly unsaved) context config template against static mock story data,
// using the same helper set as the real prompt builder, without touching any chat/connection state.
// Renders with the role-tagged SPLIT_CHAT format so the result can be shown as distinct
// system/user/assistant blocks rather than one flat wall of text.
export function compileContextTemplatePreview(template: string): {
	messages?: PreviewMessage[]
	error?: string
} {
	try {
		const handlebars = Handlebars.create()
		registerContextHandlebarsHelpers(handlebars, {
			promptFormat: PromptFormats.SPLIT_CHAT
		})
		const compiled = handlebars.compile(template)
		const rendered = compiled(buildMockTemplateContext())
		const messages = parseSplitChatPrompt(
			rendered
		) as unknown as PreviewMessage[]
		return { messages }
	} catch (err: any) {
		return { error: err?.message || "Failed to render template" }
	}
}
