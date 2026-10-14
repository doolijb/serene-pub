/**
 * The Models view's list (plan 2026-10-11, the Models / Connections split):
 * every model of every connection, one entry per model, flat.
 *
 * The Connections view lists connections and keeps each one's models inside
 * it; this list answers the other question — "which models can I use?" — so
 * the unit is the model, and the connection it lives on is a chip on the row
 * rather than a heading over it.
 *
 * ⚠ Pure. No Svelte, no socket.
 */
import { capabilityVerb } from "./jobPicker"
import type { CapabilityConnection, CapabilityModel } from "./jobPicker"
import { serviceLabel } from "./connectionIndexFilter"
import { isLocalOnnxType } from "./modelManagement"
import { modelDisplay } from "./modelDisplay"

/** One model, with the connection it lives on. */
export interface FlatModel<
	C extends CapabilityConnection = CapabilityConnection
> {
	connectionId: number
	connectionName: string
	connectionType: string | null
	/** The connection's service word ("OpenRouter", "KoboldCPP"). */
	serviceLabel: string
	model: C["models"][number]
	/** The transforms this model may serve (`satisfiableCapabilities`). */
	capabilities: readonly string[]
	/** A local ONNX file this install owns, rather than a host's model. */
	isLocal: boolean
	local: CapabilityModel["local"]
	enabled: boolean
	missingSince: string | null
	/** The row's title (`modelDisplay`), which is also the sort key. */
	displayName: string
}

/** A model nobody can pick: switched off, or absent from the host's current list. */
export function isSetAside(entry: {
	enabled: boolean
	missingSince: string | null
}): boolean {
	return !entry.enabled || entry.missingSince != null
}

/** "Untitled connection" for a row with no name, as the index says it. */
export function connectionNameOf(connection: {
	name?: string | null
}): string {
	return connection.name?.trim() || "Untitled connection"
}

/**
 * Every model of every connection, sorted by display name — the models a
 * person can pick first, the hidden and no-longer-listed ones last.
 */
export function flatModels<C extends CapabilityConnection>(
	rows: readonly C[]
): FlatModel<C>[] {
	const out: FlatModel<C>[] = []
	for (const connection of rows) {
		const connectionName = connectionNameOf(connection)
		const service = serviceLabel(connection)
		for (const model of connection.models) {
			out.push({
				connectionId: connection.id,
				connectionName,
				connectionType: connection.type ?? null,
				serviceLabel: service,
				model,
				capabilities: model.satisfiableCapabilities ?? [],
				isLocal: isLocalOnnxType(connection.type),
				local: model.local,
				enabled: model.enabled !== false,
				missingSince: model.missingSince ?? null,
				displayName: modelDisplay(model).name
			})
		}
	}
	return out.sort(compareFlatModels)
}

function compareFlatModels(a: FlatModel<any>, b: FlatModel<any>): number {
	const aside = Number(isSetAside(a)) - Number(isSetAside(b))
	if (aside) return aside
	return (
		a.displayName.localeCompare(b.displayName, undefined, {
			sensitivity: "base",
			numeric: true
		}) ||
		a.connectionName.localeCompare(b.connectionName) ||
		a.model.id - b.model.id
	)
}

/** The scope menu: everything, or the models able to do one job. */
export const MODEL_SCOPES = [
	{ id: "all", label: "All", transform: null },
	{ id: "chat", label: "Chat", transform: "text->text" },
	{ id: "images", label: "Images", transform: "text->image" },
	{ id: "embeddings", label: "Embeddings", transform: "text->embedding" },
	{ id: "entities", label: "Entities", transform: "text->entities" }
] as const

export type ModelScope = (typeof MODEL_SCOPES)[number]["id"]

/** The transform a scope narrows to, or null for All. */
export function scopeTransform(scope: ModelScope): string | null {
	return MODEL_SCOPES.find((s) => s.id === scope)?.transform ?? null
}

/** Whether the entry can do the scope's job. All keeps everything. */
export function inScope(
	entry: { capabilities: readonly string[] },
	scope: ModelScope
): boolean {
	const transform = scopeTransform(scope)
	return !transform || entry.capabilities.includes(transform)
}

/**
 * Narrow by scope, then by the filter box. Every word typed must appear in
 * the model's name, its identifier, its connection's name or its service.
 */
export function filterModels<E extends FlatModel<any>>(
	entries: readonly E[],
	opts: { query: string; scope: ModelScope }
): E[] {
	const words = opts.query.trim().toLowerCase().split(/\s+/).filter(Boolean)
	return entries.filter((entry) => {
		if (!inScope(entry, opts.scope)) return false
		if (!words.length) return true
		const haystack = [
			entry.displayName,
			entry.model.name,
			entry.model.model,
			entry.connectionName,
			entry.serviceLabel
		]
			.filter(Boolean)
			.join(" ")
			.toLowerCase()
		return words.every((w) => haystack.includes(w))
	})
}

/** How many entries each scope keeps, ignoring the query. */
export function scopeCounts(
	entries: readonly { capabilities: readonly string[] }[]
): Record<ModelScope, number> {
	const counts = {} as Record<ModelScope, number>
	for (const scope of MODEL_SCOPES)
		counts[scope.id] = entries.filter((e) => inScope(e, scope.id)).length
	return counts
}

/** "12 models" at All; "4 can chat", "1 can draw" for a job. */
export function modelsSummaryLine(count: number, scope: ModelScope): string {
	const transform = scopeTransform(scope)
	if (!transform) return `${count} ${count === 1 ? "model" : "models"}`
	const label = MODEL_SCOPES.find((s) => s.id === scope)?.label ?? scope
	return `${count} can ${capabilityVerb(transform, label)}`
}

/**
 * The connection chip on a model's row: the connection's name, and — in its
 * tooltip — the service, when the name does not already say it.
 */
export function connectionChip(entry: {
	connectionName: string
	serviceLabel: string
}): { label: string; title: string } {
	const sameWord =
		entry.connectionName.toLowerCase() === entry.serviceLabel.toLowerCase()
	return {
		label: entry.connectionName,
		title: sameWord
			? entry.connectionName
			: `${entry.connectionName} · ${entry.serviceLabel}`
	}
}
