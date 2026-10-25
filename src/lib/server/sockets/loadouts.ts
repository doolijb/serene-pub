/**
 * `loadouts:*` — the Loadouts view, the loadout sheet, the defaults ledger and
 * the pickers (I12; DESIGN-image-generation §14). Every handler is
 * admin-only: members never see a loadout, and a session never picks one.
 *
 * Plus the matting row's pair (`localModels:matting`,
 * `localModels:mattingRemove`) — the Models view lists the background remover
 * beside the connection models, with *Delete from disk*.
 */

import { workflowValuesOf } from "$lib/shared/loadouts/workflowValues"
import { perImagePriceOf } from "$lib/shared/connections/imagePrice"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, asc, eq, inArray } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { afterModelChange } from "$lib/server/pipelines/registrations/unserved"
import {
	S,
	TRANSFORMS,
	capabilityLabel,
	isTransformId,
	type TransformId
} from "@serene-pub/sdk"
import { sidesOf } from "$lib/shared/capabilities/sides"
import { samplingShapeForCapability } from "$lib/shared/capabilities/samplingShape"
import {
	consequenceLine,
	impliedNeeds,
	samplingAfterPairChange
} from "$lib/shared/loadouts/consequence"
import {
	defaultLoadoutFor,
	defaultTransformOf,
	freePubSlug,
	isFilled,
	loadoutById,
	loadoutIdOf,
	mergeChain,
	mergeLoadout,
	slugifyLoadoutName,
	type LoadoutRow
} from "$lib/server/loadouts"
import { storedCapabilities } from "$lib/server/pipelines/runtime/capabilityGuard"
import { starRefusal } from "$lib/server/connections/starRefusal"
import { withStarConsequences } from "$lib/server/connections/starConsequences"
import { buildSystemSettingsGet } from "./systemSettings"

type Emit = (event: string, data: any) => void
const DENIED = "Access denied. Only admin users can manage loadouts."

function requireAdmin(socket: any, emitToUser: Emit) {
	if (!socket.user?.isAdmin) {
		emitToUser("error", { error: DENIED })
		throw new Error(DENIED)
	}
}

/** Emit the failure on the event's own channel, then throw. */
function refuse(emitToUser: Emit, event: string, error: string): never {
	emitToUser(`${event}:error`, { error })
	throw new Error(error)
}

// ── Reading ──────────────────────────────────────────────────────────────

/**
 * Which stored configs name each loadout: config values and node overrides on
 * a `loadout` slot, by the loadout id their value carries. Steps are distinct
 * (pipeline, node) addresses; pipelines are named.
 */
async function usedByIndex(): Promise<
	Map<string, { steps: Set<string>; pipelines: Set<string> }>
> {
	const out = new Map<string, { steps: Set<string>; pipelines: Set<string> }>()
	const idOf = (v: unknown): string | null =>
		v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string"
			? (v as { id: string }).id
			: typeof v === "string"
				? v
				: null
	const add = (id: string | null, specName: string, step: string) => {
		if (!id) return
		const e = out.get(id) ?? { steps: new Set(), pipelines: new Set() }
		e.steps.add(step)
		e.pipelines.add(specName)
		out.set(id, e)
	}
	// 🚧 R50 (0110): configurations are retired — a loadout is held by a
	// pipeline's instance values and by registration values (genre, preset,
	// session), each keyed by node.
	const { registrationValueRefs } = await import("$lib/server/pipelines/registrations/values")
	const specRows = await db
		.select({ id: schema.pipelineSpecs.id, slug: schema.pipelineSpecs.slug, name: schema.pipelineSpecs.name })
		.from(schema.pipelineSpecs)
	const specBySlug = new Map(specRows.map((r) => [r.slug, r]))
	const regPipeline = new Map<number, string>()
	for (const r of await db
		.select({ id: schema.registrations.id, specSlug: schema.registrations.specSlug, key: schema.registrations.key })
		.from(schema.registrations))
		regPipeline.set(r.id, r.specSlug ?? (r.key.split("→")[1] ?? ""))
	for (const ref of await registrationValueRefs(db as never, ["loadout"])) {
		const slug = ref.scopeKind === "instance" ? ref.scopeRef : (regPipeline.get(ref.rowId) ?? "")
		const spec = [...specBySlug.values()].find((x) => x.slug === slug || x.slug.endsWith(`/${slug}`))
		if (!spec) continue
		add(idOf(ref.value), spec.name, `${spec.id}\u0000${ref.nodeKey}`)
	}
	const fromOverrides = await db
		.select({
			value: schema.pipelineNodeOverrides.value,
			nodeKey: schema.pipelineNodeOverrides.nodeKey,
			specId: schema.pipelineNodeOverrides.specId,
			specName: schema.pipelineSpecs.name
		})
		.from(schema.pipelineNodeOverrides)
		.innerJoin(
			schema.pipelineSpecs,
			eq(schema.pipelineSpecs.id, schema.pipelineNodeOverrides.specId)
		)
		.where(eq(schema.pipelineNodeOverrides.slot, "loadout"))
	for (const r of fromOverrides)
		add(idOf(r.value), r.specName, `${r.specId}\u0000${r.nodeKey}`)
	return out
}

/** Every loadout summarised, plus the ledger's transforms and the strip. */
export async function buildLoadoutsList(): Promise<Sockets.Loadouts.List.Response> {
	const rows = await db
		.select()
		.from(schema.loadouts)
		.orderBy(asc(schema.loadouts.transform), asc(schema.loadouts.name))
	const byId = new Map(rows.map((r) => [r.id, r]))
	const connections = await db.select().from(schema.connections)
	const connById = new Map(connections.map((c) => [c.id, c]))
	const models = await db.select().from(schema.connectionModels)
	const modelById = new Map(models.map((m) => [m.id, m]))
	const sampling = await db
		.select()
		.from(schema.samplingConfigs)
		.orderBy(asc(schema.samplingConfigs.name))
	const samplingById = new Map(sampling.map((s) => [s.id, s]))
	const used = await usedByIndex()
	/** Plugins switched on, by id — a plugin's loadout owner is its id (`seedPluginLoadouts`). */
	const pluginsOn = new Set(
		(
			await db
				.select({ pluginId: schema.plugins.pluginId, enabled: schema.plugins.enabled })
				.from(schema.plugins)
		)
			.filter((p) => p.enabled)
			.map((p) => p.pluginId)
	)

	const defaults = new Map<string, LoadoutRow>()
	for (const r of rows) {
		const t = defaultTransformOf(r)
		if (t) defaults.set(t, r)
	}
	/** The root a merge chain ends at, from the rows already read. */
	const rootOf = (r: LoadoutRow): LoadoutRow => {
		const seen = new Set<number>([r.id])
		let at = r
		while (at.mergedInto != null) {
			const p = byId.get(at.mergedInto)
			if (!p || seen.has(p.id)) break
			seen.add(p.id)
			at = p
		}
		return at
	}

	const summarise = (r: LoadoutRow): Sockets.Loadouts.Summary => {
		const root = rootOf(r)
		const conn = root.connectionId != null ? connById.get(root.connectionId) : undefined
		const model =
			root.connectionModelId != null ? modelById.get(root.connectionModelId) : undefined
		const filled = isFilled(root)
		const fallback = defaults.get(r.transform)
		const fallbackName = fallback && fallback.id !== r.id ? fallback.name : null
		const grades = conn ? (storedCapabilities(conn) as Record<string, number>) : {}
		const id = loadoutIdOf(r)
		const u = used.get(id)
		return {
			id: r.id,
			loadoutId: id,
			slug: r.slug,
			name: r.name,
			description: r.description ?? null,
			owner: r.owner,
			transform: r.transform,
			connectionId: r.connectionId ?? null,
			connectionModelId: r.connectionModelId ?? null,
			connectionName: conn?.name ?? null,
			modelName: model?.name ?? null,
			connectionType: conn?.type ?? null,
			samplingConfigId: r.samplingConfigId ?? null,
			samplingName:
				root.samplingConfigId != null
					? (samplingById.get(root.samplingConfigId)?.name ?? null)
					: null,
			workflowId: r.workflowId ?? null,
			workflowValues: workflowValuesOf(r.workflowValues),
			tier: r.tier ?? null,
			defaultFor: defaultTransformOf(r),
			mergedInto: r.mergedInto ?? null,
			mergedIntoName:
				r.mergedInto != null ? (byId.get(r.mergedInto)?.name ?? null) : null,
			filled,
			fallbackName,
			consequence: consequenceLine({
				filled,
				fallbackName,
				grades,
				needs: impliedNeeds(r.seedKey)
			}),
			usedBy: {
				steps: u?.steps.size ?? 0,
				pipelines: [...(u?.pipelines ?? [])].sort()
			},
			grades,
			perImagePrice: model ? perImagePriceOf(model.facts) : null,
			...(r.owner !== "core" && r.owner !== "pub" && !pluginsOn.has(r.owner)
				? { pluginOff: true }
				: {})
		}
	}

	const loadouts = rows.map(summarise)
	const transformIds = new Set<string>([
		...rows.map((r) => r.transform),
		...defaults.keys()
	])
	const transforms = [...transformIds]
		.filter((t) => isTransformId(t))
		.sort((a, b) => {
			const order = Object.keys(TRANSFORMS)
			const ia = order.indexOf(a)
			const ib = order.indexOf(b)
			return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b)
		})
		.map((t) => ({
			id: t,
			label: capabilityLabel(t as TransformId),
			output: sidesOf(t as TransformId).output,
			defaultLoadoutId: defaults.get(t)?.id ?? null
		}))
	const samplingOptions: Sockets.Loadouts.List.Response["samplingOptions"] = {}
	for (const t of transformIds) {
		const shape = samplingShapeForCapability(t)
		samplingOptions[t] = shape
			? sampling
					.filter((s) => (s.shape ?? S.textGen) === shape)
					.map((s) => ({
						id: s.id,
						name: s.name,
						shape: s.shape ?? S.textGen,
						seedKey: s.seedKey ?? null
					}))
			: []
	}
	// Each connection's stored grades, for the editor's Model card: the
	// connections list leaves `capabilities` to the panel's own fetch, and a
	// chip or consequence read off nothing says every model lacks everything.
	const connectionGrades: Record<string, Record<string, number>> = {}
	for (const c of connections)
		connectionGrades[c.id] = storedCapabilities(c) as Record<string, number>
	const reply = defaults.get("text->text")
	return {
		loadouts,
		transforms,
		canReply: !!reply && isFilled(rootOf(reply)),
		connectionGrades,
		samplingOptions
	}
}

async function summaryOf(id: number): Promise<Sockets.Loadouts.Summary> {
	const list = await buildLoadoutsList()
	const found = list.loadouts.find((l) => l.id === id)
	if (!found) throw new Error("That loadout no longer exists.")
	return found
}

/** Push the fresh list, and the settings when a default moved. */
async function pushAfterWrite(emitToUser: any, defaultsMoved: boolean) {
	await emitToUser("loadouts:list", () => buildLoadoutsList())
	if (defaultsMoved)
		await emitToUser("systemSettings:get", () => buildSystemSettingsGet())
}

// ── The seeded sampling a transform swaps to (§12 suggestion 4) ─────────

async function seededSamplingFor(transform: string) {
	const { CORE_LOADOUTS } = await import("@serene-pub/core-catalog")
	const seedKey = CORE_LOADOUTS.find(
		(d) => d.defaultFor && d.transform === transform
	)?.sampling
	if (!seedKey) return null
	const [row] = await db
		.select()
		.from(schema.samplingConfigs)
		.where(eq(schema.samplingConfigs.seedKey, seedKey))
		.limit(1)
	return row
		? { id: row.id, name: row.name, shape: row.shape ?? S.textGen }
		: null
}

// ── Handlers ─────────────────────────────────────────────────────────────

export const loadoutsList: Handler<
	Sockets.Loadouts.List.Params,
	Sockets.Loadouts.List.Response
> = {
	event: "loadouts:list",
	handler: async (socket, _params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		const res = await buildLoadoutsList()
		emitToUser("loadouts:list", res)
		return res
	}
}

export const loadoutsCreate: Handler<
	Sockets.Loadouts.Create.Params,
	Sockets.Loadouts.Create.Response
> = {
	event: "loadouts:create",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		const name = (params.name ?? "").trim()
		if (!name) refuse(emitToUser, "loadouts:create", "A loadout needs a name.")
		if (!isTransformId(params.transform))
			refuse(emitToUser, "loadouts:create", `"${params.transform}" is not a kind of work a loadout can do.`)
		const slug = params.slug?.trim()
			? slugifyLoadoutName(params.slug)
			: await freePubSlug(db, name)
		const [clash] = await db
			.select({ id: schema.loadouts.id })
			.from(schema.loadouts)
			.where(and(eq(schema.loadouts.owner, "pub"), eq(schema.loadouts.slug, slug)))
			.limit(1)
		if (clash)
			refuse(emitToUser, "loadouts:create", `Another loadout is already called "${slug}".`)
		const seeded = await seededSamplingFor(params.transform)
		const [row] = await db
			.insert(schema.loadouts)
			.values({
				owner: "pub",
				slug,
				name,
				description: params.description ?? null,
				transform: params.transform,
				samplingConfigId: seeded?.id ?? null
			})
			.returning()
		const res = { loadout: await summaryOf(row!.id) }
		emitToUser("loadouts:create", res)
		await pushAfterWrite(emitToUser, false)
		return res
	}
}

export const loadoutsUpdate: Handler<
	Sockets.Loadouts.Update.Params,
	Sockets.Loadouts.Update.Response
> = {
	event: "loadouts:update",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		const row = await loadoutById(db, params.id)
		if (!row) refuse(emitToUser, "loadouts:update", "That loadout no longer exists.")
		const shipped = row.owner !== "pub"
		const patch: Partial<typeof schema.loadouts.$inferInsert> = {}
		// A shipped loadout's prose is its package's; a person fills the pair.
		if (!shipped) {
			if (params.name !== undefined) {
				const name = params.name.trim()
				if (!name) refuse(emitToUser, "loadouts:update", "A loadout needs a name.")
				patch.name = name
			}
			if (params.description !== undefined) patch.description = params.description
			if (params.slug !== undefined) patch.slug = slugifyLoadoutName(params.slug)
		}

		let notice: string | undefined
		const pairChanged =
			params.connectionId !== undefined &&
			(params.connectionId !== row.connectionId ||
				(params.connectionModelId ?? null) !== row.connectionModelId)
		if (params.connectionId !== undefined) {
			const refusal = await starRefusal(db, {
				capability: row.transform,
				connectionId: params.connectionId,
				connectionModelId: params.connectionModelId ?? null
			})
			if (refusal) refuse(emitToUser, "loadouts:update", refusal)
			patch.connectionId = params.connectionId
			// The model rides with the connection, always (see capabilityDefaults).
			patch.connectionModelId =
				params.connectionId == null ? null : (params.connectionModelId ?? null)
		}
		if (params.samplingConfigId !== undefined) patch.samplingConfigId = params.samplingConfigId
		if (params.workflowId !== undefined) patch.workflowId = params.workflowId
		if (params.workflowValues !== undefined)
			patch.workflowValues = workflowValuesOf(params.workflowValues)
		// Another workflow's dials mean nothing to this one: a workflow change
		// that sends no dials of its own starts the new one at its defaults.
		else if (
			params.workflowId !== undefined &&
			params.workflowId !== row.workflowId
		)
			patch.workflowValues = null

		// Step 3's rule: a pair change swaps a mismatched sampling config to the
		// transform's seeded default, and says so.
		if (pairChanged && params.samplingConfigId === undefined && row.samplingConfigId != null) {
			const [current] = await db
				.select()
				.from(schema.samplingConfigs)
				.where(eq(schema.samplingConfigs.id, row.samplingConfigId))
				.limit(1)
			const swap = samplingAfterPairChange({
				current: current
					? { id: current.id, name: current.name, shape: current.shape ?? S.textGen }
					: null,
				wantedShape: samplingShapeForCapability(row.transform) ?? null,
				seededDefault: await seededSamplingFor(row.transform)
			})
			if (swap.notice) {
				patch.samplingConfigId = swap.samplingConfigId
				notice = swap.notice
			}
		}

		const isDefault = defaultTransformOf(row) != null
		await withStarConsequences(
			db,
			() =>
				db
					.update(schema.loadouts)
					.set({ ...patch, updatedAt: new Date() })
					.where(eq(schema.loadouts.id, row.id)),
			isDefault && params.connectionId !== undefined ? [row.transform] : []
		)
		const res: Sockets.Loadouts.Update.Response = {
			loadout: await summaryOf(row.id),
			...(notice ? { notice } : {})
		}
		emitToUser("loadouts:update", res)
		await pushAfterWrite(emitToUser, isDefault)
		return res
	}
}

export const loadoutsDelete: Handler<
	Sockets.Loadouts.Delete.Params,
	Sockets.Loadouts.Delete.Response
> = {
	event: "loadouts:delete",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		const row = await loadoutById(db, params.id)
		if (!row) refuse(emitToUser, "loadouts:delete", "That loadout no longer exists.")
		if (row.owner !== "pub")
			refuse(
				emitToUser,
				"loadouts:delete",
				`${row.name} ships with ${row.owner === "core" ? "Serene Pub" : row.owner} and cannot be deleted — merge it instead.`
			)
		if (defaultTransformOf(row))
			refuse(
				emitToUser,
				"loadouts:delete",
				`${row.name} is the default loadout for ${capabilityLabel(row.transform as TransformId)}. Make another loadout the default first.`
			)
		await db.delete(schema.loadouts).where(eq(schema.loadouts.id, row.id))
		const res = { id: row.id }
		emitToUser("loadouts:delete", res)
		await pushAfterWrite(emitToUser, false)
		return res
	}
}

export const loadoutsSetDefault: Handler<
	Sockets.Loadouts.SetDefault.Params,
	Sockets.Loadouts.SetDefault.Response
> = {
	event: "loadouts:setDefault",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		const row = await loadoutById(db, params.id)
		if (!row) refuse(emitToUser, "loadouts:setDefault", "That loadout no longer exists.")
		if (!isTransformId(row.transform))
			refuse(emitToUser, "loadouts:setDefault", "That loadout names no kind of work.")
		const { input, output } = sidesOf(row.transform as TransformId)
		await withStarConsequences(
			db,
			() =>
				db.transaction(async (tx) => {
					await tx
						.update(schema.loadouts)
						.set({ defaultForInput: null, defaultForOutput: null, updatedAt: new Date() })
						.where(
							and(
								eq(schema.loadouts.defaultForInput, input),
								eq(schema.loadouts.defaultForOutput, output)
							)
						)
					await tx
						.update(schema.loadouts)
						.set({ defaultForInput: input, defaultForOutput: output, updatedAt: new Date() })
						.where(eq(schema.loadouts.id, row.id))
				}),
			[row.transform]
		)
		const res = { loadout: await summaryOf(row.id) }
		emitToUser("loadouts:setDefault", res)
		await pushAfterWrite(emitToUser, true)
		return res
	}
}

export const loadoutsMerge: Handler<
	Sockets.Loadouts.Merge.Params,
	Sockets.Loadouts.Merge.Response
> = {
	event: "loadouts:merge",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		const row = await loadoutById(db, params.id)
		if (!row) refuse(emitToUser, "loadouts:merge", "That loadout no longer exists.")
		const r = await withStarConsequences(
			db,
			() => mergeLoadout(db, params.id, params.parentId),
			defaultTransformOf(row) ? [row.transform] : []
		)
		if (!r.ok) refuse(emitToUser, "loadouts:merge", r.error)
		const res = { loadout: await summaryOf(params.id) }
		emitToUser("loadouts:merge", res)
		await pushAfterWrite(emitToUser, defaultTransformOf(row) != null)
		return res
	}
}

/**
 * The pick behind **Fill for me** and **Make it** (§12 suggestion 3): the
 * best pair the fleet has for a loadout's work, and why, in words a person
 * reads.
 *
 * The scoring, kept simple and stated here so it can be argued with:
 *   1. Candidates are every enabled, listed model on every connection that
 *      `starRefusal` accepts for the loadout's transform — the same judgement
 *      every star door asks.
 *   2. Each scores one point per need the loadout implies (`impliedNeeds`)
 *      that its connection answers natively — schema door for Extraction,
 *      native tools for Tool calling, edit-class for Portrait/Sprites.
 *   3. The transform default's own pair gets half a point, so a one-model
 *      install keeps one model rather than loading a second for a tie.
 *   4. Ties go to the connection listed first by name, then the model.
 * Sampling: the declaration's preset (by seed key), for a loadout with none.
 * Null when no model can do the work at all.
 */
export async function pickFill(
	dbh: typeof db,
	opts: { transform: string; seedKey: string | null; name: string }
): Promise<{
	connectionId: number
	connectionModelId: number
	/** The declaration's preset, when it has one seeded here. */
	seededSamplingConfigId: number | null
	label: string
	/** Why this pair, as a sentence ending in a full stop. */
	why: string
} | null> {
	const needs = impliedNeeds(opts.seedKey)
	const def = await defaultLoadoutFor(dbh, opts.transform)
	const defRoot = def ? (await mergeChain(dbh, def)).at(-1)! : null
	const connections = await dbh
		.select()
		.from(schema.connections)
		.orderBy(asc(schema.connections.name))
	const models = connections.length
		? await dbh
				.select()
				.from(schema.connectionModels)
				.where(
					inArray(
						schema.connectionModels.connectionId,
						connections.map((c) => c.id)
					)
				)
				.orderBy(asc(schema.connectionModels.sortOrder), asc(schema.connectionModels.name))
		: []
	type Pick = {
		connectionId: number
		modelId: number
		score: number
		label: string
		answers: string[]
		isDefault: boolean
	}
	let best: Pick | null = null
	for (const c of connections) {
		const grades = storedCapabilities(c) as Record<string, number>
		for (const m of models.filter((x) => x.connectionId === c.id)) {
			if (!m.enabled || m.missingSince) continue
			const refusal = await starRefusal(dbh, {
				capability: opts.transform,
				connectionId: c.id,
				connectionModelId: m.id
			})
			if (refusal) continue
			const answers: string[] = []
			if (needs.structured && (grades["json_schema"] ?? 0) > 0)
				answers.push("has a schema door")
			if (needs.tools && (grades["tools"] ?? 0) >= 2) answers.push("has native tool calls")
			if (needs.references && (grades["text+image->image"] ?? 0) > 0)
				answers.push("takes reference pictures")
			const isDefault =
				defRoot?.connectionId === c.id && defRoot.connectionModelId === m.id
			const score = answers.length + (isDefault ? 0.5 : 0)
			if (!best || score > best.score)
				best = {
					connectionId: c.id,
					modelId: m.id,
					score,
					label: `${m.name} on ${c.name}`,
					answers,
					isDefault
				}
		}
	}
	if (!best) return null
	const wanted = [
		needs.structured && "has a schema door",
		needs.tools && "has native tool calls",
		needs.references && "takes reference pictures"
	].filter((w): w is string => !!w)
	const defName = defRoot?.name ?? "the default loadout"
	let why: string
	if (best.answers.length)
		why = `It ${best.answers.join(" and ")}, what ${opts.name} is best with${best.isDefault ? `, and it is already ${defName}'s model` : ""}.`
	else if (wanted.length && best.isDefault)
		why = `No model here ${wanted.join(" or ")}, so it keeps ${defName}'s model and no second model loads.`
	else if (wanted.length)
		why = `No model here ${wanted.join(" or ")}; it is the first that can do the work.`
	else if (best.isDefault)
		why = `It is already ${defName}'s model, so no second model loads.`
	else why = "It is the first model here that can do the work."
	let seededSamplingConfigId: number | null = null
	if (opts.seedKey) {
		const { CORE_LOADOUTS } = await import("@serene-pub/core-catalog")
		const seedKey = CORE_LOADOUTS.find((d) => d.id === opts.seedKey)?.sampling
		if (seedKey) {
			const [s] = await dbh
				.select({ id: schema.samplingConfigs.id })
				.from(schema.samplingConfigs)
				.where(eq(schema.samplingConfigs.seedKey, seedKey))
				.limit(1)
			seededSamplingConfigId = s?.id ?? null
		}
	}
	return {
		connectionId: best.connectionId,
		connectionModelId: best.modelId,
		seededSamplingConfigId,
		label: best.label,
		why
	}
}

/**
 * **Fill for me** — the loadout editor's proposal: `pickFill`'s pair and
 * sampling, written into the editor's draft, never the row. Save sends it
 * like any other pick. Works for a loadout not yet created (by transform).
 */
export const loadoutsProposeFill: Handler<
	Sockets.Loadouts.ProposeFill.Params,
	Sockets.Loadouts.ProposeFill.Response
> = {
	event: "loadouts:proposeFill",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		const row = params.id != null ? await loadoutById(db, params.id) : null
		if (params.id != null && !row)
			refuse(emitToUser, "loadouts:proposeFill", "That loadout no longer exists.")
		const transform = row?.transform ?? params.transform
		if (!transform)
			refuse(emitToUser, "loadouts:proposeFill", "Say what the loadout is for first.")
		const pick = await pickFill(db, {
			transform,
			seedKey: row?.seedKey ?? null,
			name: row?.name ?? "this loadout"
		})
		if (!pick)
			refuse(
				emitToUser,
				"loadouts:proposeFill",
				`No model can do ${capabilityLabel(transform as TransformId)} yet. Get one in Models, then try again.`
			)
		const res = {
			id: row?.id ?? null,
			connectionId: pick.connectionId,
			connectionModelId: pick.connectionModelId,
			samplingConfigId: pick.seededSamplingConfigId,
			explanation: `Filled with ${pick.label}. ${pick.why}`
		}
		emitToUser("loadouts:proposeFill", res)
		return res
	}
}

/**
 * **Make it** — fill a loadout's pair from the fleet and save at once
 * (`pickFill`). The editor's **Fill for me** proposes the same pick into its
 * draft instead (`loadouts:proposeFill`).
 */
export const loadoutsMakeIt: Handler<
	Sockets.Loadouts.MakeIt.Params,
	Sockets.Loadouts.MakeIt.Response
> = {
	event: "loadouts:makeIt",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		const row = await loadoutById(db, params.id)
		if (!row) refuse(emitToUser, "loadouts:makeIt", "That loadout no longer exists.")
		const best = await pickFill(db, {
			transform: row.transform,
			seedKey: row.seedKey,
			name: row.name
		})
		if (!best)
			refuse(
				emitToUser,
				"loadouts:makeIt",
				`No model can do ${capabilityLabel(row.transform as TransformId)} yet. Get one in Models, then try again.`
			)
		const samplingConfigId = row.samplingConfigId ?? best.seededSamplingConfigId
		const isDefault = defaultTransformOf(row) != null
		await withStarConsequences(
			db,
			() =>
				db
					.update(schema.loadouts)
					.set({
						connectionId: best.connectionId,
						connectionModelId: best.connectionModelId,
						samplingConfigId,
						updatedAt: new Date()
					})
					.where(eq(schema.loadouts.id, row.id)),
			isDefault ? [row.transform] : []
		)
		const res = {
			loadout: await summaryOf(row.id),
			explanation: `${row.name} now runs on ${best.label}.`
		}
		emitToUser("loadouts:makeIt", res)
		await pushAfterWrite(emitToUser, isDefault)
		return res
	}
}

// ── The matting row (Models view) ───────────────────────────────────────

export const localModelsMatting: Handler<
	Sockets.LocalModels.Matting.Params,
	Sockets.LocalModels.Matting.Response
> = {
	event: "localModels:matting",
	handler: async (socket, _params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		const { mattingModelState, MATTING_DISPLAY_NAME } = await import(
			"$lib/server/localModels/matting"
		)
		const st = await mattingModelState(db)
		const res: Sockets.LocalModels.Matting.Response = {
			name: MATTING_DISPLAY_NAME,
			...st
		}
		emitToUser("localModels:matting", res)
		return res
	}
}

/** Stop the background remover's download (admin). */
export const localModelsCancelMatting: Handler<
	Sockets.LocalModels.CancelMatting.Params,
	Sockets.LocalModels.CancelMatting.Response
> = {
	event: "localModels:cancelMatting",
	handler: async (socket, _params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		const { cancelMattingDownload, mattingModelState, MATTING_DISPLAY_NAME } =
			await import("$lib/server/localModels/matting")
		const res = { cancelled: cancelMattingDownload() }
		emitToUser("localModels:cancelMatting", res)
		// The `cancelling` state, so the tray's line says so at once.
		emitToUser("localModels:matting", {
			name: MATTING_DISPLAY_NAME,
			...(await mattingModelState(db))
		})
		return res
	}
}

export const localModelsMattingRemove: Handler<
	Sockets.LocalModels.MattingRemove.Params,
	Sockets.LocalModels.MattingRemove.Response
> = {
	event: "localModels:mattingRemove",
	handler: async (socket, _params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		const { removeMattingModel, mattingModelState, MATTING_DISPLAY_NAME } =
			await import("$lib/server/localModels/matting")
		let removed = false
		try {
			removed = await removeMattingModel(db)
		} catch (e) {
			refuse(emitToUser, "localModels:mattingRemove", (e as Error).message)
		}
		const res = { removed }
		emitToUser("localModels:mattingRemove", res)
		emitToUser("localModels:matting", {
			name: MATTING_DISPLAY_NAME,
			...(await mattingModelState(db))
		})
		return res
	}
}

export function registerLoadoutHandlers(
	socket: any,
	emitToUser: Emit,
	register: (socket: any, handler: Handler<any, any>, emitToUser: Emit) => void
) {
	register(socket, loadoutsList, emitToUser)
	// 🚧 R56: what is served moves with the loadouts — say so after each write.
	register(socket, afterModelChange(loadoutsCreate), emitToUser)
	register(socket, afterModelChange(loadoutsUpdate), emitToUser)
	register(socket, afterModelChange(loadoutsDelete), emitToUser)
	register(socket, afterModelChange(loadoutsSetDefault), emitToUser)
	register(socket, afterModelChange(loadoutsMerge), emitToUser)
	register(socket, afterModelChange(loadoutsMakeIt), emitToUser)
	register(socket, loadoutsProposeFill, emitToUser)
	register(socket, localModelsMatting, emitToUser)
	register(socket, localModelsCancelMatting, emitToUser)
	register(socket, localModelsMattingRemove, emitToUser)
}
