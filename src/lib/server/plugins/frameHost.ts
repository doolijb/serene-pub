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
 *
 * 🚧 (M2a) One exception, and only for GET: the frame's OWN plugin's two doors,
 * `/plugin-assets/<id>/` and `/plugin-data/<id>/`, are written into
 * `connect-src` as scheme-less host-sources WITH a path (`'self'` cannot
 * carry a path, and a bare `'self'` would open the whole app). The frame's
 * origin is opaque, so its `fetch` is cross-origin: the two doors answer an
 * `Origin: null` request with `Access-Control-Allow-Origin: null` (never
 * credentials, never another origin). Both routes export GET alone, so a
 * preflighted request (POST, PUT, custom headers) can never succeed.
 */

import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { readFile, realpath, stat } from "node:fs/promises"
import nodePath from "node:path"
import { Readable } from "node:stream"
import { eq, and, ne, notLike, type SQL } from "drizzle-orm"
import { getAppDataDir } from "$lib/server/utils/appDataDir"
import { AUTHORED_OWNER_LABEL } from "$lib/shared/widgets/authoredOwner"
import { pluginWidgetId, type WidgetDecl } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import {
	autoplayGranted,
	declaredPermissions,
	effectivePermissions,
	networkGrant,
	perUserStorageGrant,
	servedStorageGlobs
} from "./permissions"
import { mimeForUiPath } from "./pluginMime"
import { pluginsEnabled } from "./flag"

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
			bytes: bytes.byteLength,
			kind: "ui"
		})
		stored++
	}
	return { stored, refused }
}

/**
 * The absolute path of a `disk` row's file, or null when the row is not on disk
 * or its `disk_path` escapes `<dataDir>/plugins/`.
 */
export function pluginFileAbsPath(row: {
	storedAt: string
	diskPath: string | null
}): string | null {
	if (row.storedAt !== "disk" || !row.diskPath) return null
	const root = nodePath.join(getAppDataDir(), "plugins")
	const abs = nodePath.join(getAppDataDir(), row.diskPath)
	return abs.startsWith(root + nodePath.sep) ? abs : null
}

/** A stored file's bytes, wherever they live: base64 in the row, or the file on disk. */
export async function readPluginFileBytes(row: {
	storedAt: string
	content: string | null
	diskPath: string | null
}): Promise<Buffer> {
	if (row.storedAt === "disk") {
		const abs = pluginFileAbsPath(row)
		if (!abs) throw new Error("A plugin file's disk path is outside the plugins folder.")
		return readFile(abs)
	}
	return Buffer.from(row.content ?? "", "base64")
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
 * have to refuse an id no widget would ever ask for — a widget style
 * (`widget_styles.widget_slug`), a widget's settings (`widget_instance_id`,
 * through `widgetOfInstance`). Read from the stored manifests through
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
 * per-session write keyed on a widget instance id (`widget_instance_id`) is
 * held to, through `widgetOfInstance`.
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
export const frameSrc = (pluginId: string, entry: string, version?: string): string =>
	`/plugin-ui/${pluginId}/${entry}${version ? `?v=${encodeURIComponent(version)}` : ""}`

/**
 * The inverse for `/plugin-assets/<id>/<version>/<path…>`: the version is part
 * of the address, so an asset URL is immutable across upgrades.
 */
export function parseAssetSrc(
	rest: string | null | undefined
): { pluginId: string; version: string; path: string } | undefined {
	const segments = (rest ?? "").split("/").filter(Boolean)
	if (segments.length < 3) return undefined
	const [pluginId, version, ...rel] = segments
	if (!isPluginSlug(pluginId) || !/^[0-9A-Za-z.+-]+$/.test(version)) return undefined
	const path = rel.join("/")
	if (!isSafeUiPath(path)) return undefined
	return { pluginId, version, path }
}

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

/**
 * 🚧 (M2a) `doors` names the request's `url.host` and the frame's plugin id;
 * with it `connect-src` opens for GET on that plugin's own `/plugin-assets/`
 * and `/plugin-data/` and nothing else. A host outside the host-source
 * grammar is ignored (it could otherwise smuggle a directive).
 */
export function frameCsp(
	manifest: unknown,
	adminDenied?: string[] | null,
	doors?: { host: string; pluginId: string }
): string {
	const eff = effectivePermissions(
		declaredPermissions(manifest as any),
		adminDenied ?? null
	)
	const hosts = networkGrant(eff) ?? []
	const doorSources =
		doors && /^[A-Za-z0-9.-]+(:\d+)?$|^\[[0-9A-Fa-f:.]+\](:\d+)?$/.test(doors.host) && isPluginSlug(doors.pluginId)
			? [
					`${doors.host}/plugin-assets/${doors.pluginId}/`,
					`${doors.host}/plugin-data/${doors.pluginId}/`
				]
			: []
	const connect = [
		...doorSources,
		...hosts.flatMap((h) => [`https://${h}`, `http://${h}`, `wss://${h}`, `ws://${h}`])
	].join(" ")
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

/**
 * 🚧 `Permissions-Policy` for a frame document (M0, SHAPES L8): sound may
 * not start unasked (`autoplay=()`) unless `media:autoplay` is declared,
 * reviewed and not denied. Null when granted — no header at all.
 */
export function framePermissionsPolicy(
	manifest: unknown,
	adminDenied?: string[] | null
): string | null {
	const eff = effectivePermissions(
		declaredPermissions(manifest as any),
		adminDenied ?? null
	)
	return autoplayGranted(eff) ? null : "autoplay=()"
}

/* ── serving assets and served storage ──────────────────────────────────── */

/** Whether `path` is a safe path matching one of the granted globs. */
export function servedPathAllowed(globs: readonly string[], path: string): boolean {
	return (
		isSafeUiPath(path) &&
		globs.some((g) => (nodePath.posix as any).matchesGlob(path, g) as boolean)
	)
}

/**
 * One `bytes=a-b` / `bytes=a-` / `bytes=-n` range over a body of `size` bytes.
 * Null for anything else (serve the whole body); `"unsatisfiable"` for a range
 * wholly past the end.
 */
export function parseByteRange(
	header: string | null,
	size: number
): { start: number; end: number } | "unsatisfiable" | null {
	if (!header) return null
	const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
	if (!m || (m[1] === "" && m[2] === "")) return null
	if (size <= 0) return "unsatisfiable"
	if (m[1] === "") {
		const n = Number(m[2])
		if (n <= 0) return "unsatisfiable"
		return { start: Math.max(size - n, 0), end: size - 1 }
	}
	const start = Number(m[1])
	if (start >= size) return "unsatisfiable"
	if (m[2] === "") return { start, end: size - 1 }
	const end = Number(m[2])
	if (end < start) return null
	return { start, end: Math.min(end, size - 1) }
}

const INERT_CSP =
	"default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox"

interface ServedBody {
	size: number
	mime: string
	etag: string
	cacheControl: string
	/**
	 * 🚧 (M2b) A person's own file (`/plugin-data/<id>/me/…`): no CORS answer at
	 * all, whatever the request's `Origin` — an opaque-origin frame sends no
	 * cookie, and a credentialed answer to `Origin: null` would hand any
	 * sandboxed page the person's files.
	 */
	private?: boolean
	body: (range: { start: number; end: number } | null) => BodyInit
}

function respond(request: Request, o: ServedBody): Response {
	const headers: Record<string, string> = {
		"Content-Type": o.mime,
		ETag: o.etag,
		"Cache-Control": o.cacheControl,
		"X-Content-Type-Options": "nosniff",
		"Content-Security-Policy": INERT_CSP,
		"Accept-Ranges": "bytes"
	}
	if (o.mime.startsWith("image/svg+xml")) headers["Content-Disposition"] = "inline"
	if (!o.private) Object.assign(headers, doorCors(request))
	if (request.headers.get("if-none-match") === o.etag)
		return new Response(null, { status: 304, headers })
	const range = parseByteRange(request.headers.get("range"), o.size)
	if (range === "unsatisfiable")
		return new Response(null, {
			status: 416,
			headers: { ...headers, "Content-Range": `bytes */${o.size}` }
		})
	if (range) {
		headers["Content-Range"] = `bytes ${range.start}-${range.end}/${o.size}`
		headers["Content-Length"] = String(range.end - range.start + 1)
		return new Response(o.body(range), { status: 206, headers })
	}
	headers["Content-Length"] = String(o.size)
	return new Response(o.body(null), { headers })
}

const diskBody = (abs: string, range: { start: number; end: number } | null): BodyInit =>
	Readable.toWeb(
		createReadStream(abs, range ? { start: range.start, end: range.end } : undefined)
	) as unknown as ReadableStream

/**
 * 🚧 (M2a) The CORS answer of the frame's two doors. A frame is an opaque
 * origin: its `fetch` carries `Origin: null`. Only that exact origin is
 * answered, never with credentials. `Vary` is unconditional so a cache never
 * hands a frame a copy made for a request that carried no origin.
 */
function doorCors(request: Request): Record<string, string> {
	return request.headers.get("origin") === "null"
		? { Vary: "Origin", "Access-Control-Allow-Origin": "null" }
		: { Vary: "Origin" }
}

/**
 * The doors' not-found, with the same CORS answer as a 200 (M2b): without it
 * a frame's `fetch` of a missing file rejects as a network error, and the
 * frame cannot tell "not there" from "not allowed".
 */
const NOT_FOUND = (request: Request): Response =>
	new Response("Not found", { status: 404, headers: doorCors(request) })

/** The enabled, non-core plugin a `/plugin-assets` or `/plugin-data` URL names. */
async function servingPlugin(db: Db, rest: string | undefined, versioned = false) {
	if (!pluginsEnabled()) return null
	const parsed = versioned ? parseAssetSrc(rest) : parseFrameSrc(rest)
	if (!parsed) return null
	const [plugin] = await db
		.select({
			version: schema.plugins.version,
			enabled: schema.plugins.enabled,
			manifest: schema.plugins.manifest,
			adminDenied: schema.plugins.adminDenied
		})
		.from(schema.plugins)
		.where(and(eq(schema.plugins.pluginId, parsed.pluginId), notCoreRow()))
		.limit(1)
	if (!plugin?.enabled) return null
	if ("version" in parsed && parsed.version !== plugin.version) return null
	return { ...parsed, plugin }
}

/**
 * `/plugin-assets/<pluginId>/<path>` — a package's `asset` files, immutable,
 * ETag = the row's sha256. A `ui` row is a 404 here.
 */
export async function pluginAssetResponse(
	db: Db,
	rest: string | undefined,
	request: Request
): Promise<Response> {
	const hit = await servingPlugin(db, rest, true)
	if (!hit) return NOT_FOUND(request)
	const file = await readPluginFile(db, hit.pluginId, hit.path)
	if (!file || file.kind !== "asset") return NOT_FOUND(request)
	const base = {
		mime: file.mime,
		etag: `"${file.hash}"`,
		cacheControl: "public, max-age=31536000, immutable"
	}
	if (file.storedAt === "disk") {
		const abs = pluginFileAbsPath(file)
		let size: number
		try {
			if (!abs) throw new Error("outside the plugins folder")
			size = (await stat(abs)).size
		} catch {
			console.warn(
				`[plugins] '${hit.pluginId}' asset '${hit.path}' is missing on disk (${file.diskPath})`
			)
			return NOT_FOUND(request)
		}
		return respond(request, { ...base, size, body: (r) => diskBody(abs as string, r) })
	}
	const bytes = await readPluginFileBytes(file)
	return respond(request, {
		...base,
		size: bytes.byteLength,
		body: (r) => new Uint8Array(r ? bytes.subarray(r.start, r.end + 1) : bytes)
	})
}

const dataEtags = new Map<string, string>()

async function sha256OfPath(abs: string, mtimeMs: number, size: number): Promise<string> {
	const key = `${abs}|${mtimeMs}|${size}`
	const known = dataEtags.get(key)
	if (known) return known
	const hash = await new Promise<string>((resolve, reject) => {
		const h = createHash("sha256")
		const s = createReadStream(abs)
		s.on("error", reject)
		s.on("data", (c) => h.update(c))
		s.on("end", () => resolve(h.digest("hex")))
	})
	dataEtags.set(key, hash)
	while (dataEtags.size > 500) dataEtags.delete(dataEtags.keys().next().value as string)
	return hash
}

/**
 * `/plugin-data/<pluginId>/<path>` — files the plugin wrote to its own storage,
 * served only where a granted `storage-serve:<glob>` matches. Never a listing.
 */
export async function pluginDataResponse(
	db: Db,
	rest: string | undefined,
	request: Request,
	/** 🚧 (M2b) The signed-in person's id, for `me/…`; null/absent = nobody. */
	userId?: number | null
): Promise<Response> {
	const hit = await servingPlugin(db, rest)
	if (!hit) return NOT_FOUND(request)
	// `me/` is reserved (M2b): everything under it is the signed-in person's
	// own files, never the pub-wide folder, and it never gets a CORS answer.
	if (hit.path === "me" || hit.path.startsWith("me/")) {
		const mine = (): Response =>
			new Response("Not found", {
				status: 404,
				headers: { "Cache-Control": "private, no-store" }
			})
		const rel = hit.path.slice(3)
		const eff = effectivePermissions(
			declaredPermissions(hit.plugin.manifest as any),
			hit.plugin.adminDenied ?? null
		)
		if (!userId || !rel || perUserStorageGrant(eff) === undefined) return mine()
		if (!servedPathAllowed(servedStorageGlobs(eff), rel)) return mine()
		const { userStorageDir } = await import("./SandboxManager")
		const root = userStorageDir(getAppDataDir(), hit.pluginId, userId)
		if (!root) return mine()
		try {
			const real = await realpath(nodePath.join(root, rel))
			const realRoot = await realpath(root)
			if (!real.startsWith(realRoot + nodePath.sep)) return mine()
			const st = await stat(real)
			if (!st.isFile()) return mine()
			const hash = await sha256OfPath(real, st.mtimeMs, st.size)
			return respond(request, {
				size: st.size,
				mime: mimeForUiPath(rel),
				etag: `"${hash}"`,
				cacheControl: "private, no-store",
				private: true,
				body: (r) => diskBody(real, r)
			})
		} catch {
			return mine()
		}
	}
	const globs = servedStorageGlobs(
		effectivePermissions(
			declaredPermissions(hit.plugin.manifest as any),
			hit.plugin.adminDenied ?? null
		)
	)
	if (!servedPathAllowed(globs, hit.path)) return NOT_FOUND(request)
	const { storageSegment } = await import("./SandboxManager")
	const root = nodePath.join(getAppDataDir(), "extensions_data", storageSegment(hit.pluginId))
	let abs: string
	let size: number
	let mtimeMs: number
	try {
		const real = await realpath(nodePath.join(root, hit.path))
		const realRoot = await realpath(root)
		if (!real.startsWith(realRoot + nodePath.sep)) return NOT_FOUND(request)
		const st = await stat(real)
		if (!st.isFile()) return NOT_FOUND(request)
		abs = real
		size = st.size
		mtimeMs = st.mtimeMs
	} catch {
		return NOT_FOUND(request)
	}
	const hash = await sha256OfPath(abs, mtimeMs, size)
	return respond(request, {
		size,
		mime: mimeForUiPath(hit.path),
		etag: `"${hash}"`,
		cacheControl: "private, no-cache",
		body: (r) => diskBody(abs, r)
	})
}
