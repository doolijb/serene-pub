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
import { sessionEvents } from "@serene-pub/sdk"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { answersEvent } from "$lib/server/pipelines/entities/presetBindings"
import { asc, desc, eq, inArray, sql } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import {
	listGenreActions,
	listOfferedGenres,
	listSessionGenres,
	normalizeIncludedActions,
	promoteIncludedActions
} from "$lib/server/pipelines/entities/sessionGenres"

const adminOnly = (socket: any) => {
	if (!socket.user?.isAdmin) throw new Error("Unauthorized")
}

/**
 * The notices the boot reconcile left, in the shape every surface repeats.
 *
 * Read as a batch and attached to the rows rather than fetched per preset: the
 * list renders every preset on the instance, and a query each would be the
 * classic N+1 on a screen that exists to be scanned.
 */
async function staleBindingsByPreset(
	presetIds: number[]
): Promise<Map<number, Sockets.SessionAdmin.StaleBinding[]>> {
	const out = new Map<number, Sockets.SessionAdmin.StaleBinding[]>()
	if (!presetIds.length) return out
	const rows = (await db
		.select()
		.from(schema.sessionPresetNotices)
		.where(inArray(schema.sessionPresetNotices.presetId, presetIds))
		.orderBy(asc(schema.sessionPresetNotices.event))) as any[]
	for (const r of rows) {
		const list = out.get(r.presetId) ?? []
		list.push({
			event: r.event,
			bound: r.boundSpec,
			reason: r.reason,
			fallbackSpec: r.fallbackSpec ?? null,
			firstSeenAt: new Date(r.firstSeenAt).toISOString()
		})
		out.set(r.presetId, list)
	}
	return out
}

const presetRow = (
	p: typeof schema.sessionPresets.$inferSelect,
	stale?: Sockets.SessionAdmin.StaleBinding[]
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
	defaults: (p.defaults ??
		null) as Sockets.SessionAdmin.PresetDefaults | null,
	enabled: p.enabled,
	isDefault: p.isDefault,
	isImmutable: p.isImmutable,
	// Absent rather than empty: "the reconcile found nothing" and "nobody
	// asked" are the same answer to a reader, and an empty array on every row
	// would put a shape on the wire that means neither.
	...(stale?.length ? { staleBindings: stale } : {})
})

/* ── types ──────────────────────────────────────────────────────────── */

/**
 * Every genre with its settings, preset count and create pipeline.
 *
 * Split out of the handler below so the one cascade that re-sends it
 * (`sessionGenres:update`) can hand it to `emitToUser` as a thunk
 * (socket-interest plan, ruling 4): ONE source of truth for the payload, and
 * the four reads behind it — the registry, the settings, the preset counts and
 * every spec version's input lock — are paid only when some socket declared the
 * key. Skipping the emit alone would save nothing; those reads are the cost.
 */
async function buildSessionGenres(): Promise<Sockets.SessionAdmin.Genres.Response> {
	const modes = await listOfferedGenres(db)
	const settings = await db.select().from(schema.sessionGenreSettings)
	// Counted as listed (R67): a disabled plugin's presets are not.
	const { disabledPlugins } = await import("$lib/server/plugins/disabledPlugins")
	const off = await disabledPlugins(db)
	const presets = await db
		.select({
			genreId: schema.sessionPresets.genreId,
			ownerPluginId: schema.sessionPresets.ownerPluginId
		})
		.from(schema.sessionPresets)
	const countBy = new Map<string, number>()
	for (const p of presets)
		if (!off.owns(p.ownerPluginId))
			countBy.set(p.genreId, (countBy.get(p.genreId) ?? 0) + 1)
	const settingBy = new Map((settings as any[]).map((s) => [s.genreId, s]))
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
			eq(schema.pipelineSpecVersions.specId, schema.pipelineSpecs.id)
		)
	const createSpecByGenre = new Map<string, string>(
		(specRows as any[])
			.filter(
				(r) =>
					r.activeVersionId === r.versionId &&
					r.inputEvent === sessionEvents.sessionCreated &&
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
	return res
}

export const sessionGenresList: Handler<
	Sockets.SessionAdmin.Genres.Params,
	Sockets.SessionAdmin.Genres.Response
> = {
	event: "sessionGenres:list",
	handler: async (socket, _params, emitToUser) => {
		adminOnly(socket)
		const res = await buildSessionGenres()
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
		// LAZY (socket-interest plan, ruling 4): a re-list nobody asked for,
		// so the four reads behind it are paid only where a genre list is
		// open. Skipping the emit alone would save nothing.
		await emitToUser("sessionGenres:list", () => buildSessionGenres())
		// The hub shows the switch too (R66).
		await emitToUser("sessionGenres:detail", () => buildGenreDetail(params.slug))
		return res
	}
}

/**
 * One genre's whole world (admin IA 2026-08-28): identity + shape, the event
 * surface with the pipelines whose input lock answers each slot, its presets,
 * its session count. Every fact here is a SELECT made elsewhere — this is the
 * dashboard where they meet.
 */
/**
 * Every swap an ENABLED plugin contributes to one of these pipelines (R29),
 * with the admin's switch for it (`plugins.disabled_swaps`, R66). A disabled
 * plugin's contributions are not listed — owner ruling 2026-09-24: a plugin
 * that is off appears nowhere outside the plugins page — but its switches
 * stay stored, so turning it back on restores them.
 */
async function genreSwapContributions(
	specNames: Map<string, string>
): Promise<Sockets.SessionAdmin.GenreDetail.SwapRow[]> {
	if (!specNames.size) return []
	const { swapKey } = await import("$lib/server/pipelines/entities/bindings")
	const { i18nText } = await import("@serene-pub/sdk")
	const plugins = await db
		.select({
			pluginId: schema.plugins.pluginId,
			name: schema.plugins.name,
			enabled: schema.plugins.enabled,
			manifest: schema.plugins.manifest,
			disabledSwaps: schema.plugins.disabledSwaps
		})
		.from(schema.plugins)
		.where(eq(schema.plugins.enabled, true))
		.orderBy(asc(schema.plugins.id))
	const registry = await db
		.select({
			definitionId: schema.pipelineDefinitionRegistry.definitionId,
			version: schema.pipelineDefinitionRegistry.version,
			i18n: schema.pipelineDefinitionRegistry.i18n
		})
		.from(schema.pipelineDefinitionRegistry)
	const nameOf = new Map(
		(registry as any[]).map((r) => [
			`${r.definitionId}@${r.version}`,
			i18nText(r.i18n?.name) || r.definitionId
		])
	)
	const out: Sockets.SessionAdmin.GenreDetail.SwapRow[] = []
	for (const p of plugins as any[]) {
		const swaps = (p.manifest?.swaps ?? []) as Array<{
			spec?: string
			node?: string
			definition?: string
		}>
		for (const c of Array.isArray(swaps) ? swaps : []) {
			if (!c?.spec || !c.node || !c.definition || !specNames.has(c.spec)) continue
			out.push({
				pluginId: p.pluginId,
				pluginName: p.name ?? p.pluginId,
				spec: c.spec,
				specName: specNames.get(c.spec)!,
				node: c.node,
				definition: c.definition,
				name: nameOf.get(c.definition) ?? c.definition,
				enabled: !(p.disabledSwaps ?? []).includes(
					swapKey(c.spec, c.node, c.definition)
				)
			})
		}
	}
	return out
}

/**
 * One genre's hub (admin IA 2026-08-28; grown by B4, R66): identity, its
 * app-wide switch, the event surface, its presets, its session count, and
 * the swap contributions plugins make to its pipelines. Built apart from the
 * handler so the hub's writes can re-send it to whoever has it open.
 */
async function buildGenreDetail(
	genreId: string
): Promise<Sockets.SessionAdmin.GenreDetail.Response> {
	const genres = await listOfferedGenres(db)
	const genre = genres.find((g) => g.genreId === genreId)
	if (!genre) {
		const res: Sockets.SessionAdmin.GenreDetail.Response = {
			slots: [],
			presets: [],
			sessionCount: 0,
			error: `'${genreId}' is not a genre this build registers.`
		}
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
			inputEvent: schema.pipelineSpecVersions.inputEvent,
			inputEvents: schema.pipelineSpecVersions.inputEvents,
			sourcePluginId: schema.pipelineSpecs.sourcePluginId
		})
		.from(schema.pipelineSpecs)
		.innerJoin(
			schema.pipelineSpecVersions,
			eq(schema.pipelineSpecVersions.specId, schema.pipelineSpecs.id)
		)
	// A disabled plugin's pipelines are no candidate here (R67).
	const { disabledPlugins } = await import("$lib/server/plugins/disabledPlugins")
	const off = await disabledPlugins(db)
	const active = (specRows as any[]).filter(
		(r) =>
			r.activeVersionId === r.versionId &&
			r.status === "published" &&
			r.inputGenre === genreId &&
			!off.owns(r.sourcePluginId)
	)
	const events = genre.events ?? {}
	const eventNames = new Set([
		...Object.keys(events),
		...active.flatMap((r) => [r.inputEvent, ...(r.inputEvents ?? [])]).filter(Boolean)
	])
	const slots: Sockets.SessionAdmin.GenreDetail.Slot[] = [
		...eventNames
	].map((event) => ({
		event,
		required: !!events[event]?.required,
		open: !!events[event]?.open,
		candidates: active
			.filter((r) => answersEvent(r, event))
			.map((r) => ({ slug: r.slug, name: r.name ?? r.slug }))
	}))

	const presetRows = (
		await db
			.select()
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.genreId, genreId))
			.orderBy(asc(schema.sessionPresets.id))
	).filter((p) => !off.owns(p.ownerPluginId))

	const sessions = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(schema.sessions)
		.where(eq(schema.sessions.genreId, genreId))

	const createSpecSlug =
		active.find((r) => r.inputEvent === sessionEvents.sessionCreated)?.slug ??
		null

	const staleByPreset = await staleBindingsByPreset(
		(presetRows as any[]).map((p) => p.id)
	)

	// The app-wide switch (R66): no row states it, so it is on.
	const [setting] = await db
		.select()
		.from(schema.sessionGenreSettings)
		.where(eq(schema.sessionGenreSettings.genreId, genreId))
		.limit(1)

	const res: Sockets.SessionAdmin.GenreDetail.Response = {
		genre: {
			genreId: genre.genreId,
			name: genre.name,
			description: genre.description ?? "",
			family: genre.family ?? "",
			shape: (genre.shape ?? {}) as Record<string, unknown>,
			createSpecSlug,
			enabled: setting ? !!setting.enabled : true,
			defaultPresetId: setting?.defaultPresetId ?? null
		},
		swaps: await genreSwapContributions(
			new Map(active.map((r) => [r.slug as string, (r.name ?? r.slug) as string]))
		),
		slots,
		presets: (presetRows as any[]).map((p) =>
			presetRow(p, staleByPreset.get(p.id))
		),
		sessionCount: (sessions as any[])[0]?.n ?? 0
	}
	return res
}

export const sessionGenresDetail: Handler<
	Sockets.SessionAdmin.GenreDetail.Params,
	Sockets.SessionAdmin.GenreDetail.Response
> = {
	event: "sessionGenres:detail",
	handler: async (socket, params, emitToUser) => {
		adminOnly(socket)
		const res = await buildGenreDetail(params.genreId)
		emitToUser(res.genre ? "sessionGenres:detail" : "sessionGenres:detail:error", res)
		return res
	}
}

/**
 * Every preset of a genre on or off at once (R66, Q-B4d) — the bulk half of
 * the hub's per-preset switches, which stay `sessionPresets:update`. Turning
 * presets on is validated exactly as one at a time is (a preset missing a
 * required binding cannot be enabled); each refusal is reported by name and
 * the rest go through. Withdrawn presets are left alone.
 */
export const sessionGenresSetPresetsEnabled: Handler<
	Sockets.SessionAdmin.SetPresetsEnabled.Params,
	Sockets.SessionAdmin.SetPresetsEnabled.Response
> = {
	event: "sessionGenres:setPresetsEnabled",
	handler: async (socket, params, emitToUser) => {
		adminOnly(socket)
		const rows = (await db
			.select()
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.genreId, params.genreId))) as any[]
		let changed = 0
		const refused: Array<{ id: number; name: string; reason: string }> = []
		for (const p of rows) {
			if (p.withdrawnAt != null || !!p.enabled === params.enabled) continue
			if (params.enabled) {
				const reason = await validateBindings(p.genreId, p.bindings ?? {}, {
					enabled: true
				})
				if (reason) {
					refused.push({ id: p.id, name: p.name, reason })
					continue
				}
			}
			await db
				.update(schema.sessionPresets)
				.set({ enabled: params.enabled, updatedAt: new Date() })
				.where(eq(schema.sessionPresets.id, p.id))
			changed++
		}
		const res = { genreId: params.genreId, changed, refused }
		emitToUser("sessionGenres:setPresetsEnabled", res)
		await emitToUser("sessionGenres:detail", () => buildGenreDetail(params.genreId))
		return res
	}
}

/**
 * One plugin swap contribution on or off (R29, R66): the admin's decision,
 * kept in `plugins.disabled_swaps` and never overwritten by a reinstall.
 * Only a contribution the plugin's manifest declares may be switched, so the
 * list cannot fill with keys that name nothing.
 */
export const sessionGenresSetSwapEnabled: Handler<
	Sockets.SessionAdmin.SetSwapEnabled.Params,
	Sockets.SessionAdmin.SetSwapEnabled.Response
> = {
	event: "sessionGenres:setSwapEnabled",
	handler: async (socket, params, emitToUser) => {
		adminOnly(socket)
		const { swapKey } = await import("$lib/server/pipelines/entities/bindings")
		const [plugin] = (await db
			.select({
				id: schema.plugins.id,
				manifest: schema.plugins.manifest,
				disabledSwaps: schema.plugins.disabledSwaps
			})
			.from(schema.plugins)
			.where(eq(schema.plugins.pluginId, params.pluginId))
			.limit(1)) as any[]
		const declared = ((plugin?.manifest?.swaps ?? []) as any[]).some(
			(c) =>
				c?.spec === params.spec &&
				c?.node === params.node &&
				c?.definition === params.definition
		)
		if (!plugin || !declared) {
			const res = {
				ok: false,
				error: `'${params.pluginId}' does not contribute that swap.`
			}
			emitToUser("sessionGenres:setSwapEnabled:error", res)
			return res
		}
		const key = swapKey(params.spec, params.node, params.definition)
		const off = new Set<string>(plugin.disabledSwaps ?? [])
		if (params.enabled) off.delete(key)
		else off.add(key)
		await db
			.update(schema.plugins)
			.set({ disabledSwaps: [...off] })
			.where(eq(schema.plugins.id, plugin.id))
		const res = { ok: true }
		emitToUser("sessionGenres:setSwapEnabled", res)
		if (params.genreId)
			await emitToUser("sessionGenres:detail", () =>
				buildGenreDetail(params.genreId!)
			)
		// The plugins page counts each plugin's live swaps (R66); lazy — it
		// costs nothing unless that page is open.
		const { emitList } = await import("./plugins")
		await emitList(emitToUser)
		return res
	}
}

/* ── presets ────────────────────────────────────────────────────────── */

/**
 * The presets, as one caller may be shown them.
 *
 * Split out for the same reason as `buildSessionGenres`: the three write
 * cascades below re-send this list, and the stale-binding scan behind it runs
 * per preset. `isAdmin` rides along because it decides which presets the
 * recipient may be offered — an administrator sees the whole table, everyone
 * else the picker's cut.
 */
async function buildSessionPresets(
	isAdmin: boolean
): Promise<Sockets.SessionAdmin.Presets.Response> {
	const rows = await db
		.select()
		.from(schema.sessionPresets)
		.orderBy(asc(schema.sessionPresets.id))
	const staleByPreset = await staleBindingsByPreset(
		(rows as any[]).map((r) => r.id)
	)
	// A disabled plugin's presets are listed to nobody, admins included
	// (R67); a preset an uninstalled plugin left behind still is, to admins.
	const { disabledPlugins } = await import("$lib/server/plugins/disabledPlugins")
	const off = await disabledPlugins(db)
	let out = (rows as any[])
		.filter((r) => !off.owns(r.ownerPluginId))
		.map((r) => presetRow(r, staleByPreset.get(r.id)))
	// The picker's cut: a non-admin sees only what they may start.
	if (!isAdmin) {
		const settings = await db.select().from(schema.sessionGenreSettings)
		const disabledTypes = new Set(
			(settings as any[]).filter((s) => !s.enabled).map((s) => s.genreId)
		)
		// Withdrawn beside enabled (0119): a plugin's preset that lost its
		// plugin drops out of the picker the same way a disabled one does,
		// while staying in the admin list and on the sessions that named it.
		const withdrawn = new Set(
			(rows as any[])
				.filter((r) => r.withdrawnAt != null)
				.map((r) => r.id)
		)
		out = out.filter(
			(p) =>
				p.enabled &&
				!disabledTypes.has(p.genreId) &&
				!withdrawn.has(p.id)
		)
	}
	return { presets: out }
}

export const sessionPresetsList: Handler<
	Sockets.SessionAdmin.Presets.Params,
	Sockets.SessionAdmin.Presets.Response
> = {
	event: "sessionPresets:list",
	handler: async (socket, _params, emitToUser) => {
		const res = await buildSessionPresets(!!socket.user?.isAdmin)
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
			// Multi-event locks (0154): without them a spec locked on several
			// events answered "nothing" and every preset save was refused.
			inputEvents: schema.pipelineSpecVersions.inputEvents,
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
	const events = (active.find(
		(r) =>
			r.inputGenre === genreId && r.inputEvent === sessionEvents.sessionCreated
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
		if (spec.inputGenre !== genreId || !answersEvent(spec, event))
			return `'${b.spec}' answers '${[spec.inputEvent, ...(spec.inputEvents ?? [])].filter(Boolean).join("', '") || "nothing"}' for '${spec.inputGenre ?? "no genre"}' — it cannot bind to '${event}' of '${genreId}' (24 §4).`
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
			if (from) {
				// The copied included set is promoted, never refused (third
				// pass, S1): a source row may still carry a bare key from
				// before identities, and the copy is the one chance to land
				// it as the identity — refusing would lose a curation somebody
				// made; writing it verbatim would copy the debt. What cannot
				// be promoted stays bare, served by the ⏳ fallback.
				const copied = (from as any).includedActions
				base = {
					bindings: (from as any).bindings,
					primarySlug: (from as any).primarySlug,
					configSelections: (from as any).configSelections,
					includedActions: Array.isArray(copied)
						? promoteIncludedActions(
								await listGenreActions(db, params.genreId),
								copied.map(String)
							).included
						: copied,
					defaults: (from as any).defaults
				}
			}
		}
		// A bare preset starts with the locks' answers, so the form opens
		// with every slot the instance can fill already filled.
		if (!base.bindings || !Object.keys(base.bindings as object).length) {
			const { resolveSessionEventSpec } = await import(
				"$lib/server/pipelines/runtime/sessionEvents"
			)
			const bindings: Record<string, { spec: string }> = {}
			for (const event of [
				sessionEvents.sessionCreated,
				sessionEvents.messageRespond
			]) {
				const spec = await resolveSessionEventSpec(
					db,
					params.genreId,
					event
				)
				if (spec) bindings[event] = { spec }
			}
			base.bindings = bindings
		}
		// Stated beats copied: `fromPresetId` seeds the whole bundle, and an
		// explicit `defaults` on the create is the caller overruling that one
		// part of it.
		if (params.defaults !== undefined) base.defaults = params.defaults
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
		// LAZY, like the genre re-list above.
		await emitToUser("sessionPresets:list", () =>
			buildSessionPresets(!!socket.user?.isAdmin)
		)
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
			params.bindings ??
			((existing as any).bindings as Record<
				string,
				{ spec: string; config?: number }
			>) ??
			{}
		const nextEnabled = params.enabled ?? !!(existing as any).enabled
		// Switching a preset OFF, and nothing else, is never refused: a
		// preset whose binding went stale must still be hideable from its
		// own switch, as it is from the hub's Hide all (R66 review).
		const onlyHiding =
			params.enabled === false &&
			Object.keys(params).every((k) => k === "id" || k === "enabled")
		if (!onlyHiding) {
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
			// The included set is stored by identity (W-A): validated against
			// what the genre is offered, a bare function key landing as the
			// companion's identity (⏳) and anything else refused by name —
			// the same normaliser `setPresetActions` runs on the legacy squat.
			if (params.includedActions !== undefined) {
				if (params.includedActions === null) patch.includedActions = null
				else {
					const normalized = normalizeIncludedActions(
						await listGenreActions(db, (existing as any).genreId),
						params.includedActions
					)
					if (!normalized.ok) {
						const res = { error: normalized.error }
						emitToUser("sessionPresets:update:error", res)
						return res
					}
					patch.includedActions = normalized.included
				}
			}
			// The creation pre-fill (23 §9). `null` clears it; absent leaves it
			// alone — the same reset-is-explicit rule the rest of this patch
			// follows, so "the admin cleared every field" and "the admin sent
			// no opinion" stay distinguishable.
			if (params.defaults !== undefined) patch.defaults = params.defaults
		}
		/**
		 * A patch naming nothing answers with the row.
		 *
		 * Every field on this handler is optional, so "no fields" is a shape a
		 * client can send by construction — a form saved with nothing changed,
		 * a retry that lost its body, an immutable preset whose whole patch the
		 * branch above dropped. An empty SET is refused by the driver, so the
		 * caller received a raw exception for a request that asked for nothing;
		 * the honest answer to "change none of this" is the row as it stands.
		 */
		const [row] = Object.keys(patch).length
			? await db
					.update(schema.sessionPresets)
					.set(patch)
					.where(eq(schema.sessionPresets.id, params.id))
					.returning()
			: [existing]
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
		// LAZY, like the genre re-list above.
		await emitToUser("sessionPresets:list", () =>
			buildSessionPresets(!!socket.user?.isAdmin)
		)
		// The genre hub switches presets too (R66).
		await emitToUser("sessionGenres:detail", () =>
			buildGenreDetail((row as any).genreId)
		)
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
		// LAZY, like the genre re-list above.
		await emitToUser("sessionPresets:list", () =>
			buildSessionPresets(!!socket.user?.isAdmin)
		)
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
		const modes = await listSessionGenres(db)
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
	register(socket, sessionGenresSetPresetsEnabled, emitToUser)
	register(socket, sessionGenresSetSwapEnabled, emitToUser)
	register(socket, sessionPresetsList, emitToUser)
	register(socket, sessionPresetsCreate, emitToUser)
	register(socket, sessionPresetsUpdate, emitToUser)
	register(socket, sessionPresetsDelete, emitToUser)
	register(socket, sessionsAdminList, emitToUser)
}
