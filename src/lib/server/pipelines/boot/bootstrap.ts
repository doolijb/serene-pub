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
 *    line of code: a type is published per declaration and a spec per document,
 *    and both are idempotent on the content hash.
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
 * The slug's pointer moves, and the declaration it moved off is kept (ruling
 * 2026-09-10). The guarantee that buys — **a stored hash always resolves to
 * what it named** — is what makes publishing an edited declaration safe to do
 * unattended: nothing that pinned the old one is orphaned by the move. Refusing
 * instead would protect the same guarantee by stopping the boot, which costs
 * every pipeline on the install and a migration per edit to undo. See
 * `registrySync.ts`.
 */

import { allTypes, allScriptTypes } from "@serene-pub/sdk"
// Core's **entry** types are declared in the catalog rather than the
// contracts, and declaring one registers it — so this import is what puts
// them in `allTypes()` below. The catalog is already loaded by way of
// `specs/respond`; naming it here is the difference between a dependency
// and a coincidence, and the failure it prevents is quiet (a fresh install
// with no entry rows and nothing saying why).
import "@serene-pub/core-catalog"
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
import { syncTypeRegistry } from "$lib/server/pipelines/boot/registrySync"
import {
	projectEntryConstraints,
	type EntryProjectionReport
} from "$lib/server/pipelines/boot/entryProjection"
import type { PresetReconcileReport } from "$lib/server/pipelines/boot/presetReconcile"
import { seedVariableTemplates } from "$lib/server/pipelines/boot/seedVariableTemplates"
import { seedContextTemplates } from "$lib/server/pipelines/boot/seedContextTemplates"
import {
	migrateContextTemplates,
	type ContextTemplateMigrationReport
} from "$lib/server/pipelines/migrate/migrateContextTemplates"
import * as schema from "$lib/server/db/schema"
import { eq, and } from "drizzle-orm"

export interface BootstrapReport {
	types: {
		inserted: number
		unchanged: number
		/**
		 * Slugs whose pointer moved to a declaration this install had not seen
		 * (ruling 2026-09-10). Empty on a fresh install and on any boot that
		 * changed nothing; a line in the boot log when it is not, because a pin
		 * quietly meaning something new is the one event here worth correlating
		 * an incident with.
		 */
		republished: string[]
	}
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
	/**
	 * What each entry type's declared schema became in the database — the CHECK
	 * constraints and indexes projected from `config_schema`, plus the rows that
	 * violate one. Absent only when the registry refused, since a projection
	 * derived from types core just declined to publish would describe nothing.
	 */
	entryProjection?: EntryProjectionReport
	/**
	 * Which preset bindings this instance can still honour, and the notices
	 * that fact left behind.
	 */
	presetBindings?: PresetReconcileReport
}

/**
 * Bring the pipeline tables in line with this build.
 *
 * Returns a report rather than a bare success. Nothing here refuses any more —
 * a changed declaration publishes and the slug moves — but what moved is a fact
 * the boot log and a diagnostics screen both want, and a report is how it
 * travels without this function deciding who is listening.
 */
export async function bootstrapPipelines(db: Db): Promise<BootstrapReport> {
	const report: BootstrapReport = {
		types: { inserted: 0, unchanged: 0, republished: [] },
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

	{
		// The hook contract check (24 §11): the catalog declares, core
		// implements, and a mismatch in either direction refuses the boot
		// before anything seeds — a packaging error, not a runtime state.
		const { assertHookCompleteness } = await import(
			"$lib/server/pipelines/boot/coreHooks"
		)
		assertHookCompleteness()

		// The same check one construct over, and for the identical reason:
		// core declares its node types in the contracts and implements them in
		// `bindings.ts`, and a binding key is a **string literal no compiler
		// checks** — so a renamed type leaves its handler bound to nothing,
		// and the node halts with "no binding registered" pointing at the
		// wrong file. Structural compatibility (ruling 2026-09-10) is the rule
		// being applied: a handler may be bound to any type that supplies
		// everything it reads. See `bindingCompat.ts` for what this can and
		// cannot see.
		const { assertCoreBindingsCompatible } = await import(
			"$lib/server/pipelines/boot/bindingCompat"
		)
		assertCoreBindingsCompatible()

		// The same shape of check, one construct over: every declared entry
		// type must name a budget band the ranker's weight map actually
		// carries. `DEFAULT_SIGNAL_WEIGHTS` is a **total** map over a closed
		// union, so a type declaring a sixth name is not a new band — it is
		// candidates scored against `undefined` and dropped, **with a green
		// parity suite and nothing in the receipt**. That already happened
		// once: history was absent from every prompt between spec 1.8.0 and
		// 1.10.0. It also catches the declarations failing to load at all,
		// which is one dropped side-effectful module away.
		const { assertEntryDeclarations } = await import(
			"$lib/server/entries/declarations"
		)
		const { DEFAULT_SIGNAL_WEIGHTS } = await import(
			"$lib/server/pipelines/ranking/weights"
		)
		// The same rule over the other kind of producer: a *retrieval mechanism* can
		// claim a band no entry type declares — the entity mechanism returns
		// transcript in `messages`, and a message is not an entry — so the
		// mechanisms' bands go through the same assertion rather than a second one
		// growing beside it.
		const { RETRIEVAL_MECHANISM_BANDS } = await import(
			"$lib/server/pipelines/ranking/entitySearch"
		)
		const entryFindings = assertEntryDeclarations(
			Object.keys(DEFAULT_SIGNAL_WEIGHTS),
			RETRIEVAL_MECHANISM_BANDS
		)
		if (entryFindings.length)
			throw new Error(
				`entry type declarations do not fit this build:\n · ` +
					entryFindings.join("\n · ")
			)

		// Every type the running build knows about. Importing the contracts is
		// what registers them, so this is a fact about the code rather than a
		// list anyone maintains.
		const synced = await syncTypeRegistry(
			db,
			// Script types go through the same sync, and that is the design
			// rather than a convenience: 18 §2 puts them "under the same sync
			// and publishing rules as node types", so a second projection path
			// would be a second set of rules to keep in step.
			// `snapshotRegistry` branches on the id.
			[...allTypes(), ...allScriptTypes()],
			{ release: RESPOND_VERSION }
		)
		report.types = {
			inserted: synced.inserted.length,
			unchanged: synced.unchanged.length,
			republished: synced.republished
		}
	}

	// Straight after the type sync: the projection derives DDL from the registry
	// *rows*, so it has to run once they are in step with this build.
	//
	// It cannot fail the boot. Constraints are added NOT VALID and every step
	// collects its own errors, because the alternative — a declaration change
	// that stops the application starting — is exactly what a local-first app
	// cannot afford.
	report.entryProjection = await projectEntryConstraints(db)

	// After the type sync: the DATA half of the event set is read off the same
	// descriptors, so an event registry written before them would describe a
	// build whose types this instance has not published yet.
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

	// After the specs: a preset names a type by slug, and the slug's spec row
	// must exist for the Types admin page to resolve it (23 §9).
	const { seedSessionPresets } = await import(
		"$lib/server/pipelines/boot/seed"
	)
	await seedSessionPresets(db)

	// Straight after the presets, and the order is the whole point: the seed
	// back-fills bindings from the locks this boot just published, so a
	// reconcile run before it would report a slot as stale that the very next
	// statement fills in. It records what an upgrade or a plugin removal left
	// pointing at nothing — the run itself falls back regardless (ruled
	// 2026-09-10); this is what tells the administrator.
	const { reconcilePresetBindings } = await import(
		"$lib/server/pipelines/boot/presetReconcile"
	)
	report.presetBindings = await reconcilePresetBindings(db)

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
 * The published version a spec slug resolves to, or null.
 *
 * Loaded from rows every time rather than cached at module scope: the rows are
 * the system of record (F3), and a cache would mean an admin publishing a new
 * version has to restart the process for it to take effect — which is the kind
 * of thing that gets discovered in production.
 *
 * ⚠ **Resolved through `active_version_id`, which is the pointer** — not through
 * `status = 'published' ORDER BY id`, which is what stood here. That took the
 * *lowest* id, so on any install that had upgraded past a version bump it
 * returned the oldest document still on the books rather than the live one. It
 * was invisible because publishing left the previous row saying `published` and
 * a fresh test database only ever has one. `publishVersion` now retires the row
 * the pointer moves off, so the two agree; this reads the pointer because the
 * pointer is the answer.
 */
export async function publishedVersionOf(
	db: Db,
	specId: string
): Promise<{ id: number; semver: string; canonicalHash: string } | null> {
	const [row] = await db
		.select({
			id: schema.pipelineSpecVersions.id,
			semver: schema.pipelineSpecVersions.semver,
			canonicalHash: schema.pipelineSpecVersions.canonicalHash
		})
		.from(schema.pipelineSpecs)
		.innerJoin(
			schema.pipelineSpecVersions,
			eq(
				schema.pipelineSpecVersions.id,
				schema.pipelineSpecs.activeVersionId
			)
		)
		.where(
			and(
				eq(schema.pipelineSpecs.slug, specId),
				eq(schema.pipelineSpecVersions.status, "published")
			)
		)
		.limit(1)
	return row ?? null
}

/** The published document for a spec id, or null. */
export async function loadPublished(db: Db, specId: string) {
	const version = await publishedVersionOf(db, specId)
	if (!version) return null
	return await loadDocument(db, version.id)
}
