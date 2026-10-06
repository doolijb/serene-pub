/**
 * Bringing a person's 0.5.3 prompt text across, once.
 *
 * What a person wrote before the pipeline layer existed lives in the legacy
 * tables: their own prompt, narrator, summarize and graph-build configs, and
 * the system/user/chat choices that selected between them. This carries the
 * **prompt text** into the pipeline layer — each config as a configuration of
 * the pipeline it fed, a copy of the shipped default with their prompts in it
 * — and selects it where it was selected, so the panel shows what they wrote
 * rather than showing them defaults.
 *
 * ## Prompt text only (owner ruling, 2026-10-01)
 *
 * Nothing else a 0.5.3 config held customises a pipeline: not its
 * `post_history_*` numbers, not its own connection or sampling picks, and no
 * context config at all. Those are accepted losses, each said in an upgrade
 * note (`attic/etl/configs.ts`); the shipped pipeline's own answer stands.
 *
 * ## Where each thing lands
 *
 * The scope chain already existed under different names, and `world.ts` wrote
 * the correspondence down. This follows it exactly rather than inventing one:
 *
 * | 0.5.3 | scope |
 * |---|---|
 * | `system_settings.default*` | `pub` |
 * | `user_settings.active*` | `session`, on every session that person owns (and `pub` on a single-user install) |
 * | `chats.narrator_prompt_config_id` | `session` |
 *
 * `migrateLegacySelections` says why, rule by rule.
 *
 * ## Read from the attic, and idempotent
 *
 * The legacy rows are 0.5.3's, read from the attic (`$lib/server/attic`) the
 * upgrade stashed them in — never from `public`. No attic, nothing to bring
 * across: a fresh install, or an upgrade that has finished, passes straight
 * through. Keyed on a marker row per legacy config, so a second run — a boot
 * that resumed an interrupted upgrade — writes nothing twice.
 */

import { and, asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { atticExists } from "$lib/server/attic"
import * as attic from "$lib/server/attic/tables"
import { declarations } from "$lib/server/pipelines/config/panel"
import { createPrompt } from "$lib/server/pipelines/entities/prompts"
import { promptPoolKeyFor } from "$lib/server/pipelines/entities/promptPool"
import {
	GRAPH_BUILD_SPEC_ID,
	CHAT_NARRATE_SPEC_ID,
	CHAT_RESPOND_SPEC_ID,
	SUMMARIZE_CHARACTER_SPEC_ID,
	SUMMARIZE_HISTORY_SPEC_ID,
	SUMMARIZE_SCENE_SPEC_ID,
	SUMMARIZE_WORLD_SPEC_ID
} from "$lib/server/pipelines/specs"

const str = (v: unknown): string => (typeof v === "string" ? v : "")

/**
 * The NUMBER-valued columns of a row, as a key union.
 *
 * Every dynamic column name in this file names one — a legacy pointer holds a
 * config id — and each was spelt `string` behind
 * an `as any` at the read. Derived from the row instead, a misspelt column is a
 * compile error rather than an `undefined` that silently migrates nothing,
 * which is the failure this whole file exists to avoid repeating.
 */
type NumberColumn<Row> = {
	[K in keyof Row]-?: Row[K] extends number | null ? K : never
}[keyof Row]
type SystemPointerColumn = NumberColumn<typeof attic.systemSettings.$inferSelect>
type SessionPointerColumn = NumberColumn<typeof attic.chats.$inferSelect>
type UserPointerColumn = NumberColumn<typeof attic.userSettings.$inferSelect>

/** One legacy table, and how its rows become a pipeline's prompts. */
interface LegacySource {
	specSlug: string
	table: any
	/**
	 * The legacy table's own name, and half the identity of a migrated prompt.
	 *
	 * Needed because two SOURCES entries read the SAME table:
	 * `sceneSummarizeConfigs` migrates into both the scene and the history
	 * pipeline. Under pooling those two pipelines share every summarize pool,
	 * so a legacy row must become ONE prompt that both configs point at — the
	 * same dedupe the shipped catalog makes for exactly the same pair. Keying
	 * the marker on the table rather than the spec is what makes the second
	 * pass find the first pass's row instead of colliding with it on the pool's
	 * unique name index.
	 */
	legacyTable: string
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

/**
 * A narrator config's texts, with the narration's direction where 0.5.3 put it.
 *
 * 0.5.3 added what a person typed in the Narrator modal to the prompt in code
 * (`promptBuilder.compilePrompt`), whatever the config's own text said: after
 * the system prompt as _Additional focus for this response: …_ (or the bare
 * direction when the system prompt was empty), and again after the
 * post-history instructions (or on its own). In 0.6 the prompt row renders it,
 * inside `{{#if turnDirection}}`, as the shipped Narrator row does — so a row
 * carried from 0.5.3 says it too, and an undirected narration renders exactly
 * the text that was written.
 */
const FOCUS = "Additional focus for this response: {{turnDirection}}"
const narratorFields = (row: any) => {
	const fields = sessionFields(row, str(row.narratorName) || "Narrator")
	const after = (text: string, alone: string) =>
		text
			? `${text}{{#if turnDirection}}\n\n${FOCUS}{{/if}}`
			: `{{#if turnDirection}}${alone}{{/if}}`
	return {
		...fields,
		systemPrompt: after(fields.systemPrompt, "{{turnDirection}}"),
		postHistoryInstructions: after(fields.postHistoryInstructions, FOCUS)
	}
}

const summarizeFields = (row: any) => ({
	batch: str(row.batchSystemPrompt),
	synth: str(row.synthSystemPrompt),
	name: str(row.nameSystemPrompt)
})

const SOURCES: LegacySource[] = [
	{
		specSlug: CHAT_RESPOND_SPEC_ID,
		table: attic.promptConfigs,
		legacyTable: "prompt_configs",
		fields: (r) => sessionFields(r)
	},
	{
		specSlug: CHAT_NARRATE_SPEC_ID,
		table: attic.narratorPromptConfigs,
		legacyTable: "narrator_prompt_configs",
		fields: narratorFields
	},
	{
		specSlug: SUMMARIZE_WORLD_SPEC_ID,
		table: attic.worldSummarizeConfigs,
		legacyTable: "world_summarize_configs",
		fields: summarizeFields
	},
	{
		specSlug: SUMMARIZE_CHARACTER_SPEC_ID,
		table: attic.characterSummarizeConfigs,
		legacyTable: "character_summarize_configs",
		fields: summarizeFields
	},
	{
		specSlug: SUMMARIZE_SCENE_SPEC_ID,
		table: attic.sceneSummarizeConfigs,
		legacyTable: "scene_summarize_configs",
		fields: (r) => ({
			...summarizeFields(r),
			characterExtraction: str(r.characterExtractionSystemPrompt)
		})
	},
	{
		specSlug: SUMMARIZE_HISTORY_SPEC_ID,
		table: attic.sceneSummarizeConfigs,
		legacyTable: "scene_summarize_configs",
		fields: summarizeFields
	},
	{
		specSlug: GRAPH_BUILD_SPEC_ID,
		table: attic.graphBuildConfigs,
		legacyTable: "graph_build_configs",
		fields: (r) => ({
			nodeResolution: str(r.nodeResolutionSystemPrompt),
			preFilter: str(r.preFilterSystemPrompt),
			perspective: str(r.perspectiveSystemPrompt),
			nodeDescription: str(r.nodeDescriptionSystemPrompt),
			stateDetection: str(r.stateDetectionSystemPrompt)
		})
	}
]

/** Each legacy table, and the pipelines its rows are brought into. */
export const SOURCES_BY_TABLE: Record<string, string[]> = SOURCES.reduce(
	(acc, s) => {
		;(acc[s.legacyTable] ??= []).push(s.specSlug)
		return acc
	},
	{} as Record<string, string[]>
)

export interface MigrationReport {
	specSlug: string
	/** User-created configs copied across as pipeline configs. */
	configs: string[]
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
const migratedKey = (specSlug: string, legacyId: number | string) =>
	`migrated:${specSlug}:${legacyId}`

/**
 * The same idea, for one migrated prompt: the pool, plus the row it came from.
 *
 * Keyed on the legacy TABLE rather than the spec, deliberately. Scene and
 * history summarization migrate the same `scene_summarize_configs` rows into
 * pools they now share, so the second pass has to find the row the first pass
 * wrote rather than insert a twin — which the pool's unique
 * `(node type, slot, name)` index would refuse anyway, as a raw constraint
 * error in the middle of boot.
 *
 * A non-null `seed_key` on a row a user owns is not a contradiction:
 * `is_immutable` is what says "core ships this and you may not edit it", and
 * these are false. The key is identity, not provenance.
 */
const migratedPromptKey = (
	pool: string,
	legacyTable: string,
	legacyId: number
) => `migrated-prompt:${pool}:${legacyTable}:${legacyId}`

/**
 * A name free in this pool, because the pool is what enforces uniqueness now.
 *
 * Two legacy configs a person happened to give the same name land in one pool —
 * they did not before, when a pool was a pipeline — and an unqualified insert
 * would fail the unique index in the middle of boot. Suffixed rather than
 * refused: losing somebody's migrated wording to a name clash would be the
 * worst possible outcome of a migration whose entire purpose is not to lose it.
 */
async function freePromptName(
	db: Db,
	nodeDefinitionId: string,
	slot: string,
	base: string
): Promise<string> {
	const rows = await db
		.select({ name: schema.pipelinePrompts.name })
		.from(schema.pipelinePrompts)
		.where(
			and(
				eq(schema.pipelinePrompts.nodeDefinitionId, nodeDefinitionId),
				eq(schema.pipelinePrompts.slot, slot)
			)
		)
	const taken = new Set(rows.map((r) => r.name))
	if (!taken.has(base)) return base
	let n = 2
	while (taken.has(`${base} (${n})`)) n++
	return `${base} (${n})`
}

/**
 * A free configuration name on this pipeline — `(spec, name)` is unique, and
 * a person's 0.5.3 config may share its name with core's ("Default") or with
 * another of theirs. Suffixed, never refused, for `freePromptName`'s reason.
 */
async function freeConfigName(
	db: Db,
	specId: number,
	base: string
): Promise<string> {
	const rows = await db
		.select({ name: schema.pipelineConfigs.name })
		.from(schema.pipelineConfigs)
		.where(eq(schema.pipelineConfigs.specId, specId))
	const taken = new Set(rows.map((r) => r.name))
	const clean = base.trim() || "Configuration"
	if (!taken.has(clean)) return clean
	let n = 2
	while (taken.has(`${clean} (${n})`)) n++
	return `${clean} (${n})`
}

interface ConfigValue {
	nodeKey: string
	slot: string
	path: string
	value: unknown
}

/**
 * A migrated configuration, made the way a person makes one: a copy of the
 * shipped default with their prompts written over it.
 *
 * The copy is what makes it run on the boot that wrote it. The shipped
 * default carries the reference slots nothing else supplies — the context
 * template, the variable layouts — and `reconcileConfigs`, which would
 * back-fill them, has already run by the time the migration does; a config
 * holding only its prompts halts at assemble ("no template") until the NEXT
 * start reconciles it. Copied from the reconciled default, it is already what
 * that next start would make of it.
 */
async function createFromShipped(
	db: Db,
	spec: { id: number; slug: string },
	seedKey: string,
	name: string,
	values: ConfigValue[]
): Promise<number> {
	const { shippedDefault } = await import("$lib/server/pipelines/config/named")
	const shipped = await shippedDefault(db, spec.id, spec.slug)
	const [config] = await db
		.insert(schema.pipelineConfigs)
		.values({
			specId: spec.id,
			seedKey,
			name: await freeConfigName(db, spec.id, name),
			isImmutable: false,
			isDefault: false
		})
		.returning()
	const own = new Map(values.map((v) => [`${v.nodeKey}/${v.slot}/${v.path}`, v]))
	const copied = shipped
		? (
				await db
					.select()
					.from(schema.pipelineConfigValues)
					.where(eq(schema.pipelineConfigValues.configId, shipped.id))
			).filter((v) => !own.has(`${v.nodeKey}/${v.slot}/${v.path ?? ""}`))
		: []
	const rows = [
		...copied.map((v) => ({
			configId: config.id,
			nodeKey: v.nodeKey,
			slot: v.slot,
			path: v.path ?? "",
			value: v.value
		})),
		...values.map((v) => ({ configId: config.id, ...v }))
	]
	if (rows.length) await db.insert(schema.pipelineConfigValues).values(rows as any)
	return config.id
}

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
	if (!(await atticExists(db))) return out

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
			skipped: 0
		}

		const decls = await declarations(db, spec.activeVersionId)
		const promptNodes = decls.filter((d) => d.control === "prompts-ref")

		const rows = await db
			.select()
			.from(source.table)
			.orderBy(asc(source.table.id))

		for (const row of rows) {
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

			// The user's wording becomes prompts they own — editable, unlike the
			// shipped ones, because it was always theirs.
			//
			// **One row per pool**, carrying only that pool's declared fields.
			// A legacy row is a bundle: a scene summarize config holds `batch`,
			// `synth`, `name` and `characterExtraction`, four texts belonging
			// to four different node types that only ever travelled together
			// because the spec was the namespace. Written whole into one pool
			// it would be a prompt the other three steps refuse — the panel
			// would show a config it will not let them select — so the split is
			// not a nicety here, it is what keeps the migrated config usable.
			const authored = source.fields(row)
			// Pool key → the prompt id every decl in that pool points at. Two
			// decls sharing a pool share one row: they read the same fields
			// from the same node type, so a second row would be a duplicate the
			// unique index refuses and the picker could not tell apart.
			const promptIdByPool = new Map<string, number>()
			for (const d of promptNodes) {
				if (!d.nodeDefinitionId) continue
				const pool = promptPoolKeyFor(d.nodeDefinitionId, d.slot)
				if (promptIdByPool.has(pool)) continue

				const promptKey = migratedPromptKey(
					pool,
					source.legacyTable,
					row.id
				)
				const [existing] = await db
					.select()
					.from(schema.pipelinePrompts)
					.where(eq(schema.pipelinePrompts.seedKey, promptKey))
					.limit(1)
				if (existing) {
					promptIdByPool.set(pool, existing.id)
					continue
				}

				// Only what this pool's slot declares. A field the legacy row
				// carried that no node here reads is left out rather than
				// copied into every pool: it would render nowhere, and the boot
				// sweep would archive it on the next pass anyway.
				const fields: Record<string, string> = {}
				for (const field of d.promptFields ?? [])
					if (field in authored) fields[field] = authored[field]!
				const made = await createPrompt(db, {
					nodeDefinitionId: d.nodeDefinitionId,
					slot: d.slot,
					name: await freePromptName(
						db,
						d.nodeDefinitionId,
						d.slot,
						row.name
					),
					fields,
					seedKey: promptKey,
					// Written while migrating this pipeline, so it sorts to the
					// top of that pipeline's picker. Grouping only — it stays
					// selectable wherever the node is reused.
					createdForSpecId: spec.id
				})
				promptIdByPool.set(pool, made.id)
			}

			// Each prompts slot points at its OWN pool's prompt. It used to
			// point every one of them at a single row, which was the only thing
			// a per-pipeline bundle could mean — and which the panel now
			// refuses, because a summarizer's synth step will not accept a row
			// carrying only the drafting text.
			const values: ConfigValue[] = promptNodes
				.filter((d) => d.nodeDefinitionId)
				.map((d) => ({
					nodeKey: d.nodeKey,
					slot: d.slot,
					path: "",
					value: promptIdByPool.get(
						promptPoolKeyFor(d.nodeDefinitionId!, d.slot)
					)
				}))
				.filter((v) => v.value != null)
			await createFromShipped(db, spec, seedKey, row.name, values)
			report.configs.push(row.name)
		}

		out.push(report)
	}

	return out
}

/**
 * 0.5.3 seed keys 0.6 spells differently (plan E4.1). The session rename
 * reached one shipped prompt's key; every other seed kept its spelling.
 */
const RENAMED_SEEDS: Readonly<Record<string, string>> = {
	"prompt-neutral-chat": "prompt-neutral-session"
}

/**
 * The 0.6 configuration that renders what a SHIPPED 0.5.3 config rendered.
 *
 * 0.6 ships those prompts as rows in the pools (`pipeline-prompt:<node
 * type>:<slot>:<0.5.3 seed key>`), not as configurations, so a pick of one is
 * answered by the shipped default when that default already points at it,
 * and otherwise by a configuration that does — made once, named after the
 * prompt, keyed `migrated:<spec>:<0.5.3 seed key>`. Null when 0.6 ships
 * nothing under that key: the shipped default then stands.
 */
async function configForSeed(
	db: Db,
	spec: { id: number; slug: string; activeVersionId: number },
	legacySeedKey: string
): Promise<number | null> {
	const seedKey = migratedKey(spec.slug, legacySeedKey)
	const [made] = await db
		.select({ id: schema.pipelineConfigs.id })
		.from(schema.pipelineConfigs)
		.where(eq(schema.pipelineConfigs.seedKey, seedKey))
		.limit(1)
	if (made) return made.id

	const slug = RENAMED_SEEDS[legacySeedKey] ?? legacySeedKey
	const decls = (await declarations(db, spec.activeVersionId)).filter(
		(d) => d.control === "prompts-ref" && d.nodeDefinitionId
	)
	const seeded = (
		await db
			.select({
				id: schema.pipelinePrompts.id,
				name: schema.pipelinePrompts.name,
				seedKey: schema.pipelinePrompts.seedKey,
				nodeDefinitionId: schema.pipelinePrompts.nodeDefinitionId,
				slot: schema.pipelinePrompts.slot
			})
			.from(schema.pipelinePrompts)
	).filter(
		(p) => p.seedKey?.startsWith("pipeline-prompt:") && p.seedKey.endsWith(`:${slug}`)
	)
	const wanted: Array<ConfigValue & { name: string }> = []
	for (const d of decls) {
		const pool = promptPoolKeyFor(d.nodeDefinitionId!, d.slot)
		const p = seeded.find(
			(s) => promptPoolKeyFor(s.nodeDefinitionId, s.slot) === pool
		)
		if (p)
			wanted.push({ nodeKey: d.nodeKey, slot: d.slot, path: "", value: p.id, name: p.name })
	}
	if (!wanted.length) return null

	const { shippedDefault } = await import("$lib/server/pipelines/config/named")
	const shipped = await shippedDefault(db, spec.id, spec.slug)
	if (shipped) {
		const values = await db
			.select()
			.from(schema.pipelineConfigValues)
			.where(eq(schema.pipelineConfigValues.configId, shipped.id))
		const holds = (w: ConfigValue) =>
			values.some(
				(v) =>
					v.nodeKey === w.nodeKey &&
					v.slot === w.slot &&
					(v.path ?? "") === w.path &&
					Number(v.value) === w.value
			)
		if (wanted.every(holds)) return shipped.id
	}
	return createFromShipped(
		db,
		spec,
		seedKey,
		wanted[0].name,
		wanted.map(({ name: _name, ...v }) => v)
	)
}

/** Which legacy pointer selects which pipeline, and from which table. */
interface Pointer {
	specSlug: string
	table: any
	system: SystemPointerColumn
	user?: UserPointerColumn
	/**
	 * A chat's own pick, where 0.5.3 READ one. Only the narrator's was
	 * (`resolveNarratorPromptConfig`: chat → user → system). A chat's prompt
	 * config ("AI Override") was stored and never read — generation took the
	 * user's active config — so it selects nothing (owner ruling M5); the
	 * wiring notes each one instead.
	 */
	session?: SessionPointerColumn
}

const POINTERS: Pointer[] = [
	{
		specSlug: CHAT_RESPOND_SPEC_ID,
		table: attic.promptConfigs,
		system: "defaultPromptConfigId",
		user: "activePromptConfigId"
	},
	{
		specSlug: CHAT_NARRATE_SPEC_ID,
		table: attic.narratorPromptConfigs,
		system: "defaultNarratorPromptConfigId",
		user: "activeNarratorPromptConfigId",
		session: "narratorPromptConfigId"
	},
	{
		specSlug: SUMMARIZE_WORLD_SPEC_ID,
		table: attic.worldSummarizeConfigs,
		system: "defaultSummarizeWorldConfigId",
		user: "activeSummarizeWorldConfigId"
	},
	{
		specSlug: SUMMARIZE_CHARACTER_SPEC_ID,
		table: attic.characterSummarizeConfigs,
		system: "defaultSummarizeCharacterConfigId",
		user: "activeSummarizeCharacterConfigId"
	},
	// 0.5.3 summarized scenes AND history through the scene config
	// (`sockets/summarize.ts`: anything not world or character lore).
	{
		specSlug: SUMMARIZE_SCENE_SPEC_ID,
		table: attic.sceneSummarizeConfigs,
		system: "defaultSummarizeSceneConfigId",
		user: "activeSummarizeSceneConfigId"
	},
	{
		specSlug: SUMMARIZE_HISTORY_SPEC_ID,
		table: attic.sceneSummarizeConfigs,
		system: "defaultSummarizeSceneConfigId",
		user: "activeSummarizeSceneConfigId"
	},
	// System-wide in 0.5.3 (`graphBuildConfigs.ts`): no user or chat pick.
	{
		specSlug: GRAPH_BUILD_SPEC_ID,
		table: attic.graphBuildConfigs,
		system: "defaultGraphBuildConfigId"
	}
]

/**
 * Whether this install has one person — the case where their picks are the
 * instance's too (owner ruling B1). Counted on the restored users, so the
 * seeded admin a 0.5.3 admin merged into is one person, not two.
 */
async function isSingleUserInstall(db: Db): Promise<boolean> {
	const users = await db.select({ id: schema.users.id }).from(schema.users)
	return users.length === 1
}

/**
 * Each person's 0.5.3 settings row, by their 0.5.3 user id — the id a 0.5.3
 * chat names its owner by.
 */
async function legacyUserSettings(db: Db) {
	const { atticHasTable } = await import("$lib/server/attic")
	if (!(await atticHasTable(db, "user_settings")))
		return new Map<number, typeof attic.userSettings.$inferSelect>()
	const rows = await db.select().from(attic.userSettings)
	return new Map(rows.map((r) => [r.userId, r]))
}

/**
 * Point each scope at the config it was already using.
 *
 * 0.5.3 resolved every one of these as `user_settings.active_*` falling back
 * to `system_settings.default_*` (`getUserConfigurations`), the narrator with
 * the chat's own pick in front. The person's picks were the only lever with a
 * writer — nothing but graph build's own panel ever wrote a system default —
 * so dropping them would hand every person the instance's choice instead of
 * their own (owner ruling B1, 2026-10-01):
 *
 *   · the **pub** selects what someone chose for it: a config somebody wrote,
 *     a single-user install's own pick (theirs was the pub's in effect), or a
 *     system default with no person lever (graph build). A shipped 0.5.3
 *     config it merely defaulted to selects nothing, so new sessions get
 *     0.6's shipped default;
 *   · each **session** selects what its owner's chain resolved to, where that
 *     differs from what the pub now resolves to. Where it is the same,
 *     nothing is written, so the session keeps following the pub.
 *
 * A pick of a shipped config selects its 0.6 equivalent (`configForSeed`); a
 * pick of a person's own, its `migrated:` configuration.
 */
export async function migrateLegacySelections(db: Db): Promise<number> {
	const { selectConfig, resolveSelectedConfig, shippedDefault } = await import(
		"$lib/server/pipelines/config/named"
	)
	if (!(await atticExists(db))) return 0

	const [system] = await db.select().from(attic.systemSettings).limit(1)
	// A 0.5.3 chat is the session of the same id.
	const chats = await db.select().from(attic.chats).orderBy(asc(attic.chats.id))
	const owners = new Map(
		(
			await db
				.select({ id: schema.sessions.id, userId: schema.sessions.userId })
				.from(schema.sessions)
		).map((s) => [s.id, s.userId])
	)
	const settings = await legacyUserSettings(db)
	const single = await isSingleUserInstall(db)
	const soleSettings = single && settings.size === 1 ? [...settings.values()][0] : undefined

	let selected = 0

	for (const pointer of POINTERS) {
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, pointer.specSlug))
			.limit(1)
		if (!spec?.activeVersionId) continue
		const target = { id: spec.id, slug: spec.slug, activeVersionId: spec.activeVersionId }

		const legacyRows = new Map<number, { id: number; seedKey: string | null }>(
			(await db.select().from(pointer.table)).map((r: any) => [r.id, r])
		)
		/** The first of these 0.5.3 ids naming a row that still exists. */
		const firstLiving = (...candidates: Array<number | null | undefined>) =>
			candidates.find((id) => id != null && legacyRows.has(id)) ?? null

		const configs = new Map<number, number | null>()
		/** The 0.6 configuration a 0.5.3 config id resolves to. */
		const configFor = async (legacyId: number | null): Promise<number | null> => {
			if (legacyId == null) return null
			if (configs.has(legacyId)) return configs.get(legacyId)!
			const row = legacyRows.get(legacyId)!
			let id: number | null
			if (row.seedKey) id = await configForSeed(db, target, row.seedKey)
			else {
				const [config] = await db
					.select({ id: schema.pipelineConfigs.id })
					.from(schema.pipelineConfigs)
					.where(eq(schema.pipelineConfigs.seedKey, migratedKey(spec.slug, legacyId)))
					.limit(1)
				id = config?.id ?? null
			}
			configs.set(legacyId, id)
			return id
		}

		const existing = async (scope: "pub" | "session", scopeId: number) => {
			const [row] = await db
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
			return row?.configId ?? null
		}

		// ── the pub ──
		const systemPick = firstLiving(system?.[pointer.system])
		const pubPick = firstLiving(
			pointer.user ? soleSettings?.[pointer.user] : null,
			systemPick
		)
		// A shipped config the pub only defaulted to is no choice, so 0.6's
		// shipped default stands for new sessions (existing ones keep theirs
		// below). A system default is a choice where no person lever existed.
		const chosen =
			!pointer.user ||
			pubPick !== systemPick ||
			(pubPick != null && !legacyRows.get(pubPick)?.seedKey)
		const pubConfig = chosen ? await configFor(pubPick) : null
		const shipped = await shippedDefault(db, spec.id, spec.slug)
		if (
			pubConfig != null &&
			pubConfig !== shipped?.id &&
			(await existing("pub", 0)) == null
		) {
			await selectConfig(db, spec.id, "pub", 0, pubConfig)
			selected++
		}
		const pubNow =
			(await resolveSelectedConfig(db, spec.id, spec.slug, {}))?.configId ?? null

		// ── each session, through its owner's chain ──
		if (!pointer.user && !pointer.session) continue
		for (const chat of chats) {
			const own = pointer.user ? settings.get(chat.userId)?.[pointer.user] : null
			const pick = firstLiving(
				pointer.session ? chat[pointer.session] : null,
				own,
				system?.[pointer.system]
			)
			const config = await configFor(pick)
			if (config == null || config === pubNow) continue
			if (!owners.has(chat.id)) continue
			if ((await existing("session", chat.id)) != null) continue
			await selectConfig(db, spec.id, "session", chat.id, config, owners.get(chat.id))
			selected++
		}
	}

	return selected
}

export interface FullMigrationReport {
	configs: MigrationReport[]
	selections: number
}

/** The whole pass, in dependency order. */
export async function migrateLegacyToPipelines(
	db: Db
): Promise<FullMigrationReport> {
	const configs = await migrateLegacyConfigs(db)
	const selections = await migrateLegacySelections(db)
	return { configs, selections }
}
