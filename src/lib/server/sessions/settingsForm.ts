/**
 * 🚧 **The session's settings form, derived** (PROPOSAL-layering §5, A9, A10,
 * R1, R32, R36, R37; lane 5b, 2026-10-20). Settings are never declared twice:
 * what a session shows is
 *
 *  · **the genre's fields** — and the rules the session plays (its ruleset
 *    and rigour), fixed at start (R32) — through `exposure.ts`;
 *  · **the settings of every pipeline its registrations run** — each step's
 *    parameters, stored on the session's own registration row under the
 *    registration's key (A9: `registrationKey · step · slot · path`), so a
 *    preset swap leaves the values of a pipeline it stops running dormant
 *    in the table, and they come back with the pipeline;
 *  · **each routine** — its mode (Off · Review · Full), its cadence's
 *    options, Allow stacking and, on the system clock, the cron caps.
 *
 * ## One cascade, every layer may lock (A10)
 *
 * A value resolves declaration (a pipeline's declared defaults: `author`) <
 * the genre's defaults < the preset < the session, through the SDK's
 * `resolveExposure`; a layer may lock a setting for every layer below it.
 *
 * ## Who sees and changes what (R1, R36, R37)
 *
 *  · The session's **owner** sees a setting whose `reach` is `owner` — a
 *    genre's field by default; a pipeline's setting when it declares
 *    `reach: 'owner'`, or (⏳ the step settings folded in here) when its step
 *    is exposed to the session (`expose.session`) and it is a plain value on
 *    a step that calls no model — unless a layer above locked it. A setting
 *    fixed at start is shown, read-only.
 *  · An **administrator**, in their own session, sees every setting; locked
 *    and fixed ones read-only.
 *  · Anyone else — a guest — reaches nothing here (R1): what a guest
 *    controls is what a widget or a pipeline offers them.
 *  · **Routines:** anyone with the settings picks each routine's mode (R37);
 *    only an administrator changes its cadence's options, Allow stacking and
 *    caps (R36).
 *  · **Model plumbing** — a connection, sampling, a loadout, prompts,
 *    templates — is never in the form, for anyone; the write refuses it too.
 *
 * The write (`updateSetting`) re-derives the form for the asker and finds
 * the address in it: what the asker cannot see or may not change is refused
 * by construction, in a sentence, never by a second copy of the rules.
 */
import { and, eq, inArray } from "drizzle-orm"
import {
	cadenceClock,
	coreCadences,
	eventById,
	getCadence,
	getDefinition,
	i18nText,
	isModelPlumbing,
	isSettingDecision,
	registrationKeyOf,
	resolveExposure,
	sessionEvents,
	type CadenceRef,
	type EffectiveRegistration,
	type FieldDecl,
	type RegistrationDecl,
	type SettingValue
} from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { registrationScopeWhere } from "$lib/server/pipelines/registrations/rows"
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"

type Form = Sockets.Sessions.SettingsForm.Response
type Group = Sockets.Sessions.SettingsForm.Group
type Field = Sockets.Sessions.SettingsForm.Field
type Address = Sockets.Sessions.SettingsForm.Address
type Layer = Sockets.Sessions.SettingsForm.Layer
type Routine = Sockets.Sessions.SettingsForm.Routine

/** A refusal in a sentence a person can act on. */
export class SettingRefusal extends Error {}

export interface SettingsViewer {
	userId: number
	isAdmin: boolean
}

/** The controls a value may be set through here. */
const PLAIN_CONTROLS = new Set(["integer", "number", "boolean", "enum", "string", "text"])
/** A step whose declarations name one of these runs on a model: its settings tune the call, never a member's. */
const MODEL_SLOTS = new Set(["connection", "sampling", "loadout"])
/** The slots whose fields are a pipeline's settings (`params`, `settings`). */
const SETTING_SLOTS = new Set(["params", "settings"])

const ROUTINE_MODE_LABELS: Record<string, string> = { off: "Off", review: "Review", full: "Full" }

/** The id of an address — the same string for the same address, whatever order its keys arrived in. */
export function addressId(a: Address): string {
	switch (a.kind) {
		case "genre":
			return JSON.stringify(["genre", a.key])
		case "pipeline":
			return JSON.stringify(["pipeline", a.registrationKey, a.nodeKey, a.slot, a.path])
		case "routine":
			return JSON.stringify(["routine", a.registrationKey, a.field])
	}
}

/** What one field writes, and what it checks first. */
interface Located {
	field: Field
	write: (db: Db, value: unknown | null) => Promise<void>
	/** Called before a write is accepted — the door for a routine's own row. */
	check?: (db: Db, value: unknown | null) => Promise<string | null>
	/** Genre fields: the write is a `session-updated` naming `genreFields` (🚧 `rigour`: the column). */
	changes?: "genreFields" | "registrations" | "rigour"
}

interface Built {
	form: Form
	located: Map<string, Located>
}

const text = (v: unknown, fallback = ""): string => i18nText(v as never) ?? (typeof v === "string" ? v : fallback)

const humanize = (key: string) =>
	key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase())

/** A FieldDecl's control, members and bounds, as the form carries them. */
function controlOf(decl: FieldDecl): Pick<Field, "control" | "members" | "min" | "max"> {
	const d = decl as FieldDecl & { of?: readonly string[]; members?: ReadonlyArray<{ key: string; label?: unknown; description?: unknown }>; list?: boolean }
	const members = d.members?.length
		? d.members.map((m) => ({
				key: m.key,
				label: text(m.label, m.key),
				...(text(m.description) ? { description: text(m.description) } : {})
			}))
		: d.of?.map((k) => ({ key: k, label: humanize(k) }))
	const bounds = {
		...(typeof d.min === "number" ? { min: d.min } : {}),
		...(typeof d.max === "number" ? { max: d.max } : {})
	}
	// A list that names its choices carries them (lane 7: drawn as ticks, never typed).
	if (d.list) return { control: "list", ...bounds, ...(members ? { members } : {}) }
	switch (d.type) {
		case "boolean":
			return { control: "boolean" }
		case "integer":
			return { control: "integer", ...bounds }
		case "number":
			return { control: "number", ...bounds }
		case "enum":
			return { control: "enum", ...(members ? { members } : {}) }
		case "string":
			return { control: "string" }
		case "text":
			return { control: "text" }
		case "string[]":
			return { control: "list", ...(members ? { members } : {}) }
		default:
			return { control: "json" }
	}
}

/** The value as its control takes it, or a refusal naming what it wants. */
export function checkedValue(field: Pick<Field, "label" | "control" | "min" | "max" | "members">, value: unknown): unknown {
	const say = (what: string) => new SettingRefusal(`${field.label} ${what}. Nothing was saved.`)
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
		case "text":
			if (typeof value !== "string" || value.length > 20000) throw say("is text")
			return value
		case "list":
			if (!Array.isArray(value) || value.length > 200 || value.some((v) => typeof v !== "string")) throw say("is a list of words")
			// A list that names its choices takes only those (lane 7).
			if (field.members?.length && value.some((v) => !field.members!.some((m) => m.key === v)))
				throw say(`takes only ${field.members.map((m) => m.label).join(", ")}`)
			return value
		case "json":
			try {
				const json = JSON.stringify(value)
				if (json === undefined || json.length > 20000) throw new Error()
			} catch {
				throw say("is not something this form can store")
			}
			return value
	}
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

const sourceOf = (from: string): Layer =>
	from === "declaration" ? "declaration" : (["author", "genre", "preset", "session"].includes(from) ? from : "session") as Layer

/* ── the genre's group ───────────────────────────────────────────────── */

async function genreGroup(
	db: Db,
	session: typeof schema.sessions.$inferSelect,
	viewer: SettingsViewer,
	located: Map<string, Located>
): Promise<Group | null> {
	const { getSessionGenre, STANDARD_GENRE_ID } = await import("$lib/server/pipelines/entities/sessionGenres")
	const { genreSettingsCascade } = await import("$lib/server/sessions/exposure")
	const genreId = session.genreId ?? STANDARD_GENRE_ID
	const genre = await getSessionGenre(db, genreId)
	const declared = ((genre?.shape as { fields?: Record<string, FieldDecl> } | undefined)?.fields ?? {}) as Record<string, FieldDecl>
	const stored: Record<string, unknown> = {
		...((session.genreFields ?? {}) as Record<string, unknown>),
		...(session.primaryRuleset ? { ruleset: session.primaryRuleset } : {}),
		...(session.rigour ? { rigour: session.rigour } : {})
	}
	const settings = await genreSettingsCascade(db, {
		genreId,
		declared,
		pins: genre?.settings,
		presetId: session.presetId ?? null,
		stored,
		stage: "session"
	})
	const fields: Field[] = []
	for (const s of settings) {
		const ownerVisible = s.reach === "owner" && !s.lockedAt
		if (!viewer.isAdmin && !ownerVisible) continue
		const editable = viewer.isAdmin ? !s.lockedAt && !s.fixed : s.ownerSees
		const address: Address = { kind: "genre", key: s.key }
		const field: Field = {
			id: addressId(address),
			address,
			label: text((s.decl as { label?: unknown }).label, humanize(s.key)),
			...(text((s.decl as { description?: unknown }).description) ? { description: text((s.decl as { description?: unknown }).description) } : {}),
			...controlOf(s.decl),
			value: s.value,
			inherited: s.inherited,
			source: sourceOf(s.from),
			...(s.lockedAt ? { lockedAt: s.lockedAt as Layer } : {}),
			reach: s.reach,
			...(s.fixed ? { fixed: true as const } : {}),
			...((s.decl as { advanced?: boolean }).advanced ? { advanced: true as const } : {}),
			editable,
			...(editable
				? {}
				: {
						readOnlyReason: s.fixed
							? "Chosen when the session started; the rules a session plays do not change."
							: s.lockedAt
								? `Set by the session's ${s.lockedAt === "preset" ? "preset" : "genre"}.`
								: "Only an administrator changes this."
					})
		}
		fields.push(field)
		if (!editable) continue
		/**
		 * How strict is a column, changeable mid-session unless a layer locks
		 * it (PLAN-rulesets §21; main-session ruling 2026-10-20): one of the
		 * genre's options, as `sessions:update` takes it; a reset takes the
		 * value the layers above give it.
		 */
		if (s.rules && s.key === "rigour") {
			located.set(field.id, {
				field,
				changes: "rigour",
				check: async (_db, value) => {
					if (value === null) return null
					const { getGenre } = await import("@serene-pub/sdk")
					const options: readonly string[] = (getGenre(genreId) as any)?.rigour?.options ?? ["prose"]
					return typeof value === "string" && options.includes(value) ? null : "This genre does not play that strictly."
				},
				write: async (tx, value) => {
					const next = typeof value === "string" ? value : typeof s.inherited === "string" ? s.inherited : "prose"
					await tx
						.update(schema.sessions)
						.set({ rigour: next as never, updatedAt: new Date() })
						.where(eq(schema.sessions.id, session.id))
				}
			})
			continue
		}
		if (s.rules) continue
		located.set(field.id, {
			field,
			changes: "genreFields",
			write: async (tx, value) => {
				// Merge over what is stored, read inside the write (a field saved
				// from its widget meanwhile keeps its value).
				await tx.transaction(async (t: Db) => {
					const [row] = await t
						.select({ genreFields: schema.sessions.genreFields })
						.from(schema.sessions)
						.where(eq(schema.sessions.id, session.id))
						.limit(1)
					const next = { ...((row?.genreFields ?? {}) as Record<string, unknown>) }
					if (value === null || same(value, s.inherited)) delete next[s.key]
					else next[s.key] = value
					await t
						.update(schema.sessions)
						.set({ genreFields: next, updatedAt: new Date() })
						.where(eq(schema.sessions.id, session.id))
				})
			}
		})
	}
	if (!fields.length) return null
	return { kind: "genre", id: "genre", heading: genre?.name ?? "Genre", fields }
}

/* ── a pipeline's group ──────────────────────────────────────────────── */

/** A session's own row under a registration key, if it has one. */
async function sessionRow(db: Db, sessionId: number, key: string) {
	const [row] = await db
		.select()
		.from(schema.registrations)
		.where(
			and(
				registrationScopeWhere({ kind: "session", sessionId }),
				eq(schema.registrations.key, key)
			)
		)
		.limit(1)
	return row ?? null
}

/**
 * A change row with nothing left to say is removed; a registering row is
 * kept — and so is one holding a routine's runtime state (a cron's next
 * time, lane 6), which is the routine runtime's, not the form's.
 */
const emptyChange = (r: Partial<typeof schema.registrations.$inferSelect>) =>
	!r.triggerFamily &&
	!r.dropped &&
	r.state == null &&
	r.values == null &&
	r.mode == null &&
	r.when == null &&
	r.allowStacking == null &&
	r.caps == null &&
	r.order == null &&
	r.label == null &&
	r.cadenceOptions == null &&
	r.triggerRef == null

/**
 * Write `patch` onto the session's own row for `key` — the registering row
 * when the session has one, else a change row (§11-1) — and remove a change
 * row left with nothing to say.
 */
export async function patchSessionRow(
	db: Db,
	sessionId: number,
	key: string,
	patch: (row: Partial<typeof schema.registrations.$inferSelect>) => Partial<typeof schema.registrations.$inferInsert>,
	origin: string
): Promise<void> {
	const { rowOfChange } = await import("$lib/server/pipelines/registrations/rows")
	const { invalidateRegistrations } = await import("$lib/server/pipelines/registrations/resolve")
	const row = await sessionRow(db, sessionId, key)
	if (row) {
		const next = { ...row, ...patch(row) }
		if (emptyChange(next)) await db.delete(schema.registrations).where(eq(schema.registrations.id, row.id))
		else
			await db
				.update(schema.registrations)
				.set({ ...patch(row), updatedAt: new Date() })
				.where(eq(schema.registrations.id, row.id))
	} else {
		const fresh = { ...rowOfChange({ key }, { kind: "session", sessionId }, origin) }
		const next = { ...fresh, ...patch(fresh as never) }
		if (!emptyChange(next as never)) await db.insert(schema.registrations).values(next as never)
	}
	invalidateRegistrations()
}

/** Set (or with `null` clear) one address in a registration's values. */
export function valuesWith(
	values: unknown,
	at: { nodeKey: string; slot: string; path: string },
	value: unknown | null
): Record<string, Record<string, unknown>> | null {
	const out: Record<string, Record<string, unknown>> = {}
	for (const [k, v] of Object.entries((values ?? {}) as Record<string, Record<string, unknown>>)) out[k] = { ...v }
	const node = (out[at.nodeKey] ??= {})
	if (at.path === "") {
		if (value === null) delete node[at.slot]
		else node[at.slot] = value
	} else {
		const cur = node[at.slot]
		const slot: Record<string, unknown> =
			cur && typeof cur === "object" && !Array.isArray(cur) ? { ...(cur as Record<string, unknown>) } : cur !== undefined ? { "": cur } : {}
		if (value === null) delete slot[at.path]
		else slot[at.path] = value
		if (Object.keys(slot).length) node[at.slot] = slot
		else delete node[at.slot]
	}
	if (!Object.keys(node).length) delete out[at.nodeKey]
	return Object.keys(out).length ? out : null
}

/** A value a registration states, its layer decision read out only when it is one (`{ value, lock }`). */
const decided = (v: unknown): SettingValue => (isSettingDecision(v) ? v : { value: v })

interface PipelineGroupInput {
	slug: string
	regs: EffectiveRegistration[]
}

async function pipelineGroup(
	db: Db,
	session: typeof schema.sessions.$inferSelect,
	viewer: SettingsViewer,
	input: PipelineGroupInput,
	located: Map<string, Located>
): Promise<Group | null> {
	const { published, declarations } = await import("$lib/server/pipelines/config/panel/declarations")
	const at = await published(db, input.slug)
	if (!at) return null
	const keys = input.regs.map((r) => r.key)
	const firstKey = keys[0]!
	const [decls, nodes] = await Promise.all([
		declarations(db, at.specVersionId),
		db
			.select({
				nodeKey: schema.pipelineNodes.nodeKey,
				definitionId: schema.pipelineNodes.definitionId,
				definitionVersion: schema.pipelineNodes.definitionVersion,
				expose: schema.pipelineNodes.expose
			})
			.from(schema.pipelineNodes)
			.where(eq(schema.pipelineNodes.specVersionId, at.specVersionId))
	])
	const settingDecls = decls.filter((d) => SETTING_SLOTS.has(d.matrixSlot) && PLAIN_CONTROLS.has(d.control))
	const nodeExpose = new Map(nodes.map((n) => [n.nodeKey, (n.expose ?? null) as { promptReach?: string } | null]))
	// 🚧 R54: a step whose prompt choice is the owner's (`expose.promptReach`).
	const promptDecls = decls.filter(
		(d) => d.control === "prompts-ref" && nodeExpose.get(d.nodeKey)?.promptReach === "owner" && !!d.nodeDefinitionId
	)
	if (!settingDecls.length && !promptDecls.length) return null
	const modelCalls = new Set(decls.filter((d) => MODEL_SLOTS.has(d.matrixSlot)).map((d) => d.nodeKey))
	const nodeOf = new Map(nodes.map((n) => [n.nodeKey, n]))

	const { registrationValueLayers, addressedValues } = await import("$lib/server/pipelines/registrations/values")
	const { shippedConfigValuesOf } = await import("$lib/server/pipelines/config/named")
	const layers = await registrationValueLayers(db, {
		specSlug: at.slug,
		specId: at.specId,
		sessionId: session.id,
		registrationKey: firstKey
	})
	// 🚧 R50: the pipeline's instance values sit under the genre layer.
	const instanceValues = addressedValues(layers.instance, decls, { keepDecisions: true })
	const genreValues = addressedValues(layers.genre, decls, { keepDecisions: true })
	const presetValues = addressedValues(layers.preset, decls, { keepDecisions: true })
	const sessionValues = addressedValues(layers.session, decls, { keepDecisions: true })
	const declared = await shippedConfigValuesOf(db, at.specId, at.slug, at.specVersionId, decls).catch(
		() => new Map<string, unknown>()
	)
	// ⏳ The step settings' old home (pipeline_node_overrides, session
	// scope): read beneath the session's registration values, cleared by a write.
	const legacy = new Map<string, unknown>()
	for (const o of await db
		.select()
		.from(schema.pipelineNodeOverrides)
		.where(
			and(
				eq(schema.pipelineNodeOverrides.specId, at.specId),
				eq(schema.pipelineNodeOverrides.scopeKind, "session"),
				eq(schema.pipelineNodeOverrides.scopeId, session.id)
			)
		))
		legacy.set(`${o.nodeKey}\u0000${o.slot}\u0000${o.path ?? ""}`, o.value)

	const fields: Field[] = []
	for (const d of settingDecls) {
		const node = nodeOf.get(d.nodeKey)
		if (!node) continue
		const def = getDefinition(`${node.definitionId}@${node.definitionVersion}`) as
			| { slots?: Record<string, { schema?: Record<string, FieldDecl & { list?: boolean }> }> }
			| undefined
		const fdecl = def?.slots?.[d.slot]?.schema?.[d.path]
		// A list is no plain value, whatever its element's control (rule 3).
		if (fdecl?.list === true || Array.isArray(fdecl?.default) || Array.isArray(d.authorDefault)) continue
		const exposed = (node.expose as { session?: boolean } | null)?.session === true
		const modelStep = modelCalls.has(d.nodeKey)
		const plumbing = isModelPlumbing(d.path, fdecl as never)
		const reach: "owner" | "admin" =
			modelStep || plumbing ? "admin" : (fdecl?.reach ?? (exposed ? "owner" : "admin"))
		const addr = `${d.nodeKey}\u0000${d.slot}\u0000${d.path}`
		const author = declared.has(addr) ? declared.get(addr) : d.authorDefault
		const layerOf = (m: Map<string, unknown>): Record<string, SettingValue> =>
			m.has(addr) ? { v: decided(m.get(addr)) } : {}
		const sessionLayer: Record<string, SettingValue> = sessionValues.has(addr)
			? { v: decided(sessionValues.get(addr)) }
			: legacy.has(addr)
				? { v: decided(legacy.get(addr)) }
				: {}
		const decl = { type: "string", default: author, reach, ...(fdecl?.fixedAtStart ? { fixedAtStart: true as const } : {}) } as FieldDecl
		const above = [
			{ layer: "genre", values: genreValues.has(addr) ? layerOf(genreValues) : layerOf(instanceValues) },
			{ layer: "preset", values: layerOf(presetValues) }
		]
		const r = resolveExposure({ v: decl }, [...above, { layer: "session", values: sessionLayer }], { defaultReach: "admin" }).v!
		const inherited = resolveExposure({ v: decl }, above, { defaultReach: "admin" }).v!.value
		const ownerSees = reach === "owner" && !r.lockedAt && !plumbing && !modelStep
		if (!viewer.isAdmin && !ownerSees && !(r.fixed && reach === "owner" && !r.lockedAt)) continue
		const editable = viewer.isAdmin ? !r.lockedAt && !r.fixed : ownerSees && !r.fixed
		const address: Address = { kind: "pipeline", registrationKey: firstKey, nodeKey: d.nodeKey, slot: d.slot, path: d.path }
		const field: Field = {
			id: addressId(address),
			address,
			label: d.label,
			...(d.description ? { description: d.description } : {}),
			control: d.control as Field["control"],
			...(d.min != null ? { min: d.min } : {}),
			...(d.max != null ? { max: d.max } : {}),
			...(d.control === "enum"
				? {
						members: (
							(d.members ?? (d.of ?? []).map((k: string) => ({ key: k }))) as ReadonlyArray<{
								key: string
								label?: string
								description?: string
							}>
						).map((m) => ({ key: m.key, label: m.label ?? m.key, ...(m.description ? { description: m.description } : {}) }))
					}
				: {}),
			value: r.value,
			inherited,
			source: r.from === "declaration" ? "author" : sourceOf(r.from),
			...(r.lockedAt ? { lockedAt: r.lockedAt as Layer } : {}),
			reach,
			...(r.fixed ? { fixed: true as const } : {}),
			...(!d.quick && !exposed && !fdecl?.reach ? { advanced: true as const } : {}),
			editable,
			...(editable
				? {}
				: {
						readOnlyReason: r.fixed
							? "Chosen when the session started."
							: r.lockedAt
								? `Set by the session's ${r.lockedAt === "preset" ? "preset" : "genre"}.`
								: "Only an administrator changes this."
					})
		}
		fields.push(field)
		stepOf.set(field, {
			spec: at.slug,
			specName: at.name,
			nodeKey: d.nodeKey,
			definitionId: `${node.definitionId}@${node.definitionVersion}`,
			heading: i18nText((node.expose as { label?: unknown } | null)?.label as never) ?? d.stepHeading ?? d.typeLabel,
			exposed: exposed && !modelStep
		})
		if (!editable) continue
		located.set(field.id, {
			field,
			changes: "registrations",
			write: async (tx, value) => {
				const clear = value === null || same(value, inherited)
				// Every registration of the pipeline (A9): one setting, however
				// many triggers run it.
				for (const key of keys)
					await patchSessionRow(
						tx,
						session.id,
						key,
						(row) => ({ values: valuesWith(row.values, d, clear ? null : value) as never }),
						viewer.isAdmin ? "admin" : "owner"
					)
				// ⏳ The old home of a step setting is cleared, so a reset resets.
				await tx
					.delete(schema.pipelineNodeOverrides)
					.where(
						and(
							eq(schema.pipelineNodeOverrides.specId, at.specId),
							eq(schema.pipelineNodeOverrides.scopeKind, "session"),
							eq(schema.pipelineNodeOverrides.scopeId, session.id),
							eq(schema.pipelineNodeOverrides.nodeKey, d.nodeKey),
							eq(schema.pipelineNodeOverrides.slot, d.slot),
							eq(schema.pipelineNodeOverrides.path, d.path)
						)
					)
			}
		})
	}
	// 🚧 R54: the prompt choice of each step whose prompt is the owner's — among
	// the slot's pool, an administrator's hidden prompts left out for anyone
	// else (the one in force stays listed). The choice, never the text.
	if (promptDecls.length) {
		const { listPrompts } = await import("$lib/server/pipelines/entities/prompts")
		const plain = (v: unknown) => (isSettingDecision(v) ? v.value : v)
		for (const d of promptDecls) {
			const addr = `${d.nodeKey}\u0000${d.slot}\u0000${d.path}`
			const at1 = (m: Map<string, unknown>) => (m.has(addr) ? plain(m.get(addr)) : undefined)
			const inherited =
				at1(presetValues) ?? at1(genreValues) ?? at1(instanceValues) ?? (declared.has(addr) ? declared.get(addr) : d.authorDefault)
			const own = at1(sessionValues) ?? (legacy.has(addr) ? legacy.get(addr) : undefined)
			const value = own ?? inherited
			const idOf = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null)
			const pool = await listPrompts(db, d.nodeDefinitionId!, d.slot, at.specId)
			const offered = pool.filter((p) => viewer.isAdmin || !p.hidden || p.id === idOf(value))
			if (!offered.length) continue
			const address: Address = { kind: "pipeline", registrationKey: firstKey, nodeKey: d.nodeKey, slot: d.slot, path: d.path }
			const node = nodeOf.get(d.nodeKey)
			const field: Field = {
				id: addressId(address),
				address,
				label: "Prompt",
				description: "Which prompt this step writes from. Prompts are written in the prompt library; here you choose one.",
				control: "enum",
				members: offered.map((p) => ({
					key: String(p.id),
					label: p.hidden ? `${p.name} (hidden from owners)` : p.name
				})),
				value: idOf(value) != null ? String(idOf(value)) : null,
				inherited: idOf(inherited) != null ? String(idOf(inherited)) : null,
				source: own !== undefined ? "session" : at1(presetValues) !== undefined ? "preset" : at1(genreValues) !== undefined || at1(instanceValues) !== undefined ? "genre" : "author",
				reach: "owner",
				editable: true
			}
			fields.push(field)
			stepOf.set(field, {
				spec: at.slug,
				specName: at.name,
				nodeKey: d.nodeKey,
				definitionId: node ? `${node.definitionId}@${node.definitionVersion}` : d.nodeDefinitionId!,
				heading: i18nText((node?.expose as { label?: unknown } | null)?.label as never) ?? d.stepHeading ?? d.typeLabel,
				exposed: true
			})
			located.set(field.id, {
				field,
				changes: "registrations",
				write: async (tx, v) => {
					const id = v === null ? null : idOf(v)
					const clear = id === null || id === idOf(inherited)
					for (const key of keys)
						await patchSessionRow(
							tx,
							session.id,
							key,
							(row) => ({ values: valuesWith(row.values, d, clear ? null : id) as never }),
							viewer.isAdmin ? "admin" : "owner"
						)
					await tx
						.delete(schema.pipelineNodeOverrides)
						.where(
							and(
								eq(schema.pipelineNodeOverrides.specId, at.specId),
								eq(schema.pipelineNodeOverrides.scopeKind, "session"),
								eq(schema.pipelineNodeOverrides.scopeId, session.id),
								eq(schema.pipelineNodeOverrides.nodeKey, d.nodeKey),
								eq(schema.pipelineNodeOverrides.slot, d.slot),
								eq(schema.pipelineNodeOverrides.path, d.path)
							)
						)
				}
			})
		}
	}
	if (!fields.length) return null
	return {
		kind: "registration",
		id: at.slug,
		heading: text(input.regs[0]?.label) || at.name,
		pipeline: at.slug,
		registrationKeys: keys,
		triggers: [
			...new Set(
				input.regs.map((r) =>
					r.trigger.family === "event"
						? r.trigger.event
						: r.trigger.family === "action"
							? r.trigger.action
							: r.trigger.family === "routine"
								? r.trigger.cadence.id
								: String((r.trigger as { family: string }).family)
				)
			)
		],
		fields
	}
}

/** ⏳ Where each pipeline field came from — the step-settings projection reads it. */
const stepOf = new WeakMap<
	Field,
	{ spec: string; specName: string; nodeKey: string; definitionId: string; heading: string; exposed: boolean }
>()

/** The step a pipeline field belongs to (⏳ for the step-settings projection). */
export const stepOfField = (f: Field) => stepOf.get(f)

/* ── the routines ────────────────────────────────────────────────────── */

/** The session's events as an enum's members: core's, named. */
function sessionEventMembers(): { key: string; label: string }[] {
	return [...new Set(Object.values(sessionEvents))].map((id) => ({
		key: id,
		label: text(eventById(id)?.name, id.replace(/^[^:]+:event\//, "").replace(/@\d+$/, "").replace(/-/g, " "))
	}))
}

/** Which layer of a session's rows states a column for a key (an administrator's genre change is keyed `admin:<key>`). */
function layerStating(
	rows: { genre: ReadonlyArray<{ key: string }>; preset: ReadonlyArray<{ key: string }>; session: ReadonlyArray<{ key: string }> },
	key: string,
	has: (row: Record<string, unknown>) => boolean
): Layer | null {
	const base = (k: string) => (k.startsWith("admin:") ? k.slice("admin:".length) : k)
	const states = (list: ReadonlyArray<{ key: string }>, k: (x: string) => string = (x) => x) =>
		(list as ReadonlyArray<Record<string, unknown>>).some((r) => k(String(r.key)) === key && has(r))
	if (states(rows.session)) return "session"
	if (states(rows.preset)) return "preset"
	if (states(rows.genre, base)) return "genre"
	return null
}

/**
 * What each routine pipeline does, in a sentence (lane 7): the first
 * `expose.purpose` its published version's steps declare — the line the
 * pipeline panel prints under a model call. Absent when none declares one.
 */
export async function routinePurposes(db: Db, slugs: readonly string[]): Promise<Map<string, string>> {
	const out = new Map<string, string>()
	if (!slugs.length) return out
	const rows = await db
		.select({ slug: schema.pipelineSpecs.slug, expose: schema.pipelineNodes.expose, position: schema.pipelineNodes.position })
		.from(schema.pipelineSpecs)
		.innerJoin(schema.pipelineNodes, eq(schema.pipelineNodes.specVersionId, schema.pipelineSpecs.activeVersionId))
		.where(inArray(schema.pipelineSpecs.slug, [...new Set(slugs)]))
	for (const r of [...rows].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
		if (out.has(r.slug)) continue
		const purpose = text((r.expose as { purpose?: unknown } | null)?.purpose)
		if (purpose) out.set(r.slug, purpose)
	}
	return out
}

async function routinesGroup(
	db: Db,
	session: typeof schema.sessions.$inferSelect,
	viewer: SettingsViewer,
	resolved: NonNullable<Awaited<ReturnType<typeof import("$lib/server/pipelines/registrations/resolve").effectiveRegistrations>>>,
	pipelineNames: Map<string, string>,
	located: Map<string, Located>
): Promise<Group | null> {
	const routines: Routine[] = []
	const { systemCronCaps } = await import("$lib/server/pipelines/registrations/door")
	const caps = await systemCronCaps(db)
	const purposes = await routinePurposes(
		db,
		resolved.effective.filter((r) => r.trigger.family === "routine").map((r) => r.pipeline)
	).catch(() => new Map<string, string>())
	for (const r of resolved.effective) {
		if (r.trigger.family !== "routine") continue
		const ref = r.trigger.cadence as CadenceRef
		const def = getCadence(ref.id) as
			| { i18n?: { name?: unknown }; options?: Record<string, FieldDecl> }
			| undefined
		const offered = resolved.offered.find((o) => o.key === r.key)
		const offeredRef = offered?.trigger.family === "routine" ? (offered.trigger.cadence as CadenceRef) : ref
		const fields: Field[] = []
		const routineField = (
			field: string,
			label: string,
			control: Pick<Field, "control" | "members" | "min" | "max">,
			value: unknown,
			inherited: unknown,
			source: Layer,
			adminOnly: boolean,
			write: (value: unknown | null) => (row: Partial<typeof schema.registrations.$inferSelect>) => Partial<typeof schema.registrations.$inferInsert>,
			description?: string
		) => {
			if (adminOnly && !viewer.isAdmin) return
			const address: Address = { kind: "routine", registrationKey: r.key, field }
			const f: Field = {
				id: addressId(address),
				address,
				label,
				...(description ? { description } : {}),
				...control,
				value,
				inherited,
				source,
				reach: adminOnly ? "admin" : "owner",
				editable: true
			}
			fields.push(f)
			located.set(f.id, {
				field: f,
				changes: "registrations",
				write: async (tx, v) => {
					const clear = v === null || same(v, inherited)
					await patchSessionRow(tx, session.id, r.key, write(clear ? null : v), viewer.isAdmin ? "admin" : "owner")
				},
				...(adminOnly || field === "cadence"
					? {
							check: async (tx, v) => {
								// The door, on the registration as this write would leave it.
								const next = routineAfter(r, field, v === null ? undefined : v)
								const { registrationDoor, doorSentence } = await import("$lib/server/pipelines/registrations/door")
								const verdict = await registrationDoor(tx, [next], {
									layer: "this session",
									genreId: resolved.genreId,
									sessionId: session.id
								})
								return verdict.errors.length ? doorSentence(verdict.errors) : null
							}
						}
					: {})
			})
		}
		const has = (col: string) => (row: Record<string, unknown>) => row[col] != null
		// 🚧 When it runs — after each turn or after each round (R52): the one
		// cadence choice the owner makes, on a routine its preset runs on one
		// of the two (Story's reckoning). A session change row's `trigger_ref`.
		const { TURN_OR_ROUND_CADENCES } = await import("$lib/server/pipelines/registrations/resolve")
		if (TURN_OR_ROUND_CADENCES.includes(offeredRef.id))
			routineField(
				"cadence",
				"When it runs",
				{
					control: "enum",
					members: TURN_OR_ROUND_CADENCES.map((id) => {
						const d = getCadence(id) as { i18n?: { name?: unknown; description?: unknown } } | undefined
						return {
							key: id,
							label: text(d?.i18n?.name, id),
							...(d?.i18n?.description ? { description: text(d.i18n.description) } : {})
						}
					})
				},
				ref.id,
				offeredRef.id,
				layerStating(resolved.rows, r.key, has("triggerRef")) ?? "declaration",
				false,
				(v) => () => ({ triggerRef: (v as string | null) ?? null })
			)
		// Mode — anyone with the settings (R37).
		routineField(
			"mode",
			"Mode",
			{
				control: "enum",
				members: ["off", "review", "full"].map((k) => ({
					key: k,
					label: ROUTINE_MODE_LABELS[k]!,
					description:
						k === "off"
							? "Does not run."
							: k === "review"
								? "Runs, and holds what it would change for you to accept."
								: "Runs, and applies what it changes."
				}))
			},
			r.mode ?? "full",
			offered?.mode ?? "full",
			layerStating(resolved.rows, r.key, has("mode")) ?? "declaration",
			false,
			(v) => () => ({ mode: (v as string | null) ?? null })
		)
		// The cadence's options, Allow stacking, caps — administrators (R36).
		// A JSON option (`where`, `when`, `at`, the jump ceiling) is shown, not
		// typed; an event to listen to is a choice among the session's events
		// (lane 7: no free-text ids).
		for (const [opt, decl] of Object.entries(def?.options ?? {})) {
			const fmt = decl as FieldDecl & { format?: string }
			const control: Pick<Field, "control" | "members" | "min" | "max"> =
				fmt.format === "json" || fmt.type === "object"
					? { control: "json" }
					: opt === "event" && ref.id === coreCadences.onEvent.id
						? { control: "enum", members: sessionEventMembers() }
						: controlOf(decl)
			routineField(
				`cadence.${opt}`,
				text((decl as { label?: unknown }).label, humanize(opt)),
				control,
				ref.options?.[opt] ?? decl.default,
				offeredRef.options?.[opt] ?? decl.default,
				resolved.rows.session.some((s) => s.key === r.key && s.cadenceOptions && opt in (s.cadenceOptions as object))
					? "session"
					: offered?.origin === "preset"
						? "preset"
						: "genre",
				true,
				(v) => (row) => {
					const cur = { ...((row.cadenceOptions ?? {}) as Record<string, unknown>) }
					if (v === null) delete cur[opt]
					else cur[opt] = v
					return { cadenceOptions: (Object.keys(cur).length ? cur : null) as never }
				},
				text((decl as { description?: unknown }).description) || undefined
			)
		}
		routineField(
			"allowStacking",
			"Allow stacking",
			{ control: "boolean" },
			r.allowStacking ?? false,
			offered?.allowStacking ?? false,
			layerStating(resolved.rows, r.key, has("allowStacking")) ?? "declaration",
			true,
			(v) => () => ({ allowStacking: (v as boolean | null) ?? null }),
			"When on, a firing while this routine already has one waiting queues another; when off, it is skipped."
		)
		if (cadenceClock(ref) === "system") {
			const capField = (k: "idleTimeoutMinutes" | "maxRunsInRow", label: string, description: string) =>
				routineField(
					k,
					label,
					{ control: "integer", min: 1, ...(caps[k] != null ? { max: caps[k] } : {}) },
					r.caps?.[k] ?? caps[k] ?? null,
					offered?.caps?.[k] ?? caps[k] ?? null,
					layerStating(resolved.rows, r.key, (row) => (row.caps as Record<string, unknown> | null)?.[k] != null) ?? "declaration",
					true,
					(v) => (row) => {
						const cur = { ...((row.caps ?? {}) as Record<string, unknown>) }
						if (v === null) delete cur[k]
						else cur[k] = v
						return { caps: (Object.keys(cur).length ? cur : null) as never }
					},
					description
				)
			capField("idleTimeoutMinutes", "Idle cron timeout (minutes)", "How long the session may go without anyone's interaction before this routine stops running.")
			capField("maxRunsInRow", "Most cron runs in a row", "How many runs this routine may have since the last interaction.")
		}
		routines.push({
			registrationKey: r.key,
			pipeline: r.pipeline,
			label: text(r.label) || pipelineNames.get(r.pipeline) || r.pipeline,
			...(purposes.get(r.pipeline) ? { purpose: purposes.get(r.pipeline)! } : {}),
			cadence: { id: ref.id, name: text(def?.i18n?.name, ref.id), options: { ...(ref.options ?? {}) } },
			mode: (r.mode ?? "full") as Routine["mode"],
			fields
		})
	}
	if (!routines.length) return null
	return { kind: "routines", id: "routines", heading: "Routines", fields: [], routines }
}

/** A routine registration as a write of `field` would leave it — what the door judges. */
function routineAfter(r: EffectiveRegistration, field: string, v: unknown): RegistrationDecl {
	const { origin: _o, changedBy: _c, ...decl } = r
	const next = { ...decl } as Record<string, unknown>
	if (field.startsWith("cadence.") && r.trigger.family === "routine") {
		const opt = field.slice("cadence.".length)
		const options = { ...r.trigger.cadence.options } as Record<string, unknown>
		if (v === undefined) delete options[opt]
		else options[opt] = v
		next.trigger = { family: "routine", cadence: { id: r.trigger.cadence.id, options } }
	} else if (field === "cadence" && r.trigger.family === "routine") {
		// The door judges the swap as the registration it would be (its fit,
		// its cadence); the row keeps the registration's key (A8, R52).
		next.trigger = { family: "routine", cadence: { id: typeof v === "string" ? v : r.trigger.cadence.id, options: {} } }
		next.key = registrationKeyOf(next.trigger as never, r.pipeline)
	}
	else if (field === "allowStacking") next.allowStacking = v
	else if (field === "idleTimeoutMinutes" || field === "maxRunsInRow") next.caps = { ...(r.caps ?? {}), [field]: v }
	else if (field === "mode") next.mode = v
	return next as unknown as RegistrationDecl
}

/* ── the form ────────────────────────────────────────────────────────── */

async function build(db: Db, sessionId: number, viewer: SettingsViewer): Promise<Built> {
	const located = new Map<string, Located>()
	const access = await checkSessionAccess(sessionId, viewer.userId)
	if (!access.hasAccess || !access.isOwner)
		return {
			form: { sessionId, groups: [], error: "Only the session's owner sees its settings." },
			located
		}
	const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).limit(1)
	if (!session) return { form: { sessionId, groups: [], error: "Session not found." }, located }
	const groups: Group[] = []
	const genre = await genreGroup(db, session, viewer, located)
	if (genre) groups.push(genre)

	const { effectiveRegistrations } = await import("$lib/server/pipelines/registrations/resolve")
	const resolved = await effectiveRegistrations(db, sessionId)
	if (resolved) {
		// A pipeline once, however many triggers run it; never the creation
		// pipeline (its settings applied while the session was being made).
		const byPipeline = new Map<string, EffectiveRegistration[]>()
		for (const r of resolved.effective) {
			if (r.trigger.family === "event" && r.trigger.event === sessionEvents.sessionCreated) continue
			byPipeline.set(r.pipeline, [...(byPipeline.get(r.pipeline) ?? []), r])
		}
		const names = new Map<string, string>()
		if (byPipeline.size)
			for (const s of await db
				.select({ slug: schema.pipelineSpecs.slug, name: schema.pipelineSpecs.name })
				.from(schema.pipelineSpecs)
				.where(inArray(schema.pipelineSpecs.slug, [...byPipeline.keys()])))
				names.set(s.slug, s.name)
		// The reply first, then what answers the session's other events, its
		// actions, and its routines — the order a person reads a session in.
		const rank = (regs: EffectiveRegistration[]) =>
			Math.min(
				...regs.map((r) =>
					r.trigger.family === "event"
						? r.trigger.event === sessionEvents.messageRespond
							? 0
							: 1
						: r.trigger.family === "action"
							? 2
							: 3
				)
			)
		const ordered = [...byPipeline].sort((a, b) => rank(a[1]) - rank(b[1]))
		for (const [slug, regs] of ordered) {
			try {
				const g = await pipelineGroup(db, session, viewer, { slug, regs }, located)
				if (g) groups.push(g)
			} catch (err) {
				console.warn(`[settingsForm] '${slug}' offers no settings: ${(err as Error).message}`)
			}
		}
		const routines = await routinesGroup(db, session, viewer, resolved, names, located)
		if (routines) groups.push(routines)
	}
	return { form: { sessionId, viewer: viewer.isAdmin ? "admin" : "owner", groups }, located }
}

/** Every field of a form — each group's, and each routine's. */
export const formFields = (form: Form): Field[] =>
	form.groups.flatMap((g) => [...g.fields, ...(g.routines ?? []).flatMap((r) => r.fields)])

/** **The session's settings form**, derived for the asker (see the module note). */
export async function settingsForm(db: Db, sessionId: number, viewer: SettingsViewer): Promise<Form> {
	return (await build(db, sessionId, viewer)).form
}

/** The internal build — the form and what each editable field writes (the step-settings projection reads it). */
export const settingsFormBuild = build

/**
 * **Change one setting** — the address must be one the asker's form shows
 * and lets them change; the value one its control takes. `null`, or the
 * value it inherits, resets it (reset-is-delete). Refuses in a sentence
 * (`SettingRefusal`). Returns what moved, for the caller's event.
 */
export async function updateSetting(
	db: Db,
	sessionId: number,
	viewer: SettingsViewer,
	address: Address,
	value: unknown
): Promise<{ changes: "genreFields" | "registrations" | "rigour" }> {
	if (!address || typeof address !== "object" || !["genre", "pipeline", "routine"].includes((address as { kind?: string }).kind ?? ""))
		throw new SettingRefusal("That is not a setting. Nothing was saved.")
	const { form, located } = await build(db, sessionId, viewer)
	if (form.error) throw new SettingRefusal(form.error)
	const id = addressId(address)
	const at = located.get(id)
	if (!at) {
		const shown = formFields(form).find((f) => f.id === id)
		if (shown && !shown.editable) throw new SettingRefusal(`${shown.label}: ${shown.readOnlyReason ?? "it cannot be changed here."} Nothing was saved.`)
		throw new SettingRefusal(
			address.kind === "pipeline" && (MODEL_SLOTS.has(address.slot) || isModelPlumbing(address.slot) || isModelPlumbing(address.path))
				? "What a step runs on — its connection, sampling, loadout, prompts and templates — is an administrator's, in the pipeline's own settings. Nothing was saved."
				: "That is not a setting this session offers you here. Nothing was saved."
		)
	}
	const checked = value === null || value === undefined ? null : checkedValue(at.field, value)
	if (at.check) {
		const refused = await at.check(db, checked)
		if (refused) throw new SettingRefusal(`${refused} Nothing was saved.`)
	}
	await at.write(db, checked)
	return { changes: at.changes ?? "registrations" }
}
