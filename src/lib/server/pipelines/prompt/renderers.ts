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

/**
 * May be async: a plugin's engine runs out-of-process through the runtime
 * manager, so its render is a round trip. Core's stays synchronous; the seam
 * (`renderTemplate`) is async either way so a caller cannot tell — which is
 * the same "never learns which ran" posture the script fold takes.
 */
export type TemplateRenderer = (ctx: RenderContext) => string | Promise<string>

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

/**
 * Release an engine a plugin registered — the disable/uninstall half of
 * `registerRenderer`, called by the engine host's sync and nobody else.
 *
 * Owner-checked for the same reason registration is: a plugin that could
 * release somebody else's engine could make every template on that engine
 * stop rendering by asking nicely. Core's engine is not releasable at all.
 * Releasing an id nobody holds is a no-op, not an error — the sync that calls
 * this reconciles toward a desired state, and "already gone" is that state.
 */
export function releaseRenderer(engineId: string, owner: string): void {
	if (engineId === CORE_TEMPLATE_ENGINE) return
	const existing = renderers.get(engineId)
	if (existing && existing.owner === owner) renderers.delete(engineId)
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
 *
 * ## `engineId` is required, and an absent one throws
 *
 * It used to be `string | null | undefined`, defaulting to core's engine. That
 * default is how the delivery bug survived a release: `derefTemplate` returned
 * a bare source string, so `input.template.engine` was `undefined` on every
 * run on every install, and this function silently answered "then it must be
 * Handlebars". Every context template rendered in core's language no matter
 * what it declared, and there was nothing anywhere to see — a Jinja template
 * would have shipped its raw `{% %}` markup to the model as prose.
 *
 * Both template tables now store `engine` NOT NULL, so a null arriving here
 * can no longer mean "the row did not say". It can only mean a caller dropped
 * it between the row and this call, which is precisely the defect above. It is
 * therefore a fault, and it is raised as one.
 */
export async function renderTemplate(
	engineId: string,
	ctx: RenderContext
): Promise<string> {
	if (!engineId)
		throw new TemplateEngineError(
			`renderTemplate was called with no template engine. A template carries its ` +
				`engine on the row (both template tables store it NOT NULL), so an absent ` +
				`one means the value was dropped on the way here rather than never chosen. ` +
				`Pass the engine the row declares — defaulting to ${CORE_TEMPLATE_ENGINE} ` +
				`here is what previously rendered every template in core's language whatever ` +
				`it was written in.`
		)
	const renderer = renderers.get(engineId)
	if (!renderer)
		throw new TemplateEngineError(
			`no renderer for template engine '${engineId}'. Core renders ${CORE_TEMPLATE_ENGINE}; ` +
				`others come from an extension that registers one. Known: ` +
				`${knownEngines()
					.map((e) => `${e.id} (${e.owner})`)
					.join(", ")}`
		)
	return await renderer.render(ctx)
}
