/**
 * Descriptors — the shared-scope declaration of a type (01 §1, 04 §3).
 *
 * A descriptor is data: it can be listed, rendered and validated without loading
 * the hook that implements it. That is what lets the plugin manager and the editor
 * work from rows (10 §10.2).
 */

import type { ShapeId } from './shapes.js'

export type Kind = 'input' | 'query' | 'task' | 'provider' | 'consumer'

export type LocaleMap = { en: string } & Record<string, string>
export type I18n = string | LocaleMap

/** Slot kinds (12 §2). Five siblings; only two are ever cross-referenced. */
export type SlotKind = 'connection' | 'sampling' | 'prompts' | 'template' | 'parameters' | 'wire'

export interface SlotDecl {
	kind: SlotKind
	/** For connection/sampling: which shape's connections are eligible. */
	shape?: ShapeId
	/** Which lens renders it (05 §3). */
	facet?: string
	/** For prompts: the authored text fields. */
	fields?: Record<string, { type: 'text'; i18n?: I18n }>
	/** For parameters: the declared schema. Options may be sourced from the connection. */
	schema?: Record<string, ParamDecl>
	/**
	 * Which template language this slot's source is written in — a registry id, not a
	 * hardcoded literal (src/engines.ts). The value stored in the slot carries it too, so
	 * two slots in one spec may use different engines.
	 */
	engine?: string
	/**
	 * For `wire` slots: the format id this Provider defaults to. Overridable through the
	 * normal scope chain, and in core sourced from the connection's adapter metadata so
	 * picking Ollama gets the right instruct format without configuring anything
	 * (src/wire.ts).
	 */
	format?: string
	/**
	 * For template slots: the variables this template may reference.
	 *
	 * ⚠ Required, and 16 §4 is wrong to imply otherwise. A *source* template renders one
	 * item out of a collection, and the item's shape lives inside the port's payload
	 * rather than on the port — so typed ports alone cannot tell an author what
	 * `{{ entry.title }}` is allowed to be. See src/template.ts.
	 */
	variables?: Record<string, 'any' | string[]>
}

export interface ParamDecl {
	/**
	 * `secret` is write-only in the UI, encrypted at rest, redacted from receipts by
	 * type, and excluded from export (13 §6). The type is what makes those
	 * enforceable — a free-form value cannot be told from a note. See src/settings.ts.
	 */
	type: 'number' | 'integer' | 'string' | 'boolean' | 'enum' | 'string[]' | 'secret'
	default?: unknown
	min?: number
	max?: number
	of?: readonly string[]
	/** e.g. 'connection.voices' — options come from the live connection (17 §2b). */
	from?: string
	i18n?: I18n
}

export interface PortDecl {
	[port: string]: ShapeId
}

/**
 * `Out`/`In` are generic so the *port names* survive into the type system. That is what
 * lets the builder offer `$.history.messages` with autocomplete instead of
 * `$ref('history', 'messages')` with a string (see src/scope.ts). Both default to the
 * open `PortDecl`, so nothing that ignores the generics changes.
 */
export interface Descriptor<
	Out extends PortDecl = PortDecl,
	In extends PortDecl = PortDecl,
	Id extends string = string,
> {
	/**
	 * `namespace:kind/name@N` — and the `@N` is the **type** version, which is a pin
	 * (01 §3). Distinct from a spec's semver, which is an upgrade key (src/identity.ts).
	 * Carried in the type so a pinned constructor can expose `.v1()` at the call site.
	 */
	id: Id
	kind: Kind
	i18n?: { name?: I18n; description?: I18n }
	slots?: Record<string, SlotDecl>
	ports: { in?: In; out?: Out }

	/** Provider/consumer only — the review gate keys on this, not on kind (01 §7). */
	effects?: 'none' | 'external' | 'write' | 'emit'
	/**
	 * An author may default review **on** for their own node. There is no value here
	 * that forbids it — that is the enforcement, not a rule someone checks (F14).
	 */
	reviewDefault?: 'off' | 'async' | 'sync'
	/** Connection kind for providers (== produced shape). */
	shape?: ShapeId
	/** May this node be switched off? Requires shape transparency (01 §14 F-toggleable). */
	toggleable?: boolean
	/** Declares it consumes the run seed — keeps Tasks pure (F11). */
	declaresRandomness?: boolean
	/** May finish before an upstream stream ends (01 §11). */
	earlyExit?: boolean
	/** Public pipeline hooks may be pinned by any spec (01 §9b). */
	public?: boolean
	/** F36 — every hook invocation is bounded. */
	timeoutMs?: number
	timeoutKind?: 'wall' | 'idle'
	/** Which core event a write causes. Declared here, never per spec (01 §8). */
	causesEvent?: string
	usage?: string
}

const types = new Map<string, Descriptor>()

function register<D extends Descriptor<any, any, any>>(d: D): D {
	if (types.has(d.id)) throw new Error(`duplicate type id: ${d.id}`)
	checkWritePublishes(d as Descriptor)
	types.set(d.id, d as Descriptor)
	return d
}

/**
 * A gate-eligible write publishes `write-result@1`, never raw ids (13 §7j-b).
 *
 * Checked at registration rather than reviewed by hand, because the hand-written version
 * was already wrong: three core Consumers declared `row-ids@1` out ports while declaring
 * `effects: 'write'`. Each one was a spec that could wire a downstream foreign key to a
 * row a reviewer had not approved yet — and under `async` review that row may never exist.
 * The failure lands long after the run that caused it, which is the worst kind to find by
 * reading.
 */
function checkWritePublishes(d: Descriptor): void {
	if (d.effects !== 'write') return
	const bad = Object.entries(d.ports?.out ?? {}).filter(([, s]) => shapeIdOf(s) === 'core:shape/row-ids@1')
	if (!bad.length) return
	throw new Error(
		`${d.id} declares effects: 'write' but publishes core:shape/row-ids@1 on ` +
			`${bad.map(([k]) => `'${k}'`).join(', ')}. A gate-eligible write publishes ` +
			`core:shape/write-result@1 — pending under async review, committed otherwise — so a ` +
			`downstream port wanting raw ids fails at publish instead of writing a foreign key ` +
			`that dangles when the reviewer rejects (13 §7j-b).`,
	)
}

const shapeIdOf = (s: unknown): string | undefined =>
	typeof s === 'string' ? s : ((s as { id?: string } | undefined)?.id ?? undefined)

export function getType(id: string): Descriptor | undefined {
	return types.get(id)
}
export function allTypes(): Descriptor[] {
	return [...types.values()]
}
export function _clearTypes(): void {
	types.clear()
}

// ── describe* — one per kind, same shape, no modality anywhere ───────────────

export const describeInput = <O extends PortDecl, I extends PortDecl, const Id extends string>(
	d: Omit<Descriptor<O, I, Id>, 'kind'>,
) => register({ ...d, kind: 'input' as const })
export const describeQueryType = <O extends PortDecl, I extends PortDecl, const Id extends string>(
	d: Omit<Descriptor<O, I, Id>, 'kind'>,
) => register({ ...d, kind: 'query' as const })
export const describeTaskType = <O extends PortDecl, I extends PortDecl, const Id extends string>(
	d: Omit<Descriptor<O, I, Id>, 'kind'>,
) => register({ ...d, kind: 'task' as const })
export const describeProvider = <O extends PortDecl, I extends PortDecl, const Id extends string>(
	d: Omit<Descriptor<O, I, Id>, 'kind'>,
) => register({ ...d, kind: 'provider' as const })
export const describeConsumerTarget = <O extends PortDecl, I extends PortDecl, const Id extends string>(
	d: Omit<Descriptor<O, I, Id>, 'kind'>,
) => register({ ...d, kind: 'consumer' as const })

/**
 * A pinned constructor. The builder method names the *kind*; this names the
 * *type and version* (04 §4b). Both are required — drop either and F21 or static
 * pin-checking goes with it.
 */
export interface NodeSpec<D extends Descriptor<any, any, any> = Descriptor> {
	readonly __node: true
	descriptor: D
	config: Record<string, unknown>
}

/** `'core:query/chat-history@2'` → `'2'`. Absent means `1`. */
type VersionOf<S extends string> = S extends `${string}@${infer V}` ? V : '1'

export type NodeCtor<D extends Descriptor<any, any, any>> = (config?: Record<string, unknown>) => NodeSpec<D>

/**
 * A pinned constructor (04 §4b).
 *
 * The builder method names the **kind**; this names the **type and version**, and the
 * version sits at the call site — `generateText.v1({ … })` — for three reasons that a
 * version baked into the id cannot deliver:
 *
 *  - upgrading a pin is a **visible diff**, not an invisible change of meaning
 *  - two versions of a type can **coexist in one spec**, which a migration needs
 *  - a deprecated pin **strikes through** on `generateText.v1` precisely, because the
 *    key is what carries the version
 */
export type Pinned<D extends Descriptor<any, any, any>> = {
	readonly [K in `v${VersionOf<D['id']>}`]: NodeCtor<D>
} & {
	readonly id: D['id']
	readonly descriptor: D
}

export function pin<D extends Descriptor<any, any, any>>(descriptor: D): Pinned<D> {
	const version = /@(\d+)$/.exec(descriptor.id)?.[1] ?? '1'
	const ctor: NodeCtor<D> = (config: Record<string, unknown> = {}) => ({
		__node: true,
		descriptor,
		config,
	})
	return { [`v${version}`]: ctor, id: descriptor.id, descriptor } as Pinned<D>
}

/** The out-port map of whatever a pinned constructor produces — the scope's raw material. */
export type OutPortsOf<N> =
	N extends NodeSpec<infer D> ? (D extends Descriptor<infer O, any, any> ? O : PortDecl) : PortDecl
