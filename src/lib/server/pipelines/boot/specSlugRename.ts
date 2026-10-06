/**
 * ⏳ **Ten core pipelines take their new ids** (PLAN-catalogue-and-pipeline-names
 * C4 and C5, ruled 2026-10-05).
 *
 * Spec ids got a rule that day — `core:spec/<genre>-<what>` for a genre's
 * pipelines — and the ten that broke it were renamed in the catalogue with no
 * aliases: `create-chat` → `chat-create`, `respond` → `chat-respond`,
 * `narrate` → `chat-narrate`, `narrate-character` → `chat-side-character`,
 * `generate-image` → `chat-generate-image`, `create-guide` → `guide-create`
 * and `answer-form-<genre>` → `<genre>-answer-form` (×4). The seed publishes
 * by slug, so without this pass an install that ran an earlier build boots,
 * publishes ten NEW spec rows beside the old ones, leaves the old rows
 * published with every setting a person made on them, and refuses the boot
 * when the action specs claim their slash names twice. Owner: "As long as the
 * pipeline and configs update smoothly."
 *
 * What moves, in one transaction, before anything else at boot reads a spec:
 *
 *  1. **The spec row**, renamed in place (`pipeline_specs.slug`), so every
 *     integer foreign key stays attached: versions, configs and their values,
 *     session overrides, config selections, rebinds and bindings. Core's rows
 *     only (`source_plugin_id` NULL).
 *  2. **Every stored string that names one** — a config's `seed_key`
 *     (`pipeline-default:<slug>`, `migrated:<slug>:<id>`,
 *     `plugin:<id>:<slug>#<config>`) and `included_actions`; a session
 *     preset's `bindings`, `config_selections`, `primary_slug` and
 *     `included_actions`; `pipeline_bindings.subject`,
 *     `session_functions.function_key` and `seen_actions.action_key` (action
 *     identities, `<slug>#<key>`); `pipeline_prompts.default_for_specs`;
 *     `plugins.disabled_swaps` (`<slug>#<node>#<definition>`); and
 *     `session_preset_notices`, whose rows the preset reconcile rebuilds only
 *     for enabled presets.
 *  3. **The shipped default configs are named "Default"** (C5): every
 *     `pipeline-default:` row, `is_default` and `is_immutable` — people cannot
 *     rename those — through `defaultConfigNameCandidates`, so a person's own
 *     config already called "Default" keeps its name and the shipped one
 *     takes the next free one.
 *
 * What stays as written: run history (`pipeline_runs.spec_slug`, receipts),
 * which names what ran; the stored versions, which are documents; and a
 * plugin's manifest, which is its author's.
 *
 * ## When the new id already has a row
 *
 * A database that booted this build before the pass existed — a development
 * one — holds both. The old row is merged into the new one and deleted: the
 * new row keeps its id and its pointer, and the old one's dependents move
 * across. Where both hold the same address (a session's override of one
 * setting, a scope's selection, a rebind of one node, a binding of one
 * subject), the new row's wins, the `spritePickerMove` rule: it was made
 * later, under this build. The old row's versions stay as history, retired.
 * Its shipped default goes when the new row has its own (both were written
 * from the catalogue; a selection of it falls back to the shipped default by
 * foreign key, which is the same thing). A person's config keeps its name;
 * the shipped default yields one it holds, and a clash between two of a
 * person's configs numbers the moved one.
 *
 * Idempotent: a second boot finds no old slug and every default already
 * named. Delete this module once a release has shipped it.
 */

import { and, asc, eq, inArray, isNull, like, or } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defaultConfigNameCandidates } from "$lib/server/pipelines/config/named"

/** The ten renames, old id → new id. */
export const SPEC_SLUG_RENAMES: ReadonlyArray<readonly [string, string]> = [
	["core:spec/create-chat", "core:spec/chat-create"],
	["core:spec/respond", "core:spec/chat-respond"],
	["core:spec/narrate", "core:spec/chat-narrate"],
	["core:spec/narrate-character", "core:spec/chat-side-character"],
	["core:spec/generate-image", "core:spec/chat-generate-image"],
	["core:spec/create-guide", "core:spec/guide-create"],
	["core:spec/answer-form-chat", "core:spec/chat-answer-form"],
	["core:spec/answer-form-adventure", "core:spec/adventure-answer-form"],
	["core:spec/answer-form-guide", "core:spec/guide-answer-form"],
	["core:spec/answer-form-lair", "core:spec/lair-answer-form"]
]

const NEW_SLUG = new Map(SPEC_SLUG_RENAMES)
const OLD_SLUGS = [...NEW_SLUG.keys()]

/**
 * An old id inside a longer string, at a slug's boundaries: the string's
 * start or a `:` before it (`pipeline-default:`, `migrated:`,
 * `plugin:<id>:`), and its end, a `#` or a `:` after it. Never a prefix match:
 * `core:spec/narrate` is not the start of `core:spec/narrate-character`, and
 * `acme.core:spec/respond` is not core's.
 */
const OLD_SLUG_IN = new RegExp(
	`(^|:)(${OLD_SLUGS.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?=$|[#:])`,
	"g"
)

/** `value` with every old id in it renamed. */
export const renamedIn = (value: string): string =>
	value.replace(
		OLD_SLUG_IN,
		(_, lead: string, old: string) => lead + NEW_SLUG.get(old)!
	)

/** A list of strings renamed, de-duplicated in order; null when nothing in it was renamed. */
const renamedList = (list: unknown): string[] | null => {
	if (!Array.isArray(list)) return null
	const out = list.map((v) => (typeof v === "string" ? renamedIn(v) : v))
	return out.some((v, i) => v !== list[i]) ? [...new Set(out)] : null
}

/** Every string anywhere in a JSON value renamed; the same value when none was. */
const renamedDeep = <T>(value: T): T => {
	if (typeof value === "string") return renamedIn(value) as T
	if (Array.isArray(value)) {
		const out = value.map(renamedDeep)
		return out.some((v, i) => v !== value[i]) ? (out as T) : value
	}
	if (value && typeof value === "object") {
		const entries = Object.entries(value).map(
			([k, v]) => [k, renamedDeep(v)] as const
		)
		return entries.some(
			([k, v]) => v !== (value as Record<string, unknown>)[k]
		)
			? (Object.fromEntries(entries) as T)
			: value
	}
	return value
}

/** `name 2`, `name 3`, … — for a person's config moved beside one of the same name. */
function* numbered(name: string): Generator<string, never> {
	for (let i = 2; ; i++) yield `${name} ${i}`
}

/** A text column holding an old id anywhere — a prefilter; `renamedIn` decides. */
const mentionsOld = (column: any) =>
	or(...OLD_SLUGS.map((s) => like(column, `%${s}%`)))

/** What one boot's rename did. */
export interface SpecSlugRenameReport {
	/** `old → new`, for each spec row renamed in place this boot. */
	renamed: string[]
	/** `old → new`, for each old row merged into a row the new id already had. */
	merged: string[]
	/** Rows whose stored strings were rewritten to the new ids. */
	rewritten: number
	/** Shipped default configs renamed to "Default" (C5). */
	defaultsRenamed: number
}

export async function renameSpecSlugs(db: Db): Promise<SpecSlugRenameReport> {
	const report: SpecSlugRenameReport = {
		renamed: [],
		merged: [],
		rewritten: 0,
		defaultsRenamed: 0
	}
	// One transaction, `tx` only: an outer-handle query awaited inside one
	// deadlocks PGlite.
	await db.transaction(async (tx: Db) => {
		const rows = await tx
			.select({
				id: schema.pipelineSpecs.id,
				slug: schema.pipelineSpecs.slug
			})
			.from(schema.pipelineSpecs)
			.where(
				and(
					isNull(schema.pipelineSpecs.sourcePluginId),
					inArray(schema.pipelineSpecs.slug, OLD_SLUGS)
				)
			)
		for (const row of rows) {
			const to = NEW_SLUG.get(row.slug)!
			const [current] = await tx
				.select({ id: schema.pipelineSpecs.id })
				.from(schema.pipelineSpecs)
				.where(eq(schema.pipelineSpecs.slug, to))
				.limit(1)
			if (current) {
				await mergeSpec(tx, row, { id: current.id, slug: to })
				report.merged.push(`${row.slug} → ${to}`)
			} else {
				await tx
					.update(schema.pipelineSpecs)
					.set({ slug: to })
					.where(eq(schema.pipelineSpecs.id, row.id))
				report.renamed.push(`${row.slug} → ${to}`)
			}
		}
		report.rewritten = await rewriteStoredSlugs(tx)
		report.defaultsRenamed = await nameShippedDefaults(tx)
	})

	const { renamed, merged, rewritten, defaultsRenamed } = report
	if (renamed.length || merged.length)
		console.log(
			`[pipelines] moved ${renamed.length + merged.length} core pipeline(s) to their new ids: ` +
				[...renamed, ...merged].join(", ") +
				(merged.length
					? ` (${merged.length} merged into a row the new id already had)`
					: "")
		)
	if (rewritten)
		console.log(
			`[pipelines] rewrote ${rewritten} stored reference(s) to the new pipeline ids`
		)
	if (defaultsRenamed)
		console.log(
			`[pipelines] named ${defaultsRenamed} shipped default config(s) "Default"`
		)
	return report
}

/**
 * Fold the old row into the row its new id already has (see the header):
 * everything the old one holds moves across unless the new one holds the
 * same address, and then the old row goes, taking what did not move with it.
 */
async function mergeSpec(
	tx: Db,
	from: { id: number; slug: string },
	into: { id: number; slug: string }
): Promise<void> {
	// Versions: history, kept under the surviving row and never its pointer.
	const have = new Set(
		(
			await tx
				.select({
					semver: schema.pipelineSpecVersions.semver,
					hash: schema.pipelineSpecVersions.canonicalHash
				})
				.from(schema.pipelineSpecVersions)
				.where(eq(schema.pipelineSpecVersions.specId, into.id))
		).map((v) => `${v.semver}\0${v.hash}`)
	)
	for (const v of await tx
		.select({
			id: schema.pipelineSpecVersions.id,
			semver: schema.pipelineSpecVersions.semver,
			hash: schema.pipelineSpecVersions.canonicalHash,
			status: schema.pipelineSpecVersions.status
		})
		.from(schema.pipelineSpecVersions)
		.where(eq(schema.pipelineSpecVersions.specId, from.id))) {
		if (have.has(`${v.semver}\0${v.hash}`)) continue
		await tx
			.update(schema.pipelineSpecVersions)
			.set({
				specId: into.id,
				...(v.status === "published" ? { status: "retired" } : {})
			})
			.where(eq(schema.pipelineSpecVersions.id, v.id))
	}

	// Configs.
	const intoConfigs = await tx
		.select({
			id: schema.pipelineConfigs.id,
			name: schema.pipelineConfigs.name,
			seedKey: schema.pipelineConfigs.seedKey
		})
		.from(schema.pipelineConfigs)
		.where(eq(schema.pipelineConfigs.specId, into.id))
	const fromConfigs = await tx
		.select({
			id: schema.pipelineConfigs.id,
			name: schema.pipelineConfigs.name,
			seedKey: schema.pipelineConfigs.seedKey
		})
		.from(schema.pipelineConfigs)
		.where(eq(schema.pipelineConfigs.specId, from.id))
		.orderBy(asc(schema.pipelineConfigs.id))
	const shipped = intoConfigs.find(
		(c) => c.seedKey === `pipeline-default:${into.slug}`
	)
	const holder = new Map(intoConfigs.map((c) => [c.name, c.id]))
	const taken = new Set([
		...intoConfigs.map((c) => c.name),
		...fromConfigs.map((c) => c.name)
	])
	const free = (candidates: Iterable<string>) => {
		for (const name of candidates)
			if (!taken.has(name)) {
				taken.add(name)
				return name
			}
		throw new Error("unreachable: the candidates are unbounded")
	}
	for (const c of fromConfigs) {
		if (shipped && c.seedKey === `pipeline-default:${from.slug}`) {
			await tx
				.delete(schema.pipelineConfigs)
				.where(eq(schema.pipelineConfigs.id, c.id))
			continue
		}
		let name = c.name
		const clash = holder.get(name)
		if (shipped && clash === shipped.id) {
			// The shipped default yields; `nameShippedDefaults` settles it.
			const moved = free(defaultConfigNameCandidates())
			await tx
				.update(schema.pipelineConfigs)
				.set({ name: moved })
				.where(eq(schema.pipelineConfigs.id, shipped.id))
			holder.set(moved, shipped.id)
		} else if (clash !== undefined) name = free(numbered(c.name))
		await tx
			.update(schema.pipelineConfigs)
			.set({ specId: into.id, name })
			.where(eq(schema.pipelineConfigs.id, c.id))
		holder.set(name, c.id)
	}

	// The three per-scope tables, each by its own address.
	const selections = schema.pipelineConfigSelections
	const selected = new Set(
		(
			await tx
				.select({ kind: selections.scopeKind, id: selections.scopeId })
				.from(selections)
				.where(eq(selections.specId, into.id))
		).map((s) => `${s.kind}\0${s.id}`)
	)
	for (const s of await tx
		.select({
			row: selections.id,
			kind: selections.scopeKind,
			id: selections.scopeId
		})
		.from(selections)
		.where(eq(selections.specId, from.id)))
		if (!selected.has(`${s.kind}\0${s.id}`))
			await tx
				.update(selections)
				.set({ specId: into.id })
				.where(eq(selections.id, s.row))

	const overrides = schema.pipelineNodeOverrides
	const overridden = new Set(
		(
			await tx
				.select()
				.from(overrides)
				.where(eq(overrides.specId, into.id))
		).map((o) =>
			[o.scopeKind, o.scopeId, o.nodeKey, o.slot, o.path].join("\0")
		)
	)
	for (const o of await tx
		.select()
		.from(overrides)
		.where(eq(overrides.specId, from.id)))
		if (
			!overridden.has(
				[o.scopeKind, o.scopeId, o.nodeKey, o.slot, o.path].join("\0")
			)
		)
			await tx
				.update(overrides)
				.set({ specId: into.id })
				.where(eq(overrides.id, o.id))

	const rebinds = schema.pipelineNodeRebinds
	const rebound = new Set(
		(
			await tx.select().from(rebinds).where(eq(rebinds.specId, into.id))
		).map((r) => [r.scopeKind, r.scopeId, r.nodeKey].join("\0"))
	)
	for (const r of await tx
		.select()
		.from(rebinds)
		.where(eq(rebinds.specId, from.id)))
		if (!rebound.has([r.scopeKind, r.scopeId, r.nodeKey].join("\0")))
			await tx
				.update(rebinds)
				.set({ specId: into.id })
				.where(eq(rebinds.id, r.id))

	// Bindings are addressed by subject, not spec, so they all move; a
	// subject both rows bind is settled with the other subjects below.
	await tx
		.update(schema.pipelineBindings)
		.set({ specId: into.id })
		.where(eq(schema.pipelineBindings.specId, from.id))
	// Grouping only, and `set null` on delete would lose it.
	await tx
		.update(schema.pipelinePrompts)
		.set({ createdForSpecId: into.id })
		.where(eq(schema.pipelinePrompts.createdForSpecId, from.id))
	await tx
		.update(schema.pipelineContextTemplates)
		.set({ createdForSpecId: into.id })
		.where(eq(schema.pipelineContextTemplates.createdForSpecId, from.id))

	await tx
		.delete(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.id, from.id))
}

/** Every stored string naming an old id, rewritten. Returns the rows changed. */
async function rewriteStoredSlugs(tx: Db): Promise<number> {
	let changed = 0

	// Configs: the seed key (unique) and the curated actions.
	const configs = schema.pipelineConfigs
	for (const c of await tx
		.select({
			id: configs.id,
			seedKey: configs.seedKey,
			includedActions: configs.includedActions
		})
		.from(configs)) {
		const patch: Partial<typeof configs.$inferInsert> = {}
		if (c.seedKey && renamedIn(c.seedKey) !== c.seedKey) {
			const seedKey = renamedIn(c.seedKey)
			const [holder] = await tx
				.select({ id: configs.id })
				.from(configs)
				.where(eq(configs.seedKey, seedKey))
				.limit(1)
			// Two rows for one marker (a `migrated:` config a development
			// database wrote under both ids): the person's row is kept, minus a
			// marker the other already carries.
			patch.seedKey = holder ? null : seedKey
		}
		const actions = renamedList(c.includedActions)
		if (actions) patch.includedActions = actions
		if (!Object.keys(patch).length) continue
		await tx.update(configs).set(patch).where(eq(configs.id, c.id))
		changed++
	}

	// Session presets: five columns, two of them maps.
	for (const p of await tx.select().from(schema.sessionPresets)) {
		const patch: Partial<typeof schema.sessionPresets.$inferInsert> = {}
		const bindings = (p.bindings ?? {}) as Record<
			string,
			{ spec: string; config?: number }
		>
		if (
			Object.values(bindings).some((b) => b?.spec && NEW_SLUG.has(b.spec))
		)
			patch.bindings = Object.fromEntries(
				Object.entries(bindings).map(([event, b]) => [
					event,
					b?.spec && NEW_SLUG.has(b.spec)
						? { ...b, spec: NEW_SLUG.get(b.spec)! }
						: b
				])
			)
		const selections = (p.configSelections ?? {}) as Record<string, number>
		if (Object.keys(selections).some((slug) => NEW_SLUG.has(slug))) {
			// A key under both ids keeps the new one's choice.
			const out: Record<string, number> = {}
			for (const [slug, id] of Object.entries(selections))
				if (!NEW_SLUG.has(slug)) out[slug] = id
			for (const [slug, id] of Object.entries(selections))
				if (NEW_SLUG.has(slug) && !(NEW_SLUG.get(slug)! in out))
					out[NEW_SLUG.get(slug)!] = id
			patch.configSelections = out
		}
		if (p.primarySlug && NEW_SLUG.has(p.primarySlug))
			patch.primarySlug = NEW_SLUG.get(p.primarySlug)!
		const actions = renamedList(p.includedActions)
		if (actions) patch.includedActions = actions
		// The swaps a session made from this preset starts with (`{ spec,
		// node, definition }`, `storedSwapsOf`).
		const defaults = p.defaults as { swaps?: unknown } | null
		if (
			Array.isArray(defaults?.swaps) &&
			defaults.swaps.some((w) => NEW_SLUG.has(w?.spec))
		)
			patch.defaults = {
				...defaults,
				swaps: defaults.swaps.map((w) =>
					NEW_SLUG.has(w?.spec)
						? { ...w, spec: NEW_SLUG.get(w.spec)! }
						: w
				)
			}
		if (!Object.keys(patch).length) continue
		// `updated_at` stays: the preset says what it said, under the new ids.
		await tx
			.update(schema.sessionPresets)
			.set({ ...patch, updatedAt: p.updatedAt })
			.where(eq(schema.sessionPresets.id, p.id))
		changed++
	}

	// The three action-identity columns, each unique within its owner: where
	// the new identity already has a row, that row wins and the old one goes.
	// A binding's enabled-when override is a person's predicate and may test
	// a value against an identity, so its strings are renamed with it.
	const bindings = schema.pipelineBindings
	for (const b of await tx.select().from(bindings)) {
		const subject = renamedIn(b.subject)
		const enabledWhen = renamedDeep(b.enabledWhen)
		if (subject === b.subject && enabledWhen === b.enabledWhen) continue
		changed++
		if (subject !== b.subject) {
			const [held] = await tx
				.select({ id: bindings.id })
				.from(bindings)
				.where(
					and(
						eq(bindings.scopeKind, b.scopeKind),
						eq(bindings.scopeId, b.scopeId),
						eq(bindings.genreId, b.genreId),
						eq(bindings.subject, subject)
					)
				)
				.limit(1)
			if (held) {
				await tx.delete(bindings).where(eq(bindings.id, b.id))
				continue
			}
		}
		await tx
			.update(bindings)
			.set({ subject, enabledWhen })
			.where(eq(bindings.id, b.id))
	}

	const functions = schema.sessionFunctions
	for (const f of await tx
		.select()
		.from(functions)
		.where(mentionsOld(functions.functionKey))) {
		const functionKey = renamedIn(f.functionKey)
		if (functionKey === f.functionKey) continue
		const [held] = await tx
			.select({ id: functions.id })
			.from(functions)
			.where(
				and(
					eq(functions.sessionId, f.sessionId),
					eq(functions.genreId, f.genreId),
					eq(functions.functionKey, functionKey)
				)
			)
			.limit(1)
		if (held) await tx.delete(functions).where(eq(functions.id, f.id))
		else
			await tx
				.update(functions)
				.set({ functionKey })
				.where(eq(functions.id, f.id))
		changed++
	}

	const seen = schema.seenActions
	for (const s of await tx
		.select()
		.from(seen)
		.where(mentionsOld(seen.actionKey))) {
		const actionKey = renamedIn(s.actionKey)
		if (actionKey === s.actionKey) continue
		const [held] = await tx
			.select({ id: seen.id })
			.from(seen)
			.where(
				and(eq(seen.userId, s.userId), eq(seen.actionKey, actionKey))
			)
			.limit(1)
		if (held) await tx.delete(seen).where(eq(seen.id, s.id))
		else await tx.update(seen).set({ actionKey }).where(eq(seen.id, s.id))
		changed++
	}

	// Lists of slugs and swap entries.
	for (const p of await tx
		.select({
			id: schema.pipelinePrompts.id,
			defaultForSpecs: schema.pipelinePrompts.defaultForSpecs
		})
		.from(schema.pipelinePrompts)) {
		const defaultForSpecs = renamedList(p.defaultForSpecs)
		if (!defaultForSpecs) continue
		await tx
			.update(schema.pipelinePrompts)
			.set({ defaultForSpecs })
			.where(eq(schema.pipelinePrompts.id, p.id))
		changed++
	}
	for (const p of await tx
		.select({
			id: schema.plugins.id,
			disabledSwaps: schema.plugins.disabledSwaps
		})
		.from(schema.plugins)) {
		const disabledSwaps = renamedList(p.disabledSwaps)
		if (!disabledSwaps) continue
		await tx
			.update(schema.plugins)
			.set({ disabledSwaps })
			.where(eq(schema.plugins.id, p.id))
		changed++
	}

	// The preset reconcile rewrites these for enabled presets every boot; a
	// disabled or withdrawn preset's notice would keep naming the old id.
	const notices = schema.sessionPresetNotices
	for (const n of await tx
		.select()
		.from(notices)
		.where(
			or(
				inArray(notices.boundSpec, OLD_SLUGS),
				inArray(notices.fallbackSpec, OLD_SLUGS)
			)
		)) {
		await tx
			.update(notices)
			.set({
				boundSpec: NEW_SLUG.get(n.boundSpec) ?? n.boundSpec,
				fallbackSpec:
					n.fallbackSpec === null
						? null
						: (NEW_SLUG.get(n.fallbackSpec) ?? n.fallbackSpec)
			})
			.where(eq(notices.id, n.id))
		changed++
	}

	return changed
}

/**
 * C5: every shipped default config named "Default", or the first numbered
 * name its spec's other configs leave free. Returns the rows renamed.
 */
async function nameShippedDefaults(tx: Db): Promise<number> {
	const configs = schema.pipelineConfigs
	const all = await tx
		.select({
			id: configs.id,
			specId: configs.specId,
			name: configs.name,
			seedKey: configs.seedKey,
			isDefault: configs.isDefault,
			isImmutable: configs.isImmutable
		})
		.from(configs)
		.orderBy(asc(configs.id))
	const names = new Map<number, Set<string>>()
	for (const c of all) {
		if (!names.has(c.specId)) names.set(c.specId, new Set())
		names.get(c.specId)!.add(c.name)
	}
	let renamed = 0
	for (const c of all) {
		if (
			!(
				c.isDefault &&
				c.isImmutable &&
				c.seedKey?.startsWith("pipeline-default:")
			)
		)
			continue
		const taken = names.get(c.specId)!
		taken.delete(c.name)
		let name = ""
		for (name of defaultConfigNameCandidates()) if (!taken.has(name)) break
		taken.add(name)
		if (name === c.name) continue
		await tx.update(configs).set({ name }).where(eq(configs.id, c.id))
		renamed++
	}
	return renamed
}
