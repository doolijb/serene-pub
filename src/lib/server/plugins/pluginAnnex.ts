/**
 * A plugin's annex declaration (owner ruling 2026-09-26), registered in this
 * process from the **stored manifest** — like its events (`pluginEvents.ts`).
 *
 * The SDK's `validate()` judges a `set-session-annex` step's literal keys
 * against the owner's declaration only when this process knows it
 * (`annexDeclarationOf`); a plugin's `defineExtension` runs in the plugin's
 * own build, never here, so the declaration is registered from the
 * manifest's `annexFields` — data. A plugin that declares nothing is
 * registered as `[]`: every key its pipelines write is then refused at the
 * publish, not first at a turn. The host's write judges again, from the
 * plugins table (`sessions/annexFields.ts`), whatever publish saw.
 *
 * Uninstall withdraws it.
 */

import {
	_withdrawAnnex,
	annexField,
	annexFieldFindings,
	declareAnnex,
	type AnnexFieldDecl,
	type AnnexFieldInput
} from "@serene-pub/sdk"

/** Register a plugin's annex declaration; returns a sentence per entry refused. */
export function registerPluginAnnex(manifest: unknown, pluginId: string): string[] {
	const raw = (manifest as { annexFields?: unknown } | null)?.annexFields
	if (raw !== undefined && !Array.isArray(raw)) {
		declareAnnex(pluginId, [])
		return [`'annexFields' is not a list — the plugin's annex declaration is empty`]
	}
	const refused: string[] = []
	const fields: AnnexFieldDecl[] = []
	const taken = new Set<string>()
	for (const r of (raw as unknown[] | undefined) ?? []) {
		const faults = annexFieldFindings(r, `${pluginId}.annexFields`)
		if (faults.length) {
			refused.push(`${faults.join("; ")} — not registered`)
			continue
		}
		const decl = annexField(r as AnnexFieldInput)
		if (taken.has(decl.key)) {
			refused.push(`annex field '${decl.key}' is declared twice — the second was not registered`)
			continue
		}
		taken.add(decl.key)
		fields.push(decl)
	}
	declareAnnex(pluginId, fields)
	return refused
}

/** Drop a plugin's annex declaration (uninstall). */
export function withdrawPluginAnnex(pluginId: string): void {
	_withdrawAnnex(pluginId)
}
