/**
 * Plugin-declared template engines — the runtime half of 12 §2a's ruling that
 * **core's template language is a default, not an assumption.**
 *
 * The registry (`prompt/renderers.ts`) has been shaped for this from the start:
 * a template row carries its engine id as data, an unknown engine refuses by
 * name, and core's own engine cannot be redefined. What was missing is the door
 * an *out-of-process* plugin walks through: `registerRenderer` takes a
 * function, and a sandboxed plugin cannot hand core one.
 *
 * So the manifest declares, and core forwards — the same posture as hooks
 * (`hookTypes`) and for the same reason: the manifest is the one source of
 * truth core can read without executing the plugin (F6, 13 §10c).
 *
 *     "engines": { "acme.x:template/mustache@1": "renderMustache" }
 *
 * At sync, each declared engine gets a forwarding renderer that calls the
 * plugin's exported hook through the `RuntimeManager` — permission-checked,
 * time-boxed, output-capped, logged, like every other hook. The render seam
 * (`renderTemplate`) is async either way, so the pipeline never learns whether
 * a template rendered in-process or out.
 *
 * ## Determinism
 *
 * A template render must be a pure function of `(template, variables)`: the
 * assemble step runs inside a replayable pipeline, and an engine that answered
 * differently on replay would make the receipt a lie. The forwarding call
 * therefore pins the sandbox clock (`nowMs: 0`) and seeds the RNG from the
 * engine id alone — an engine that *wants* nondeterminism gets determinism
 * instead, which is the contract, not a limitation.
 *
 * ## Failure is loud, never a fallback
 *
 * A failed engine call throws `TemplateEngineError`, which surfaces exactly
 * like an unregistered engine: the render fails with the engine named. This is
 * the standing rule (renderers.ts) — a fallback to Handlebars would mostly
 * "work", emitting the foreign syntax intact into somebody's prompt.
 */

import { eq } from "drizzle-orm"
import { plugins } from "$lib/server/db/schema"
import {
	registerRenderer,
	releaseRenderer,
	TemplateEngineError,
	type RenderContext
} from "$lib/server/pipelines/prompt/renderers"
import type { RuntimeManager } from "./RuntimeManager"

type Db = { select: any }

/**
 * Generous against the in-process default (250ms) because a plugin engine is a
 * worker round trip rendering what may be a whole context template; still a
 * hard box — a template render that needs longer than this is not a template
 * render.
 */
export const ENGINE_TIMEOUT_MS = 3_000

/** A rendered context can be large; a runaway one still cannot be unbounded. */
export const ENGINE_MAX_OUTPUT_BYTES = 4 * 1024 * 1024

/**
 * The engine-id grammar, same shape family as script types: namespaced,
 * one payload segment, pinned. `core:template/handlebars@1` is the exemplar.
 */
const ENGINE_ID =
	/^([a-z0-9][a-z0-9.-]*):template\/([a-z0-9][a-z0-9-]*)@(\d+)$/

/**
 * The namespace a plugin's engines must live under: its manifest id with the
 * one `/` flattened to `.` — `acme/x` declares under `acme.x:`, the same
 * convention plugin-owned script types already use. Ownership by grammar, so
 * a plugin claiming `core:` or a neighbour's namespace is refused at sync
 * with a sentence, not discovered at render time as a mystery.
 */
export const engineNamespaceOf = (pluginId: string): string =>
	pluginId.replace("/", ".")

/** Read `engines` off a stored manifest, tolerant of its json being anything. */
export function engineTypesOf(manifest: unknown): Record<string, string> {
	const raw =
		manifest && typeof manifest === "object"
			? (manifest as any).engines
			: undefined
	if (!raw || typeof raw !== "object") return {}
	const out: Record<string, string> = {}
	for (const [engineId, hook] of Object.entries(
		raw as Record<string, unknown>
	))
		if (typeof hook === "string" && hook) out[engineId] = hook
	return out
}

/** Why a declared engine cannot be registered, or null if it can. */
export function engineDeclarationError(
	pluginId: string,
	engineId: string
): string | null {
	const m = ENGINE_ID.exec(engineId)
	if (!m)
		return (
			`'${engineId}' is not a template engine id. The grammar is ` +
			`'<namespace>:template/<name>@<major>' — 'acme.x:template/mustache@1'.`
		)
	const ns = engineNamespaceOf(pluginId)
	if (m[1] !== ns)
		return (
			`'${engineId}' is not in this extension's namespace. '${pluginId}' ` +
			`declares engines under '${ns}:' — an engine two parties could claim ` +
			`is one where every template on the instance renders differently ` +
			`depending on install order.`
		)
	return null
}

/** What this module registered, so a re-sync can release what no longer holds. */
const registered = new Map<string, { pluginId: string; hookName: string }>()

function forwardingRenderer(
	manager: RuntimeManager,
	pluginId: string,
	engineId: string,
	hookName: string
) {
	return async (ctx: RenderContext): Promise<string> => {
		const r = await manager.callHook(
			pluginId,
			hookName,
			{
				template: ctx.template,
				variables: ctx.variables,
				promptFormat: ctx.promptFormat ?? null
			},
			{
				timeoutMs: ENGINE_TIMEOUT_MS,
				maxOutputBytes: ENGINE_MAX_OUTPUT_BYTES,
				// Purity pins — see the header. One label per engine, a clock
				// that never moves: the render is a function of its inputs.
				seedLabel: `engine:${engineId}`,
				nowMs: 0
			}
		)
		if (!r.ok)
			throw new TemplateEngineError(
				`template engine '${engineId}' (${pluginId}) failed to render: ` +
					`${r.reason ?? r.outcome}`
			)
		if (typeof r.value !== "string")
			throw new TemplateEngineError(
				`template engine '${engineId}' (${pluginId}) returned ` +
					`${r.value === null ? "null" : typeof r.value} where a ` +
					`rendered string was expected`
			)
		return r.value
	}
}

/**
 * Reconcile the renderer registry with what enabled plugins declare.
 *
 * Global rather than per-plugin on purpose: the desired state is a projection
 * of the `plugins` table, and reconciling toward it makes every caller —
 * boot, enable, disable, uninstall — the same one-line call with no ordering
 * to get wrong. Per-engine failures warn and continue; one plugin's bad
 * declaration must not cost another's engine.
 */
export async function syncPluginEngines(
	db: Db,
	manager: RuntimeManager
): Promise<void> {
	const rows: Array<{
		pluginId: string
		enabled: boolean
		manifest: unknown
	}> = await db
		.select({
			pluginId: plugins.pluginId,
			enabled: plugins.enabled,
			manifest: plugins.manifest
		})
		.from(plugins)
		.where(eq(plugins.enabled, true))

	const desired = new Map<string, { pluginId: string; hookName: string }>()
	for (const row of rows)
		for (const [engineId, hookName] of Object.entries(
			engineTypesOf(row.manifest)
		)) {
			const problem = engineDeclarationError(row.pluginId, engineId)
			if (problem) {
				console.warn(`[plugins] engine skipped: ${problem}`)
				continue
			}
			if (desired.has(engineId)) {
				console.warn(
					`[plugins] engine '${engineId}' declared twice; keeping ` +
						`'${desired.get(engineId)!.pluginId}'`
				)
				continue
			}
			desired.set(engineId, { pluginId: row.pluginId, hookName })
		}

	// Release what no longer holds — disabled, uninstalled, or re-declared
	// differently. Releasing is owner-checked in the registry itself.
	for (const [engineId, held] of [...registered]) {
		const want = desired.get(engineId)
		if (want?.pluginId === held.pluginId && want.hookName === held.hookName)
			continue
		releaseRenderer(engineId, held.pluginId)
		registered.delete(engineId)
	}

	for (const [engineId, want] of desired) {
		if (registered.has(engineId)) continue
		try {
			registerRenderer(
				engineId,
				want.pluginId,
				forwardingRenderer(
					manager,
					want.pluginId,
					engineId,
					want.hookName
				)
			)
			registered.set(engineId, want)
		} catch (e) {
			// Somebody in-process already owns the id (core's, or a test's).
			console.warn(
				`[plugins] engine '${engineId}' not registered: ${String(e)}`
			)
		}
	}
}

/** Test-only: forget what was registered (pair with `_resetRenderers`). */
export function _resetEngineHost(): void {
	registered.clear()
}
