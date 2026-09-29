/**
 * What Admin → Connections says about connections, pure so it is tested
 * (`connectionsAdmin.test.ts`): the short modality words its column and
 * filter use, which capability defaults a connection holds, and what a
 * delete takes with it.
 */
import { capabilityLabel } from "@serene-pub/sdk"
import type { AdminDeletion } from "$lib/client/components/admin/changelist"

type ListRow = Pick<Sockets.Connections.List.Row, "id" | "name" | "type"> & {
	models: readonly { id: number; name?: string | null; model: string }[]
}

type Defaults = Record<
	string,
	{ connectionId?: number | null; connectionModelId?: number | null } | undefined
>

/** A column's word for a modality; the Connections view's section names are headings. */
const MODALITY_WORD: Record<string, string> = {
	"text-gen": "Text",
	"image-gen": "Image",
	embeddings: "Embeddings",
	ner: "Named entities"
}
export const MODALITY_ORDER = ["text-gen", "image-gen", "embeddings", "ner"]

export function modalityWord(modality: string | null | undefined): string {
	if (!modality) return "—"
	return MODALITY_WORD[modality] ?? modality
}

export function capabilityWord(capability: string): string {
	try {
		return capabilityLabel(capability as any)
	} catch {
		return capability
	}
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
				? `Anything set to use ${n === 1 ? "it" : "them"} will need another choice: ${released.length === 1 ? "one default goes" : `${released.length} defaults go`} unset. `
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
					label: "Default released for",
					items: held.map((h) => h.label)
				})
			return { label: r.name ?? `Connection ${r.id}`, related }
		}),
		confirmLabel: n === 1 ? "Delete connection" : `Delete ${n} ${noun}`
	}
}

/**
 * The manager switches a delete also turns off, so no half-removed install
 * is left: KoboldCPP whenever its managed row goes, Ollama only with the last
 * Ollama connection (every Ollama is managed against its own host). The
 * same rule `ConnectionsSidebar.removeManager` applies to one row.
 */
export function managerFlagsReleased(
	deletingIds: readonly number[],
	rows: readonly { id?: number | null; type?: string | null }[]
): (
	| "systemSettings:updateKoboldCppManagerEnabled"
	| "systemSettings:updateOllamaManagerEnabled"
)[] {
	const going = new Set(deletingIds)
	const out: (
		| "systemSettings:updateKoboldCppManagerEnabled"
		| "systemSettings:updateOllamaManagerEnabled"
	)[] = []
	if (rows.some((r) => r.id != null && going.has(r.id) && r.type === "koboldcpp_managed"))
		out.push("systemSettings:updateKoboldCppManagerEnabled")
	const ollama = rows.filter((r) => r.id != null && r.type === "ollama")
	if (ollama.length && ollama.some((r) => going.has(r.id!)) && ollama.every((r) => going.has(r.id!)))
		out.push("systemSettings:updateOllamaManagerEnabled")
	return out
}
