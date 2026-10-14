/**
 * Core's shipped context templates, as rows: the story string assemble
 * renders, and the two transcript templates `render-transcript@1` lays a
 * scene out with.
 *
 * Insert-only, by seed key — like `seedPipelinePrompts` and
 * `seedVariableTemplates`, and for the same reason: a row a user edited is
 * theirs. This one is immutable so it should never have diverged, but "should
 * never have" is not a mechanism, and re-writing on every boot would make this
 * file able to overwrite something it did not create.
 *
 * What the row *says* lives in `contextTemplateDefaults.ts`, which imports no
 * schema — the parity harness and the docs guard both read it, and a module
 * that opens a database connection at import cannot be read by either.
 */

import { and, asc, eq, isNull } from "drizzle-orm"
import {
	DEFAULT_TRANSCRIPT_TEMPLATE,
	LAIR_TRANSCRIPT_TEMPLATE
} from "@serene-pub/core-catalog"
import * as schema from "$lib/server/db/schema"
import { CORE_TEMPLATE_ENGINE } from "$lib/server/pipelines/prompt/renderers"
import { coreTemplateIdFor } from "$lib/server/pipelines/entities/templateIds"
import {
	namesTakenBesides,
	shippedNameFor
} from "$lib/server/pipelines/boot/shippedName"
import {
	CONTEXT_TEMPLATE_NODE_TYPE,
	CONTEXT_TEMPLATE_SEED_KEY,
	SHIPPED_CONTEXT_TEMPLATE,
	SHIPPED_CONTEXT_TEMPLATE_NAME,
	poolKeyFor
} from "$lib/server/pipelines/entities/contextTemplateDefaults"

/** 🚧 The node type a transcript template lays out (live scenes §12.1). Unversioned. */
export const TRANSCRIPT_TEMPLATE_NODE_TYPE = "core:task/render-transcript"

/** 🚧 Stable identity for core's Default transcript row. */
export const DEFAULT_TRANSCRIPT_SEED_KEY =
	"pipeline-context-template:core:transcript-default"

/** 🚧 Stable identity for core's Lair transcript row. */
export const LAIR_TRANSCRIPT_SEED_KEY =
	"pipeline-context-template:core:transcript-lair"

/** One row core ships into `pipeline_context_templates`. */
interface ShippedContextTemplate {
	seedKey: string
	/** The node type whose context it renders, unversioned (the pool). */
	nodeDefinitionId: string
	name: string
	source: string
}

/**
 * Every row core ships, the story string first.
 *
 * The transcript templates are the same strings the summarize-scene specs'
 * Default presets carry inline (core-catalog `summarizeScene.ts`, the
 * Lair's `genres/lair/summarizeScene.ts`): a spec's shipped config keeps the
 * inline value, and these rows are what its picker offers — the Default for
 * every genre, the Lair's to choose.
 */
export const SHIPPED_CONTEXT_TEMPLATES: readonly ShippedContextTemplate[] = [
	{
		seedKey: CONTEXT_TEMPLATE_SEED_KEY,
		nodeDefinitionId: CONTEXT_TEMPLATE_NODE_TYPE,
		name: SHIPPED_CONTEXT_TEMPLATE_NAME,
		source: SHIPPED_CONTEXT_TEMPLATE
	},
	{
		seedKey: DEFAULT_TRANSCRIPT_SEED_KEY,
		nodeDefinitionId: TRANSCRIPT_TEMPLATE_NODE_TYPE,
		name: "Default transcript",
		source: DEFAULT_TRANSCRIPT_TEMPLATE
	},
	{
		seedKey: LAIR_TRANSCRIPT_SEED_KEY,
		nodeDefinitionId: TRANSCRIPT_TEMPLATE_NODE_TYPE,
		name: "Lair transcript",
		source: LAIR_TRANSCRIPT_TEMPLATE
	}
]

/**
 * The pool's default row, by seed key, for each pool core ships into. A pool
 * named here never falls to "oldest immutable row", so the default does not
 * hang on which row happened to be inserted first.
 */
const POOL_DEFAULT_SEED_KEYS: ReadonlyMap<string, string> = new Map([
	[poolKeyFor(CONTEXT_TEMPLATE_NODE_TYPE), CONTEXT_TEMPLATE_SEED_KEY],
	[poolKeyFor(TRANSCRIPT_TEMPLATE_NODE_TYPE), DEFAULT_TRANSCRIPT_SEED_KEY]
])

export interface ContextTemplateSeedResult {
	created: string[]
	present: string[]
	/** Core's row, when its source had drifted from the code. */
	refreshed: string[]
}

/**
 * Write the shipped templates, once each.
 *
 * Must run **before** `seedCoreSpecs`: `ensureDefaultConfig` points the
 * assemble node's template slot at a row, and a shipped config pointing at
 * nothing would leave every install rendering the in-code floor above an empty
 * picker.
 */
export async function seedContextTemplates(
	db: Db
): Promise<ContextTemplateSeedResult> {
	const result: ContextTemplateSeedResult = {
		created: [],
		present: [],
		refreshed: []
	}
	for (const t of SHIPPED_CONTEXT_TEMPLATES)
		result[await seedOne(db, t)].push(t.seedKey)
	return result
}

async function seedOne(
	db: Db,
	t: ShippedContextTemplate
): Promise<keyof ContextTemplateSeedResult> {
	const [existing] = await db
		.select()
		.from(schema.pipelineContextTemplates)
		.where(eq(schema.pipelineContextTemplates.seedKey, t.seedKey))
		.limit(1)

	// The pool's names (node definition + engine, as the unique index has
	// them): a person's row may hold the catalog's name, and then the shipped
	// row yields with "(Built-in)" rather than stopping the boot
	// (`shippedName.ts`). Asked every boot, so the suffix drops once the name
	// is free.
	const poolNames = (await db
		.select({
			id: schema.pipelineContextTemplates.id,
			name: schema.pipelineContextTemplates.name
		})
		.from(schema.pipelineContextTemplates)
		.where(
			and(
				eq(
					schema.pipelineContextTemplates.nodeDefinitionId,
					poolKeyFor(t.nodeDefinitionId)
				),
				eq(schema.pipelineContextTemplates.engine, CORE_TEMPLATE_ENGINE)
			)
		)) as Array<{ id: number; name: string }>
	const name = shippedNameFor(
		t.name,
		namesTakenBesides(poolNames, existing?.id ?? null)
	)

	if (existing) {
		// Refreshed rather than left alone, for the reason spelled out in
		// `seedVariableTemplates`: insert-only meant core's own template could
		// never be corrected once an install had booted, so a fresh install and
		// an upgraded one rendered different prompts from identical settings.
		// Matched on `seedKey`, which is NULL for anything a user wrote.
		// Derived from the seed key (R19), and part of the drift check for the
		// same reason the source is: migration 0143 names the rows that existed
		// before this column, and this names the ones seeded after it.
		const templateId = coreTemplateIdFor(t.seedKey)
		if (
			existing.source !== t.source ||
			existing.templateId !== templateId ||
			existing.name !== name
		) {
			await db
				.update(schema.pipelineContextTemplates)
				.set({
					name,
					source: t.source,
					templateId,
					engine: CORE_TEMPLATE_ENGINE,
					updatedAt: new Date()
				})
				.where(eq(schema.pipelineContextTemplates.id, existing.id))
			return "refreshed"
		}
		return "present"
	}

	await db.insert(schema.pipelineContextTemplates).values({
		nodeDefinitionId: poolKeyFor(t.nodeDefinitionId),
		seedKey: t.seedKey,
		templateId: coreTemplateIdFor(t.seedKey),
		name,
		source: t.source,
		// Explicit rather than NULL: a template carries its engine on the value
		// (12 §2a), so a stored row keeps what it was authored in even if
		// core's default moves later.
		engine: CORE_TEMPLATE_ENGINE,
		isImmutable: true,
		// Core's belongs to no pipeline, which is what puts it in the picker's
		// "shipped" group rather than under whichever panel happened to boot.
		createdForSpecId: null
	})
	return "created"
}

/**
 * The template a node's slot should point at by default.
 *
 * Core's shipped row for that node definition, resolved by **seed key** rather than
 * by lowest id — a migrated `context_configs` row can hold a lower id than the
 * seed on an upgraded install, and "first row" would then hand two installs
 * different defaults from identical settings.
 *
 * Falls back to the oldest immutable row for a node definition core ships nothing
 * for, which is any plugin's.
 *
 * ## Per engine, and there is deliberately NO cross-engine fallback
 *
 * `engine` is the language the slot declares, and a pool with no template in
 * it returns `null`. Handing a jinja2 slot core's Handlebars source is exactly
 * the accident the engine half of the pool key exists to prevent: it would
 * store cleanly, render its `{% %}` untouched, and ship that to the model as
 * prose. `null` instead means the slot resolves to nothing and assemble halts
 * with "has no template" — loud, and pointing at the missing row.
 *
 * Both of core's jinja2 slots are unbound today, so on a core install this
 * branch is unreachable; it exists for the first plugin that publishes a node
 * in its own language, which is the case that would otherwise be silent.
 */
export async function defaultContextTemplateFor(
	db: Db,
	nodeDefinitionId: string,
	engine: string
): Promise<number | null> {
	const pool = poolKeyFor(nodeDefinitionId)

	const seedKey = POOL_DEFAULT_SEED_KEYS.get(pool)
	if (seedKey && engine === CORE_TEMPLATE_ENGINE) {
		const [row] = await db
			.select()
			.from(schema.pipelineContextTemplates)
			.where(eq(schema.pipelineContextTemplates.seedKey, seedKey))
			.limit(1)
		if (row) return row.id
	}

	const [first] = await db
		.select()
		.from(schema.pipelineContextTemplates)
		.where(
			and(
				eq(schema.pipelineContextTemplates.nodeDefinitionId, pool),
				eq(schema.pipelineContextTemplates.engine, engine),
				eq(schema.pipelineContextTemplates.isImmutable, true),
				isNull(schema.pipelineContextTemplates.createdForSpecId),
				// Never a WITHDRAWN row (R19) — see `defaultPromptFor`. This is
				// the step that picks a row nobody named, so a disabled
				// package's template must not become a new default here. NULL
				// on every row that is not a plugin's.
				isNull(schema.pipelineContextTemplates.withdrawnAt)
			)
		)
		.orderBy(asc(schema.pipelineContextTemplates.id))
		.limit(1)
	return first?.id ?? null
}
