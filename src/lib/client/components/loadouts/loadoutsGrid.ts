/**
 * The **loadouts grid** and the **defaults ledger** in the Loadouts view
 * (I12; DESIGN-image-generation §14.1): every loadout as a tile, grouped by
 * output kind the way Admin › Defaults groups (text · images · audio ·
 * embeddings · entities), the default-flagged one first in each group; then
 * every job and the loadout that is its default.
 *
 * Every word a tile or a ledger row shows is decided here.
 */
import { IO_KINDS } from "@serene-pub/sdk"
import { outputKindOf } from "$lib/shared/capabilities/samplingShape"
import {
	OUTPUT_KIND_ICONS,
	outputKindLabel
} from "$lib/shared/constants/outputKinds"
import { ownerChip } from "./loadoutSheet"
import { perPictureLine } from "$lib/shared/connections/imagePrice"

type Summary = Sockets.Loadouts.Summary
type Transform = Sockets.Loadouts.List.Response["transforms"][number]

/** What one tile says. */
export interface LoadoutTile {
	id: number
	title: string
	/** `Nemo 12B on KoboldCPP`, or *Unfilled — falls back to Reply*. */
	pair: string
	filled: boolean
	/** The sampling config's name, or null. */
	sampling: string | null
	/** *merged into Reply*, a plugin owner, *<owner> · plugin off*, or null. */
	chip: string | null
	/** The one consequence line, or null (unfilled says it in `pair`). */
	consequence: string | null
	/** The gold mark: this is its job's default. */
	isDefault: boolean
	/** 🚧 *≈ $0.05 per picture* when the pair's model facts carry a price, else null. */
	price: string | null
}

/** The words for one tile. */
export function loadoutTile(l: Summary): LoadoutTile {
	const pair = l.filled
		? l.modelName && l.connectionName
			? `${l.modelName} on ${l.connectionName}`
			: (l.modelName ?? l.connectionName ?? "Pair set")
		: (l.consequence ??
			(l.fallbackName
				? `Unfilled — falls back to ${l.fallbackName}`
				: "Unfilled — nothing to fall back to yet"))
	return {
		id: l.id,
		title: l.name,
		pair,
		filled: l.filled,
		sampling: l.samplingName,
		chip:
			l.mergedInto != null
				? `merged into ${l.mergedIntoName ?? "another loadout"}`
				: l.pluginOff
					? `${l.owner} · plugin off`
					: ownerChip(l.owner),
		consequence: l.filled ? l.consequence : null,
		isDefault: l.defaultFor != null,
		price: l.filled ? perPictureLine(l.perImagePrice) : null
	}
}

/** One output-kind group of the grid. */
export interface LoadoutGroup {
	kind: string
	label: string
	/** A `@lucide/svelte` export name (NOMENCLATURE §22). */
	icon: string
	tiles: LoadoutTile[]
}

/** The kind a transform files under: its single output kind, else "other". */
function kindOf(transform: string, transforms: readonly Transform[]): string {
	return (
		outputKindOf(transform) ??
		transforms.find((t) => t.id === transform)?.output ??
		"other"
	)
}

/**
 * The grid's groups in `IO_KINDS` order, "Other" last. Within a group the
 * defaults come first, then by the jobs' order, then by name.
 */
export function groupLoadouts(
	loadouts: readonly Summary[],
	transforms: readonly Transform[]
): LoadoutGroup[] {
	const order = [...IO_KINDS] as string[]
	const tOrder = transforms.map((t) => t.id)
	const rankT = (id: string) => {
		const i = tOrder.indexOf(id)
		return i < 0 ? tOrder.length : i
	}
	const groups = new Map<string, { group: LoadoutGroup; rows: Summary[] }>()
	for (const l of loadouts) {
		const kind = kindOf(l.transform, transforms)
		let g = groups.get(kind)
		if (!g) {
			g = {
				group: {
					kind,
					label: kind === "other" ? "Other" : outputKindLabel(kind),
					icon: OUTPUT_KIND_ICONS[kind] ?? "Boxes",
					tiles: []
				},
				rows: []
			}
			groups.set(kind, g)
		}
		g.rows.push(l)
	}
	for (const g of groups.values()) {
		g.group.tiles = [...g.rows]
			.sort(
				(a, b) =>
					Number(b.defaultFor != null) - Number(a.defaultFor != null) ||
					rankT(a.transform) - rankT(b.transform) ||
					a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
			)
			.map(loadoutTile)
	}
	return [...groups.values()]
		.map((g) => g.group)
		.sort((a, b) => {
			const ia = order.indexOf(a.kind)
			const ib = order.indexOf(b.kind)
			return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib)
		})
}

/** A tile's accessible name: what pressing it opens, and its state. */
export function tileLabel(tile: LoadoutTile): string {
	return [
		`Open ${tile.title}`,
		tile.isDefault ? "the default" : null,
		tile.pair
	]
		.filter(Boolean)
		.join(", ")
}

/** One defaults-ledger row: a job and its default loadout. */
export interface LedgerRow {
	transform: string
	label: string
	kindIcon: string
	/** The default loadout's id, or the loadout Fill would open; null: none. */
	loadoutId: number | null
	/** `Reply · Nemo 12B on KoboldCPP`, *Reply · unfilled*, or *No default yet*. */
	line: string
	/** *Change* for a filled default, *Fill* otherwise. */
	verb: "Change" | "Fill"
	filled: boolean
}

/**
 * Every job and its default. A job with no default yet still has a row:
 * *Fill* opens the loadout a door for it would open (`openFor`).
 */
export function ledgerRows(
	transforms: readonly Transform[],
	loadouts: readonly Summary[],
	openFor: (job: string) => number | null
): LedgerRow[] {
	return transforms.map((t) => {
		const def =
			t.defaultLoadoutId != null
				? loadouts.find((l) => l.id === t.defaultLoadoutId)
				: undefined
		const kind = kindOf(t.id, transforms)
		const icon = OUTPUT_KIND_ICONS[kind] ?? "Boxes"
		if (!def)
			return {
				transform: t.id,
				label: t.label,
				kindIcon: icon,
				loadoutId: openFor(t.id),
				line: "No default yet",
				verb: "Fill" as const,
				filled: false
			}
		const tile = loadoutTile(def)
		return {
			transform: t.id,
			label: t.label,
			kindIcon: icon,
			loadoutId: def.id,
			line: def.filled ? `${def.name} · ${tile.pair}` : `${def.name} · unfilled`,
			verb: def.filled ? ("Change" as const) : ("Fill" as const),
			filled: def.filled
		}
	})
}

/** What the status strip is fed: *Sessions can reply* = Reply filled. */
export function replyStrip(
	list: Pick<
		Sockets.Loadouts.List.Response,
		"loadouts" | "transforms" | "canReply"
	>
): {
	state: "ready" | "unfinished"
	modelName: string | null
	connectionName: string | null
} {
	const id = list.transforms.find((t) => t.id === "text->text")?.defaultLoadoutId
	const reply = id != null ? list.loadouts.find((l) => l.id === id) : undefined
	return list.canReply && reply
		? {
				state: "ready",
				modelName: reply.modelName,
				connectionName: reply.connectionName
			}
		: { state: "unfinished", modelName: null, connectionName: null }
}

/** The jobs New loadout offers, labelled (every transform the list names). */
export function newLoadoutJobs(
	transforms: readonly Transform[]
): { id: string; label: string }[] {
	return transforms.map((t) => ({ id: t.id, label: t.label }))
}
