/**
 * The session catalogue's admin half (23 §9): types, presets, and the
 * all-users sessions list. Every handler here is admin-gated except the
 * presets *list*, which the session-start picker needs — non-admins receive
 * only enabled presets of enabled types.
 *
 * The stack this serves, said once: pipelines → pipeline configurations →
 * session presets → a user picks a preset and starts a session, with optional
 * overrides.
 */
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { asc, desc, eq, sql } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { listSessionGenres } from "$lib/server/pipelines/entities/sessionGenres"

const adminOnly = (socket: any) => {
	if (!socket.user?.isAdmin) throw new Error("Unauthorized")
}

const presetRow = (
	p: typeof schema.sessionPresets.$inferSelect
): Sockets.SessionAdmin.PresetRow => ({
	id: p.id,
	name: p.name,
	description: p.description ?? null,
	genreId: p.genreId,
	bindings: (p.bindings ?? {}) as Record<
		string,
		{ spec: string; config?: number }
	>,
	primarySlug: p.primarySlug ?? null,
	configSelections: (p.configSelections ?? {}) as Record<string, number>,
	includedActions: (p.includedActions ?? null) as string[] | null,
	enabled: p.enabled,
	isDefault: p.isDefault,
	isImmutable: p.isImmutable
})

/* ── types ──────────────────────────────────────────────────────────── */

export const sessionGenresList: Handler<
	Sockets.SessionAdmin.Genres.Params,
	Sockets.SessionAdmin.Genres.Response
> = {
	event: "sessionGenres:list",
	handler: async (socket, _params, emitToUser) => {
		adminOnly(socket)
		const modes = await listSessionGenres(db as any)
		const settings = await db.select().from(schema.sessionGenreSettings)
		const presets = await db
			.select({
				genreId: schema.sessionPresets.genreId,
				n: sql<number>`count(*)`.mapWith(Number)
			})
			.from(schema.sessionPresets)
			.groupBy(schema.sessionPresets.genreId)
		const countBy = new Map(presets.map((p) => [p.genreId, p.n]))
		const settingBy = new Map(
			(settings as any[]).map((s) => [s.genreId, s])
		)
		// A genre's create pipeline (24 §3), for the workspace link — via the
		// input lock: the spec whose active version answers session-created
		// for that genre. Transitional input-type genres have none.
		const specRows = await db
			.select({
				slug: schema.pipelineSpecs.slug,
				activeVersionId: schema.pipelineSpecs.activeVersionId,
				versionId: schema.pipelineSpecVersions.id,
				inputGenre: schema.pipelineSpecVersions.inputGenre,
				inputEvent: schema.pipelineSpecVersions.inputEvent
			})
			.from(schema.pipelineSpecs)
			.innerJoin(
				schema.pipelineSpecVersions,
				eq(
					schema.pipelineSpecVersions.specId,
					schema.pipelineSpecs.id
				)
			)
		const createSpecByGenre = new Map<string, string>(
			(specRows as any[])
				.filter(
					(r) =>
						r.activeVersionId === r.versionId &&
						r.inputEvent === "session-created" &&
						r.inputGenre
				)
				.map((r) => [r.inputGenre, r.slug])
		)
		const res: Sockets.SessionAdmin.Genres.Response = {
			genres: modes.map((m) => {
				const st = settingBy.get(m.genreId)
				return {
					slug: m.genreId,
					name: m.name,
					description: m.description ?? "",
					family: (m as any).family ?? "",
					enabled: st ? !!st.enabled : true,
					defaultPresetId: st?.defaultPresetId ?? null,
					presetCount: countBy.get(m.genreId) ?? 0,
					createSpecSlug: createSpecByGenre.get(m.genreId) ?? null
				}
			})
		}
		emitToUser("sessionGenres:list", res)
		return res
	}
}

export const sessionGenresUpdate: Handler<
	Sockets.SessionAdmin.UpdateGenre.Params,
	Sockets.SessionAdmin.UpdateGenre.Response
> = {
	event: "sessionGenres:update",
	handler: async (socket, params, emitToUser) => {
		adminOnly(socket)
		const patch: Record<string, unknown> = {}
		if (params.enabled !== undefined) patch.enabled = params.enabled
		if (params.defaultPresetId !== undefined)
			patch.defaultPresetId = params.defaultPresetId
		await db
			.insert(schema.sessionGenreSettings)
			.values({ genreId: params.slug, ...patch })
			.onConflictDoUpdate({
				target: schema.sessionGenreSettings.genreId,
				set: { ...patch, updatedAt: new Date() }
			})
		const res = { slug: params.slug, ok: true }
		emitToUser("sessionGenres:update", res)
		await sessionGenresList.handler(socket, {}, emitToUser)
		return res
	}
}

/**
 * One genre's whole world (admin IA 2026-08-28): identity + shape, the event
 * surface with the pipelines whose input lock answers each slot, its presets,
 * its session count. Every fact here is a SELECT made elsewhere — this is the
 * dashboard where they meet.
 */
export const sessionGenresDetail: Handler<
	Sockets.SessionAdmin.GenreDetail.Params,
	Sockets.SessionAdmin.GenreDetail.Response
> = {
	event: "sessionGenres:detail",
	handler: async (socket, params, emitToUser) => {
		adminOnly(socket)
		const genres = await listSessionGenres(db as any)
		const genre = genres.find((g) => g.genreId === params.genreId)
		if (!genre) {
			const res: Sockets.SessionAdmin.GenreDetail.Response = {
				slots: [],
				presets: [],
				sessionCount: 0,
				error: `'${params.genreId}' is not a genre this build registers.`
			}
			emitToUser("sessionGenres:detail:error", res)
			return res
		}

		// The candidates, off the input locks — one SELECT, grouped by event.
		const specRows = await db
			.select({
				slug: schema.pipelineSpecs.slug,
				name: schema.pipelineSpecs.name,
				activeVersionId: schema.pipelineSpecs.activeVersionId,
				versionId: schema.pipelineSpecVersions.id,
				status: schema.pipelineSpecVersions.status,
				inputGenre: schema.pipelineSpecVersions.inputGenre,
				inputEvent: schema.pipelineSpecVersions.inputEvent
			})
			.from(schema.pipelineSpecs)
			.innerJoin(
				schema.pipelineSpecVersions,
				eq(schema.pipelineSpecVersions.specId, schema.pipelineSpecs.id)
			)
		const active = (specRows as any[]).filter(
			(r) =>
				r.activeVersionId === r.versionId &&
				r.status === "published" &&
				r.inputGenre === params.genreId
		)
		const events = genre.events ?? {}
		const eventNames = new Set([
			...Object.keys(events),
			...active.map((r) => r.inputEvent).filter(Boolean)
		])
		const slots: Sockets.SessionAdmin.GenreDetail.Slot[] = [
			...eventNames
		].map((event) => ({
			event,
			required: !!events[event]?.required,
			open: !!events[event]?.open,
			candidates: active
				.filter((r) => r.inputEvent === event)
				.map((r) => ({ slug: r.slug, name: r.name ?? r.slug }))
		}))

		const presetRows = await db
			.select()
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.genreId, params.genreId))
			.orderBy(asc(schema.sessionPresets.id))

		const sessions = await db
			.select({ n: sql<number>`count(*)`.mapWith(Number) })
			.from(schema.sessions)
			.where(eq(schema.sessions.genreId, params.genreId))

		const createSpecSlug =
			active.find((r) => r.inputEvent === "session-created")?.slug ?? null

		const res: Sockets.SessionAdmin.GenreDetail.Response = {
			genre: {
				genreId: genre.genreId,
				name: genre.name,
				description: genre.description ?? "",
				family: genre.family ?? "",
				shape: (genre.shape ?? {}) as Record<string, unknown>,
				createSpecSlug
			},
			slots,
			presets: (presetRows as any[]).map(presetRow),
			sessionCount: (sessions as any[])[0]?.n ?? 0
		}
		emitToUser("sessionGenres:detail", res)
		return res
	}
}

/* ── presets ────────────────────────────────────────────────────────── */

export const sessionPresetsList: Handler<
	Sockets.SessionAdmin.Presets.Params,
	Sockets.SessionAdmin.Presets.Response
> = {
	event: "sessionPresets:list",
	handler: async (socket, _params, emitToUser) => {
		const rows = await db
			.select()
			.from(schema.sessionPresets)
			.orderBy(asc(schema.sessionPresets.id))
		let out = (rows as any[]).map(presetRow)
		// The picker's cut: a non-admin sees only what they may start.
		if (!socket.user?.isAdmin) {
			const settings = await db
				.select()
				.from(schema.sessionGenreSettings)
			const disabledTypes = new Set(
				(settings as any[])
					.filter((s) => !s.enabled)
					.map((s) => s.genreId)
			)
			out = out.filter(
				(p) => p.enabled && !disabledTypes.has(p.genreId)
			)
		}
		const res = { presets: out }
		emitToUser("sessionPresets:list", res)
		return res
	}
}


/**
 * Validate a preset's event bindings against the input locks (24 §4) and the
 * genre's surface — the admin form is the modder's preset() with the same
 * refusals. Returns the error sentence, or null.
 */
async function validateBindings(
	genreId: string,
	bindings: Record<string, { spec: string; config?: number }>,
	opts: { enabled: boolean }
): Promise<string | null> {
	const specRows = await db
		.select({
			id: schema.pipelineSpecs.id,
			slug: schema.pipelineSpecs.slug,
			activeVersionId: schema.pipelineSpecs.activeVersionId,
			versionId: schema.pipelineSpecVersions.id,
			status: schema.pipelineSpecVersions.status,
			inputGenre: schema.pipelineSpecVersions.inputGenre,
			inputEvent: schema.pipelineSpecVersions.inputEvent,
			genre: schema.pipelineSpecVersions.genre
		})
		.from(schema.pipelineSpecs)
		.innerJoin(
			schema.pipelineSpecVersions,
			eq(schema.pipelineSpecVersions.specId, schema.pipelineSpecs.id)
		)
	const active = (specRows as any[]).filter(
		(r) => r.activeVersionId === r.versionId && r.status === "published"
	)
	const events =
		(active.find(
			(r) =>
				r.inputGenre === genreId && r.inputEvent === "session-created"
		)?.genre?.events ?? {}) as Record<
		string,
		{ required?: boolean; open?: boolean }
	>

	for (const [event, b] of Object.entries(bindings)) {
		if (events[event]?.open)
			return `'${event}' is an open slot — actions bind through the included list, not an event binding.`
		const spec = active.find((r) => r.slug === b.spec)
		if (!spec)
			return `'${b.spec}' is not published on this instance, so it cannot answer '${event}'.`
		if (spec.inputGenre !== genreId || spec.inputEvent !== event)
			return `'${b.spec}' answers '${spec.inputEvent ?? "nothing"}' for '${spec.inputGenre ?? "no genre"}' — it cannot bind to '${event}' of '${genreId}' (24 §4).`
		if (b.config != null) {
			const [config] = await db
				.select({
					id: schema.pipelineConfigs.id,
					specId: schema.pipelineConfigs.specId
				})
				.from(schema.pipelineConfigs)
				.where(eq(schema.pipelineConfigs.id, b.config))
				.limit(1)
			if (!config || config.specId !== spec.id)
				return `configuration #${b.config} does not belong to '${b.spec}'.`
		}
	}

	if (opts.enabled) {
		const missing = Object.entries(events)
			.filter(([, d]) => d?.required)
			.map(([e]) => e)
			.filter((e) => !bindings[e])
		if (missing.length)
			return `an enabled preset must bind its required slots — missing: ${missing.join(", ")}.`
	}
	return null
}

export const sessionPresetsCreate: Handler<
	Sockets.SessionAdmin.CreatePreset.Params,
	Sockets.SessionAdmin.CreatePreset.Response
> = {
	event: "sessionPresets:create",
	handler: async (socket, params, emitToUser) => {
		adminOnly(socket)
		const name = params.name?.trim()
		if (!name) {
			const res = { error: "A preset needs a name." }
			emitToUser("sessionPresets:create:error", res)
			return res
		}
		let base: Partial<typeof schema.sessionPresets.$inferInsert> = {}
		if (params.fromPresetId != null) {
			const [from] = await db
				.select()
				.from(schema.sessionPresets)
				.where(eq(schema.sessionPresets.id, params.fromPresetId))
				.limit(1)
			if (from)
				base = {
					bindings: (from as any).bindings,
					primarySlug: (from as any).primarySlug,
					configSelections: (from as any).configSelections,
					includedActions: (from as any).includedActions,
					defaults: (from as any).defaults
				}
		}
		// A bare preset starts with the locks' answers, so the form opens
		// with every slot the instance can fill already filled.
		if (!base.bindings || !Object.keys(base.bindings as object).length) {
			const { resolveSessionEventSpec } = await import(
				"$lib/server/pipelines/runtime/sessionEvents"
			)
			const bindings: Record<string, { spec: string }> = {}
			for (const event of ["session-created", "message-respond"]) {
				const spec = await resolveSessionEventSpec(
					db,
					params.genreId,
					event
				)
				if (spec) bindings[event] = { spec }
			}
			base.bindings = bindings
		}
		const [row] = await db
			.insert(schema.sessionPresets)
			.values({
				name,
				description: params.description ?? null,
				genreId: params.genreId,
				...base
			})
			.returning()
		const res = { preset: presetRow(row as any) }
		emitToUser("sessionPresets:create", res)
		await sessionPresetsList.handler(socket, {}, emitToUser)
		return res
	}
}

export const sessionPresetsUpdate: Handler<
	Sockets.SessionAdmin.UpdatePreset.Params,
	Sockets.SessionAdmin.UpdatePreset.Response
> = {
	event: "sessionPresets:update",
	handler: async (socket, params, emitToUser) => {
		adminOnly(socket)
		const [existing] = await db
			.select()
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.id, params.id))
			.limit(1)
		if (!existing) {
			const res = { error: "No such preset." }
			emitToUser("sessionPresets:update:error", res)
			return res
		}
		// The bindings contract (24 §4): validated like the modder's preset().
		const nextBindings =
			(params.bindings ??
				((existing as any).bindings as Record<
					string,
					{ spec: string; config?: number }
				>)) ?? {}
		const nextEnabled = params.enabled ?? !!(existing as any).enabled
		{
			const refusal = await validateBindings(
				(existing as any).genreId,
				nextBindings,
				{ enabled: nextEnabled }
			)
			if (refusal) {
				const res = { error: refusal }
				emitToUser("sessionPresets:update:error", res)
				return res
			}
		}

		// Immutable presets accept availability flags only — like the shipped
		// pipeline configs: duplicate to change what they select.
		const patch: Record<string, unknown> = {}
		if (params.enabled !== undefined) patch.enabled = params.enabled
		if (params.isDefault !== undefined) patch.isDefault = params.isDefault
		if (!(existing as any).isImmutable) {
			if (params.name !== undefined) patch.name = params.name.trim()
			if (params.description !== undefined)
				patch.description = params.description
			if (params.bindings !== undefined) patch.bindings = params.bindings
			if (params.primarySlug !== undefined)
				patch.primarySlug = params.primarySlug
			if (params.configSelections !== undefined)
				patch.configSelections = params.configSelections
			if (params.includedActions !== undefined)
				patch.includedActions = params.includedActions
		}
		const [row] = await db
			.update(schema.sessionPresets)
			.set(patch)
			.where(eq(schema.sessionPresets.id, params.id))
			.returning()
		// One default per type: setting it clears the others.
		if (params.isDefault) {
			await db
				.update(schema.sessionPresets)
				.set({ isDefault: false })
				.where(eq(schema.sessionPresets.genreId, (row as any).genreId))
			await db
				.update(schema.sessionPresets)
				.set({ isDefault: true })
				.where(eq(schema.sessionPresets.id, params.id))
		}
		const res = { preset: presetRow(row as any) }
		emitToUser("sessionPresets:update", res)
		await sessionPresetsList.handler(socket, {}, emitToUser)
		return res
	}
}

export const sessionPresetsDelete: Handler<
	Sockets.SessionAdmin.DeletePreset.Params,
	Sockets.SessionAdmin.DeletePreset.Response
> = {
	event: "sessionPresets:delete",
	handler: async (socket, params, emitToUser) => {
		adminOnly(socket)
		const [existing] = await db
			.select()
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.id, params.id))
			.limit(1)
		if (!existing || (existing as any).isImmutable) {
			const res = {
				id: params.id,
				ok: false,
				error: existing
					? "Shipped presets stay — duplicate one instead."
					: "No such preset."
			}
			emitToUser("sessionPresets:delete:error", res)
			return res
		}
		// Sessions born from it keep running; they simply reference nothing.
		await db
			.delete(schema.sessionPresets)
			.where(eq(schema.sessionPresets.id, params.id))
		const res = { id: params.id, ok: true }
		emitToUser("sessionPresets:delete", res)
		await sessionPresetsList.handler(socket, {}, emitToUser)
		return res
	}
}

/* ── all users' sessions ────────────────────────────────────────────── */

export const sessionsAdminList: Handler<
	Sockets.SessionAdmin.SessionsList.Params,
	Sockets.SessionAdmin.SessionsList.Response
> = {
	event: "sessions:adminList",
	handler: async (socket, params, emitToUser) => {
		adminOnly(socket)
		const limit = Math.min(Math.max(params.limit ?? 200, 1), 500)
		const rows = await db
			.select()
			.from(schema.sessions)
			.orderBy(desc(schema.sessions.updatedAt))
			.limit(limit)
		const users = await db
			.select({
				id: schema.users.id,
				username: schema.users.username
			})
			.from(schema.users)
		const userBy = new Map(users.map((u) => [u.id, u.username]))
		const presets = await db
			.select({
				id: schema.sessionPresets.id,
				name: schema.sessionPresets.name
			})
			.from(schema.sessionPresets)
		const presetBy = new Map(presets.map((p) => [p.id, p.name]))
		const modes = await listSessionGenres(db as any)
		const modeBy = new Map(modes.map((m) => [m.genreId, m.name]))

		const counts = async (table: any, col: any) => {
			const r = await db
				.select({
					sessionId: col,
					n: sql<number>`count(*)`.mapWith(Number)
				})
				.from(table)
				.groupBy(col)
			return new Map((r as any[]).map((x) => [x.sessionId, x.n]))
		}
		const chars = await counts(
			schema.sessionCharacters,
			schema.sessionCharacters.sessionId
		)
		const personas = await counts(
			schema.sessionPersonas,
			schema.sessionPersonas.sessionId
		)
		const msgs = await counts(
			schema.sessionMessages,
			schema.sessionMessages.sessionId
		)

		const res: Sockets.SessionAdmin.SessionsList.Response = {
			sessions: (rows as any[]).map((s) => ({
				id: s.id,
				name: s.name ?? null,
				userId: s.userId ?? null,
				username: userBy.get(s.userId) ?? "—",
				genreId: s.genreId,
				genreName: modeBy.get(s.genreId) ?? s.genreId,
				presetId: s.presetId ?? null,
				presetName:
					s.presetId != null
						? (presetBy.get(s.presetId) ?? null)
						: null,
				isGroup: !!s.isGroup,
				characterCount: chars.get(s.id) ?? 0,
				personaCount: personas.get(s.id) ?? 0,
				messageCount: msgs.get(s.id) ?? 0,
				updatedAt: s.updatedAt
					? new Date(s.updatedAt).toISOString()
					: null
			}))
		}
		emitToUser("sessions:adminList", res)
		return res
	}
}

export function registerSessionAdminHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, sessionGenresList, emitToUser)
	register(socket, sessionGenresUpdate, emitToUser)
	register(socket, sessionGenresDetail, emitToUser)
	register(socket, sessionPresetsList, emitToUser)
	register(socket, sessionPresetsCreate, emitToUser)
	register(socket, sessionPresetsUpdate, emitToUser)
	register(socket, sessionPresetsDelete, emitToUser)
	register(socket, sessionsAdminList, emitToUser)
}
