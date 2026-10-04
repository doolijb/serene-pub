/**
 * What Admin › Presets says about session presets, pure so it is tested
 * (`presetsAdmin.test.ts`): a preset's status word and what deleting presets
 * takes. Built-in presets are kept (they ship with Serene Pub or an extension
 * and updates replace them — duplicate one to change it). Deleting never
 * stops a session: sessions started from a preset keep running and simply
 * reference nothing.
 */
import { deletionFor, type AdminDeletion } from "$lib/client/components/admin/changelist"

type Preset = Pick<
	Sockets.SessionAdmin.PresetRow,
	"id" | "name" | "genreId" | "enabled" | "isDefault" | "isImmutable" | "staleBindings"
>

export const PRESET_NOUN = { singular: "preset", plural: "presets" }

/** Stale first: the row that needs an administrator. */
export const PRESET_STATUS_ORDER = ["stale", "hidden", "available"] as const
export type PresetStatus = (typeof PRESET_STATUS_ORDER)[number]

export function presetStatus(p: Preset): PresetStatus {
	if (p.staleBindings?.length) return "stale"
	return p.enabled ? "available" : "hidden"
}

export function presetStatusWord(s: string): string {
	return (
		{
			stale: "Binding unavailable",
			hidden: "Hidden from users",
			available: "Available"
		} as Record<string, string>
	)[s] ?? s
}

export function presetDeletion(
	rows: readonly Preset[],
	genreName: (id: string) => string
): AdminDeletion {
	return deletionFor(rows, {
		noun: PRESET_NOUN,
		label: (p) => p.name,
		protect: (p) =>
			p.isImmutable ? "built-in presets are replaced by updates (duplicate one to change it)" : null,
		related: (p) =>
			p.isDefault
				? [{ label: "No longer the default for", items: [genreName(p.genreId)] }]
				: [],
		consequence: () =>
			"Sessions started from them keep running; they simply reference no preset"
	})
}
