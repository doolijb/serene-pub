/**
 * Core's shipped prompts, one namespace at a time.
 *
 * Every prompt a user could select before the pipeline layer existed becomes a
 * selectable prompt in the namespace that used it — the twelve roleplay and
 * assistant prompt configs in the reply namespace, the narrator's in the
 * narrator namespace, and each summarize table's three-or-four prompts in its
 * own. Copied **faithfully**: the wording is the wording, and an upgrade that
 * silently improved somebody's system prompt would be the single most alarming
 * thing this migration could do.
 *
 * ## One prompt covers a namespace, not a node
 *
 * The reply pipeline used to declare a `prompts` slot on three different nodes
 * with two different sets of field names — `systemPrompt` /
 * `postHistoryInstructions` / `narratorName` on the context builder, `system` /
 * `postHistory` on assembly and on the provider — which 13 §12 finding i
 * recorded as a defect. A prompt therefore carried the **union**, so that one
 * row satisfied every node and the user saw one entry rather than three
 * near-identical ones.
 *
 * Spec 1.1.0 closed it: assembly and the provider read the context node's
 * prompts by reference, so one text is authored once and the union collapses to
 * the three fields above. The earlier note here predicted that "nothing has to
 * change" when it did — the alias keys had to be removed, from this file *and*
 * from every row it had already written (migration `0110`), because the panel's
 * editor renders a box per key in the row and two of the five were addressing
 * nothing.
 *
 * ## Why the legacy tables are read rather than the constants re-listed
 *
 * `db/defaults.ts` is the system of record for what core ships, and it upserts
 * by `seedKey` on every boot. Re-listing the same prose here would make two
 * places that must agree about a paragraph of English, and they would diverge
 * on the first typo fix.
 */

import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
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

/**
 * How one legacy table's rows become prompts in one namespace.
 *
 * `fields` maps a row to the slot field names that namespace's nodes declare.
 * Written per namespace rather than derived, because the correspondence is a
 * fact about the old schema — `batch_system_prompt` is the `batch` field — and
 * no rule connects the two names.
 */
interface PromptSource {
	specSlug: string
	table: any
	fields: (row: any) => Record<string, string>
}

/** The reply and narrator namespaces share a field union; see the header. */
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
/**
 * The reply pipeline's two fields.
 *
 * `narratorName` used to be written here too, always empty: `prompt_configs`
 * has no such column, so `str(undefined)` produced `""` on all twelve shipped
 * rows and the editor rendered a box for it. It was declared on the shared
 * context-builder type and is read only when there is no speaking character,
 * which never happens on this pipeline. The narrator has its own type and its
 * own fields now; `0114` strips the key from rows already written.
 */
const chatFields = (row: any) => ({
	systemPrompt: str(row.systemPrompt),
	postHistoryInstructions: str(row.postHistoryInstructions)
})

/** The narrator's, which really does carry a name. */
const narratorFields = (row: any) => ({
	...chatFields(row),
	// Load-bearing: it names the seed line the model continues from, so an
	// empty one seeds a blank speaker.
	narratorName: str(row.narratorName) || "Narrator"
})

const summarizeFields = (row: any) => ({
	batch: str(row.batchSystemPrompt),
	synth: str(row.synthSystemPrompt),
	name: str(row.nameSystemPrompt)
})

const SOURCES: PromptSource[] = [
	{
		specSlug: RESPOND_SPEC_ID,
		table: schema.promptConfigs,
		fields: (r) => chatFields(r)
	},
	{
		specSlug: NARRATE_SPEC_ID,
		table: schema.narratorPromptConfigs,
		fields: narratorFields
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
		// History entries have no table of their own — they run on the scene
		// config today, which is the defect the fourth namespace exists to fix.
		// Seeding from scene is what makes the split behaviour-preserving: a user
		// starts exactly where they were and diverges deliberately.
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

export interface PromptSeedResult {
	specSlug: string
	created: string[]
	present: string[]
}

/**
 * Copy each namespace's shipped prompts across, once.
 *
 * Idempotent by `seedKey`, which is derived from the legacy row's own seed key
 * so that re-running finds what it wrote rather than writing it again. A legacy
 * row a *user* created has no seed key and is not copied here — that is the
 * config migration's job, and it writes user-owned prompts rather than
 * immutable shipped ones.
 */
export async function seedPipelinePrompts(db: Db): Promise<PromptSeedResult[]> {
	const out: PromptSeedResult[] = []

	for (const source of SOURCES) {
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, source.specSlug))
			.limit(1)
		if (!spec) continue

		const rows = await db
			.select()
			.from(source.table)
			.orderBy(asc(source.table.id))

		const result: PromptSeedResult = {
			specSlug: source.specSlug,
			created: [],
			present: []
		}

		for (const row of rows as any[]) {
			// Only what core ships. A user's own rows carry no seed key and are
			// migrated with their values, not copied as immutable defaults.
			if (!row.seedKey) continue

			const seedKey = `pipeline-prompt:${source.specSlug}:${row.seedKey}`
			const [existing] = await db
				.select()
				.from(schema.pipelinePrompts)
				.where(eq(schema.pipelinePrompts.seedKey, seedKey))
				.limit(1)

			if (existing) {
				result.present.push(row.seedKey)
				continue
			}

			await db.insert(schema.pipelinePrompts).values({
				specId: spec.id,
				seedKey,
				name: row.name,
				isImmutable: true,
				fields: source.fields(row)
			})
			result.created.push(row.seedKey)
		}

		out.push(result)
	}

	return out
}

/**
 * The prompt a namespace's shipped config should point at.
 *
 * The legacy *default* where the system named one, and otherwise the first
 * shipped prompt in the namespace. Never nothing: a config whose prompt
 * reference is null renders a node with no instructions, which produces output
 * that looks like a model failure rather than a missing selection.
 */
export async function defaultPromptFor(
	db: Db,
	specId: number,
	preferredSeedKey?: string | null
): Promise<number | null> {
	if (preferredSeedKey) {
		const [preferred] = await db
			.select()
			.from(schema.pipelinePrompts)
			.where(eq(schema.pipelinePrompts.seedKey, preferredSeedKey))
			.limit(1)
		if (preferred?.specId === specId) return preferred.id
	}

	const [first] = await db
		.select()
		.from(schema.pipelinePrompts)
		.where(eq(schema.pipelinePrompts.specId, specId))
		.orderBy(asc(schema.pipelinePrompts.id))
		.limit(1)
	return first?.id ?? null
}
