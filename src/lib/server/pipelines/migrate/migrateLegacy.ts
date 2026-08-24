/**
 * Bringing a user's existing configuration across, once.
 *
 * Everything a person tuned before the pipeline layer existed lives in the
 * legacy tables: their own prompt configs, their own summarize and graph-build
 * configs, and the system/user/session choices that selected between them. This
 * copies it into the pipeline layer so the new panel shows what they actually
 * have, rather than showing them defaults and quietly running something else.
 *
 * ## Only what differs from the default
 *
 * A field a user never touched is **not** written. That is the whole difference
 * between a migration and a snapshot: an unwritten field keeps inheriting, so an
 * admin moving an instance default later still reaches this user. Copying
 * everything would look identical on the day it ran and would silently pin every
 * user to the 0.6 defaults forever — the same failure `clearOption` deletes
 * rather than rewrites to avoid.
 *
 * ## Where each thing lands
 *
 * The scope chain already existed under different names, and `world.ts` wrote
 * the correspondence down. This follows it exactly rather than inventing one:
 *
 * | today | scope |
 * |---|---|
 * | `system_settings.default*` | `instance` |
 * | `user_settings.active*` | `user` |
 * | `sessions.promptConfigId` etc. | `session` |
 *
 * Flattening to a single layer would "work" and lose the property that makes the
 * chain worth having (12 §2).
 *
 * ## Idempotent, and safe to run before the user has finished migrating
 *
 * Keyed on a marker row per legacy config, so a second run writes nothing. The
 * legacy tables are left completely untouched — they stay readable behind the
 * read-only sidebar until 0.8.0 removes them.
 */

import { and, asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { declarations } from "$lib/server/pipelines/config/panel"
import { createPrompt } from "$lib/server/pipelines/entities/prompts"
import {
	GRAPH_BUILD_SPEC_ID,
	NARRATE_SPEC_ID,
	RESPOND_SPEC_ID,
	SUMMARIZE_CHARACTER_SPEC_ID,
	SUMMARIZE_HISTORY_SPEC_ID,
	SUMMARIZE_SCENE_SPEC_ID,
	SUMMARIZE_WORLD_SPEC_ID
} from "$lib/server/pipelines/specs"

type Db = { select: any; insert: any; update: any; delete: any }

const str = (v: unknown): string => (typeof v === "string" ? v : "")

/** One legacy table, and how its rows become a namespace's prompts. */
interface LegacySource {
	specSlug: string
	table: any
	fields: (row: any) => Record<string, string>
}

/**
 * The three fields the reply and narrator namespaces actually declare.
 *
 * There used to be five. `system` and `postHistory` were aliases carrying the
 * same two texts a second time, because assembly and the provider each declared
 * their own prompts slot under those names — the defect 13 §12 finding i
 * describes. Spec 1.1.0 closed it: both now read the context node's prompts by
 * reference, so nothing declares `system` or `postHistory` and nothing resolves
 * them. Writing them anyway left two dead keys in every seeded row, and the
 * panel's editor renders a box per key in the row, so a user opening a shipped
 * prompt saw five boxes where the pipeline reads three — two of them silently
 * inert. Removed here; `0110` strips them from rows already written.
 */
const sessionFields = (row: any, narratorName = "") => ({
	systemPrompt: str(row.systemPrompt),
	postHistoryInstructions: str(row.postHistoryInstructions),
	narratorName: narratorName || str(row.narratorName)
})

const summarizeFields = (row: any) => ({
	batch: str(row.batchSystemPrompt),
	synth: str(row.synthSystemPrompt),
	name: str(row.nameSystemPrompt)
})

const SOURCES: LegacySource[] = [
	{
		specSlug: RESPOND_SPEC_ID,
		table: schema.promptConfigs,
		fields: (r) => sessionFields(r)
	},
	{
		specSlug: NARRATE_SPEC_ID,
		table: schema.narratorPromptConfigs,
		fields: (r) => sessionFields(r, str(r.narratorName) || "Narrator")
	},
	{
		specSlug: SUMMARIZE_WORLD_SPEC_ID,
		table: schema.worldSummarizeConfigs,
		fields: summarizeFields
	},
	{
		specSlug: SUMMARIZE_CHARACTER_SPEC_ID,
		table: schema.characterSummarizeConfigs,
		fields: summarizeFields
	},
	{
		specSlug: SUMMARIZE_SCENE_SPEC_ID,
		table: schema.sceneSummarizeConfigs,
		fields: (r) => ({
			...summarizeFields(r),
			characterExtraction: str(r.characterExtractionSystemPrompt)
		})
	},
	{
		specSlug: SUMMARIZE_HISTORY_SPEC_ID,
		table: schema.sceneSummarizeConfigs,
		fields: summarizeFields
	},
	{
		specSlug: GRAPH_BUILD_SPEC_ID,
		table: schema.graphBuildConfigs,
		fields: (r) => ({
			nodeResolution: str(r.nodeResolutionSystemPrompt),
			preFilter: str(r.preFilterSystemPrompt),
			perspective: str(r.perspectiveSystemPrompt),
			nodeDescription: str(r.nodeDescriptionSystemPrompt),
			stateDetection: str(r.stateDetectionSystemPrompt)
		})
	}
]

export interface MigrationReport {
	specSlug: string
	/** User-created configs copied across as pipeline configs. */
	configs: string[]
	/** Values written as overrides, by scope. */
	overrides: { instance: number; user: number; session: number }
	/** Skipped because a marker said this had already run. */
	skipped: number
}

/**
 * The marker that makes this run once.
 *
 * A config's `seedKey` doubles as the marker: a migrated config carries
 * `migrated:<spec>:<legacy id>`, so finding one is the same query as finding
 * whether that legacy row has been brought across. No separate bookkeeping
 * table, and no flag that can disagree with the rows it describes.
 */
const migratedKey = (specSlug: string, legacyId: number) =>
	`migrated:${specSlug}:${legacyId}`

/**
 * Copy the user's own configs into their namespaces.
 *
 * A *user-created* row is one with no `seedKey` — the same rule `db/defaults.ts`
 * has always used to tell "core shipped this" from "a person made this". Core's
 * own rows are already present as immutable shipped prompts, so copying them
 * again would give every namespace two identical entries.
 */
export async function migrateLegacyConfigs(db: Db): Promise<MigrationReport[]> {
	const out: MigrationReport[] = []

	for (const source of SOURCES) {
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, source.specSlug))
			.limit(1)
		if (!spec?.activeVersionId) continue

		const report: MigrationReport = {
			specSlug: source.specSlug,
			configs: [],
			overrides: { instance: 0, user: 0, session: 0 },
			skipped: 0
		}

		const decls = await declarations(db, spec.activeVersionId)
		const promptNodes = decls.filter((d) => d.control === "prompts-ref")

		const rows = await db
			.select()
			.from(source.table)
			.orderBy(asc(source.table.id))

		for (const row of rows as any[]) {
			if (row.seedKey) continue // core's own — already shipped

			const seedKey = migratedKey(source.specSlug, row.id)
			const [already] = await db
				.select()
				.from(schema.pipelineConfigs)
				.where(eq(schema.pipelineConfigs.seedKey, seedKey))
				.limit(1)
			if (already) {
				report.skipped++
				continue
			}

			// The user's wording becomes a prompt they own — editable, unlike the
			// shipped ones, because it was always theirs.
			const prompt = await createPrompt(db, {
				specId: spec.id,
				name: row.name,
				fields: source.fields(row)
			})

			const [config] = await db
				.insert(schema.pipelineConfigs)
				.values({
					specId: spec.id,
					seedKey,
					name: row.name,
					isImmutable: false,
					isDefault: false
				})
				.returning()

			// Every prompts slot in the namespace points at it. The reply
			// pipeline has three, which is the spec defect noted in seedPrompts —
			// pointing all three at one prompt is what `world.ts` does today by
			// writing the same text to two slots.
			if (promptNodes.length)
				await db.insert(schema.pipelineConfigValues).values(
					promptNodes.map((d) => ({
						configId: config.id,
						nodeKey: d.nodeKey,
						slot: d.slot,
						path: "",
						value: prompt.id
					}))
				)

			report.configs.push(row.name)
		}

		out.push(report)
	}

	return out
}

/**
 * Bring across the numeric fields a prompt config used to carry.
 *
 * `post_history_depth` and `post_history_token_trigger` were columns on
 * `prompt_configs`, which is exactly the bundling the new model undoes: they are
 * *params* — how the node behaves — not prompt text. They therefore migrate as
 * overrides at the scope that selected the config, not as part of the prompt.
 *
 * Only values differing from the column default are written, for the reason in
 * the header: a written value stops inheriting.
 */
export async function migrateLegacyParams(db: Db): Promise<number> {
	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
		.limit(1)
	if (!spec?.activeVersionId) return 0

	const decls = await declarations(db, spec.activeVersionId)
	const paramNode = (path: string) =>
		decls.find((d) => d.slot === "params" && d.path === path)

	const [system] = await db.select().from(schema.systemSettings).limit(1)
	const sessionRows = await db.select().from(schema.sessions)
	const prompts = await db.select().from(schema.promptConfigs)
	const byId = new Map((prompts as any[]).map((p) => [p.id, p]))

	/** The column defaults these fields carry; equal means "never touched". */
	const DEFAULTS: Record<string, number> = {
		postHistoryDepth: 0,
		postHistoryTokenTrigger: 0
	}

	let written = 0
	/** The tuned fields a legacy config carries, or none. */
	const tuned = (configId: number | null | undefined) => {
		const row = configId != null ? byId.get(configId) : undefined
		if (!row) return []
		return Object.entries(DEFAULTS)
			.filter(([path, fallback]) => {
				const value = row[path]
				return value != null && value !== fallback
			})
			.map(([path]) => ({
				path,
				value: row[path],
				decl: paramNode(path)
			}))
			.filter((e) => e.decl)
	}

	const write = async (
		scopeId: number,
		configId: number | null | undefined
	) => {
		for (const e of tuned(configId)) {
			await db
				.insert(schema.pipelineNodeOverrides)
				.values({
					specId: spec.id,
					scopeKind: "session",
					scopeId,
					nodeKey: e.decl!.nodeKey,
					slot: "params",
					path: e.path,
					value: e.value,
					updatedAt: new Date()
				})
				.onConflictDoNothing()
			written++
		}
	}

	// The instance's tuning lands in the instance's config (the layers as
	// simplified 2026-08-24) — there is no instance override row to write.
	// The shipped default is immutable, so a tuned legacy install gets a
	// mutable copy, exactly as migration 0140 does for pre-existing rows.
	{
		const entries = tuned(system?.defaultPromptConfigId)
		if (entries.length) {
			const { resolveSelectedConfig, duplicateConfig, selectConfig } =
				await import("$lib/server/pipelines/config/named")
			let selected = await resolveSelectedConfig(
				db as any,
				spec.id,
				RESPOND_SPEC_ID,
				{}
			)
			if (selected) {
				const [cfg] = await db
					.select()
					.from(schema.pipelineConfigs)
					.where(eq(schema.pipelineConfigs.id, selected.configId))
					.limit(1)
				let targetId = selected.configId
				if ((cfg as any)?.isImmutable) {
					const copy = await duplicateConfig(
						db as any,
						selected.configId,
						`${(cfg as any).name} (customized)`
					).catch(() => null)
					if (copy) {
						targetId = copy.id
						await selectConfig(
							db as any,
							spec.id,
							"instance",
							0,
							targetId
						)
					} else {
						targetId = -1
					}
				}
				if (targetId !== -1) {
					for (const e of entries) {
						await db
							.insert(schema.pipelineConfigValues)
							.values({
								configId: targetId,
								nodeKey: e.decl!.nodeKey,
								slot: "params",
								path: e.path,
								value: e.value
							})
							.onConflictDoNothing()
						written++
					}
				}
			}
		}
	}
	// User-scope rows no longer migrate (ruled 2026-08-24) — the layer is gone.
	for (const c of sessionRows as any[]) await write(c.id, c.promptConfigId)

	return written
}

/**
 * Point each scope at the config it was already using.
 *
 * Without this the migration copies everyone's configurations across and then
 * shows them the default — which is worse than not migrating, because the panel
 * would confidently display something they did not choose.
 */
export async function migrateLegacySelections(db: Db): Promise<number> {
	const { selectConfig } = await import("$lib/server/pipelines/config/named")

	const [system] = await db.select().from(schema.systemSettings).limit(1)
	const sessionRows = await db.select().from(schema.sessions)

	/** Which legacy pointer selects which namespace. */
	const POINTERS: Array<{
		specSlug: string
		system?: string
		user?: string
		session?: string
	}> = [
		{
			specSlug: RESPOND_SPEC_ID,
			system: "defaultPromptConfigId",
			user: "activePromptConfigId",
			session: "promptConfigId"
		},
		{
			specSlug: NARRATE_SPEC_ID,
			system: "defaultNarratorPromptConfigId",
			user: "activeNarratorPromptConfigId"
		},
		{
			specSlug: SUMMARIZE_WORLD_SPEC_ID,
			system: "defaultSummarizeWorldConfigId",
			user: "activeSummarizeWorldConfigId"
		},
		{
			specSlug: SUMMARIZE_CHARACTER_SPEC_ID,
			system: "defaultSummarizeCharacterConfigId",
			user: "activeSummarizeCharacterConfigId"
		},
		{
			specSlug: SUMMARIZE_SCENE_SPEC_ID,
			system: "defaultSummarizeSceneConfigId",
			user: "activeSummarizeSceneConfigId"
		},
		{
			specSlug: GRAPH_BUILD_SPEC_ID,
			system: "defaultGraphBuildConfigId"
		}
	]

	let selected = 0

	for (const pointer of POINTERS) {
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, pointer.specSlug))
			.limit(1)
		if (!spec) continue

		/** The migrated config for a legacy row, if that row was the user's own. */
		const configFor = async (legacyId: number | null | undefined) => {
			if (legacyId == null) return null
			const [row] = await db
				.select()
				.from(schema.pipelineConfigs)
				.where(
					eq(
						schema.pipelineConfigs.seedKey,
						migratedKey(pointer.specSlug, legacyId)
					)
				)
				.limit(1)
			return row?.id ?? null
		}

		const apply = async (
			scope: "instance" | "session",
			scopeId: number,
			legacyId: number | null | undefined,
			updatedBy?: number
		) => {
			const configId = await configFor(legacyId)
			// Nothing selected, or the legacy row was one of core's — either way
			// the shipped default is already the right answer, and writing a
			// selection to say so would only stop it tracking future changes.
			if (configId == null) return
			const [existing] = await db
				.select()
				.from(schema.pipelineConfigSelections)
				.where(
					and(
						eq(schema.pipelineConfigSelections.specId, spec.id),
						eq(schema.pipelineConfigSelections.scopeKind, scope),
						eq(schema.pipelineConfigSelections.scopeId, scopeId)
					)
				)
				.limit(1)
			if (existing?.configId != null) return

			await selectConfig(db, spec.id, scope, scopeId, configId, updatedBy)
			selected++
		}

		if (pointer.system)
			await apply("instance", 0, (system as any)?.[pointer.system])

		// User-scope selections no longer migrate (ruled 2026-08-24): the
		// layer is gone, and carrying them to session scope would promote a
		// preference into a per-session decision nobody made.

		if (pointer.session)
			for (const c of sessionRows as any[])
				await apply("session", c.id, c[pointer.session], c.userId)
	}

	return selected
}

export interface FullMigrationReport {
	configs: MigrationReport[]
	params: number
	selections: number
}

/** The whole pass, in dependency order. */
export async function migrateLegacyToPipelines(
	db: Db
): Promise<FullMigrationReport> {
	const configs = await migrateLegacyConfigs(db)
	const params = await migrateLegacyParams(db)
	const selections = await migrateLegacySelections(db)
	return { configs, params, selections }
}
