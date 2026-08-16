import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq, or, and } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"

function toMeta(
	row: typeof schema.customThemes.$inferSelect & {
		uploader?: { username: string } | null
	},
	includeUploader: boolean
): Sockets.CustomThemes.ThemeMeta {
	return {
		id: row.id,
		name: row.name,
		label: row.label,
		cssKey: row.cssKey,
		isInstanceTheme: row.isInstanceTheme,
		uploadedBy: includeUploader ? row.uploadedBy : undefined,
		uploaderName: includeUploader
			? (row.uploader?.username ?? null)
			: undefined,
		createdAt: row.createdAt.toISOString()
	}
}

function stripDataThemeWrapper(css: string): string {
	// Strip [data-theme='...'] { ... } selector wrapper
	const withSelector = css.replace(
		/^\s*\[data-theme=[^\]]*\]\s*\{([\s\S]*)\}\s*$/,
		(_, inner) => inner.trim()
	)
	if (withSelector !== css) return withSelector
	// Strip bare { ... } wrapper (Skeleton generator outputs this format)
	return css.replace(/^\s*\{([\s\S]*)\}\s*$/, (_, inner) => inner.trim())
}

// `@import` and an external `url(...)` are classic CSS-based
// data-exfiltration vectors (leaking page state/cookies via a background
// image request to an attacker-controlled host, or pulling in arbitrary
// remote stylesheet content). style-src stays a tight fixed list, but
// img-src deliberately allows any "https:" host (inline chat images need
// that — see svelte.config.js), so this rejection is this app's *actual*
// defense for theme CSS, not just a backstop behind CSP. Rejects (doesn't
// silently strip) so the upload fails loudly rather than having content
// silently vanish.
const CSS_IMPORT_RE = /@import\b/i
const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi
export function assertSafeThemeCss(css: string) {
	if (CSS_IMPORT_RE.test(css)) {
		throw new Error("Theme CSS cannot contain @import.")
	}
	for (const match of css.matchAll(CSS_URL_RE)) {
		const target = match[2].trim()
		// Matches "http://", "https://", and protocol-relative "//" — the
		// (https?:)? prefix is optional, so this one check covers all three.
		if (/^(https?:)?\/\//i.test(target)) {
			throw new Error(
				"Theme CSS cannot reference external URLs in url(...) — only relative paths or data: URIs are allowed."
			)
		}
	}
}

export const customThemesList: Handler<
	Sockets.CustomThemes.List.Params,
	Sockets.CustomThemes.List.Response
> = {
	event: "customThemes:list",
	handler: async (socket, _params, emitToUser) => {
		const userId = socket.user?.id ?? null
		const isAdmin = socket.user?.isAdmin ?? false

		const rows = await db.query.customThemes.findMany({
			with: { uploader: { columns: { username: true } } }
		})

		const myThemes = rows
			.filter((r) => r.uploadedBy === userId)
			.map((r) => toMeta(r, isAdmin))

		const instanceThemes = rows
			.filter((r) => r.isInstanceTheme && r.uploadedBy !== userId)
			.map((r) => toMeta(r, isAdmin))

		const res: Sockets.CustomThemes.List.Response = {
			myThemes,
			instanceThemes
		}
		emitToUser("customThemes:list", res)
		return res
	}
}

export const customThemesGetCss: Handler<
	Sockets.CustomThemes.GetCss.Params,
	Sockets.CustomThemes.GetCss.Response
> = {
	event: "customThemes:getCss",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user?.id ?? null
		const isAdmin = socket.user?.isAdmin ?? false

		const row = await db.query.customThemes.findFirst({
			where: eq(schema.customThemes.name, params.name)
		})

		if (!row) throw new Error("Theme not found")
		if (!isAdmin && row.uploadedBy !== userId && !row.isInstanceTheme) {
			throw new Error("Unauthorized")
		}

		// Lazy-generate cssKey for themes created before this column existed
		let cssKey = row.cssKey
		if (!cssKey) {
			cssKey = crypto.randomUUID()
			await db
				.update(schema.customThemes)
				.set({ cssKey })
				.where(eq(schema.customThemes.id, row.id))
		}

		const res: Sockets.CustomThemes.GetCss.Response = {
			name: row.name,
			css: row.css,
			cssKey
		}
		emitToUser("customThemes:getCss", res)
		return res
	}
}

export const customThemesSave: Handler<
	Sockets.CustomThemes.Save.Params,
	Sockets.CustomThemes.Save.Response
> = {
	event: "customThemes:save",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user?.id ?? null
		const isAdmin = socket.user?.isAdmin ?? false

		if (!params.label.trim() || !params.css.trim()) {
			throw new Error("Label and CSS are required")
		}

		const rawCss = stripDataThemeWrapper(params.css)
		assertSafeThemeCss(rawCss)
		const newCssKey = crypto.randomUUID()

		let row: typeof schema.customThemes.$inferSelect & {
			uploader?: { username: string } | null
		}

		if (params.id) {
			const existing = await db.query.customThemes.findFirst({
				where: eq(schema.customThemes.id, params.id)
			})
			if (!existing) throw new Error("Theme not found")
			if (!isAdmin && existing.uploadedBy !== userId)
				throw new Error("Unauthorized")

			const [updated] = await db
				.update(schema.customThemes)
				.set({
					name: params.name,
					label: params.label,
					css: rawCss,
					cssKey: newCssKey
				})
				.where(eq(schema.customThemes.id, params.id))
				.returning()

			row = { ...updated, uploader: null }
		} else {
			const [inserted] = await db
				.insert(schema.customThemes)
				.values({
					name: params.name,
					label: params.label,
					css: rawCss,
					cssKey: newCssKey,
					uploadedBy: userId
				})
				.returning()

			row = { ...inserted, uploader: null }
		}

		// Fetch with uploader for response
		const withUploader = await db.query.customThemes.findFirst({
			where: eq(schema.customThemes.id, row.id),
			with: { uploader: { columns: { username: true } } }
		})

		const res: Sockets.CustomThemes.Save.Response = {
			theme: toMeta(withUploader!, isAdmin)
		}
		emitToUser("customThemes:save", res)
		return res
	}
}

export const customThemesDelete: Handler<
	Sockets.CustomThemes.Delete.Params,
	Sockets.CustomThemes.Delete.Response
> = {
	event: "customThemes:delete",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user?.id ?? null
		const isAdmin = socket.user?.isAdmin ?? false

		const existing = await db.query.customThemes.findFirst({
			where: eq(schema.customThemes.id, params.id)
		})
		if (!existing) throw new Error("Theme not found")
		if (!isAdmin && existing.uploadedBy !== userId)
			throw new Error("Unauthorized")

		await db
			.delete(schema.customThemes)
			.where(eq(schema.customThemes.id, params.id))

		const res: Sockets.CustomThemes.Delete.Response = { success: true }
		emitToUser("customThemes:delete", res)
		return res
	}
}

export const customThemesSetInstanceTheme: Handler<
	Sockets.CustomThemes.SetInstanceTheme.Params,
	Sockets.CustomThemes.SetInstanceTheme.Response
> = {
	event: "customThemes:setInstanceTheme",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user?.isAdmin) throw new Error("Unauthorized")

		await db
			.update(schema.customThemes)
			.set({ isInstanceTheme: params.enabled })
			.where(eq(schema.customThemes.id, params.id))

		const res: Sockets.CustomThemes.SetInstanceTheme.Response = {
			success: true
		}
		emitToUser("customThemes:setInstanceTheme", res)
		return res
	}
}

export function registerCustomThemeHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, customThemesList, emitToUser)
	register(socket, customThemesGetCss, emitToUser)
	register(socket, customThemesSave, emitToUser)
	register(socket, customThemesDelete, emitToUser)
	register(socket, customThemesSetInstanceTheme, emitToUser)
}
