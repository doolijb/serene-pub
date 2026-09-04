/**
 * Named configs for a pipeline, and what a new version does to them.
 *
 * ## Every pipeline has a shipped default, and it is immutable
 *
 * Not a convention — an invariant, established at publish. A pipeline with no
 * config has no answer to *"what does this do before anyone tunes it"*, and
 * every surface that asks (the panel, an export, a run) would have to invent
 * one independently. Core seeds its own; a plugin or an imported document ships
 * one in the document, as an author preset (12 §3). Either way, publishing a
 * spec version materializes it.
 *
 * It is immutable because it is the thing a user's config is *derived from* and
 * reconciled against. Editing the shipped default in place would silently
 * redefine what "back to defaults" means for everyone who had not touched it,
 * which is the same failure pinning a type version prevents. Customizing is
 * duplicating.
 *
 * ## What a new version does to a config somebody tuned
 *
 * A pipeline's tuneable surface is declared by its nodes, so publishing changes
 * it. Two directions, two different answers, and the asymmetry is deliberate:
 *
 * | change | what happens | why |
 * |---|---|---|
 * | an option is **removed** | the user's value is **culled**, with a notice | a row addressing a field that no longer exists resolves to nothing; keeping it looks like corruption, dropping it silently looks like the pipeline changed for no reason |
 * | an option is **added** | back-filled from the pipeline's default | the author default is the correct value for a parameter nobody has had the chance to set |
 *
 * Only the cull warns. A new parameter arriving at its declared default is the
 * outcome the user would have chosen; a value disappearing is not.
 *
 * ## What is never reconciled
 *
 * A value the user set that still has an address is left exactly alone, even if
 * the author default moved underneath it. That is the whole point of the layer
 * chain: an admin changing a default reaches everyone who has not opted out, and
 * stops at everyone who has (12 §2).
 */

import { and, asc, eq, inArray, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { declarations, type Decl } from "$lib/server/pipelines/config/panel"
import { defaultPromptFor } from "$lib/server/pipelines/boot/seedPrompts"
import { promptPoolKeyFor } from "$lib/server/pipelines/entities/promptPool"
import { defaultVariableTemplateFor } from "$lib/server/pipelines/boot/seedVariableTemplates"
import { defaultContextTemplateFor } from "$lib/server/pipelines/boot/seedContextTemplates"
import { CORE_TEMPLATE_ENGINE } from "$lib/server/pipelines/prompt/renderers"

type Db = {
	select: any
	insert: any
	update: any
	delete: any
}

// `\u0000` as an escape, never the raw byte: a literal NUL makes git
// classify this file as binary, and a patch generated without `--binary`
// silently drops its content. The SDK's config.ts documents the same
// lesson at its SEP constant.
const SEP = "\u0000"
const addr = (nodeKey: string, slot: string, path: string) =>
	`${nodeKey}${SEP}${slot}${SEP}${path}`

/** The address of a value row or a declaration, as one key. */
const addrOf = (r: { nodeKey: string; slot: string; path?: string | null }) =>
	addr(r.nodeKey, r.slot, r.path ?? "")

// There is deliberately no `engineFor` here any more, and no `engine` on a
// value row. It tested `decl.control === "template"` — a control string
// `declsForSlot` never emits — so the column it fed was NULL on every row ever
// written, and its only reader was this file's own copy-forward. The language a
// template is written in lives on the TEMPLATE ROW, NOT NULL, and reaches the
// renderer from there; a second copy on the value row could only ever disagree
// with it.

/* ------------------------------------------------------------------ *
 * The shipped default
 * ------------------------------------------------------------------ */

export interface EnsureDefaultResult {
	configId: number
	action: "created" | "present"
}

/**
 * The shipped row a `*-ref` declaration should point at, keyed by address.
 *
 * A reference slot has no author default — the value is a row, not a literal —
 * so `d.authorDefault` is `undefined` for every one of them and anything
 * relying on it writes nothing. That is fine on a fresh install, where
 * `ensureDefaultConfig` fills them in, and it was silently wrong on an upgraded
 * one: `reconcileConfigs` back-fills a newly declared address from the author
 * default, found `undefined`, and skipped it. The setting then showed
 * "— Pipeline Default —" with no row behind it, above output that plainly had
 * a layout. Found by booting the new build against a database seeded by the
 * old one, which is the only place it is visible.
 *
 * Shared by both callers rather than written twice, because the two disagreeing
 * about what a shipped default is would produce exactly that discrepancy again.
 */
async function refDefaults(
	db: Db,
	specId: number,
	specSlug: string,
	decls: Decl[]
): Promise<Map<string, unknown>> {
	const out = new Map<string, unknown>()
	// Per *pool*, not per spec — the correction pooling forced. This used to
	// resolve ONE prompt id for the whole pipeline and assign it to every
	// prompts-ref, which was defensible only while a spec's prompts were a
	// single per-pipeline bundle: the summarize specs' four steps all pointed
	// at the one row carrying `batch`, `synth`, `name` and
	// `characterExtraction`. Split along the declarations those are four rows
	// in four pools, and one id for all of them would hand three of the four
	// steps a prompt with none of the fields they read.
	const prompts = new Map<string, number | null>()
	// Per *variable*, not per spec: a layout row is keyed by what it renders,
	// so the shipped characters layout is the same row in every pipeline.
	const layouts = new Map<string, number | null>()
	// Per *node type*, for the same reason: session reply and the narrator run the
	// same assemble node, so core's story string is one row serving both.
	const templates = new Map<string, number | null>()

	for (const d of decls) {
		const key = addr(d.nodeKey, d.slot, d.path)
		if (d.control === "prompts-ref" && d.nodeTypeId) {
			const pool = promptPoolKeyFor(d.nodeTypeId, d.slot)
			if (!prompts.has(pool))
				prompts.set(
					pool,
					await defaultPromptFor(db, d.nodeTypeId, d.slot, {
						id: specId,
						slug: specSlug
					})
				)
			const id = prompts.get(pool)
			if (id != null) out.set(key, id)
			continue
		}
		if (d.control === "context-template-ref" && d.nodeTypeId) {
			// The engine is half the template pool now, so it is half this
			// cache key too. Keyed on the node type alone, a node declaring a
			// jinja2 template slot would be handed whichever engine's row the
			// first node of that type happened to resolve — the shipped config
			// would then point a jinja2 slot at Handlebars source, and it would
			// render as raw markup rather than fail.
			const engine = d.engine ?? CORE_TEMPLATE_ENGINE
			const pool = `${d.nodeTypeId}#${engine}`
			if (!templates.has(pool))
				templates.set(
					pool,
					await defaultContextTemplateFor(db, d.nodeTypeId, engine)
				)
			const id = templates.get(pool)
			if (id != null) out.set(key, id)
			continue
		}
		if (d.control === "variable-template-ref" && d.variableId) {
			if (!layouts.has(d.variableId))
				layouts.set(
					d.variableId,
					await defaultVariableTemplateFor(db, d.variableId)
				)
			const id = layouts.get(d.variableId)
			if (id != null) out.set(key, id)
		}
	}
	return out
}

/**
 * Guarantee the invariant for one spec: a default, immutable config exists.
 *
 * Seeded from the document's default author preset where it ships one, and from
 * the declared defaults otherwise — which is not a fallback so much as the same
 * thing said twice: an author preset *is* a set of declared values, and a
 * pipeline that ships none has exactly its declarations.
 *
 * Idempotent, and matched on `seedKey` rather than on name or id. A user is free
 * to rename their copies; the shipped one has to stay findable regardless.
 */
export async function ensureDefaultConfig(
	db: Db,
	specId: number,
	specVersionId: number,
	specSlug: string
): Promise<EnsureDefaultResult> {
	const seedKey = `pipeline-default:${specSlug}`

	const [existing] = await db
		.select()
		.from(schema.pipelineConfigs)
		.where(eq(schema.pipelineConfigs.seedKey, seedKey))
		.limit(1)
	if (existing) return { configId: existing.id, action: "present" }

	const decls = await declarations(db, specVersionId)

	// The author preset marked default, if the document shipped one. Its values
	// win over the bare declarations, because that is what shipping a preset
	// means: this is how the author intends the pipeline to arrive.
	const [preset] = await db
		.select()
		.from(schema.pipelinePresets)
		.where(
			and(
				eq(schema.pipelinePresets.specVersionId, specVersionId),
				eq(schema.pipelinePresets.isDefault, true)
			)
		)
		.limit(1)

	const presetValues = new Map<string, unknown>()
	if (preset) {
		const rows = await db
			.select()
			.from(schema.pipelinePresetValues)
			.where(eq(schema.pipelinePresetValues.presetId, preset.id))
		for (const r of rows as any[]) {
			presetValues.set(addrOf(r), r.value)
			// A preset that sets a whole SLOT is also read per FIELD.
			//
			// `p.settings('render', { review: 'on' })` stores ONE row —
			// `render|settings|null = {"review":"on"}` — because that is how the
			// author wrote it. Declarations for a settings slot are per-field
			// (`render|settings|review`), and the lookup below is by exact
			// address, so the two spellings never met: every author preset that
			// set `settings` was silently dropped and the config fell back to
			// the author default.
			//
			// That was not a small miss. `core:spec/generate-image` ships
			// `review-on` as its DEFAULT preset, labelled "Ask for the prompt" —
			// so the shipped config was named after a preset whose one value
			// never landed, and pressing Image rendered immediately instead of
			// asking for a prompt. The summarize spec's `save` node had the same
			// hole.
			//
			// Exploding here rather than at the writer because it also repairs
			// preset rows already seeded on existing installs; the per-field
			// entry is only added when the exact address is not already present,
			// so an explicit per-field row always wins.
			const wholeSlot = (r.path ?? "") === ""
			const isPlainObject =
				r.value !== null &&
				typeof r.value === "object" &&
				!Array.isArray(r.value)
			if (wholeSlot && isPlainObject)
				for (const [field, value] of Object.entries(
					r.value as Record<string, unknown>
				)) {
					const key = addr(r.nodeKey, r.slot, field)
					if (!presetValues.has(key)) presetValues.set(key, value)
				}
		}
	}

	const [config] = await db
		.insert(schema.pipelineConfigs)
		.values({
			specId,
			seedKey,
			name: preset?.label ?? "Default",
			isImmutable: true,
			isDefault: true
		})
		.returning()

	const refs = await refDefaults(db, specId, specSlug, decls)

	const values = decls
		.map((d) => {
			const key = addr(d.nodeKey, d.slot, d.path)
			const value = presetValues.has(key)
				? presetValues.get(key)
				: (refs.get(key) ?? d.authorDefault)
			return { d, value }
		})
		// A declaration with no default and no preset value is a field the author
		// left open. Writing a NULL row for it would make "never set" and "set to
		// nothing" the same state, and the reconciler below distinguishes them.
		.filter(({ value }) => value !== undefined)
		.map(({ d, value }) => ({
			configId: config.id,
			nodeKey: d.nodeKey,
			slot: d.slot,
			path: d.path,
			value
		}))

	if (values.length)
		await db.insert(schema.pipelineConfigValues).values(values)

	return { configId: config.id, action: "created" }
}

/* ------------------------------------------------------------------ *
 * Reconciliation
 * ------------------------------------------------------------------ */

export interface ReconcileReport {
	configId: number
	name: string
	culled: Array<{ nodeKey: string; slot: string; path: string }>
	backfilled: Array<{ nodeKey: string; slot: string; path: string }>
}

/**
 * Bring every user config for a spec in line with a newly published version.
 *
 * The immutable shipped default is reconciled too, and first: it is the source
 * the back-fill reads from, so a default that had not yet learned about a new
 * parameter would back-fill nothing and leave every user config missing it.
 */
export async function reconcileConfigs(
	db: Db,
	specId: number,
	specVersionId: number,
	specSlug: string
): Promise<ReconcileReport[]> {
	await ensureDefaultConfig(db, specId, specVersionId, specSlug)

	const decls = await declarations(db, specVersionId)
	const declByAddr = new Map(
		decls.map((d) => [addr(d.nodeKey, d.slot, d.path), d])
	)
	const refs = await refDefaults(db, specId, specSlug, decls)

	const configs = await db
		.select()
		.from(schema.pipelineConfigs)
		.where(eq(schema.pipelineConfigs.specId, specId))
		.orderBy(asc(schema.pipelineConfigs.id))

	// Reconcile the shipped default first, then everything derived from it.
	const ordered = [...(configs as any[])].sort(
		(a, b) => Number(!!b.isImmutable) - Number(!!a.isImmutable)
	)

	const defaults = new Map<string, { value: unknown }>()
	const reports: ReconcileReport[] = []

	for (const config of ordered) {
		const rows = await db
			.select()
			.from(schema.pipelineConfigValues)
			.where(eq(schema.pipelineConfigValues.configId, config.id))

		const present = new Set((rows as any[]).map(addrOf))
		const report: ReconcileReport = {
			configId: config.id,
			name: config.name,
			culled: [],
			backfilled: []
		}

		// ── cull: values whose address the new version no longer declares ──
		const orphaned = (rows as any[]).filter(
			(r) => !declByAddr.has(addrOf(r))
		)
		if (orphaned.length) {
			await db.insert(schema.pipelineConfigNotices).values(
				orphaned.map((r) => ({
					configId: config.id,
					kind: "culled",
					nodeKey: r.nodeKey,
					slot: r.slot,
					path: r.path ?? "",
					label: null,
					previousValue: r.value,
					specVersionId
				}))
			)
			await db.delete(schema.pipelineConfigValues).where(
				inArray(
					schema.pipelineConfigValues.id,
					orphaned.map((r) => r.id)
				)
			)
			report.culled = orphaned.map((r) => ({
				nodeKey: r.nodeKey,
				slot: r.slot,
				path: r.path ?? ""
			}))
		}

		// ── back-fill: addresses this config has never held a value for ──
		const missing = decls.filter(
			(d) => !present.has(addr(d.nodeKey, d.slot, d.path))
		)
		const additions: any[] = []
		for (const d of missing) {
			const key = addr(d.nodeKey, d.slot, d.path)
			const fromDefault = defaults.get(key)
			// The shipped row for a reference slot, third in line: the config
			// this one derives from, then the author's literal, then what core
			// ships. Without the last, a *newly declared* reference back-filled
			// nothing — `authorDefault` is `undefined` for every ref — and the
			// setting arrived on upgraded installs with no row behind it.
			const value = fromDefault
				? fromDefault.value
				: (d.authorDefault ?? refs.get(key))
			if (value === undefined) continue
			additions.push({
				configId: config.id,
				nodeKey: d.nodeKey,
				slot: d.slot,
				path: d.path,
				value
			})
		}

		if (additions.length) {
			await db.insert(schema.pipelineConfigValues).values(additions)
			await db.insert(schema.pipelineConfigNotices).values(
				additions.map((a) => ({
					configId: config.id,
					kind: "backfilled",
					nodeKey: a.nodeKey,
					slot: a.slot,
					path: a.path,
					previousValue: null,
					specVersionId
				}))
			)
			report.backfilled = additions.map((a) => ({
				nodeKey: a.nodeKey,
				slot: a.slot,
				path: a.path
			}))
		}

		// The shipped default, now reconciled, is what later configs back-fill
		// from — so a new parameter reaches a user's copy carrying the value the
		// author shipped rather than the bare declaration.
		if (config.isImmutable && !defaults.size) {
			const fresh = await db
				.select()
				.from(schema.pipelineConfigValues)
				.where(eq(schema.pipelineConfigValues.configId, config.id))
			for (const r of fresh as any[])
				defaults.set(addrOf(r), { value: r.value })
		}

		if (report.culled.length || report.backfilled.length)
			reports.push(report)
	}

	return reports
}

/** Notices a person has not been shown yet, newest first. */
export async function pendingNotices(db: Db, configId: number) {
	return await db
		.select()
		.from(schema.pipelineConfigNotices)
		.where(
			and(
				eq(schema.pipelineConfigNotices.configId, configId),
				// IS NULL, not `= NULL` — the latter is never true in SQL, so the
				// list would come back empty and the notices would never be shown.
				isNull(schema.pipelineConfigNotices.acknowledgedAt)
			)
		)
		.orderBy(asc(schema.pipelineConfigNotices.id))
}

/* ------------------------------------------------------------------ *
 * Which config a scope has selected
 * ------------------------------------------------------------------ */

/**
 * The scopes that may select a config (12 §2 as simplified 2026-08-24): the
 * session's own choice, else the instance default. There is no user layer.
 */
export type SelectionScope = "session" | "instance"

export interface SelectedConfig {
	configId: number
	name: string
	/** Where the selection came from — `shipped` when nothing selected anything. */
	source: SelectionScope | "shipped"
}

/**
 * The shipped, immutable default for a spec.
 *
 * Found by `seedKey` rather than by `isDefault`, because a user may well mark
 * one of their own copies as their default and the fallback must still land on
 * core's.
 */
async function shippedDefault(db: Db, specId: number, specSlug: string) {
	const [byKey] = await db
		.select()
		.from(schema.pipelineConfigs)
		.where(
			eq(schema.pipelineConfigs.seedKey, `pipeline-default:${specSlug}`)
		)
		.limit(1)
	if (byKey) return byKey

	// An instance whose shipped row was somehow removed still has to resolve to
	// something, and any immutable config for the spec is closer to right than
	// nothing at all.
	const [fallback] = await db
		.select()
		.from(schema.pipelineConfigs)
		.where(
			and(
				eq(schema.pipelineConfigs.specId, specId),
				eq(schema.pipelineConfigs.isImmutable, true)
			)
		)
		.limit(1)
	return fallback
}

/**
 * Which config applies, for this asker, on this pipeline.
 *
 * session → instance → whatever core shipped. The last step is the one that
 * makes the rest safe to be optional: a scope that has never chosen, a scope
 * whose choice was deleted (the FK nulls it), and a brand-new namespace all
 * resolve to the shipped default rather than to nothing. No user step (ruled
 * 2026-08-24): a person's choice of config is made per session, or it is the
 * instance's.
 *
 * The seven `system_settings.default_*_config_id` columns this replaces could
 * express only the instance layer, and only for the namespaces core happened to
 * ship a column for.
 */
export async function resolveSelectedConfig(
	db: Db,
	specId: number,
	specSlug: string,
	viewer: { sessionId?: number } = {}
): Promise<SelectedConfig | null> {
	const rows = await db
		.select()
		.from(schema.pipelineConfigSelections)
		.where(eq(schema.pipelineConfigSelections.specId, specId))

	const at = (kind: SelectionScope, id: number) =>
		(rows as any[]).find(
			(r) =>
				r.scopeKind === kind && r.scopeId === id && r.configId != null
		)?.configId as number | undefined

	const chain: Array<[SelectionScope, number | undefined]> = [
		["session", viewer.sessionId],
		["instance", 0]
	]

	for (const [kind, id] of chain) {
		if (id == null) continue
		const configId = at(kind, id)
		if (configId == null) continue
		// Confirm the row is still there and still belongs to this spec. The FK
		// covers deletion; this covers a selection carried across a spec change.
		const [config] = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.id, configId))
			.limit(1)
		if (config?.specId === specId)
			return { configId: config.id, name: config.name, source: kind }
	}

	const shipped = await shippedDefault(db, specId, specSlug)
	return shipped
		? { configId: shipped.id, name: shipped.name, source: "shipped" }
		: null
}

/**
 * Record a scope's choice of config.
 *
 * Refuses a config belonging to another pipeline rather than storing it and
 * resolving past it later: a selection that silently does nothing is the
 * hardest kind of configuration bug to see, because every screen shows the
 * value the user picked and the run uses something else.
 */
export async function selectConfig(
	db: Db,
	specId: number,
	scope: SelectionScope,
	scopeId: number,
	configId: number | null,
	updatedBy?: number
): Promise<void> {
	if (configId != null) {
		const [config] = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.id, configId))
			.limit(1)
		if (!config) throw new Error(`no pipeline config with id ${configId}.`)
		if (config.specId !== specId)
			throw new Error(
				`config '${config.name}' belongs to a different pipeline. ` +
					`Configs are namespaced to the pipeline they were written for, ` +
					`so one cannot be selected for another.`
			)
	}

	const now = new Date()
	await db
		.insert(schema.pipelineConfigSelections)
		.values({
			specId,
			scopeKind: scope,
			scopeId,
			configId,
			updatedBy,
			updatedAt: now
		})
		.onConflictDoUpdate({
			target: [
				schema.pipelineConfigSelections.specId,
				schema.pipelineConfigSelections.scopeKind,
				schema.pipelineConfigSelections.scopeId
			],
			set: { configId, updatedBy, updatedAt: now }
		})
}

/* ------------------------------------------------------------------ *
 * Named-config CRUD
 *
 * A pipeline is the backbone; a *configuration* is what someone actually
 * tunes and keeps. Until now the only verb was `selectConfig` — you could
 * choose between the shipped default and whatever the migration happened to
 * write, and nothing could make a second one. That makes the builder a
 * read-only screen with a dropdown of one, and it makes every experiment a
 * destructive edit of the thing you were happy with.
 * ------------------------------------------------------------------ */

export class ConfigNotFoundError extends Error {}
export class ConfigNotUsableError extends Error {}

export interface ConfigRecord {
	id: number
	specId: number
	name: string
	isImmutable: boolean
	isDefault: boolean
}

/** Trimmed, non-empty, and not already taken on this pipeline. */
async function assertNameFree(
	db: Db,
	specId: number,
	name: string,
	exceptId?: number
): Promise<string> {
	const clean = name.trim()
	if (!clean) throw new ConfigNotUsableError("A configuration needs a name.")
	const clash = (
		await db
			.select()
			.from(schema.pipelineConfigs)
			.where(
				and(
					eq(schema.pipelineConfigs.specId, specId),
					eq(schema.pipelineConfigs.name, clean)
				)
			)
	).find((c: any) => c.id !== exceptId)
	if (clash)
		throw new ConfigNotUsableError(
			`This pipeline already has a configuration called '${clean}'.`
		)
	return clean
}

async function configRow(db: Db, configId: number) {
	const [row] = await db
		.select()
		.from(schema.pipelineConfigs)
		.where(eq(schema.pipelineConfigs.id, configId))
		.limit(1)
	if (!row)
		throw new ConfigNotFoundError("That configuration no longer exists.")
	return row as any
}

export async function createConfig(
	db: Db,
	specId: number,
	name: string
): Promise<ConfigRecord> {
	const clean = await assertNameFree(db, specId, name)
	const [row] = await db
		.insert(schema.pipelineConfigs)
		.values({ specId, name: clean })
		.returning()
	return row as ConfigRecord
}

/**
 * A copy, values and all.
 *
 * Copying the values is the point: duplicating a configuration you like and
 * changing one thing is the whole workflow, and a duplicate that started empty
 * would silently inherit the *defaults* instead of what you were looking at.
 */
export async function duplicateConfig(
	db: Db,
	configId: number,
	name: string
): Promise<ConfigRecord> {
	const source = await configRow(db, configId)
	const clean = await assertNameFree(db, source.specId, name)

	const [copy] = await db
		.insert(schema.pipelineConfigs)
		.values({ specId: source.specId, name: clean })
		.returning()

	const values = await db
		.select()
		.from(schema.pipelineConfigValues)
		.where(eq(schema.pipelineConfigValues.configId, source.id))

	if (values.length)
		await db.insert(schema.pipelineConfigValues).values(
			(values as any[]).map((v) => ({
				configId: (copy as any).id,
				nodeKey: v.nodeKey,
				slot: v.slot,
				path: v.path,
				value: v.value
			}))
		)

	return copy as ConfigRecord
}

export async function renameConfig(
	db: Db,
	configId: number,
	name: string
): Promise<void> {
	const row = await configRow(db, configId)
	if (row.isImmutable)
		throw new ConfigNotUsableError(
			`'${row.name}' is one of the configurations Serene Pub ships, so its ` +
				`name stays. Duplicate it to make one that is yours.`
		)
	const clean = await assertNameFree(db, row.specId, name, row.id)
	await db
		.update(schema.pipelineConfigs)
		.set({ name: clean, updatedAt: new Date() })
		.where(eq(schema.pipelineConfigs.id, row.id))
}

/**
 * Values go with it, and any selection pointing at it falls back.
 *
 * `pipeline_config_values.config_id` cascades and
 * `pipeline_config_selections.config_id` is `set null`, so a session or user that
 * had this one chosen resolves the pipeline's default afterwards rather than
 * breaking. That is the behaviour we want and it is the schema's, not
 * something re-implemented here — but it is worth saying out loud, because
 * "delete the thing three sessions are using" reads alarming until you know.
 */
export async function deleteConfig(db: Db, configId: number): Promise<void> {
	const row = await configRow(db, configId)
	if (row.isImmutable)
		throw new ConfigNotUsableError(
			`'${row.name}' is one of the configurations Serene Pub ships, so it ` +
				`stays. It is the fallback the others resolve through.`
		)
	if (row.isDefault)
		throw new ConfigNotUsableError(
			`'${row.name}' is this pipeline's default. Make another one the ` +
				`default first, then delete this.`
		)
	await db
		.delete(schema.pipelineConfigs)
		.where(eq(schema.pipelineConfigs.id, row.id))
}
