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
 * Read tolerantly like `engines`/`nodeTypes` — the stored manifest is the one
 * source of truth (F6), and a malformed declaration is a missing surface, not
 * a crash.
 *
 * ## The CSP the frame lives under
 *
 * `default-src 'none'` plus: same-origin scripts/styles/assets (the plugin's
 * own files, relative paths), and `connect-src` projected from the manifest's
 * *network grants* — the same declared, admin-deniable permission that
 * governs the server-side fetchHost governs the browser surface, with no new
 * vocabulary. No grant, no network: the frame cannot phone anywhere.
 */

import { eq, and } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	declaredPermissions,
	effectivePermissions,
	networkGrant
} from "./permissions"

type Db = { select: any; insert: any; delete: any }

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
	panels: Array<SurfaceDecl & { id: string }>
}

export function surfacesOf(manifest: unknown): PluginSurfaces {
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
			if (d && typeof p.id === "string" && /^[a-z0-9_-]+$/.test(p.id))
				out.panels.push({ ...d, id: p.id })
		}
	return out
}

/** The frame document URL for a stored surface entry. */
export const frameSrc = (pluginId: string, entry: string): string =>
	`/plugin-ui/${pluginId}/${entry}`

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
		"base-uri 'none'"
	].join("; ")
}
