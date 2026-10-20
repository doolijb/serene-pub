/**
 * A plugin's declared events (R45, R52; unit E1b), registered in this process
 * from the **stored manifest** and held with their recording scope.
 *
 * The SDK resolves an event id through its in-process registry
 * (`eventById`, `packageEventById`), which only holds what this build
 * declared. A plugin's event is declared in the plugin's own code, which the
 * app never evaluates, so the declaration is registered here from the
 * manifest's `events` — data, like `pluginDefinitions.ts` registers node
 * definitions. Without it, a spec locked on the event fails to load and a
 * recording is refused as undeclared.
 *
 * The scope — which subjects' pipelines may record the event — is the
 * declaring package's to say, and the host holds every recording to it
 * (`mayRecord`). An event id must sit under the declaring plugin's slug.
 *
 * Uninstall withdraws both the scope and the declaration, so a recording of
 * a withdrawn event is refused and a reinstall may declare it afresh.
 *
 * The package's own **shapes** (`manifest.shapes`, `<slug>:shape/…`) are
 * registered first, from the same manifest: an event's payload may be one of
 * them, and `defineSessionEvent` refuses a payload shape this process does
 * not hold. They are withdrawn with the events.
 */

import { resolveRenamedCoreId } from "./renamedCoreIds"
import {
	_withdrawSessionEvent,
	_withdrawShape,
	defineSessionEvent,
	defineShape,
	getShape,
	refuseUnlessIdentical,
	type ShapeDef,
	type StoredEventDeclaration
} from "@serene-pub/sdk"

type Scope = StoredEventDeclaration & { pluginId: string }

/**
 * One entry per (event, genre): a package may let different subjects record
 * the same event in different genres, and one genre's scope must not stand in
 * for another's.
 *
 * On `globalThis`: a Vite SSR reload re-evaluates this module, and a second
 * map would lose every scope registered at boot.
 */
const SCOPES_KEY = Symbol.for("serene-pub.pluginEventScopes")
const scopes = ((globalThis as Record<symbol, unknown>)[SCOPES_KEY] ??= new Map<
	string,
	Scope
>()) as Map<string, Scope>
const keyOf = (event: string, genre: string) => `${event}\u0000${genre}`

const SUBJECT = /^[^#\s]+(#[^#\s]+)?$/

/**
 * Shape id → the plugin that registered it here. On `globalThis` for the
 * same reason as the scopes: a Vite SSR reload re-evaluates this module, and
 * a fresh map would forget which shapes an uninstall must withdraw.
 */
const SHAPE_OWNERS_KEY = Symbol.for("serene-pub.pluginShapeOwners")
const shapeOwners = ((globalThis as Record<symbol, unknown>)[
	SHAPE_OWNERS_KEY
] ??= new Map<string, string>()) as Map<string, string>

/** The comparable form of a shape — what travels in a manifest. */
const shapeData = (d: ShapeDef): ShapeDef => ({
	id: d.id,
	...(d.assignableTo?.length ? { assignableTo: [...d.assignableTo] } : {}),
	...(d.streaming === true ? { streaming: true } : {})
})

/**
 * Register a plugin's own shapes from its manifest; returns a sentence per
 * entry refused. Idempotent: what this plugin registered before is withdrawn
 * first, and a shape this process already holds identically (registered by
 * a module evaluated twice) is accepted — one held differently is refused.
 */
export function registerPluginShapes(
	manifest: unknown,
	pluginId: string
): string[] {
	withdrawPluginShapes(pluginId)
	const refused: string[] = []
	const shapes = (manifest as { shapes?: unknown } | null)?.shapes
	if (shapes === undefined) return refused
	if (!Array.isArray(shapes))
		return [`'shapes' is not a list — the manifest's shapes were not registered`]
	const own = `${pluginId}:shape/`
	for (const raw of shapes as Array<Partial<ShapeDef> | null>) {
		const id = typeof raw?.id === "string" ? raw.id : "?"
		if (!id.startsWith(own)) {
			refused.push(
				`shape '${id}' is not under '${own}' — a package carries only its own shapes`
			)
			continue
		}
		const to = raw!.assignableTo
		if (
			(to !== undefined &&
				!(Array.isArray(to) && to.every((x) => typeof x === "string"))) ||
			(raw!.streaming !== undefined && typeof raw!.streaming !== "boolean")
		) {
			refused.push(
				`shape '${id}' is malformed — 'assignableTo' is a list of shape ids and 'streaming' a boolean`
			)
			continue
		}
		const def = shapeData(raw as ShapeDef)
		const held = getShape(id)
		if (held) {
			try {
				refuseUnlessIdentical(
					shapeData(held),
					def,
					`shape '${id}' is declared twice, differently`
				)
			} catch (e) {
				refused.push((e as Error).message)
			}
			continue
		}
		defineShape(def)
		shapeOwners.set(id, pluginId)
	}
	return refused
}

/** Drop the shapes this plugin registered (uninstall, reinstall). */
export function withdrawPluginShapes(pluginId: string): void {
	for (const [id, owner] of shapeOwners)
		if (owner === pluginId) {
			_withdrawShape(id)
			shapeOwners.delete(id)
		}
}

/** Why a manifest's event entry is malformed, or undefined. */
function malformed(raw: unknown): string | undefined {
	const r = raw as Partial<StoredEventDeclaration> | null
	if (!r || typeof r !== "object") return "is not an object"
	// The id's own grammar is `defineSessionEvent`'s to judge, below.
	if (typeof r.event !== "string" || !r.event.includes(":event/"))
		return "has no event id"
	if (typeof r.genre !== "string" || !r.genre.includes(":genre/"))
		return "names no genre"
	if (typeof r.payload !== "string") return "names no payload shape"
	const by = r.recordedBy
	if (
		by !== "any" &&
		!(
			Array.isArray(by) &&
			by.length &&
			by.every((x) => typeof x === "string" && SUBJECT.test(x))
		)
	)
		return "has no valid recordedBy — a list of subjects, or 'any'"
	return undefined
}

/**
 * Register a plugin's declared events; returns a sentence per entry refused.
 * Replaces whatever this plugin registered before, so a reinstall or upgrade
 * never keeps a scope the new manifest dropped.
 */
export function registerPluginEvents(
	manifest: unknown,
	pluginId: string
): string[] {
	withdrawPluginEvents(pluginId)
	// Its shapes before its events: a payload may be one of them.
	const refused: string[] = registerPluginShapes(manifest, pluginId)
	const events = (manifest as { events?: unknown } | null)?.events
	if (events === undefined) return refused
	if (!Array.isArray(events))
		return [
			`'events' is not a list — the manifest's events were not registered`
		]
	for (let raw of events as StoredEventDeclaration[]) {
		const id = typeof raw?.event === "string" ? raw.event : "?"
		if (id !== "?" && id.slice(0, id.indexOf(":")) !== pluginId) {
			refused.push(
				`event '${id}' is not under '${pluginId}' — a package declares only its own events`
			)
			continue
		}
		const bad = malformed(raw)
		if (bad) {
			refused.push(`event entry '${id}' ${bad} — not registered`)
			continue
		}
		// Its genre and recorders on the ids core ships now: a package built
		// before a rename names the old ones (`renamedCoreIds.ts`).
		raw = {
			...raw,
			genre: resolveRenamedCoreId(raw.genre),
			recordedBy: Array.isArray(raw.recordedBy)
				? raw.recordedBy.map((r) => (typeof r === "string" ? resolveRenamedCoreId(r) : r))
				: raw.recordedBy
		}
		const k = keyOf(id, raw.genre)
		if (scopes.has(k)) {
			refused.push(
				`event '${id}' is declared twice for '${raw.genre}' — the second was not registered`
			)
			continue
		}
		try {
			defineSessionEvent({
				id,
				payload: raw.payload,
				name: raw.name,
				description: raw.description ?? ""
			})
			scopes.set(k, { ...raw, pluginId })
		} catch (e) {
			refused.push(`event '${id}': ${(e as Error).message}`)
		}
	}
	return refused
}

/**
 * Drop a plugin's events (uninstall, reinstall): their scopes go, so a
 * recording is refused, and the declarations go, so an upgrade may declare
 * them again differently. Its shapes go with them.
 */
export function withdrawPluginEvents(pluginId: string): void {
	const ids = new Set<string>()
	for (const [k, s] of scopes)
		if (s.pluginId === pluginId) {
			scopes.delete(k)
			ids.add(s.event)
		}
	for (const id of ids) _withdrawSessionEvent(id)
	// The shapes after the events that name them.
	withdrawPluginShapes(pluginId)
}

/** Whether an installed package declares this event, in any genre. */
export function isRegisteredPackageEvent(id: string): boolean {
	for (const s of scopes.values()) if (s.event === id) return true
	return false
}

/** The declaration and scope of a package event in one genre, or undefined. */
export const eventScopeOf = (id: string, genre: string) =>
	scopes.get(keyOf(id, genre))

/**
 * Whether a pipeline serving `subjects`, in a session of `genre`, may record
 * `eventId` (R47, R52): the event is declared for that genre, and that
 * declaration's scope is `'any'` or names one of the subjects. A `genre` of
 * `undefined` — a document judged before it knows its session — asks whether
 * any genre's declaration admits it.
 */
export function mayRecord(
	eventId: string,
	genre: string | undefined,
	subjects: readonly string[]
): { ok: true } | { ok: false; reason: string } {
	const decls =
		genre === undefined
			? [...scopes.values()].filter((d) => d.event === eventId)
			: [scopes.get(keyOf(eventId, genre))].filter((d): d is Scope => !!d)
	if (!decls.length)
		return {
			ok: false,
			reason: isRegisteredPackageEvent(eventId)
				? `'${eventId}' is not declared for the genre '${genre}'`
				: `'${eventId}' is not an event any installed package declares`
		}
	const admits = (d: Scope) =>
		d.recordedBy === "any" ||
		subjects.some((s) => (d.recordedBy as string[]).includes(s))
	if (decls.some(admits)) return { ok: true }
	return {
		ok: false,
		reason:
			decls
				.map(
					(d) =>
						`'${eventId}' may be recorded in '${d.genre}' by ${(d.recordedBy as string[]).join(", ")}`
				)
				.join("; ") +
			`; this pipeline serves ${subjects.length ? subjects.join(", ") : "no subject"}`
	}
}

/** Every registered (event, genre) scope, with its declaring plugin — the events admin page's read. */
export const packageEventScopes = (): ReadonlyArray<Readonly<Scope>> => [
	...scopes.values()
]
