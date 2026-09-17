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
 * It is immutable because it is the thing every other config is *derived from*
 * and reconciled against. Editing the shipped default in place would silently
 * redefine what "back to defaults" means for everyone who had not touched it,
 * which is the same failure pinning a type version prevents. Customizing is
 * duplicating.
 *
 * ## Who owns one (R8)
 *
 * An administrator, and nobody else. There is no owner column and there never
 * was one: an administrator curates which configurations exist and everyone
 * else *selects* among the ones on offer, which is why the CRUD below takes no
 * viewer — the authorization lives at the socket, where the viewer is, and the
 * curation rule (`enabled`) is applied by `selectNamedConfig` and by the panel
 * read. So the "user" in what follows is whoever tuned the configuration, and
 * that is always an administrator.
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
 *
 * ⚠ **"A value the user set" now means a row that is a DEVIATION** (ruled
 * 2026-09-10). A row holding exactly what the current declaration declares is
 * not a decision anybody made — it is what materializing every declared value
 * at seed time used to leave behind — so the reconcile sweeps it, and the
 * config inherits the declaration from then on. The asymmetry above is
 * unchanged for every row that differs; what changed is that a config no longer
 * carries a copy of the answer it was going to inherit anyway. See
 * `config/deviations.ts` for the rule and what follows from it, and
 * `drizzle/0115` for the migration that first applies it.
 */

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { isDeviation } from "$lib/server/pipelines/config/deviations"
import { presetConfigForSpec } from "$lib/server/pipelines/entities/presetBindings"
import {
	declarations,
	humanizeCamel,
	type Decl
} from "$lib/server/pipelines/config/panel"
import { defaultPromptFor } from "$lib/server/pipelines/boot/seedPrompts"
import { promptPoolKeyFor } from "$lib/server/pipelines/entities/promptPool"
import { defaultVariableTemplateFor } from "$lib/server/pipelines/boot/seedVariableTemplates"
import { defaultContextTemplateFor } from "$lib/server/pipelines/boot/seedContextTemplates"
import { defaultEngineOf } from "$lib/shared/pipelines/templateEngines"

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
 *
 * `presetValues` is read by the `sampling-ref` branch alone, and only there
 * because sampling is the one reference a document ADDRESSES rather than
 * inherits: there is no per-node-type sampling pool for core to resolve a
 * default out of, so the row a stage runs on is whichever one the author named.
 */
async function refDefaults(
	db: Db,
	specId: number,
	specSlug: string,
	decls: Decl[],
	presetValues: Map<string, unknown>
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
	// Per *seed key*: the same shipped row answers every stage that named it,
	// and the adventure preset names one row from two stages.
	const samplings = new Map<string, number | null>()

	for (const d of decls) {
		const key = addr(d.nodeKey, d.slot, d.path)
		if (d.control === "prompts-ref" && d.nodeDefinitionId) {
			const pool = promptPoolKeyFor(d.nodeDefinitionId, d.slot)
			if (!prompts.has(pool))
				prompts.set(
					pool,
					await defaultPromptFor(db, d.nodeDefinitionId, d.slot, {
						id: specId,
						slug: specSlug
					})
				)
			const id = prompts.get(pool)
			if (id != null) out.set(key, id)
			continue
		}
		if (d.control === "context-template-ref" && d.nodeDefinitionId) {
			// The engine is half the template pool now, so it is half this
			// cache key too. Keyed on the node type alone, a node declaring
			// another language would be handed whichever engine's row the first
			// node of that type happened to resolve — the shipped config would
			// then point that slot at Handlebars source, and it would render as
			// raw markup rather than fail.
			//
			// The slot's FIRST accepted engine, not the union: a default is one
			// row, and a slot that accepts two languages still ships one.
			const engine = defaultEngineOf(d)
			const pool = `${d.nodeDefinitionId}#${engine}`
			if (!templates.has(pool))
				templates.set(
					pool,
					await defaultContextTemplateFor(db, d.nodeDefinitionId, engine)
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
			continue
		}
		if (d.control === "sampling-ref") {
			const seedKey = samplingSeedKeyOf(presetValues.get(key))
			if (!seedKey) continue
			if (!samplings.has(seedKey))
				samplings.set(seedKey, await samplingIdFor(db, seedKey))
			const id = samplings.get(seedKey)
			if (id == null) {
				// Said out loud and then left unset, rather than thrown. A
				// throw here takes every OTHER pipeline's configuration with
				// it, because `reconcilePublishedConfigs` walks specs this
				// instance does not control; an unset Sampling slot is the
				// state every stage was in before a document could name one.
				console.warn(
					`[pipelines] ${specSlug}: no sampling config is seeded as ` +
						`"${seedKey}", so ${d.nodeKey}'s Sampling slot ships unset`
				)
				continue
			}
			out.set(key, id)
		}
	}
	return out
}

/**
 * The seeded row an author preset named for a `sampling` slot, if it named one.
 *
 * A config value at a sampling address is an integer `sampling_configs.id`
 * assigned by an identity sequence, so the number differs per install and a
 * shipped document cannot write one. `{ seedKey: 'sampling-background' }` is
 * what a document writes instead, and it is the only accepted spelling: a bare
 * string would be indistinguishable from a name, and a bare number is already
 * the id an admin's own selection stores.
 */
function samplingSeedKeyOf(value: unknown): string | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null
	const seedKey = (value as { seedKey?: unknown }).seedKey
	return typeof seedKey === "string" && seedKey ? seedKey : null
}

/** The row one seed key names, or null where this install has no such row. */
async function samplingIdFor(db: Db, seedKey: string): Promise<number | null> {
	const [row] = await db
		.select({ id: schema.samplingConfigs.id })
		.from(schema.samplingConfigs)
		.where(eq(schema.samplingConfigs.seedKey, seedKey))
		.limit(1)
	return row?.id ?? null
}

/**
 * The default author preset: its label, and its values keyed by address.
 *
 * Read by `ensureDefaultConfig`, which projects them, and by `reconcileConfigs`,
 * which resolves the sampling references among them. Both read it through this,
 * so the two cannot come to disagree about what the author shipped.
 */
async function presetValuesFor(
	db: Db,
	specVersionId: number
): Promise<{ label: string | null; values: Map<string, unknown> }> {
	const out = new Map<string, unknown>()

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
	if (!preset) return { label: null, values: out }

	const rows = await db
		.select()
		.from(schema.pipelinePresetValues)
		.where(eq(schema.pipelinePresetValues.presetId, preset.id))
	for (const r of rows as any[]) {
		out.set(addrOf(r), r.value)
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
				if (!out.has(key)) out.set(key, value)
			}
	}
	return { label: preset.label ?? null, values: out }
}

/**
 * Guarantee the invariant for one spec: a default, immutable config exists.
 *
 * Seeded from the document's default author preset where it ships one, and from
 * the declared defaults otherwise — which is not a fallback so much as the same
 * thing said twice: an author preset *is* a set of declared values, and a
 * pipeline that ships none has exactly its declarations.
 *
 * Idempotent, and matched on `seedKey` rather than on name or id. An
 * administrator is free to rename the copies; the shipped one has to stay
 * findable regardless.
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
	const preset = await presetValuesFor(db, specVersionId)
	const presetValues = preset.values

	const [config] = await db
		.insert(schema.pipelineConfigs)
		.values({
			specId,
			seedKey,
			name: preset.label ?? "Default",
			isImmutable: true,
			isDefault: true
		})
		.returning()

	const refs = await refDefaults(db, specId, specSlug, decls, presetValues)

	const values = decls
		.map((d) => {
			const key = addr(d.nodeKey, d.slot, d.path)
			// A seed reference is the AUTHOR'S spelling of a row id, so what
			// lands in the config is `refDefaults`' resolution of it and never
			// the reference itself: one that resolved to nothing leaves the
			// slot unset, where falling through to the preset would store
			// `{ seedKey: ... }` at an address every reader treats as an
			// integer.
			// Every other slot keeps the preset on top of the shipped row,
			// which is what a document setting its own template relies on.
			const seedRef =
				d.control === "sampling-ref" &&
				samplingSeedKeyOf(presetValues.get(key)) !== null
			const value = seedRef
				? refs.get(key)
				: presetValues.has(key)
					? presetValues.get(key)
					: (refs.get(key) ?? d.authorDefault)
			return { d, value }
		})
		// A declaration with no default and no preset value is a field the author
		// left open. Writing a NULL row for it would make "never set" and "set to
		// nothing" the same state, and the reconciler below distinguishes them.
		.filter(({ value }) => value !== undefined)
		// And the rule itself (2026-09-10): a value that IS the declaration is
		// not a deviation, so it gets no row and the config inherits it.
		//
		// ⚠ This does not empty the shipped config. What survives is everything
		// the declaration cannot supply: every `*-ref` (no author default at
		// all — the whole of `refs` above) and every author-preset value that
		// differs from the declared one. `core:spec/generate-image` is the case
		// to keep in mind: its default preset sets `render|settings|review` to
		// `on` where the substrate's `settings` slot — projected from the
		// definition's `reviewDefault` (R-9), which that oracle leaves unset —
		// says `off`, so that row is a
		// deviation and stays. Shipping a preset IS departing from the bare
		// declaration; the row is how it says so.
		.filter(({ d, value }) => isDeviation(d, value))
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
 * What a culled address was CALLED, from whichever earlier version declared it.
 *
 * A cull is by definition an address the new version does not declare, so the
 * label cannot come from the declarations the reconciler is holding — and a
 * notice that cannot name what was lost is barely better than the silence it
 * exists to replace ("a setting was removed" asks the reader to diff two
 * pipelines in their head). The version that *did* declare it still has its
 * nodes, so its `Decl` still has its label: that is the one authoritative
 * source, and it is read here.
 *
 * It is not always reachable, and the limit is worth stating rather than
 * hiding. A pre-release re-projection (0186, 0191) DELETES the type registry
 * row and lets boot sync write the new declarations at the same pinned
 * version — so the old label is gone from the database entirely, and no query
 * can recover it. Those culls fall back to the address, humanized the way the
 * panel humanizes every other key. After 0.6.0 ships, a changed type is a new
 * version rather than a rewrite of the row (13 §12b), and the label survives.
 *
 * Read once per reconcile and only when something was actually culled: it is a
 * declaration walk per version, which is affordable at publish time and would
 * not be on every boot.
 */
async function priorDeclaredLabels(
	db: Db,
	specId: number,
	specVersionId: number
): Promise<Map<string, string>> {
	const out = new Map<string, string>()
	const versions = await db
		.select()
		.from(schema.pipelineSpecVersions)
		.where(eq(schema.pipelineSpecVersions.specId, specId))
		// Newest first, and first spelling wins: a label the version before
		// last changed is the one the user was looking at when they set the
		// value, not whatever the option was called three versions ago.
		.orderBy(desc(schema.pipelineSpecVersions.id))

	for (const v of versions as any[]) {
		if (v.id === specVersionId) continue
		for (const d of await declarations(db, v.id)) {
			const key = addr(d.nodeKey, d.slot, d.path)
			if (!out.has(key)) out.set(key, d.label)
		}
	}
	return out
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
	// The preset is read here as well as inside `ensureDefaultConfig`, and it has
	// to be: that one returns the moment the shipped config exists, so on every
	// boot after the first it is this call that carries an author's sampling
	// reference to a config written before the document named one.
	const { values: presetValues } = await presetValuesFor(db, specVersionId)
	const refs = await refDefaults(db, specId, specSlug, decls, presetValues)

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

	// Built on the first cull and shared by every config after it — the
	// orphaned addresses are the same ones in each, so re-walking the older
	// versions per config would answer the same question a dozen times.
	let priorLabels: Map<string, string> | null = null
	const labelForCulled = async (r: {
		nodeKey: string
		slot: string
		path?: string | null
	}) => {
		if (!priorLabels)
			priorLabels = await priorDeclaredLabels(db, specId, specVersionId)
		// The address is the fallback, not a placeholder: `scanDepth` reads as
		// "Scan Depth", which is what the control was called even where the
		// declaration that said so is gone. The empty path is a whole-slot
		// value (a connection, a template) and names its slot instead.
		return priorLabels.get(addrOf(r)) ?? humanizeCamel(r.path || r.slot)
	}

	for (const config of ordered) {
		const rows = await db
			.select()
			.from(schema.pipelineConfigValues)
			.where(eq(schema.pipelineConfigValues.configId, config.id))

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
			const labels = new Map<string, string>()
			for (const r of orphaned)
				labels.set(addrOf(r), await labelForCulled(r))
			await db.insert(schema.pipelineConfigNotices).values(
				orphaned.map((r) => ({
					configId: config.id,
					kind: "culled",
					nodeKey: r.nodeKey,
					slot: r.slot,
					path: r.path ?? "",
					label: labels.get(addrOf(r)),
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

		// ── sweep: rows that hold exactly what the declaration declares ──
		//
		// Not a cull and deliberately not reported as one. A cull loses an
		// answer — the address is gone and the value with it — which is why it
		// leaves a notice naming what it took. This loses nothing: the address
		// still exists, the declaration still supplies the same number, and
		// every reader resolves it at the `author` layer the moment the row is
		// gone. A notice per swept row would be a paragraph telling a person
		// that a setting they never touched still says what it always said, on
		// the one boot where every install has hundreds of them.
		//
		// ⚠ Runs on **every** boot rather than once behind a flag, and that is
		// the point rather than a shortcut. `writeOption` cannot create one of
		// these any more, so on a healthy install it matches nothing; what it
		// catches is the two ways one can still appear — a database seeded by a
		// build that materialized everything, and a declared default that MOVED
		// underneath a row holding the old one. The second is what `0102`,
		// `0110` and `0111` each hand-swept with a bespoke DELETE, and it is
		// exactly the case the ruling makes safe.
		const inert = (rows as any[]).filter((r) => {
			const d = declByAddr.get(addrOf(r))
			return d && !isDeviation(d, r.value)
		})
		if (inert.length)
			await db.delete(schema.pipelineConfigValues).where(
				inArray(
					schema.pipelineConfigValues.id,
					inert.map((r) => r.id)
				)
			)

		// What the config still holds, after both removals. Computed here
		// rather than off `rows` so a swept address counts as absent — the
		// back-fill below then re-examines it and, finding the declaration's own
		// value, writes nothing.
		const gone = new Set([
			...orphaned.map((r) => r.id),
			...inert.map((r) => r.id)
		])
		const present = new Set(
			(rows as any[]).filter((r) => !gone.has(r.id)).map(addrOf)
		)

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
			// The rule again, on the other side of the same coin: an address
			// this config never held, whose answer is the declaration's own, is
			// already answered — writing it would re-materialize precisely what
			// the sweep above just removed, on the same boot. What still lands
			// here is what the declaration cannot supply: the `*-ref` rows
			// (`refs`) and whatever the shipped default deviates by.
			if (!isDeviation(d, value)) continue
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
					// Straight off the declaration that arrived, which is the
					// half of this that IS reachable — a back-fill names a
					// control the pipeline still has. Left null it would render
					// as namelessly as the cull did, in the same list.
					label: declByAddr.get(addr(a.nodeKey, a.slot, a.path))
						?.label,
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

/**
 * Mark notices seen — one of them, or every pending one for the config.
 *
 * A dismissal has to outlive the tab that made it, so it is a column on the
 * row rather than anything the client remembers: `acknowledged_at` is what
 * `pendingNotices` filters on, so acknowledging IS the thing that stops it
 * coming back. Already-acknowledged rows are left alone, which keeps the
 * timestamp honest about when the person actually saw it.
 *
 * Scoped by `configId` as well as by id, always. The id arrives from a client
 * and a notice id is a small integer somebody can guess; without the pairing,
 * dismissing your own notice would be indistinguishable from dismissing
 * somebody else's configuration's.
 *
 * Returns how many rows it moved, so a caller can tell "dismissed" from "that
 * one was already gone".
 */
export async function acknowledgeNotices(
	db: Db,
	configId: number,
	noticeId?: number
): Promise<number> {
	const rows = await db
		.update(schema.pipelineConfigNotices)
		.set({ acknowledgedAt: new Date() })
		.where(
			and(
				eq(schema.pipelineConfigNotices.configId, configId),
				isNull(schema.pipelineConfigNotices.acknowledgedAt),
				...(noticeId != null
					? [eq(schema.pipelineConfigNotices.id, noticeId)]
					: [])
			)
		)
		.returning({ id: schema.pipelineConfigNotices.id })
	return (rows as any[]).length
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
	/**
	 * Where the selection came from — `preset` when the session's preset named
	 * it, `shipped` when nothing selected anything.
	 */
	source: SelectionScope | "preset" | "shipped"
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
 * session → **preset** → instance → whatever core shipped. The last step is
 * the one that makes the rest safe to be optional: a scope that has never
 * chosen, a scope whose choice was deleted (the FK nulls it), and a brand-new
 * namespace all resolve to the shipped default rather than to nothing. No user
 * step (ruled 2026-08-24): a person's choice of config is made per session, or
 * it is the instance's.
 *
 * The preset layer (added 2026-09-10, closing a defect: the blob was validated
 * at write and read by nothing) sits where it does because of what each
 * neighbour means. Above it, the session's own row is a choice made *about this
 * session* and must survive the bundle it started from. Below it, the instance
 * default is what an install does when nobody said otherwise — and "started
 * from a preset that names a configuration" is somebody saying otherwise.
 *
 * Keyed on the SPEC rather than on an event, because this function is handed a
 * spec and a session and no event at all — and must stay that way: it is also
 * the answer for the open `session-action` slot, whose pipelines a preset can
 * only reach through `configSelections`, having no event binding to carry a
 * config on.
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

	/**
	 * The preset's answer is an id already, not a selection row — it is stored
	 * on the preset rather than in `pipeline_config_selections`, so it joins
	 * the chain as a value rather than through `at`.
	 */
	const fromPreset = await presetConfigForSpec(db, {
		sessionId: viewer.sessionId,
		specSlug
	})

	const chain: Array<[SelectedConfig["source"], number | undefined]> = [
		[
			"session",
			viewer.sessionId != null
				? at("session", viewer.sessionId)
				: undefined
		],
		["preset", fromPreset ?? undefined],
		["instance", at("instance", 0)]
	]

	for (const [kind, configId] of chain) {
		if (configId == null) continue
		// Confirm the row is still there and still belongs to this spec. The FK
		// covers deletion; this covers a selection — or a preset's choice —
		// carried across a spec change. Either way it falls through to the next
		// layer rather than pinning values from another pipeline.
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
 * A copy, deviations and all.
 *
 * Copying the values is the point: duplicating a configuration you like and
 * changing one thing is the whole workflow. Under the old model a duplicate
 * that started empty would have inherited the bare *declarations* rather than
 * what you were looking at; under this one an empty duplicate inherits exactly
 * that — the declaration — which is what the source resolves to at every
 * address it has no row for. So copying the rows is still the whole job, and
 * the copy is now the same size as the difference.
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

	// Filtered rather than copied wholesale, so a duplicate made *before* the
	// boot sweep has reached the source does not carry a materialized default
	// forward into a fresh config — where it would look for all the world like a
	// choice somebody made while duplicating. On a swept source this matches
	// everything and costs one declaration walk.
	const [spec] = await db
		.select({ activeVersionId: schema.pipelineSpecs.activeVersionId })
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.id, source.specId))
		.limit(1)
	const declByAddr = spec?.activeVersionId
		? new Map(
				(await declarations(db, spec.activeVersionId)).map((d) => [
					addr(d.nodeKey, d.slot, d.path),
					d
				])
			)
		: new Map<string, Decl>()

	const carried = (values as any[]).filter((v) => {
		const d = declByAddr.get(addrOf(v))
		// An address this version does not declare is carried as-is: the
		// reconciler culls it with a notice, which is where that decision is
		// made and reported. Swallowing it here would lose the notice.
		return !d || isDeviation(d, v.value)
	})

	if (carried.length)
		await db.insert(schema.pipelineConfigValues).values(
			carried.map((v) => ({
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
