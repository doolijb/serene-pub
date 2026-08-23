/**
 * Who can render a context template.
 *
 * A template carries its engine as data (`context_configs.engine`, 12 §2a), and
 * this is the registry that turns that id into a renderer. Core ships one —
 * Handlebars, with the helper set the existing story strings already use — and
 * an extension may register another.
 *
 * The reason this is a registry rather than a function is the whole point of
 * the ruling: **core's template language is a default, not an assumption.** A
 * plugin shipping its own assembler needs somewhere to say "these templates are
 * mine", and the alternative — inferring the language from the template text —
 * is a guess that gets confidently wrong on the first template that looks like
 * two languages at once.
 *
 * What a plugin cannot do here is replace the *core* engine. Registering
 * `core:template/handlebars@1` a second time is refused, because a plugin that
 * could redefine how everyone else's templates render would be able to change
 * every prompt on the instance without appearing anywhere in a spec.
 */

import Handlebars from "handlebars"
import { registerContextHandlebarsHelpers } from "$lib/shared/utils/contextHandlebarsHelpers"

export const CORE_TEMPLATE_ENGINE = "core:template/handlebars@1"

export interface RenderContext {
	template: string
	variables: Record<string, unknown>
	/** Passed through so an engine can honour the connection's prompt format. */
	promptFormat?: string
}

export type TemplateRenderer = (ctx: RenderContext) => string

const renderers = new Map<string, { render: TemplateRenderer; owner: string }>()

/** Core's renderer: the same construction the legacy prompt path uses. */
function renderHandlebars(ctx: RenderContext): string {
	const handlebars = Handlebars.create()
	registerContextHandlebarsHelpers(handlebars, {
		promptFormat: ctx.promptFormat ?? "vicuna"
	})
	return handlebars.compile(ctx.template)(ctx.variables)
}

renderers.set(CORE_TEMPLATE_ENGINE, { render: renderHandlebars, owner: "core" })

export class TemplateEngineError extends Error {}

/**
 * Register a renderer for a template engine.
 *
 * Called by an extension's load hook. Refuses to take over an engine somebody
 * else already owns — including core's — because the failure that would cause
 * is invisible: every template on the instance keeps rendering, differently.
 */
export function registerRenderer(
	engineId: string,
	owner: string,
	render: TemplateRenderer
): void {
	const existing = renderers.get(engineId)
	if (existing)
		throw new TemplateEngineError(
			`${engineId} is already rendered by '${existing.owner}'. Publish your engine under ` +
				`your own id instead — an engine two plugins can define is one where every ` +
				`template on the instance renders differently depending on load order.`
		)
	renderers.set(engineId, { render, owner })
}

/** Test-only: drop plugin-registered engines, keeping core's. */
export function _resetRenderers(): void {
	for (const id of [...renderers.keys()])
		if (id !== CORE_TEMPLATE_ENGINE) renderers.delete(id)
}

export const knownEngines = () =>
	[...renderers.entries()].map(([id, r]) => ({ id, owner: r.owner }))

/**
 * Render a template with whatever engine it declares.
 *
 * An unknown engine **throws rather than falling back to Handlebars**. A
 * fallback would render a foreign template as though it were Handlebars, which
 * mostly produces something — the text with its unrecognised syntax intact —
 * and that reaches a model as a prompt full of markup nobody meant to send. A
 * refusal names the engine and who could supply it.
 */
export function renderTemplate(
	engineId: string | null | undefined,
	ctx: RenderContext
): string {
	const id = engineId ?? CORE_TEMPLATE_ENGINE
	const renderer = renderers.get(id)
	if (!renderer)
		throw new TemplateEngineError(
			`no renderer for template engine '${id}'. Core renders ${CORE_TEMPLATE_ENGINE}; ` +
				`others come from an extension that registers one. Known: ` +
				`${knownEngines()
					.map((e) => `${e.id} (${e.owner})`)
					.join(", ")}`
		)
	return renderer.render(ctx)
}
