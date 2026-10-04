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
 *       "page":         { "entry": "ui/index.html",   "title": "Dashboard" }
 *     }
 *
 * Read tolerantly like `templateEngines`/`nodeDefinitions` — the stored manifest is the one
 * source of truth (F6), and a malformed declaration is a missing surface, not
 * a crash.
 *
 * A frame placed in a session is a WIDGET: a `manifest.widgets` entry whose
 * `surface` is a frame, seated by `sessions:view` like any package widget,
 * under the **namespaced** id `<pluginId>:<widgetId>` (`pluginWidgetId`).
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
import { pluginWidgetId, type WidgetDecl } from "@serene-pub/sdk"
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
}

/** Read a stored manifest's `surfaces` block: its session view and its page. */
export function surfacesOf(manifest: unknown): PluginSurfaces {
	const raw =
		manifest && typeof manifest === "object"
			? (manifest as any).surfaces
			: undefined
	const out: PluginSurfaces = {}
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
	return out
}

/**
 * Every widget ONE plugin's stored manifest declares, under the namespaced id
 * it is seated by (`pluginWidgetId`) — the one definition of "a plugin's
 * widgets" that every id allow-list and the layout validator read.
 *
 * One declaration: `manifest.widgets`, component widgets (the Battleship
 * board) and frame widgets alike.
 *
 * ⚠ The declaration, not the seating: a widget whose module is unbuilt, or
 * that is built for another host contract, is still listed — its id is real
 * and a row made for it must survive the rebuild — where `sessions:view`
 * offers it only once it can mount. `maxInstances` is carried only when it
 * is a number, which is the only cap the validator honours.
 */
export function pluginWidgetDecls(
	manifest: unknown,
	pluginId: string
): Array<Pick<WidgetDecl, "id" | "maxInstances">> {
	const out: Array<Pick<WidgetDecl, "id" | "maxInstances">> = []
	const widgets =
		manifest && typeof manifest === "object"
			? (manifest as { widgets?: unknown }).widgets
			: undefined
	if (Array.isArray(widgets))
		for (const w of widgets as Array<Partial<WidgetDecl> | null>)
			if (w && typeof w.id === "string")
				out.push({
					id: pluginWidgetId(pluginId, w.id),
					...(typeof w.maxInstances === "number"
						? { maxInstances: w.maxInstances }
						: {})
				})
	return out
}

/**
 * Every widget an ENABLED plugin declares, by the id it is seated under.
 *
 * The one answer to "is this namespaced widget id real?", for the writes that
 * have to refuse an id no widget would ever ask for — a widget style, and
 * anything else keyed on `widget_slug`. Read from the stored manifests through
 * `pluginWidgetDecls` — component and frame widgets alike — so a validator
 * never refuses an id the session view seats.
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
		for (const w of pluginWidgetDecls(r.manifest, r.pluginId)) ids.add(w.id)
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
