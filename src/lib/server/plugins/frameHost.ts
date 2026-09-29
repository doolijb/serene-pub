/**
 * Frame surfaces, server half (20 §12): a plugin's UI is documents in
 * `plugin_files`, served under a CSP composed from the plugin's grants, and
 * mounted only inside `sandbox="allow-scripts"` iframes — opaque origin, no
 * cookies, no DOM reach, storage brokered. Isolation by attribute, not
 * infrastructure, which is what makes it work on localhost self-hosting.
 *
 * ## The manifest declaration
 *
 *     "surfaces": {
 *       "session-view": { "entry": "ui/session.html", "title": "Crawl view" },
 *       "page":         { "entry": "ui/index.html",   "title": "Dashboard" },
 *       "panels": [ { "id": "map", "entry": "ui/map.html", "title": "Map" } ]
 *     }
 *
 * Read tolerantly like `templateEngines`/`nodeDefinitions` — the stored manifest is the one
 * source of truth (F6), and a malformed declaration is a missing surface, not
 * a crash.
 *
 * ⏳ `surfaces.panels` is the deprecated spelling of a widget declaration. It
 * is read through the SDK's `panelToWidgetDecl`, so what leaves this module is
 * a `WidgetDecl` and every reader past it sees the one declaration a genre's
 * shape carries — under the **namespaced** id `<pluginId>:<panelId>`
 * (`pluginWidgetId`), because a package's own id is the one thing here nobody
 * else controls. Core's and a genre's widgets keep plain ids.
 *
 * ## The CSP the frame lives under
 *
 * `default-src 'none'` plus: same-origin scripts/styles/assets (the plugin's
 * own files, relative paths), and `connect-src` projected from the manifest's
 * *network grants* — the same declared, admin-deniable permission that
 * governs the server-side fetchHost governs the browser surface, with no new
 * vocabulary. No grant, no network: the frame cannot phone anywhere.
 */

import { eq, and, ne, notLike, type SQL } from "drizzle-orm"
import { AUTHORED_OWNER_LABEL } from "$lib/shared/widgets/authoredOwner"
import {
	panelToWidgetDecl,
	pluginWidgetId,
	type WidgetDecl
} from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import {
	declaredPermissions,
	effectivePermissions,
	networkGrant
} from "./permissions"

/* ── files ──────────────────────────────────────────────────────────────── */

const SAFE_PATH = /^[a-zA-Z0-9_\-][a-zA-Z0-9._\-]*(\/[a-zA-Z0-9._\-]+)*$/

export function isSafeUiPath(path: string): boolean {
	return (
		SAFE_PATH.test(path) &&
		!path.split("/").some((seg) => seg === "." || seg === "..")
	)
}

export interface PluginFileInput {
	path: string
	mime: string
	/** Base64 bytes. */
	data: string
}

/** Replace a plugin's UI file set — install writes wholesale, like the bundle. */
export async function storePluginFiles(
	db: Db,
	pluginId: string,
	files: PluginFileInput[]
): Promise<{ stored: number; refused: string[] }> {
	const refused: string[] = []
	const crypto = await import("node:crypto")
	await db
		.delete(schema.pluginFiles)
		.where(eq(schema.pluginFiles.pluginId, pluginId))
	let stored = 0
	for (const f of files) {
		if (!isSafeUiPath(f.path) || typeof f.data !== "string") {
			refused.push(f.path)
			continue
		}
		const bytes = Buffer.from(f.data, "base64")
		await db.insert(schema.pluginFiles).values({
			pluginId,
			path: f.path,
			mime: f.mime || "application/octet-stream",
			content: f.data,
			hash: crypto.createHash("sha256").update(bytes).digest("hex"),
			bytes: bytes.byteLength
		})
		stored++
	}
	return { stored, refused }
}

export async function readPluginFile(
	db: Db,
	pluginId: string,
	path: string
): Promise<typeof schema.pluginFiles.$inferSelect | undefined> {
	if (!isSafeUiPath(path)) return undefined
	const [row] = await db
		.select()
		.from(schema.pluginFiles)
		.where(
			and(
				eq(schema.pluginFiles.pluginId, pluginId),
				eq(schema.pluginFiles.path, path)
			)
		)
		.limit(1)
	return row
}

/* ── surfaces ───────────────────────────────────────────────────────────── */

export interface SurfaceDecl {
	entry: string
	title?: string
}

export interface PluginSurfaces {
	sessionView?: SurfaceDecl
	page?: SurfaceDecl
	/**
	 * The manifest's panels, read as the ONE widget declaration
	 * (`panelToWidgetDecl`). A panel IS a widget — same channels, same settings
	 * schema — so this projection hands every reader the shape the host seats
	 * rather than a second, thinner one they would each have to translate.
	 *
	 * ⚠ The `id` is the **namespaced** one (`<pluginId>:<panelId>`, the SDK's
	 * `pluginWidgetId`), not the bare id the package declared. This is the
	 * boundary the namespacing happens at, so every reader past it — the
	 * session view, a saved layout row, `widget_settings`, `widget_styles`, a
	 * `surface:open` intent — names the same string, and no reader has to know
	 * that a plugin's widget ids are qualified and core's are not. A reader
	 * that needs the package's own spelling back uses `parsePluginWidgetId`.
	 */
	panels: WidgetDecl[]
}

/**
 * Read a stored manifest's `surfaces` block.
 *
 * `pluginId` is required because a panel's projection carries it: a
 * `WidgetDecl`'s frame surface names the package whose document it mounts, and
 * a decl without that is not resolvable to a URL.
 */
export function surfacesOf(manifest: unknown, pluginId: string): PluginSurfaces {
	const raw =
		manifest && typeof manifest === "object"
			? (manifest as any).surfaces
			: undefined
	const out: PluginSurfaces = { panels: [] }
	if (!raw || typeof raw !== "object") return out
	const decl = (v: any): SurfaceDecl | undefined =>
		v && typeof v.entry === "string" && isSafeUiPath(v.entry)
			? {
					entry: v.entry,
					...(typeof v.title === "string" ? { title: v.title } : {})
				}
			: undefined
	const sv = decl((raw as any)["session-view"])
	if (sv) out.sessionView = sv
	const pg = decl((raw as any).page)
	if (pg) out.page = pg
	if (Array.isArray((raw as any).panels))
		for (const p of (raw as any).panels) {
			const d = decl(p)
			if (!d || typeof p.id !== "string" || !/^[a-z0-9_-]+$/.test(p.id))
				continue
			// Read tolerantly like everything else here: `channels` and
			// `settings` are taken only in the shape they are declared in, and
			// a malformed one is an absent field rather than a dropped panel.
			const widget = panelToWidgetDecl(pluginId, {
				...d,
				id: p.id,
				...(Array.isArray(p.channels) &&
				p.channels.every((c: unknown) => typeof c === "string")
					? { channels: p.channels }
					: {}),
				...(p.settings &&
				typeof p.settings === "object" &&
				!Array.isArray(p.settings)
					? { settings: p.settings }
					: {})
			})
			// The one place a plugin's panel id becomes a widget id. The SDK's
			// projection is pure and hands back the package's own spelling; the
			// package chose it in private, so two packages declaring `map`
			// declare one id — and a layout row outlives the install that would
			// have told them apart. Qualified here, once, at the boundary where
			// the owner is still in hand.
			out.panels.push({ ...widget, id: pluginWidgetId(pluginId, p.id) })
		}
	return out
}

/**
 * Every widget an ENABLED plugin declares, by the id it is seated under.
 *
 * The one answer to "is this namespaced widget id real?", for the writes that
 * have to refuse an id no widget would ever ask for — a widget style, and
 * anything else keyed on `widget_slug`. Read from the stored manifests through
 * `surfacesOf`, so the set is exactly what `sessions:view` puts on the wire and
 * a validator can never accept an id the session view would not seat.
 *
 * A DISABLED plugin's widgets are absent, which is the same answer the session
 * view gives: its rows are not deleted (a re-enable must bring the arrangement
 * back), they simply stop being offered. A person cannot make a NEW style for a
 * widget that is not there; the one they already made is untouched.
 */
export async function enabledPluginWidgetIds(db: Db): Promise<Set<string>> {
	const rows = await db
		.select({
			pluginId: schema.plugins.pluginId,
			manifest: schema.plugins.manifest
		})
		.from(schema.plugins)
		.where(and(eq(schema.plugins.enabled, true), notCoreRow()))
	const ids = new Set<string>()
	for (const r of rows)
		for (const w of surfacesOf(r.manifest, r.pluginId).panels)
			ids.add(w.id)
	return ids
}

/**
 * Every widget id that may be SEATED in ONE session — the allow-list a
 * per-session write keyed on `widget_slug` is held to.
 *
 * Three declarers, because a widget has three, and they are the same three
 * `sessions:view` seats: core's `CORE_WIDGETS`, the session genre's own
 * declared `shape.panels`, and every enabled plugin's widgets under the
 * namespaced id they are seated by. The genre is read through
 * `getSessionGenre` — the read the view itself does — so the set can never
 * admit an id the view would not seat.
 *
 * ⚠ Not `widgetStyles`'s `announcedWidgetIds`, which answers the same question
 * per INSTANCE: a style is an account-level object with no session to ask, so
 * it takes the system style rows a genre's package seeded where this takes one
 * genre's panels. The two sets coincide on core and on plugins; that middle
 * term is the whole difference, and it is why this one takes a genre id.
 */
export async function seatableWidgetIds(
	db: Db,
	genreId: string
): Promise<Set<string>> {
	const { CORE_WIDGETS } = await import("@serene-pub/core-catalog")
	const { getSessionGenre } = await import(
		"$lib/server/pipelines/entities/sessionGenres"
	)
	const ids = new Set(CORE_WIDGETS.map((w) => w.id))
	const genre = await getSessionGenre(db, genreId)
	// `as any` as `sessions:view` reads it: `shape.panels` is the ⏳ pre-widget
	// spelling the SDK's `SessionShape` never declared.
	const declared = (genre?.shape as any)?.panels
	if (Array.isArray(declared))
		for (const p of declared)
			if (p && typeof p.id === "string") ids.add(p.id)
	for (const id of await enabledPluginWidgetIds(db)) ids.add(id)
	// And every offered authored component's (C6), which a session seats too.
	const { offeredAuthoredWidgetIds } = await import("$lib/server/components/offer")
	for (const id of await offeredAuthoredWidgetIds(db)) ids.add(id)
	return ids
}

/* ── the frame URL ──────────────────────────────────────────────────────── */

/**
 * The plugin slug grammar, from the SDK's `defineExtension` — lowercase
 * letters, digits, dots and hyphens, `chariot.dice-tray`, **never a slash**.
 *
 * It is what makes a frame URL parseable at all: the id is exactly ONE
 * segment, so everything after it is the stored file path and nothing has to
 * count segments. A route that guessed a two-segment id instead resolved
 * `/plugin-ui/showcase.twenty-questions/ui/tally.html` to the plugin
 * `showcase.twenty-questions/ui` — which no dotted-slug plugin is — and served
 * nothing.
 */
const PLUGIN_SLUG = /^[a-z0-9]+([.-][a-z0-9]+)*$/

export const isPluginSlug = (id: string): boolean => PLUGIN_SLUG.test(id)

/**
 * The reserved id's filter, for EVERY read that turns `plugins` rows into
 * something the app serves, offers or registers — a frame document, a widget,
 * a page, an engine, a subscription, a layout, a preset, a template, a tool,
 * a swap: a row stored under `core` before installs refused it
 * (`pluginIdFindings`) is invisible to all of them, so nothing answers as the
 * app's own owner — which a page trusts — that is not core. The plugins page
 * still lists the row, for an administrator to remove.
 *
 * Here, beside the slug grammar, because this module is light enough for
 * every reader to import (the store reaches the database module).
 * `and(eq(plugins.enabled, true), notCoreRow())` where a read takes the
 * enabled set.
 */
export function notCoreRow(): SQL {
	// And never an `authored` id (C6): that namespace is the owner of an
	// authored component, so a row stored under it before installs refused it
	// would share that component's UI worker. One filter, both reserved ids.
	return and(
		ne(schema.plugins.pluginId, "core"),
		ne(schema.plugins.pluginId, AUTHORED_OWNER_LABEL),
		notLike(schema.plugins.pluginId, `${AUTHORED_OWNER_LABEL}.%`)
	)!
}

/** The frame document URL for a stored surface entry. */
export const frameSrc = (pluginId: string, entry: string): string =>
	`/plugin-ui/${pluginId}/${entry}`

/**
 * The inverse of `frameSrc`, over the `/plugin-ui/` route's catch-all tail:
 * the plugin id and the stored file path it carries, or `undefined` when it
 * carries neither — an id outside the slug grammar, a path that traverses, or
 * a tail too short to be both. Undefined is a 404 at the route: one shape for
 * "no such frame", so the URL never says which half was wrong.
 */
export function parseFrameSrc(
	rest: string | null | undefined
): { pluginId: string; path: string } | undefined {
	const segments = (rest ?? "").split("/").filter(Boolean)
	if (segments.length < 2) return undefined
	const [pluginId, ...rel] = segments
	if (!isPluginSlug(pluginId)) return undefined
	const path = rel.join("/")
	// Checked here as well as in `readPluginFile`: the route should refuse a
	// traversal before it ever reaches a query, and the read should refuse it
	// again for a caller that never came through a URL.
	if (!isSafeUiPath(path)) return undefined
	return { pluginId, path }
}

/* ── the CSP ────────────────────────────────────────────────────────────── */

export function frameCsp(manifest: unknown, adminDenied?: string[] | null): string {
	const eff = effectivePermissions(
		declaredPermissions(manifest as any),
		adminDenied ?? null
	)
	const hosts = networkGrant(eff) ?? []
	const connect = hosts
		.flatMap((h) => [`https://${h}`, `http://${h}`, `wss://${h}`, `ws://${h}`])
		.join(" ")
	return [
		"default-src 'none'",
		"script-src 'self'",
		// The frame styles itself; inline is its own document's business.
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"font-src 'self' data:",
		"media-src 'self' blob:",
		connect ? `connect-src ${connect}` : "connect-src 'none'",
		"form-action 'none'",
		"base-uri 'none'",
		// The sandbox is the DOCUMENT's, not only the iframe attribute's: a
		// direct navigation to a plugin's page (a link, a new tab) still runs
		// it at an opaque origin — never as this app, with its cookies.
		"sandbox allow-scripts",
		// Framed by this app's own pages and nobody else's.
		"frame-ancestors 'self'"
	].join("; ")
}
