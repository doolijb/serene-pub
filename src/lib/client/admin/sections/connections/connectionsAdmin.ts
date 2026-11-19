/**
 * What Admin → Connections says about connections, pure so it is tested
 * (`connectionsAdmin.test.ts`): the short modality words its column and
 * filter use, which capability defaults a connection holds, and what a
 * delete takes with it.
 */
import { defaultLoadoutName } from "$lib/shared/loadouts/defaultLoadoutName"
import { managedConnectionIds } from "$lib/client/components/connections/managedConnectionView"
import type { AdminDeletion } from "$lib/client/components/admin/changelist"

type ListRow = Pick<Sockets.Connections.List.Row, "id" | "name" | "type"> & {
	models: readonly { id: number; name?: string | null; model: string }[]
}

type Defaults = Record<
	string,
	{ connectionId?: number | null; connectionModelId?: number | null } | undefined
>

/** A column's word for a modality; the Models view's section names are headings. */
const MODALITY_WORD: Record<string, string> = {
	"text-gen": "Text",
	"image-gen": "Image",
	embeddings: "Embeddings",
	ner: "Named entities",
	// 🚧 the speech build's modalities (audio.cpp, run by Serene Pub files as tts).
	tts: "Speech",
	asr: "Transcription"
}
export const MODALITY_ORDER = ["text-gen", "image-gen", "embeddings", "ner"]

export function modalityWord(modality: string | null | undefined): string {
	if (!modality) return "—"
	return MODALITY_WORD[modality] ?? modality
}

/** A transform's default, named by its loadout: "Reply", "Embeddings". */
export function capabilityWord(capability: string): string {
	return defaultLoadoutName(capability)
}

export interface HeldDefault {
	capability: string
	/** "Chat", "Embeddings". */
	label: string
	/** The model half of the pair, by name, when it is one of this connection's. */
	modelName: string | null
}

/** Every capability default whose pair points at this connection. */
export function defaultsHeldBy(row: ListRow, defaults: Defaults): HeldDefault[] {
	if (row.id == null) return []
	return Object.entries(defaults ?? {})
		.filter(([, d]) => d?.connectionId === row.id)
		.map(([capability, d]) => {
			const m = row.models.find((x) => x.id === d?.connectionModelId)
			return {
				capability,
				label: capabilityWord(capability),
				modelName: m ? (m.name || m.model) : null
			}
		})
		.sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * The delete confirmation for one or more connections: each connection,
 * then its models (they go with it) and the defaults it releases (they go
 * unset — `connection_defaults.connection_id` is ON DELETE SET NULL).
 */
export function connectionDeletion(
	rows: readonly ListRow[],
	defaults: Defaults
): AdminDeletion {
	const n = rows.length
	const noun = n === 1 ? "connection" : "connections"
	const released = rows.flatMap((r) => defaultsHeldBy(r, defaults))
	return {
		title: n === 1 ? `Delete ${rows[0].name ?? "this connection"}?` : `Delete ${n} ${noun}?`,
		summary:
			(released.length
				? `Anything set to use ${n === 1 ? "it" : "them"} will need another choice: ${released.length === 1 ? "one loadout is" : `${released.length} loadouts are`} emptied. `
				: "") + "This cannot be undone.",
		objects: rows.map((r) => {
			const held = defaultsHeldBy(r, defaults)
			const related: { label: string; items: string[] }[] = []
			if (r.models.length) {
				const names = r.models.map((m) => m.name || m.model)
				related.push({
					label: `${r.models.length} ${r.models.length === 1 ? "model" : "models"}`,
					items:
						names.length > 6
							? [...names.slice(0, 6), `and ${names.length - 6} more`]
							: names
				})
			}
			if (held.length)
				related.push({
					label: "Loadouts emptied",
					items: held.map((h) => h.label)
				})
			return { label: r.name ?? `Connection ${r.id}`, related }
		}),
		confirmLabel: n === 1 ? "Delete connection" : `Delete ${n} ${noun}`
	}
}

/**
 * The manager switches a delete also turns off, so no half-removed install
 * is left: each manager only with the LAST of its rows — KoboldCPP with the
 * last row of its install (managed text and, until the boot fold retires it,
 * managed image), audio.cpp with the last `audiocpp_managed` row, Ollama
 * with the last Ollama connection (every Ollama is managed against its own
 * host). Which rows are one install is `managedConnectionIds`, the same list
 * the Connections view's Remove uses.
 *
 * ⚠ The last one, not any one: a pub can hold more than one managed KoboldCPP
 * row (an image row not yet folded, an import); switching the manager off
 * on any one of them leaves the row still in use with a manager that will
 * not spawn.
 *
 * Computed when the delete is ASKED (the list broadcast that follows drops
 * the row), and emitted by the caller only once the delete is acknowledged —
 * a refused delete must not leave a live connection with its manager off.
 * Every event returned takes `{ enabled: false }`.
 */
export type ManagerRelease =
	| "systemSettings:updateKoboldCppManagerEnabled"
	| "systemSettings:updateOllamaManagerEnabled"
	| "audiocpp:updateSettings"

export function managerFlagsReleased(
	deletingIds: readonly number[],
	rows: readonly { id?: number | null; type?: string | null }[]
): ManagerRelease[] {
	const going = new Set(deletingIds)
	const out: ManagerRelease[] = []
	const lastOf = (kind: "koboldcpp" | "audiocpp" | "ollama") => {
		const ids = managedConnectionIds(kind, rows)
		return ids.length > 0 && ids.every((id) => going.has(id))
	}
	if (lastOf("koboldcpp"))
		out.push("systemSettings:updateKoboldCppManagerEnabled")
	if (lastOf("audiocpp")) out.push("audiocpp:updateSettings")
	if (lastOf("ollama")) out.push("systemSettings:updateOllamaManagerEnabled")
	return out
}

/** The widest an address's requests-at-once count may be set. */
export const LLM_LANE_WIDTH_MAX = 16

/** What the override field says when its value is refused. */
export const LLM_LANE_WIDTH_REFUSAL =
	"Use a whole number from 1 to 16, or leave it empty for the default."

/**
 * The override field's value as the write it means: empty (or a cleared
 * number input, which binds `null`) is `null`, back to the default; a whole
 * number from 1 to 16 is that number; anything else is a refusal sentence.
 */
export function llmLaneWidthParse(
	value: string | number | null | undefined
): { ok: true; width: number | null } | { ok: false; refusal: string } {
	if (value == null) return { ok: true, width: null }
	if (typeof value === "string") {
		if (!value.trim()) return { ok: true, width: null }
		if (!/^\d+$/.test(value.trim()))
			return { ok: false, refusal: LLM_LANE_WIDTH_REFUSAL }
		value = Number(value.trim())
	}
	if (
		!Number.isInteger(value) ||
		value < 1 ||
		value > LLM_LANE_WIDTH_MAX
	)
		return { ok: false, refusal: LLM_LANE_WIDTH_REFUSAL }
	return { ok: true, width: value }
}

/** A host row's "used by" line: the connections' names, or the empty words. */
export function llmLaneUsedBy(
	connections: readonly { id: number; name: string }[]
): string {
	return connections.length
		? connections.map((c) => c.name).join(", ")
		: "No connection uses this address now."
}
