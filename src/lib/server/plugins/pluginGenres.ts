/**
 * A plugin's genres, and the attribute slots and sheets they bring, registered
 * in this process from the **stored manifest** while the plugin is installed.
 *
 * The SDK answers "what genre is this session, and what does it track?"
 * through its in-process registries (`getGenre`, `getAttributeSlot`,
 * `getAttributeSheet`), which hold only what this build declared. A plugin's
 * genre is declared in the plugin's own code, which the app never evaluates, so
 * without this a plugin genre is unknown to every reader: `vocabularyFor`
 * states nothing for it and every stat write is refused as undeclared. The
 * manifest carries the compiled declarations (`genres[].slots`, `.sheets`) —
 * data, like `pluginEvents.ts` registers events and `pluginDefinitions.ts` node
 * definitions.
 *
 * **Installed, not enabled** (owner ruling 2026-09-26, resolving R67). A
 * plugin's genres, slots and sheets are registered while its row exists and
 * withdrawn only on uninstall. Disabling hides the plugin from LISTINGS
 * (`disabledPlugins.ts`: the Start form's genres, the attribute picker) and
 * nothing else — a session already on its genre keeps resolving and writing
 * its stats. Once uninstalled, the values stay where they are and read as
 * opaque data, and a write is refused.
 *
 * The whole reconcile runs only behind `pluginsEnabled()` — its callers
 * (`bootstrapPlugins`, the plugins socket's `syncDeclarations`) are gated. With
 * the subsystem off, nothing a plugin provides is registered, enabled or not.
 *
 * Only a slot or sheet under the plugin's own namespace is declared by it. A
 * genre may list core's (or another package's) slots by id; those are
 * referenced, never declared here, and never withdrawn with the plugin.
 */

import {
	_registerPackageGenre,
	_withdrawAttributeSheet,
	_withdrawAttributeSlot,
	_withdrawGenre,
	definePluginAttributeSheet,
	definePluginAttributeSlot,
	getAttributeSheet,
	getAttributeSlot,
	slotOwner,
	type AttributeSheetProps,
	type AttributeSlotProps,
	type GenreDecl
} from "@serene-pub/sdk"
import { plugins } from "$lib/server/db/schema"
import { notCoreRow } from "./frameHost"

/** What one plugin put into the registries, so it can be taken back out. */
interface Registered {
	genres: Set<string>
	slots: Set<string>
	sheets: Set<string>
	/**
	 * The manifest's `genres` as registered, when every declaration landed —
	 * so a sync that finds it unchanged (an enable, a disable, a permission
	 * change) leaves the registries alone rather than re-declaring.
	 */
	settled?: string
}

/**
 * On `globalThis`: a Vite SSR reload re-evaluates this module while the SDK's
 * registries (an external package) keep their entries, and a fresh map would
 * forget what to withdraw.
 */
const KEY = Symbol.for("serene-pub.pluginGenres")
const held = ((globalThis as Record<symbol, unknown>)[KEY] ??= new Map<
	string,
	Registered
>()) as Map<string, Registered>

type Decl = Record<string, unknown> & { id?: unknown; origin?: unknown }

/** A stored declaration's props: everything but the registry's own fields. */
function propsOf<T>(raw: Decl): T {
	const { id: _id, origin: _origin, authorUserId: _a, ...props } = raw
	return props as T
}

/** Take back everything one plugin registered. */
export function withdrawPluginGenres(pluginId: string): void {
	const mine = held.get(pluginId)
	if (!mine) return
	// Genres first (they name the slots), then sheets (they name slots), then slots.
	for (const id of mine.genres) _withdrawGenre(id)
	for (const id of mine.sheets) _withdrawAttributeSheet(id)
	for (const id of mine.slots) _withdrawAttributeSlot(id)
	held.delete(pluginId)
}

/**
 * Register one plugin's genres and their own-namespace slots and sheets from
 * its manifest, replacing whatever it registered before (an upgrade may have
 * changed a declaration). Returns a sentence per declaration refused; a refusal
 * costs that declaration, never the plugin's others.
 *
 * Synchronous on purpose: the withdraw and the re-register happen in one turn
 * of the event loop, so no reader ever sees the plugin's genre missing.
 */
export function registerPluginGenres(
	manifest: unknown,
	pluginId: string
): string[] {
	withdrawPluginGenres(pluginId)
	const refused: string[] = []
	const raw = (manifest as { genres?: unknown } | null)?.genres
	if (raw === undefined) return refused
	if (!Array.isArray(raw))
		return [`'genres' is not a list — the manifest's genres were not registered`]
	const mine: Registered = { genres: new Set(), slots: new Set(), sheets: new Set() }
	held.set(pluginId, mine)
	const own = (id: string) => slotOwner(id) === pluginId

	for (const g of raw as Decl[]) {
		const genreId = typeof g?.id === "string" ? g.id : "?"
		// Slots before sheets before the genre: a sheet naming a slot nothing
		// declares is refused, and a genre is only as good as its vocabulary.
		const slotDecls = [
			...(Array.isArray(g?.slots) ? (g.slots as Decl[]) : []),
			...(Array.isArray(g?.sheets)
				? (g.sheets as Decl[]).flatMap((s) =>
						Array.isArray(s?.slots) ? (s.slots as Decl[]) : []
					)
				: [])
		]
		for (const s of slotDecls) {
			const id = typeof s?.id === "string" ? s.id : ""
			if (!id) continue
			// A sheet entry is `{ id, required?, … }`, not a declaration; and a
			// slot under another owner is referenced, not declared, here.
			if (!own(id) || typeof (s as { type?: unknown }).type !== "string") {
				if (!getAttributeSlot(id) && !own(id))
					refused.push(`genre '${genreId}' names '${id}', which nothing on this pub declares`)
				continue
			}
			if (mine.slots.has(id)) continue
			try {
				const existed = !!getAttributeSlot(id)
				definePluginAttributeSlot(pluginId, id, propsOf<AttributeSlotProps>(s))
				if (!existed) mine.slots.add(id)
			} catch (e) {
				refused.push(`slot '${id}': ${(e as Error).message}`)
			}
		}
		for (const sh of Array.isArray(g?.sheets) ? (g.sheets as Decl[]) : []) {
			const id = typeof sh?.id === "string" ? sh.id : ""
			if (!id || !own(id) || mine.sheets.has(id)) continue
			try {
				const existed = !!getAttributeSheet(id)
				definePluginAttributeSheet(pluginId, id, propsOf<AttributeSheetProps>(sh))
				if (!existed) mine.sheets.add(id)
			} catch (e) {
				refused.push(`sheet '${id}': ${(e as Error).message}`)
			}
		}
		try {
			_registerPackageGenre(pluginId, g as unknown as GenreDecl)
			mine.genres.add(genreId)
		} catch (e) {
			refused.push(`genre '${genreId}': ${(e as Error).message}`)
		}
	}
	return refused
}

/** The part of a manifest this module registers, as a comparable string. */
function genresSignature(manifest: unknown): string {
	return JSON.stringify((manifest as { genres?: unknown } | null)?.genres ?? null)
}

/**
 * Reconcile the registries with the INSTALLED set: every installed plugin's
 * genres registered (enabled or not), every uninstalled one's withdrawn. A
 * plugin whose manifest genres are unchanged since a clean registration is
 * left as it is, so enabling or disabling never touches the registries. The
 * read happens first; the registry changes are one synchronous pass.
 */
export async function syncPluginGenres(db: Db): Promise<string[]> {
	const rows: Array<{ pluginId: string; manifest: unknown }> = await db
		.select({ pluginId: plugins.pluginId, manifest: plugins.manifest })
		.from(plugins)
		.where(notCoreRow())
	const installed = new Set(rows.map((r) => r.pluginId))
	for (const pluginId of [...held.keys()])
		if (!installed.has(pluginId)) withdrawPluginGenres(pluginId)
	const refused: string[] = []
	for (const row of rows) {
		const sig = genresSignature(row.manifest)
		if (held.get(row.pluginId)?.settled === sig) continue
		const lines = registerPluginGenres(row.manifest, row.pluginId)
		const mine = held.get(row.pluginId)
		if (mine && !lines.length) mine.settled = sig
		for (const line of lines) refused.push(`'${row.pluginId}': ${line}`)
	}
	// The last-seen mirror (R4), so a stale plugin slot can still name itself
	// after its package is gone. Best-effort: a failed mirror costs a label.
	if (rows.length)
		try {
			const { recordLastSeen } = await import("$lib/server/state/declarations")
			await recordLastSeen(db)
		} catch (e) {
			console.warn("[plugins] attribute last-seen mirror failed:", e)
		}
	return refused
}

/** Which plugin registered a genre, if one did (tests, diagnostics). */
export function pluginOfGenre(genreId: string): string | undefined {
	for (const [pluginId, mine] of held) if (mine.genres.has(genreId)) return pluginId
	return undefined
}
