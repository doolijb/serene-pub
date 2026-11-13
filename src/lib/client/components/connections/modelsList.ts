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
import { endpointKind, isLocalOnnxType } from "./modelManagement"
import { formatSize, modelDisplay } from "./modelDisplay"
import { CONNECTION_GROUPS } from "./connectionGroups"
import { FINDER_SCOPES } from "./finder"
import type { ModelsGroupBy } from "./modelsGroupBy"
import { connectionGroupOf } from "$lib/shared/connections/connectionGroup"
import { capabilityLabel } from "@serene-pub/sdk"

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
export function connectionNameOf(connection: { name?: string | null }): string {
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

/**
 * The scope menu: everything, a job, or one of two narrowings that are not a
 * job — the models a loadout names, and the files this machine holds.
 */
export const MODEL_SCOPES = [
	{ id: "all", label: "All", transform: null },
	{ id: "chat", label: "Chat", transform: "text->text" },
	{ id: "images", label: "Images", transform: "text->image" },
	{ id: "embeddings", label: "Embeddings", transform: "text->embedding" },
	{ id: "entities", label: "Entities", transform: "text->entities" },
	{ id: "in-loadout", label: "In a loadout", transform: null },
	{ id: "on-disk", label: "On disk", transform: null }
] as const

export type ModelScope = (typeof MODEL_SCOPES)[number]["id"]

/** The transform a scope narrows to, or null for All. */
export function scopeTransform(scope: ModelScope): string | null {
	return MODEL_SCOPES.find((s) => s.id === scope)?.transform ?? null
}

/**
 * One (connection, model) pair as a key a set can hold: `3:42`. Private —
 * `modelKey` is LM Studio's model name on the wire (R1); callers hold the
 * set `loadoutModelKeys` builds.
 */
function modelKey(connectionId: number, modelId: number): string {
	return `${connectionId}:${modelId}`
}

/**
 * The pairs a loadout's CURRENT pair names: filled, not merged. A merged
 * loadout is skipped (as `useInMenu` skips it): it runs on the loadout it was
 * merged into, so its own pair names a model nothing runs.
 */
export function loadoutModelKeys(
	loadouts: readonly {
		filled: boolean
		connectionId: number | null
		connectionModelId: number | null
		mergedInto: number | null
	}[]
): Set<string> {
	const keys = new Set<string>()
	for (const l of loadouts) {
		if (!l.filled || l.mergedInto != null) continue
		if (l.connectionId == null || l.connectionModelId == null) continue
		keys.add(modelKey(l.connectionId, l.connectionModelId))
	}
	return keys
}

/**
 * On this machine, still listed, and — for a local ONNX row — the file is
 * here. A model another process holds (KoboldCPP, Ollama) is on this machine
 * for as long as the host lists it.
 */
export function isOnDisk(entry: FlatModel<any>): boolean {
	if (connectionGroupOf(entry.connectionType) !== "local") return false
	if (entry.missingSince != null) return false
	if (isLocalOnnxType(entry.connectionType))
		return entry.local?.state === "on_disk"
	return true
}

function positive(n: unknown): number | null {
	return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null
}

/** What the host said the weights weigh, else what the local file weighs. */
export function sizeOnDiskOf(entry: FlatModel<any>): number | null {
	const fromFacts = positive(entry.model?.facts?.sizeBytes)
	if (fromFacts != null) return fromFacts
	return entry.local?.state === "on_disk"
		? positive(entry.local.sizeBytes)
		: null
}

/** "lives in Ollama" for an Ollama connection's row, else null. */
export function livesInOf(
	entry: Pick<FlatModel<any>, "connectionType" | "serviceLabel">
): string | null {
	return endpointKind(entry.connectionType) === "ollama"
		? `lives in ${entry.serviceLabel}`
		: null
}

/** Belongs in the last group: set aside, or able to do nothing. */
export function isCantUse(entry: FlatModel<any>): boolean {
	return isSetAside(entry) || entry.capabilities.length === 0
}

/**
 * Why a row is in the last group, for its meta line — or null where the row
 * already says it (the "No longer listed" badge, the download line).
 */
export function cantUseNoteOf(entry: FlatModel<any>): string | null {
	if (entry.missingSince != null) return null
	if (!entry.enabled) return "Switched off"
	if (
		isLocalOnnxType(entry.connectionType) &&
		entry.local?.state !== "on_disk"
	)
		return null
	if (entry.capabilities.length === 0)
		return "No default loadout can run this model"
	return null
}

/** Whether the entry is kept by the scope. All keeps everything. */
export function inScope(
	entry: FlatModel<any>,
	scope: ModelScope,
	inLoadout?: ReadonlySet<string> | null
): boolean {
	if (scope === "in-loadout")
		return !!inLoadout?.has(modelKey(entry.connectionId, entry.model.id))
	if (scope === "on-disk") return isOnDisk(entry)
	const transform = scopeTransform(scope)
	return !transform || entry.capabilities.includes(transform)
}

/**
 * Narrow by scope, then by the filter box. Every word typed must appear in
 * the model's name, its identifier, its connection's name or its service.
 */
export function filterModels<E extends FlatModel<any>>(
	entries: readonly E[],
	opts: {
		query: string
		scope: ModelScope
		inLoadout?: ReadonlySet<string> | null
	}
): E[] {
	const words = opts.query.trim().toLowerCase().split(/\s+/).filter(Boolean)
	return entries.filter((entry) => {
		if (!inScope(entry, opts.scope, opts.inLoadout)) return false
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
	entries: readonly FlatModel<any>[],
	inLoadout?: ReadonlySet<string> | null
): Record<ModelScope, number> {
	const counts = {} as Record<ModelScope, number>
	for (const scope of MODEL_SCOPES)
		counts[scope.id] = entries.filter((e) =>
			inScope(e, scope.id, inLoadout)
		).length
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

/** A Services connection with more models than this folds its list. */
export const FOLD_THRESHOLD = 12

export interface ModelsFold {
	connectionId: number
	/** The connection's name leading the line — in "where" only; null elsewhere. */
	title: string | null
	/** "312 models · 1 in a loadout" · "312 models" (before loadouts answer) · "+ 300 on OpenRouter" */
	text: string
}

export interface ModelsGroup<E> {
	/** Unique in one result: "local", "service", "conn:3", "built-in", "cap:text->text", "cut-outs", "cant-use". */
	key: string
	label: string
	/** formatSize(sum of sizeOnDiskOf over rows) — local side only; null when none known. */
	sizeLabel: string | null
	rows: E[]
	/** Drawn after the rows. */
	folds: ModelsFold[]
	/** Draw the background remover as this group's last row. */
	remover: boolean
}

/**
 * Gather the filtered, sorted list under headings. Rows keep their order
 * inside every group; a row that can do nothing, or is set aside, goes to the
 * last group whatever the grouping; a long Services list is folded to the
 * models that sit in a loadout, and the fold line says what it hides.
 */
export function groupModels<E extends FlatModel<any>>(
	entries: readonly E[],
	opts: {
		groupBy: ModelsGroupBy
		/** Every connection, in the Connections index's order. */
		connections: readonly {
			id: number
			name?: string | null
			type?: string | null
			models: readonly unknown[]
		}[]
		/** null = loadouts:list has not answered. */
		inLoadout: ReadonlySet<string> | null
		/** Connection ids the person pressed Show on. */
		unfolded: ReadonlySet<number>
		/** False while the filter box has text. */
		folding: boolean
		/** The background remover is drawn (admin). */
		remover: boolean
	}
): ModelsGroup<E>[] {
	const { connections, inLoadout } = opts
	const folded = new Set<number>()
	for (const c of connections)
		if (
			opts.folding &&
			!opts.unfolded.has(c.id) &&
			connectionGroupOf(c.type) === "service" &&
			c.models.length > FOLD_THRESHOLD
		)
			folded.add(c.id)

	const exempt = (e: E) =>
		!!inLoadout?.has(modelKey(e.connectionId, e.model.id))
	const hidden = (e: E) => folded.has(e.connectionId) && !exempt(e)

	/** One fold line per folded connection that has rows among `candidates`. */
	const foldsFor = (
		candidates: readonly E[],
		style: "count" | "plus",
		withTitle: boolean
	): ModelsFold[] => {
		const out: ModelsFold[] = []
		for (const c of connections) {
			if (!folded.has(c.id)) continue
			const mine = candidates.filter((e) => e.connectionId === c.id)
			if (!mine.length) continue
			const name = connectionNameOf(c)
			let text: string
			if (style === "count") {
				const n = mine.length
				text = `${n} ${n === 1 ? "model" : "models"}`
				if (inLoadout)
					text += ` · ${mine.filter(exempt).length} in a loadout`
			} else {
				const n = mine.filter(hidden).length
				if (!n) continue
				text = `+ ${n} on ${name}`
			}
			out.push({
				connectionId: c.id,
				title: withTitle ? name : null,
				text
			})
		}
		return out
	}

	const sizeLabelOf = (rows: readonly E[]): string | null => {
		let sum = 0
		for (const r of rows) sum += sizeOnDiskOf(r) ?? 0
		return formatSize(sum)
	}

	const usable = entries.filter((e) => !isCantUse(e))
	const cantUse = entries.filter(isCantUse)
	const groups: ModelsGroup<E>[] = []
	const group = (
		key: string,
		label: string,
		rows: E[],
		extra: Partial<ModelsGroup<E>> = {}
	) =>
		groups.push({
			key,
			label,
			sizeLabel: null,
			rows,
			folds: [],
			remover: false,
			...extra
		})

	if (opts.groupBy === "where") {
		const label = (id: string) =>
			CONNECTION_GROUPS.find((g) => g.id === id)?.label ?? id
		const local = usable.filter(
			(e) => connectionGroupOf(e.connectionType) === "local"
		)
		const service = usable.filter(
			(e) => connectionGroupOf(e.connectionType) !== "local"
		)
		group("local", label("local"), local, {
			sizeLabel: sizeLabelOf(local),
			remover: opts.remover
		})
		group(
			"service",
			label("service"),
			service.filter((e) => !hidden(e)),
			{
				folds: foldsFor(service, "count", true)
			}
		)
	} else if (opts.groupBy === "connection") {
		const sides = [
			connections.filter((c) => connectionGroupOf(c.type) === "local"),
			connections.filter((c) => connectionGroupOf(c.type) !== "local")
		]
		for (const [i, side] of sides.entries())
			for (const c of side) {
				const mine = usable.filter((e) => e.connectionId === c.id)
				group(
					`conn:${c.id}`,
					connectionNameOf(c),
					mine.filter((e) => !hidden(e)),
					{
						sizeLabel: i === 0 ? sizeLabelOf(mine) : null,
						folds: foldsFor(mine, "count", false)
					}
				)
			}
		if (opts.remover) group("built-in", "Built in", [], { remover: true })
	} else {
		const kinds = new Map<string, { label: string; rows: E[] }>()
		for (const s of FINDER_SCOPES)
			kinds.set(s.capability, { label: s.label, rows: [] })
		const extras = new Map<string, { label: string; rows: E[] }>()
		for (const e of usable) {
			const sixOf = e.capabilities.filter((c) => kinds.has(c))
			for (const c of sixOf) kinds.get(c)!.rows.push(e)
			if (sixOf.length) continue
			for (const c of e.capabilities) {
				if (!extras.has(c))
					extras.set(c, {
						label: capabilityLabel(c as never),
						rows: []
					})
				extras.get(c)!.rows.push(e)
			}
		}
		for (const [capability, { label, rows }] of [...kinds, ...extras])
			group(
				`cap:${capability}`,
				label,
				rows.filter((e) => !hidden(e)),
				{
					folds: foldsFor(rows, "plus", false)
				}
			)
		if (opts.remover) group("cut-outs", "Cut-outs", [], { remover: true })
	}

	group(
		"cant-use",
		"Can't be used right now",
		cantUse.filter((e) => !hidden(e)),
		{
			folds: foldsFor(cantUse, "plus", false)
		}
	)

	return groups.filter((g) => g.rows.length || g.folds.length || g.remover)
}
