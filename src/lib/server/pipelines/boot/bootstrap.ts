/**
 * What core puts in the pipeline tables at startup.
 *
 * Three things, and they are not the same kind of thing:
 *
 * 1. **The type registry** — every node type core knows about, hashed, so a
 *    stored document that names a type gets the same type back on the next boot
 *    or refuses to load (F3, U2). This is a *fact* about the running code.
 * 2. **The event registry** — core's closed event set, materialized so that
 *    `affects_user` is a column rather than a classification somebody repeats
 *    per subscription (11 §4). Also a fact about the code.
 * 3. **Core's own spec documents** — the pipelines core ships, published so a
 *    session can run one. This is *content*, and the difference matters at the next
 *    line of code: the registry sync raises on conflict, and spec publishing is
 *    idempotent by version.
 *
 * What each seeds under, and why the three rules differ, is in `seed.ts`.
 *
 * ## Why this is not in `db/defaults.ts`
 *
 * The seeded rows there are user-editable content — prompt configs, context
 * configs — upserted by `seedKey` so a user's edits survive. A published spec
 * version is **immutable by construction** (F3: rows are the system of record,
 * and a published version is what a run resolved against). Re-seeding one on
 * every boot would either clobber a run's history or need an exception in a file
 * whose whole rule is that there are none.
 *
 * ## What happens when the code and the database disagree
 *
 * The registry sync refuses rather than reconciling. A type whose ports changed
 * under a document that already uses it is not a merge; it is a spec that means
 * something different than it did when someone approved it, and the honest
 * response is to stop and say so. See `registrySync.ts`.
 */

import { allTypes, allScriptTypes } from "@serene-pub/sdk"
import {
	seedCoreSpecs,
	syncEventRegistry,
	type SpecSeedReport
} from "$lib/server/pipelines/boot/seed"
import {
	migrateLegacyToPipelines,
	type FullMigrationReport
} from "$lib/server/pipelines/migrate/migrateLegacy"
// Re-exported rather than moved out from under its importers: the spec now
// lives in `specs/respond.ts`, and half the pipeline tests name it from here.
export {
	RESPOND_SPEC_ID,
	RESPOND_VERSION,
	respondSpec
} from "$lib/server/pipelines/specs/respond"
import { RESPOND_VERSION } from "$lib/server/pipelines/specs/respond"
import { loadDocument } from "$lib/server/pipelines/boot/store"
import {
	syncTypeRegistry,
	TypeRegistryConflictError
} from "$lib/server/pipelines/boot/registrySync"
import { seedVariableTemplates } from "$lib/server/pipelines/boot/seedVariableTemplates"
import { seedContextTemplates } from "$lib/server/pipelines/boot/seedContextTemplates"
import {
	migrateContextTemplates,
	type ContextTemplateMigrationReport
} from "$lib/server/pipelines/migrate/migrateContextTemplates"
import * as schema from "$lib/server/db/schema"
import { eq, and } from "drizzle-orm"

export interface BootstrapReport {
	types: { inserted: number; unchanged: number }
	/** Core's event set, materialized so `affects_user` is queryable (11 §4). */
	events: { inserted: number; updated: number; unchanged: number }
	/** The shipped variable layouts every config's default points at. */
	variableTemplates: { created: number; present: number }
	/** The shipped story string every assemble node's default points at. */
	contextTemplates: { created: number; present: number }
	specs: SpecSeedReport[]
	/** What a user's existing configuration became. Empty after the first boot. */
	migration: FullMigrationReport
	/** What each scope's legacy context config became, and what that pinned. */
	contextTemplateMigration: ContextTemplateMigrationReport
	/** Set when the registry refused; the app still boots, pipelines do not run. */
	conflict?: string
}

/**
 * Bring the pipeline tables in line with this build.
 *
 * Returns a report rather than throwing on a registry conflict. A type-hash
 * conflict means *pipelines* cannot run safely; it does not mean the session app
 * cannot start, and taking the whole instance down over a subsystem nobody has
 * opted into yet would be the wrong trade. The conflict travels in the report so
 * the diagnostics screen can say what is wrong and the caller can decide.
 */
export async function bootstrapPipelines(db: any): Promise<BootstrapReport> {
	const report: BootstrapReport = {
		types: { inserted: 0, unchanged: 0 },
		events: { inserted: 0, updated: 0, unchanged: 0 },
		variableTemplates: { created: 0, present: 0 },
		contextTemplates: { created: 0, present: 0 },
		specs: [],
		migration: { configs: [], params: 0, selections: 0 },
		contextTemplateMigration: {
			ran: false,
			copied: 0,
			selected: 0,
			pinned: 0,
			customScopes: [],
			rePointed: 0
		}
	}

	try {
		// Every type the running build knows about. Importing the contracts is
		// what registers them, so this is a fact about the code rather than a
		// list anyone maintains.
		const synced = await syncTypeRegistry(
			db,
			// Script types go through the same sync, and that is the design
			// rather than a convenience: 18 §2 puts them "under the same sync,
			// conflict-refusal and re-projection rules as node types", so a
			// second projection path would be a second set of rules to keep in
			// step. `snapshotRegistry` branches on the id.
			[...allTypes(), ...allScriptTypes()],
			{ release: RESPOND_VERSION }
		)
		report.types = {
			inserted: synced.inserted.length,
			unchanged: synced.unchanged.length
		}
	} catch (err) {
		if (err instanceof TypeRegistryConflictError) {
			report.conflict = err.message
			return report
		}
		throw err
	}

	// After the type sync and inside its success path: the DATA half of the
	// event set is read off the same descriptors, so an event registry written
	// while the types are in conflict would describe a build core just refused.
	const events = await syncEventRegistry(db)
	report.events = {
		inserted: events.inserted.length,
		updated: events.updated.length,
		unchanged: events.unchanged.length
	}

	// Before the specs, and the order is load-bearing: `ensureDefaultConfig`
	// points every variables declaration at a layout row, so a spec seeded
	// first would ship a config selecting nothing. The prompt is byte-identical
	// either way (the code default is the floor), but the panel would open with
	// an empty picker above output that plainly has a layout.
	const layouts = await seedVariableTemplates(db)
	report.variableTemplates = {
		created: layouts.created.length,
		present: layouts.present.length
	}

	// Beside the layouts and before the specs, for the same reason: the shipped
	// config points its template slot at a row, and a spec seeded first would
	// ship a config selecting nothing.
	const templates = await seedContextTemplates(db)
	report.contextTemplates = {
		created: templates.created.length,
		present: templates.present.length
	}

	report.specs = await seedCoreSpecs(db)

	// Last, and only once. Everything it writes references a spec, a prompt or a
	// config that the three steps above had to create first.
	report.migration = await migrateLegacyToPipelines(db)

	// After that migration rather than beside it, and the order matters: this
	// declines to write over an override that is already there, so it has to
	// run once every override anybody else was going to write exists.
	report.contextTemplateMigration = await migrateContextTemplates(db)

	return report
}

/**
 * The published document for a spec id, or null.
 *
 * Loaded from rows every time rather than cached at module scope: the rows are
 * the system of record (F3), and a cache would mean an admin publishing a new
 * version has to restart the process for it to take effect — which is the kind
 * of thing that gets discovered in production.
 */
export async function loadPublished(db: any, specId: string) {
	const [row] = await db
		.select({ id: schema.pipelineSpecVersions.id })
		.from(schema.pipelineSpecVersions)
		.innerJoin(
			schema.pipelineSpecs,
			eq(schema.pipelineSpecVersions.specId, schema.pipelineSpecs.id)
		)
		.where(
			and(
				eq(schema.pipelineSpecs.slug, specId),
				eq(schema.pipelineSpecVersions.status, "published")
			)
		)
		.orderBy(schema.pipelineSpecVersions.id)
		.limit(1)
	if (!row) return null
	return await loadDocument(db, row.id)
}
