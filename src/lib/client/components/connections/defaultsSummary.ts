/**
 * What the instance's CAPABILITY DEFAULTS add up to, as a pure function over
 * the connections list.
 *
 * A capability default is an (endpoint, model) pair registered for one
 * transform (NOMENCLATURE §10) — both halves required, which is exactly why
 * this module exists: "is it set" is not "is there a row in
 * `connection_defaults`", it is "does that row still resolve to a model that
 * is here". A default pointing at a model its host stopped listing is
 * REGISTERED and BROKEN, and those are two different sentences on screen.
 *
 * Extracted from the index view so the arithmetic behind "Defaults · 4 of 10
 * set" can be stated and tested without a component: which pair each transform
 * resolves to, what state that pair is in, and how the ledger groups them. The
 * view renders what this returns and decides nothing.
 *
 * ⚠ Resolved off the LIST ROWS, never fetched. `connections:list` already
 * carries every endpoint with every model, so a second request here would be a
 * second answer that can disagree with the one already on screen.
 *
 * ⚠ Local ONNX rows carry disk state (`ModelRow.local`), and it is part of the
 * answer: a default that is registered, enabled and listed but whose files are
 * `not_downloaded` is a default the first job will stall on. It says so here
 * rather than at the stall.
 */
import { capabilityLabel, IO_KINDS, TRANSFORMS } from "@serene-pub/sdk"
import { outputKindOf } from "$lib/shared/capabilities/samplingShape"
import {
	OUTPUT_KIND_ICONS,
	outputKindLabel
} from "$lib/shared/constants/outputKinds"
import type { CapabilityDefaultRef } from "./modelSystemDefaults"
import type { ModelFacts } from "$lib/shared/connections/modelFacts"

/**
 * A local ONNX row's disk state, structurally — the fields this module reads
 * off `Sockets.Connections.LocalModelState`. Restated rather than imported so
 * the module stays a plain unit under test with no wire types in scope.
 */
export interface SummaryLocalState {
	state?: "not_downloaded" | "downloading" | "on_disk" | "error"
	loaded?: boolean
	/** Bytes on disk once `on_disk`; the list's size until then. */
	sizeBytes?: number | null
	/** The catalogue's size and dimensions — `localCatalogLine` reads them. */
	catalog?: { sizeMb?: number; dimensions?: number }
}

export interface SummaryModel {
	id: number
	name: string
	enabled: boolean
	missingSince: string | null
	local?: SummaryLocalState
	/**
	 * What the host said about this model, where it said anything.
	 *
	 * Carried so the capability view — which is a CHOOSER — can put context,
	 * price and size on its rows. Without it every row read
	 * `Anthropic (Claude) · listed`, which is true of all eight of them and so
	 * distinguishes none. Nothing in this module reads it; it passes through.
	 */
	facts?: ModelFacts | null
	/** The admin's context override, which wins over `facts.contextWindow`. */
	contextWindow?: number | null
}

export interface SummaryConnection {
	id: number
	name?: string | null
	models: readonly SummaryModel[]
	/** Non-null when the host's last model listing failed. */
	modelsSync?: { at: string | null; error: string | null } | null
}

/**
 * The dot beside a pair, and nothing more.
 *
 * - `ok` — enabled, still listed, and (a local row) on disk or resident.
 * - `pending` — the files are on their way. Neither healthy nor a problem.
 * - `warning` — needs a person: gone from the host, switched off, never
 *   downloaded, or a download that failed.
 * - `unset` — no pair registered at all. Not a fault; a blank.
 */
export type DefaultState = "ok" | "pending" | "warning" | "unset"

export interface DefaultsSummaryEntry {
	/** The transform id, e.g. `text->text`. */
	capability: string
	/** What a person is shown for it: "Chat", "Embeddings". */
	label: string
	/** `undefined` for a transform whose output side names two kinds. */
	outputKind: string | undefined
	/** The endpoint half, when the default resolves. */
	connection?: SummaryConnection
	/** The model half, when the default resolves. */
	model?: SummaryModel
	/** The registration resolves to a model that is actually here. */
	set: boolean
	state: DefaultState
	/** The second line's last clause: "ready", "not listed", "on disk", … */
	stateWord: string
}

export interface DefaultsSummary {
	/** One per transform the SDK declares, in `TRANSFORMS` order. */
	entries: DefaultsSummaryEntry[]
	/** How many transforms there are. The M of "N of M set". */
	total: number
	/** How many resolve to a pair. The N. */
	setCount: number
	/** `total - setCount` — the "K not set" pill, hidden at zero. */
	unsetCount: number
	/** Just the set ones, in the same order: the pill row. */
	pills: DefaultsSummaryEntry[]
}

/** One output-kind heading in the ledger, with its own count. */
export interface DefaultsGroup {
	kind: string
	label: string
	/** A `@lucide/svelte` export name, resolved by the component. */
	icon: string
	entries: DefaultsSummaryEntry[]
	setCount: number
	total: number
}

/** The state of one resolved pair, and the word that goes with it. */
export function pairState(model: SummaryModel): {
	state: DefaultState
	stateWord: string
} {
	if (model.missingSince != null)
		return { state: "warning", stateWord: "not listed" }
	if (!model.enabled) return { state: "warning", stateWord: "switched off" }
	const local = model.local
	if (local) {
		if (local.loaded) return { state: "ok", stateWord: "loaded" }
		if (local.state === "on_disk")
			return { state: "ok", stateWord: "on disk" }
		if (local.state === "downloading")
			return { state: "pending", stateWord: "downloading" }
		if (local.state === "error")
			return { state: "warning", stateWord: "download failed" }
		return { state: "warning", stateWord: "not downloaded" }
	}
	return { state: "ok", stateWord: "ready" }
}

/**
 * A resolved pair's final state: `pairState` on the model, downgraded to
 * `warning` when the endpoint's last model listing failed — a host that
 * cannot be reached is a warning even when the row itself reads as ready,
 * while a row already `warning` or `pending` (a download in flight) is
 * unaffected.
 */
function entryState(
	connection: SummaryConnection | undefined,
	model: SummaryModel
): { state: DefaultState; stateWord: string } {
	const status = pairState(model)
	if (status.state === "ok" && connection?.modelsSync?.error != null)
		return { state: "warning", stateWord: "host unreachable" }
	return status
}

/** The (endpoint, model) pair a registration names, when both halves are here. */
export function resolvePair(
	rows: readonly SummaryConnection[],
	def: CapabilityDefaultRef | undefined
): { connection?: SummaryConnection; model?: SummaryModel } {
	if (!def || def.connectionId == null) return {}
	const connection = rows.find((c) => c.id === def.connectionId)
	if (!connection) return {}
	// The endpoint alone is not a default (§10): a registration with no model
	// half — or one naming a model absent from this endpoint — resolves
	// as unconfigured, and the endpoint is dropped with it rather than
	// reported as a partial answer nothing can use.
	if (def.connectionModelId == null) return {}
	const model = connection.models.find((m) => m.id === def.connectionModelId)
	return model ? { connection, model } : {}
}

export function defaultsSummary(
	rows: readonly SummaryConnection[],
	defaults: Record<string, CapabilityDefaultRef | undefined> | undefined
): DefaultsSummary {
	const entries: DefaultsSummaryEntry[] = []
	for (const capability of Object.keys(TRANSFORMS)) {
		const { connection, model } = resolvePair(rows, defaults?.[capability])
		const resolved = !!(connection && model)
		const status = model
			? entryState(connection, model)
			: { state: "unset" as DefaultState, stateWord: "not set" }
		entries.push({
			capability,
			label: safeCapabilityLabel(capability),
			outputKind: outputKindOf(capability),
			connection,
			model,
			set: resolved,
			state: status.state,
			stateWord: status.stateWord
		})
	}
	const setCount = entries.filter((e) => e.set).length
	return {
		entries,
		total: entries.length,
		setCount,
		unsetCount: entries.length - setCount,
		pills: entries.filter((e) => e.set)
	}
}

/**
 * The ledger's groups, in `IO_KINDS` order.
 *
 * A transform whose output side names two kinds has no single heading to sit
 * under (see `outputKindOf`), so it gets an "Other" group at the end rather
 * than being filed under the first of its two — which would put an image
 * sampler's heading over something that mostly writes prose.
 */
export function groupDefaultsByOutputKind(
	entries: readonly DefaultsSummaryEntry[]
): DefaultsGroup[] {
	const order = [...IO_KINDS] as string[]
	const groups = new Map<string, DefaultsGroup>()
	for (const entry of entries) {
		const kind = entry.outputKind ?? "other"
		let group = groups.get(kind)
		if (!group) {
			group = {
				kind,
				label: kind === "other" ? "Other" : outputKindLabel(kind),
				icon: OUTPUT_KIND_ICONS[kind] ?? "Boxes",
				entries: [],
				setCount: 0,
				total: 0
			}
			groups.set(kind, group)
		}
		group.entries.push(entry)
		group.total++
		if (entry.set) group.setCount++
	}
	return [...groups.values()].sort((a, b) => {
		const ia = order.indexOf(a.kind)
		const ib = order.indexOf(b.kind)
		return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib)
	})
}

/** The SDK's label, falling back to the id so a plugin's is legible. */
function safeCapabilityLabel(id: string): string {
	try {
		return capabilityLabel(id as any)
	} catch {
		return id
	}
}
