/**
 * `defineExtension` — the one entry point a plugin author starts from (03, 09).
 *
 * Before this existed, the SDK could express a pipeline and nothing else. An author could
 * build a spec but had nowhere to say *"this is my plugin, here are its lifecycle hooks,
 * its settings, its node types, its components, and the pipelines it ships."* That is the
 * difference between authoring a pipeline and writing a plugin, and it is most of what
 * "download the SDK" has to mean.
 *
 * Everything here is a **literal declaration**, because the compiler extracts it from the
 * source without executing it (F6, 03 §3, 13/§30). A registration assembled at runtime is
 * a lint error rather than a silent omission — the manifest has to be a complete statement
 * of what a plugin can do, or the permission model is a guess.
 */

import type { BuiltSpec } from './builder.js'
import type { Descriptor } from './descriptors.js'
import type { PluginSettings, SettingsSchema } from './settings.js'
import type { EventHook, LifecycleHook, LifecycleMoment } from './hooks.js'
import type { Result } from './executor.js'

// ── Hook declarations ───────────────────────────────────────────────────────

/**
 * The callable implementing a node type. Data in, expected shape out; the executor is the
 * only caller (01 §9). **Private** means only this extension's specs may pin it; **public**
 * means any spec may, which is how peer composition happens — as a node on the spine,
 * never a peer call mid-run (F10).
 */
export interface PipelineHookDecl<D extends Descriptor<any, any, any> = Descriptor> {
	readonly __decl: 'pipeline-hook'
	type: D
	visibility: 'private' | 'public'
	handler: (input: any, ctx: any) => Result | Promise<Result>
	/**
	 * Always its own process. There is no in-process option, and that is a rule
	 * rather than a default.
	 *
	 * An extension hook running inside Serene Pub's process cannot be stopped —
	 * a runaway loop or a blocking call takes the whole application with it, and
	 * F36's promise that every hook invocation is bounded becomes unenforceable
	 * (13 §7h). It also shares the host's memory, so a crash is the host's crash
	 * and a leak is the host's leak.
	 *
	 * Kept as a field rather than dropped because the *value* still travels into
	 * the registry row, where install-time validation reads it without executing
	 * the plugin (F6). A manifest claiming anything else is refused there.
	 */
	runtime?: 'process'
}

export function pipelineHook<D extends Descriptor<any, any, any>>(
	type: D | { descriptor: D },
	handler: PipelineHookDecl<D>['handler'],
	opts: { visibility?: 'private' | 'public' } = {},
): PipelineHookDecl<D> {
	const descriptor = ('descriptor' in type ? type.descriptor : type) as D
	return {
		__decl: 'pipeline-hook',
		type: descriptor,
		visibility: opts.visibility ?? (descriptor.public ? 'public' : 'private'),
		handler,
		// Not configurable. See the note on the field.
		runtime: 'process',
	}
}

export interface LifecycleHookDecl {
	readonly __decl: 'lifecycle-hook'
	moment: LifecycleMoment
	/** For `scheduled`: how often. Model work belongs in a pipeline, not here (F32). */
	cadence?: string
	handler: LifecycleHook
	timeoutMs?: number
}

export const lifecycleHook = (
	moment: LifecycleMoment,
	handler: LifecycleHook,
	opts: { cadence?: string; timeoutMs?: number } = {},
): LifecycleHookDecl => ({ __decl: 'lifecycle-hook', moment, handler, ...opts })

export interface EventHookDecl {
	readonly __decl: 'event-hook'
	/** A core event slug. Plugins cannot define events in SDK 1.0 (F8, 13 §7g). */
	event: string
	handler: EventHook
	timeoutMs?: number
}

export const eventHook = (event: string, handler: EventHook, opts: { timeoutMs?: number } = {}): EventHookDecl => ({
	__decl: 'event-hook',
	event,
	handler,
	...opts,
})

// ── Components ──────────────────────────────────────────────────────────────

export interface ComponentDecl {
	readonly __decl: 'component'
	/** The surface it mounts into, e.g. `core:surface/chat-message@1` (10). */
	surface: string
	slug: string
	label: string
	/** Which adapter renders it. All three are framework-neutral against one ABI (10 §4). */
	framework: 'svelte' | 'react' | 'vanilla'
	/** Path to the built asset, relative to the plugin root. Resolved at install. */
	entry: string
	/** Component-side settings this component reads through `ctx` (12 §6). */
	settings?: SettingsSchema
}

export const component = (d: Omit<ComponentDecl, '__decl'>): ComponentDecl => ({ __decl: 'component', ...d })

// ── The extension ───────────────────────────────────────────────────────────

export interface ExtensionDecl {
	/** `vendor.plugin` — the owner segment of every id this plugin registers (F2). */
	slug: string
	name: string
	version: string
	description?: string
	/** Supported SP range, separate from the SDK range (09). */
	engines?: { 'serene-pub'?: string }
	settings?: PluginSettings<any>
	/** Node types this plugin registers, and the hooks that implement them. */
	hooks?: Array<PipelineHookDecl<any> | LifecycleHookDecl | EventHookDecl>
	components?: ComponentDecl[]
	/** Pipelines shipped with the plugin. Compiled to documents at build time (F6). */
	pipelines?: BuiltSpec[]
	/**
	 * Dependencies on **public pipeline hooks** other plugins expose. Type-level pins
	 * only; runtime peer invocation is banned (F10, 01 §9b).
	 */
	peerTypes?: string[]
}

export interface Extension extends ExtensionDecl {
	readonly __extension: true
}

export class ExtensionError extends Error {}

const SLUG = /^[a-z0-9]+([.-][a-z0-9]+)*$/

/**
 * Declare a plugin. Validated here rather than at install, because an error an author
 * sees while writing costs a minute and the same error at install costs a support thread.
 */
export function defineExtension(d: ExtensionDecl): Extension {
	const problems: string[] = []
	if (!SLUG.test(d.slug)) {
		problems.push(
			`'${d.slug}' is not a valid plugin slug — lowercase letters, digits, dots and hyphens ` +
				`(e.g. 'chariot.dice-tray'). It is the namespace every id you register must sit under.`,
		)
	}
	if (!/^\d+\.\d+\.\d+/.test(d.version)) {
		problems.push(`'${d.version}' is not semver. A plugin upgrades by version comparison (12 §3b).`)
	}

	// Every id a plugin registers must sit under its own namespace. `core:` is reserved
	// and the registry rejects it, but a plugin claiming *another plugin's* namespace
	// would be accepted and would break ownership-based updates (12 §3b).
	for (const h of d.hooks ?? []) {
		if (h.__decl !== 'pipeline-hook') continue
		const ns = h.type.id.split(':')[0]
		if (ns !== d.slug) {
			problems.push(
				`type '${h.type.id}' is registered by plugin '${d.slug}' but sits under namespace '${ns}'. ` +
					`Rename it to '${d.slug}:…' — ownership is what lets an update replace your rows and ` +
					`leave everyone else's alone.`,
			)
		}
	}

	for (const p of d.pipelines ?? []) {
		const ns = p.id.split(':')[0]
		if (p.id.includes(':') && ns !== d.slug) {
			problems.push(`pipeline '${p.id}' sits under namespace '${ns}', not '${d.slug}'.`)
		}
	}

	const seen = new Set<string>()
	for (const c of d.components ?? []) {
		if (seen.has(c.slug)) problems.push(`duplicate component slug '${c.slug}' — slugs are the sync key (12 §3b).`)
		seen.add(c.slug)
	}

	if (problems.length) {
		throw new ExtensionError(`invalid extension '${d.slug}':\n` + problems.map((p) => `  • ${p}`).join('\n'))
	}
	return { __extension: true, ...d }
}

// ── Derived views ───────────────────────────────────────────────────────────

export const pipelineHooksOf = (e: Extension) =>
	(e.hooks ?? []).filter((h): h is PipelineHookDecl<any> => h.__decl === 'pipeline-hook')
export const lifecycleHooksOf = (e: Extension) =>
	(e.hooks ?? []).filter((h): h is LifecycleHookDecl => h.__decl === 'lifecycle-hook')
export const eventHooksOf = (e: Extension) =>
	(e.hooks ?? []).filter((h): h is EventHookDecl => h.__decl === 'event-hook')

/**
 * The bindings map the executor wants, built from the declaration. So an author's tests
 * run their real hooks rather than a hand-maintained parallel map that drifts.
 */
export function bindingsOf(e: Extension): Record<string, PipelineHookDecl<any>['handler']> {
	const out: Record<string, PipelineHookDecl<any>['handler']> = {}
	for (const h of pipelineHooksOf(e)) out[h.type.id] = h.handler
	return out
}
