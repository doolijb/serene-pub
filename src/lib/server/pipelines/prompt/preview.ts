/**
 * What a template draft would produce, without a session.
 *
 * The editors need this for a reason the panel does not: a layout or a context
 * template can be *syntactically fine and render nothing*. `{{#each character}}`
 * over a scope whose key is `characters` produces an empty string, and there is
 * no error anywhere — you find out when a reply arrives with no cast in it. A
 * preview is what turns that into something you can see while typing.
 *
 * ## Why the sample data comes from the registry
 *
 * The version this replaces (`promptBuilder/mockTemplateContext.ts`) hand-wrote
 * a second definition of every variable's shape, and it had already drifted:
 * it rendered `worldLore` and `history` as `JSON.stringify([{name, content}], null, 2)`
 * where the real path produces a **keyed object, minified**. So the preview
 * showed a shape no prompt has ever contained — worse than no preview, because
 * a template written against it looks correct here and renders empty in a session.
 *
 * Every variable now declares its own `sample` alongside its `scope`
 * (sdk/src/variables.ts), so there is one definition and the preview renders
 * the shape the node actually emits. What is left here is only the material no
 * variable owns: the message loop, the macro scalars, the budget.
 *
 * ## The preview renders *through* the layouts
 *
 * A context template receives variables that a layout has already rendered, so
 * a preview that stringified the samples itself would show the wrong thing the
 * moment anyone selected a prose layout. It calls `renderVariable` with the
 * same resolved layouts the run would use, which also means the two previews
 * compose: change a layout, and the context preview updates with it.
 */

import { getVariable, allVariables, sampleValues } from "@serene-pub/sdk"
import { PromptFormats } from "$lib/shared/constants/PromptFormats"
import { parseSplitChatPrompt } from "$lib/shared/utils/parseSplitChatPrompt"
import { renderTemplate } from "$lib/server/pipelines/prompt/renderers"
import {
	renderVariable,
	shippedRowsByKey,
	type ResolvedLayouts
} from "$lib/server/pipelines/entities/variableLayouts"

export interface PreviewMessage {
	role: string
	content: string
}

/**
 * The parts of a context template's scope that no variable declares.
 *
 * The message loop is here rather than in the registry because the parent
 * template loops it — it is structure, not presentation, and a layout for it
 * would have nothing to lay out. Same for the macro scalars and the budget.
 */
function structuralContext(): Record<string, unknown> {
	return {
		char: "Ash",
		character: "Ash",
		user: "Rell",
		persona: "Rell",
		budget: { total: 4096, used: 1180, remaining: 2916 },
		postHistory: {
			// Depth 0 against the three messages below — immediately after the
			// last one, which is where the reminder actually goes at run time.
			targetIndex: 2,
			instructions:
				"Remember: stay in character as Ash. Do not speak or act for Rell.",
			charInstructions:
				"Keep it to two or three paragraphs, and end on something Rell can answer.",
			exampleDialogue: '"You picked a poor season for it."',
			hasContent: true
		},
		sessionMessages: [
			{
				id: 1,
				role: "user",
				name: "Rell",
				message: "How much further to the ridge?"
			},
			{
				id: 2,
				role: "assistant",
				name: "Ash",
				message:
					'Ash squinted at the horizon, then at the ash on the wind. "An hour, if the wind holds. Three if it turns."'
			},
			{
				id: 3,
				role: "user",
				name: "Rell",
				message: "And if it turns?"
			}
		]
	}
}

/**
 * Every declared variable's sample, rendered through the layout in force.
 *
 * Keyed by the scope key rather than the variable id, because that is what a
 * template writes: `{{{characters}}}`, not `{{{core:var/characters@1}}}`.
 */
export function sampleContext(
	layouts?: ResolvedLayouts
): Record<string, unknown> {
	const out: Record<string, unknown> = structuralContext()
	for (const decl of allVariables()) {
		const values = sampleValues(decl)
		for (const key of Object.keys(decl.scope))
			out[key] = renderVariable(layouts, key, values[key])
	}
	return out
}

/**
 * The layouts that write no heading of their own.
 *
 * What an archived `context_configs` row is pinned to, because those templates
 * carry their own headings and fences — so a preview of one has to use the bare
 * rows or every block comes out wrapped twice. Exactly the doubling the wrapper
 * migration exists to prevent, and a preview that showed it would send someone
 * hunting a bug that is only in the preview.
 */
export function bareLayouts(): ResolvedLayouts {
	const out: ResolvedLayouts = {}
	for (const [key, rows] of shippedRowsByKey)
		for (const row of rows)
			if (!row.isDefault) out[key] = { source: row.source }
	return out
}

export interface ContextPreviewInput {
	source: string
	engine?: string | null
	/** The layouts a run would resolve. Absent means every shipped default. */
	layouts?: ResolvedLayouts
}

/**
 * Render a context template draft as role-tagged blocks.
 *
 * Split-session format so the result can be shown as distinct system/user/assistant
 * sections rather than one wall of text — the same reason the editor it feeds
 * has always used it.
 */
export function previewContextTemplate(input: ContextPreviewInput): {
	messages?: PreviewMessage[]
	error?: string
} {
	try {
		const rendered = renderTemplate(input.engine, {
			template: input.source,
			variables: sampleContext(input.layouts),
			promptFormat: PromptFormats.SPLIT_CHAT
		})
		return {
			messages: parseSplitChatPrompt(
				rendered
			) as unknown as PreviewMessage[]
		}
	} catch (err: any) {
		return { error: err?.message || "Failed to render template" }
	}
}

export interface VariablePreviewInput {
	source: string
	engine?: string | null
	variableId: string
}

/**
 * Render a layout draft against its variable's declared sample.
 *
 * Returns the string the context template would receive — so what you see here
 * is exactly what `{{{characters}}}` will be, wrappers included.
 */
export function previewVariableTemplate(input: VariablePreviewInput): {
	rendered?: string
	error?: string
} {
	const decl = getVariable(input.variableId)
	if (!decl)
		return {
			// A plugin's variable whose plugin is disabled: the row is still
			// editable, there is just nothing to render it against.
			error:
				`Nothing on this instance declares ${input.variableId}, so there is no ` +
				`sample to preview against. The layout is still saved and still used.`
		}

	try {
		const scope: Record<string, unknown> = sampleValues(decl)
		return {
			rendered: renderTemplate(input.engine, {
				template: input.source,
				variables: scope,
				promptFormat: PromptFormats.SPLIT_CHAT
			})
		}
	} catch (err: any) {
		return { error: err?.message || "Failed to render layout" }
	}
}
