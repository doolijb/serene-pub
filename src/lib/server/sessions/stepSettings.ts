/**
 * 🚧 A session's **step settings** (PROPOSAL-live-scenes §15 G11): the
 * parameters of the steps a session's pipelines put in session settings
 * (`expose.session`, SDK `NodeOpts.expose`) that are STORY settings — Chat's
 * reply tick (*Each reply advances the clock by …*, `core:task/clock-step`),
 * the sprite picker's *Choose sprites*, stickiness and floor — drawn in the
 * session's own settings for its owner, member or admin alike.
 *
 * `expose.session` marks a step as the session's to shape, and a step so
 * marked may carry plumbing beside its story settings: the turn order's
 * `advise` oracle carries a connection, a sampling config and prompts. Those
 * are never a member's (owner ruling 2026-10-12: no member surface for
 * connections, models, sampling or loadouts, ever), so a step setting is
 * held to three rules, and a field failing any is simply not one:
 *
 *  1. **Its step runs on no model.** A step whose declarations name a
 *     connection, a sampling config or a loadout is a model call; none of
 *     its fields is offered, its parameters included — a model call's
 *     parameters tune the call.
 *  2. **It is a parameter** (a `parameters` slot, matrix slot `params`) —
 *     never a prompt, template, variable layout, script chain or review gate.
 *  3. **Its control is a plain value**: a whole number, a number, a switch, a
 *     choice or a line of text — never a secret, a list or a share bar (🚧 a
 *     field declared `list: true` is a list whatever its element's control).
 *
 * 🚧 Whose: the pipelines the session lists (`sessionPipelines` — its reply,
 * its enabled actions, its create spec while creating) and the specs bound
 * to its own events (§15 G19 — the turn order), every one held to the
 * same three rules.
 *
 * Read and written beside the panel, not through it: the panel shows a
 * non-admin prompts alone (`visibleTo`), which is the right line for every
 * other step. A write lands where the panel's session-scope writes land
 * (`pipeline_node_overrides`, scope `session`), so the run reads it through
 * the same chain (session → configuration → the step's own default), and a
 * value equal to what it would inherit stores no row (reset-is-delete).
 */
import { and, eq } from "drizzle-orm"
import { getDefinition } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"

type Field = Sockets.Sessions.Bindings.StepSettings.Field
type Step = Sockets.Sessions.Bindings.StepSettings.Step

/** A refusal in a sentence a person can act on. */
export class StepSettingRefusal extends Error {}

/** Rule 1: a declaration in any of these makes its step a model call. */
const MODEL_SLOTS = new Set(["connection", "sampling", "loadout"])
/** Rule 3: the controls a step setting may be. */
const PLAIN_CONTROLS = new Set<Field["control"]>(["integer", "number", "boolean", "enum", "string"])

/**
 * Whether a parameter holds a LIST of values — declared `list: true`, or
 * defaulting to one — whatever its element's control says (rule 3).
 */
function isListField(
	node: { definitionId: string; definitionVersion: number },
	d: { slot: string; path: string; authorDefault?: unknown }
): boolean {
	if (Array.isArray(d.authorDefault)) return true
	const def = getDefinition(`${node.definitionId}@${node.definitionVersion}`) as
		| { slots?: Record<string, { schema?: Record<string, { list?: unknown; default?: unknown }> }> }
		| undefined
	const field = def?.slots?.[d.slot]?.schema?.[d.path]
	return field?.list === true || Array.isArray(field?.default)
}

const addr = (nodeKey: string, slot: string, path: string) =>
	`${nodeKey}\u0000${slot}\u0000${path}`

/** One step setting with the address it is stored at (server-side only). */
interface Located {
	specId: number
	step: Step
	field: Field
	slot: string
}

/**
 * 🚧 The specs bound to the session's own events (live scenes §15 G19): the
 * turn order, and any genre spec answering a session event — every event the
 * session's genre binds, resolved as a run would resolve it
 * (`resolveSessionEventSpec`), deduped by slug. Not the reply, an action or
 * the create spec: `sessionPipelines` lists those. A binding that does not
 * resolve offers nothing rather than failing the read.
 */
async function eventBoundSpecs(db: Db, sessionId: number): Promise<string[]> {
	const [{ getSessionGenre, STANDARD_GENRE_ID }, { resolveSessionEventSpec }, { sessionEvents }] =
		await Promise.all([
			import("$lib/server/pipelines/entities/sessionGenres"),
			import("$lib/server/pipelines/runtime/sessionEvents"),
			import("@serene-pub/sdk")
		])
	const [row] = await db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	const genreId = row?.genreId ?? STANDARD_GENRE_ID
	const genre = await getSessionGenre(db, genreId).catch(() => null)
	const skip = new Set<string>([
		sessionEvents.sessionAction,
		sessionEvents.messageRespond,
		sessionEvents.sessionCreated
	])
	const out: string[] = []
	for (const event of Object.keys(genre?.events ?? {})) {
		if (skip.has(event)) continue
		const slug = await resolveSessionEventSpec(db, genreId, event, { sessionId }).catch(() => null)
		if (slug && !out.includes(slug)) out.push(slug)
	}
	return out
}

/**
 * Every step setting of the pipelines `sessionId` runs, each with where it is
 * stored. The creation pipeline is left out once the session is created —
 * its settings only applied while creating it (`CREATION_READ_ONLY_NOTE`).
 * 🚧 After them, the specs bound to the session's events (§15 G19), the
 * turn order among them, held to the same three rules: its `advise` oracle
 * runs on a model and offers nothing; who may be seated and the mention
 * rule are its story settings.
 */
async function locateAll(db: Db, sessionId: number, userId: number): Promise<Located[]> {
	const { sessionPipelines } = await import("$lib/server/pipelines/entities/sessionPipelines")
	const { published, declarations, i18nText } = await import(
		"$lib/server/pipelines/config/panel/declarations"
	)
	const { layers } = await import("$lib/server/pipelines/config/panel/read")
	const { pipelines: listed } = await sessionPipelines(db, sessionId, userId)
	const claimed = new Set(listed.map((p) => p.slug))
	const pipelines: Array<{ slug: string; label: string; creation?: string }> = [
		...listed,
		...(await eventBoundSpecs(db, sessionId))
			.filter((slug) => !claimed.has(slug))
			.map((slug) => ({ slug, label: "" }))
	]
	const out: Located[] = []
	for (const p of pipelines) {
		if (p.creation === "created") continue
		const at = await published(db, p.slug)
		if (!at) continue
		const nodes = await db
			.select({
				nodeKey: schema.pipelineNodes.nodeKey,
				definitionId: schema.pipelineNodes.definitionId,
				definitionVersion: schema.pipelineNodes.definitionVersion,
				expose: schema.pipelineNodes.expose
			})
			.from(schema.pipelineNodes)
			.where(eq(schema.pipelineNodes.specVersionId, at.specVersionId))
		const exposed = new Map(
			nodes
				.filter((n) => (n.expose as { session?: boolean } | null)?.session === true)
				.map((n) => [n.nodeKey, n])
		)
		if (!exposed.size) continue
		const decls = (await declarations(db, at.specVersionId)).filter((d) =>
			exposed.has(d.nodeKey)
		)
		const modelCalls = new Set(
			decls.filter((d) => MODEL_SLOTS.has(d.matrixSlot)).map((d) => d.nodeKey)
		)
		const chain = await layers(db, at, { userId, isAdmin: false, sessionId })
		const steps = new Map<string, Step>()
		for (const d of decls) {
			if (modelCalls.has(d.nodeKey)) continue
			if (d.matrixSlot !== "params") continue
			if (!PLAIN_CONTROLS.has(d.control as Field["control"])) continue
			const node = exposed.get(d.nodeKey)!
			// Rule 3's list (§15 G19): a `string` field declared `list: true`
			// (the turn order's envoy list) is a list of values, though the
			// panel's control names its element's type.
			if (isListField(node, d)) continue
			const key = addr(d.nodeKey, d.slot, d.path)
			const inherited = chain.preset.has(key) ? chain.preset.get(key) : d.authorDefault
			const own = chain.session?.has(key) === true
			const field: Field = {
				path: d.path,
				label: d.label,
				...(d.description ? { description: d.description } : {}),
				control: d.control as Field["control"],
				...(d.min != null ? { min: d.min } : {}),
				...(d.max != null ? { max: d.max } : {}),
				...(d.control === "enum"
					? {
							members: (
								(d.members ?? (d.of ?? []).map((k) => ({ key: k }))) as ReadonlyArray<{
									key: string
									label?: string
									description?: string
								}>
							).map((m) => ({
								key: m.key,
								label: m.label ?? m.key,
								...(m.description ? { description: m.description } : {})
							}))
						}
					: {}),
				value: own ? chain.session!.get(key) : inherited,
				inherited,
				source: own ? "session" : chain.preset.has(key) ? "config" : "author"
			}
			let step = steps.get(d.nodeKey)
			if (!step) {
				step = {
					spec: at.slug,
					specName: p.label || at.name,
					nodeKey: d.nodeKey,
					definitionId: `${node.definitionId}@${node.definitionVersion}`,
					heading:
						i18nText((node.expose as { label?: unknown } | null)?.label) ??
						d.stepHeading ??
						d.typeLabel,
					fields: []
				}
				steps.set(d.nodeKey, step)
			}
			step.fields.push(field)
			out.push({ specId: at.specId, step, field, slot: d.slot })
		}
	}
	return out
}

/** The session's step settings, by step, in the order its pipelines list them. */
export async function readStepSettings(
	db: Db,
	sessionId: number,
	userId: number
): Promise<Step[]> {
	const seen = new Set<Step>()
	const steps: Step[] = []
	for (const l of await locateAll(db, sessionId, userId))
		if (!seen.has(l.step)) {
			seen.add(l.step)
			steps.push(l.step)
		}
	return steps
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** The value as its control takes it, or a refusal naming what it wants. */
function checkedValue(field: Field, value: unknown): unknown {
	const say = (what: string) =>
		new StepSettingRefusal(`${field.label} ${what}. Nothing was saved.`)
	const bounded = (n: number) => {
		if (field.min != null && n < field.min) throw say(`is at least ${field.min}`)
		if (field.max != null && n > field.max) throw say(`is at most ${field.max}`)
		return n
	}
	switch (field.control) {
		case "integer":
			if (typeof value !== "number" || !Number.isInteger(value)) throw say("is a whole number")
			return bounded(value)
		case "number":
			if (typeof value !== "number" || !Number.isFinite(value)) throw say("is a number")
			return bounded(value)
		case "boolean":
			if (typeof value !== "boolean") throw say("is on or off")
			return value
		case "enum":
			if (typeof value !== "string" || !(field.members ?? []).some((m) => m.key === value))
				throw say(`is one of ${(field.members ?? []).map((m) => m.label).join(", ")}`)
			return value
		case "string":
			if (typeof value !== "string" || value.length > 2000) throw say("is a line of text")
			return value
	}
}

/**
 * Set one step setting for the session — or, with `value: null` or the value
 * it would inherit, clear the session's own (reset-is-delete). The caller has
 * checked the asker owns the session. Refuses an address the session's
 * pipelines do not offer as a step setting, and a value its control does not
 * take, in a sentence (`StepSettingRefusal`).
 */
export async function writeStepSetting(
	db: Db,
	opts: {
		sessionId: number
		userId: number
		spec: string
		nodeKey: string
		path: string
		value: unknown
	}
): Promise<void> {
	const located = (await locateAll(db, opts.sessionId, opts.userId)).find(
		(l) => l.step.spec === opts.spec && l.step.nodeKey === opts.nodeKey && l.field.path === opts.path
	)
	if (!located)
		throw new StepSettingRefusal(
			"That is not a setting this session's pipelines offer here. Nothing was saved."
		)
	const where = and(
		eq(schema.pipelineNodeOverrides.specId, located.specId),
		eq(schema.pipelineNodeOverrides.scopeKind, "session"),
		eq(schema.pipelineNodeOverrides.scopeId, opts.sessionId),
		eq(schema.pipelineNodeOverrides.nodeKey, opts.nodeKey),
		eq(schema.pipelineNodeOverrides.slot, located.slot),
		eq(schema.pipelineNodeOverrides.path, opts.path)
	)
	const value = opts.value === null ? null : checkedValue(located.field, opts.value)
	if (value === null || sameValue(value, located.field.inherited)) {
		await db.delete(schema.pipelineNodeOverrides).where(where)
		return
	}
	const now = new Date()
	await db
		.insert(schema.pipelineNodeOverrides)
		.values({
			specId: located.specId,
			scopeKind: "session",
			scopeId: opts.sessionId,
			nodeKey: opts.nodeKey,
			slot: located.slot,
			path: opts.path,
			value,
			updatedBy: opts.userId,
			updatedAt: now
		})
		.onConflictDoUpdate({
			target: [
				schema.pipelineNodeOverrides.specId,
				schema.pipelineNodeOverrides.scopeKind,
				schema.pipelineNodeOverrides.scopeId,
				schema.pipelineNodeOverrides.nodeKey,
				schema.pipelineNodeOverrides.slot,
				schema.pipelineNodeOverrides.path
			],
			set: { value, updatedBy: opts.userId, updatedAt: now }
		})
}

/** @internal Test seam: the rules a field is held to, by name. */
export const STEP_SETTING_RULES = { MODEL_SLOTS, PLAIN_CONTROLS } as const
