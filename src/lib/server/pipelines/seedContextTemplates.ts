/**
 * Core's shipped context template, as a row.
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
import * as schema from "$lib/server/db/schema"
import { CORE_TEMPLATE_ENGINE } from "./renderers"
import {
	CONTEXT_TEMPLATE_NODE_TYPE,
	CONTEXT_TEMPLATE_SEED_KEY,
	SHIPPED_CONTEXT_TEMPLATE,
	SHIPPED_CONTEXT_TEMPLATE_NAME,
	poolKeyFor
} from "./contextTemplateDefaults"

type Db = { select: any; insert: any; update: any; delete: any }

export interface ContextTemplateSeedResult {
	created: string[]
	present: string[]
}

/**
 * Write the shipped template, once.
 *
 * Must run **before** `seedCoreSpecs`: `ensureDefaultConfig` points the
 * assemble node's template slot at a row, and a shipped config pointing at
 * nothing would leave every install rendering the in-code floor above an empty
 * picker.
 */
export async function seedContextTemplates(
	db: Db
): Promise<ContextTemplateSeedResult> {
	const result: ContextTemplateSeedResult = { created: [], present: [] }

	const [existing] = await db
		.select()
		.from(schema.pipelineContextTemplates)
		.where(
			eq(
				schema.pipelineContextTemplates.seedKey,
				CONTEXT_TEMPLATE_SEED_KEY
			)
		)
		.limit(1)

	if (existing) {
		result.present.push(CONTEXT_TEMPLATE_SEED_KEY)
		return result
	}

	await db.insert(schema.pipelineContextTemplates).values({
		nodeTypeId: poolKeyFor(CONTEXT_TEMPLATE_NODE_TYPE),
		seedKey: CONTEXT_TEMPLATE_SEED_KEY,
		name: SHIPPED_CONTEXT_TEMPLATE_NAME,
		source: SHIPPED_CONTEXT_TEMPLATE,
		// Explicit rather than NULL: a template carries its engine on the value
		// (12 §2a), so a stored row keeps what it was authored in even if
		// core's default moves later.
		engine: CORE_TEMPLATE_ENGINE,
		isImmutable: true,
		// Core's belongs to no pipeline, which is what puts it in the picker's
		// "shipped" group rather than under whichever panel happened to boot.
		createdForSpecId: null
	})
	result.created.push(CONTEXT_TEMPLATE_SEED_KEY)

	return result
}

/**
 * The template a node's slot should point at by default.
 *
 * Core's shipped row for that node type, resolved by **seed key** rather than
 * by lowest id — a migrated `context_configs` row can hold a lower id than the
 * seed on an upgraded install, and "first row" would then hand two installs
 * different defaults from identical settings.
 *
 * Falls back to the oldest immutable row for a node type core ships nothing
 * for, which is any plugin's.
 */
export async function defaultContextTemplateFor(
	db: Db,
	nodeTypeId: string
): Promise<number | null> {
	const pool = poolKeyFor(nodeTypeId)

	if (pool === poolKeyFor(CONTEXT_TEMPLATE_NODE_TYPE)) {
		const [row] = await db
			.select()
			.from(schema.pipelineContextTemplates)
			.where(
				eq(
					schema.pipelineContextTemplates.seedKey,
					CONTEXT_TEMPLATE_SEED_KEY
				)
			)
			.limit(1)
		if (row) return row.id
	}

	const [first] = await db
		.select()
		.from(schema.pipelineContextTemplates)
		.where(
			and(
				eq(schema.pipelineContextTemplates.nodeTypeId, pool),
				eq(schema.pipelineContextTemplates.isImmutable, true),
				isNull(schema.pipelineContextTemplates.createdForSpecId)
			)
		)
		.orderBy(asc(schema.pipelineContextTemplates.id))
		.limit(1)
	return first?.id ?? null
}
