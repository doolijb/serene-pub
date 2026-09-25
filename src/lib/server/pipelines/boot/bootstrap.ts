/**
 * What core puts in the pipeline tables at startup.
 *
 * Three things, and they are not the same kind of thing:
 *
 * 1. **The definition registry** — every node definition core knows about, hashed, so a
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

import { allDefinitions, allScriptKinds } from "@serene-pub/sdk"
// Core's **entry** types are declared in the catalog rather than the
// contracts, and declaring one registers it — so this import is what puts
// them in `allDefinitions()` below. The catalog is already loaded by way of
// `specs/respond`; naming it here is the difference between a dependency
// and a coincidence, and the failure it prevents is quiet (a fresh install
// with no entry rows and nothing saying why).
import "@serene-pub/core-catalog"
import {
	seedCoreSpecs,
	syncEventRegistry,
	type RebindMoveReport,
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
import { syncDefinitionRegistry } from "$lib/server/pipelines/boot/registrySync"
import { pluginDefinitionPins } from "$lib/server/plugins/pluginDefinitions"
import {
	projectEntryConstraints,
	type EntryProjectionReport
} from "$lib/server/pipelines/boot/entryProjection"
import type { PresetReconcileReport } from "$lib/server/pipelines/boot/presetReconcile"
import type { PlacedNodeReconcileReport } from "$lib/server/pipelines/boot/placedNodeReconcile"
import type { BindingSubjectReport } from "$lib/server/pipelines/boot/bindingSubjects"
import type { DeclarationLoadReport } from "$lib/server/state/declarations"
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
		/**
		 * Slugs this build does not publish, marked `removed` on this boot
		 * (plans/29 R-2). Empty on every boot but the first after a cull; a
		 * line in the boot log when it is not, because a stored spec pinning
		 * one is about to halt legibly and an administrator should know why.
		 */
		removed: string[]
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
	/**
	 * Which placed nodes pin a definition this build does not run — removed
	 * or provisional (R-2) — and the notices that fact left on their
	 * configurations.
	 */
	placedNodes?: PlacedNodeReconcileReport
	/** ⏳ Which pre-V2 binding rows were re-keyed by subject, and which were dropped. */
	bindingSubjects?: BindingSubjectReport
	/**
	 * ⏳ How many Turn order choices moved from the respond specs' `speaker`
	 * node to `core:spec/<genre>-turn-order` `strategy` this boot (PLAN-turn-order
	 * A5, R20). Zero on every boot after the first, and on any build that
	 * has not published the spec.
	 */
	rebindMove?: RebindMoveReport
	/**
	 * What the attribute registry loaded from this install's rows, and what it
	 * mirrored back as last-seen (R1, R4).
	 */
	declarations?: DeclarationLoadReport
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
		types: { inserted: 0, unchanged: 0, republished: [], removed: [] },
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

	// FIRST, and before anything reads a slot. The attribute registry has two
	// sources (R1) — code, which the imports above have already registered, and
	// the install's own `attribute_declarations` rows — and `getAttributeSlot`
	// is the only door either goes through. A session resolving its vocabulary
	// against a half-loaded registry would silently drop whatever had not
	// arrived, so the load happens before the checks rather than beside the
	// seeds. It cannot fail the boot: a row this build refuses costs that one
	// declaration and says which in the report.
	{
		const { loadStoredDeclarations } = await import(
			"$lib/server/state/declarations"
		)
		try {
			report.declarations = await loadStoredDeclarations(db)
		} catch (e) {
			console.warn("[state] attribute declarations did not load:", e)
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
		// core declares its node definitions in the contracts and implements them in
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
		//
		// ⚠ Minus what a PLUGIN put there. An installed package's declarations
		// are registered in the same in-process map so its specs resolve
		// (`plugins/pluginDefinitions.ts`); this sync publishes what it is
		// handed as **core's** — owner NULL, `transport: 'node'` — and marks
		// anything core no longer declares as removed. A plugin's declaration
		// left in this list would take its own row away from it and route its
		// node to a core binding that does not exist.
		const fromPlugins = pluginDefinitionPins()
		const synced = await syncDefinitionRegistry(
			db,
			// Script types go through the same sync, and that is the design
			// rather than a convenience: 18 §2 puts them "under the same sync
			// and publishing rules as node definitions", so a second projection path
			// would be a second set of rules to keep in step.
			// `snapshotRegistry` branches on the id.
			[...allDefinitions(), ...allScriptKinds()].filter(
				(d) => !fromPlugins.has(d.id)
			),
			// Everything core publishes, so a core row this build does not
			// declare is marked `removed` (the reverse-diff, R-2).
			{ release: RESPOND_VERSION, complete: true }
		)
		report.types = {
			inserted: synced.inserted.length,
			unchanged: synced.unchanged.length,
			republished: synced.republished,
			removed: synced.removed
		}
		if (synced.removed.length)
			console.warn(
				`[pipelines] ${synced.removed.length} definition(s) this build does not publish, ` +
					`marked removed (rows kept for the specs pinning them): ${synced.removed.join(", ")}`
			)
		if (synced.deprecatedUnpublished.length)
			console.warn(
				`[pipelines] ${synced.deprecatedUnpublished.length} deprecated definition(s) this ` +
					`build does not publish, left deprecated — an administrator's word: ` +
					synced.deprecatedUnpublished.join(", ")
			)

		// After the sync, so the registry already says `provisional` for the
		// three a plan owns: every other core definition this build publishes
		// has a handler, or the build is refused in dev and told once in
		// production (R-2). See `bindingCompat.ts` for what it judges.
		const { assertCoreDefinitionsBound } = await import(
			"$lib/server/pipelines/boot/bindingCompat"
		)
		assertCoreDefinitionsBound()

		// The hook ctx per kind (R-3), probed rather than documented: the SDK's
		// `assertHookSurface` reads the keys the sandboxes hand an event
		// listener and a lifecycle callback and refuses an executor handle on
		// either; the two pure kinds are held to carrying neither storage nor
		// fetch. One table feeds both sandboxes (`plugins/hookCtx.ts`), so a
		// regression here is a regression in what every plugin receives.
		const { hookCtxKeysFor } = await import("$lib/server/plugins/hookCtx")
		const { assertHookSurface } = await import("@serene-pub/sdk")
		const asSurface = (keys: string[]) =>
			Object.fromEntries(keys.map((k) => [k, true]))
		for (const kind of ["event", "lifecycle"] as const) {
			const probe = assertHookSurface(kind, asSurface(hookCtxKeysFor(kind)))
			if (!probe.ok)
				throw new Error(
					`the ${kind} hook ctx hands out ${probe.found.join(", ")} — an executor ` +
						`handle no hook may hold (F32, plans/29 R-3)`
				)
		}
		for (const kind of ["task", "chain-link"] as const) {
			const keys = hookCtxKeysFor(kind)
			const leaked = keys.filter((k) => k === "storage" || k === "fetch")
			if (leaked.length)
				throw new Error(
					`the ${kind} hook ctx hands out ${leaked.join(", ")} — a ${kind} is pure ` +
						`(F11) and gets neither (plans/29 R-3)`
				)
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

	// ⏳ After the specs, and that is the whole reason it is here rather than
	// in a migration (PLAN-turn-order R20): the Turn order control's row
	// points at `core:spec/<genre>-turn-order` by id, and that spec's row is what the
	// seed above just inserted. Idempotent and re-runnable; a no-op on every
	// boot after the first and on any build that does not publish the spec.
	const { moveSpeakerRebinds } = await import(
		"$lib/server/pipelines/boot/seed"
	)
	report.rebindMove = await moveSpeakerRebinds(db)

	// ⏳ Beside it, and after the specs for the same reason: a binding row a
	// previous release keyed by function is re-keyed by subject (plans/31
	// V2) against the actions this boot just published. What could not be
	// re-keyed is dropped and said here, once per boot it happens.
	const { reprojectBindingSubjects } = await import(
		"$lib/server/pipelines/boot/bindingSubjects"
	)
	report.bindingSubjects = await reprojectBindingSubjects(db)
	if (report.bindingSubjects.dropped.length)
		console.warn(
			`[pipelines] ${report.bindingSubjects.dropped.length} binding(s) keyed by a bare function ` +
				`could not be re-keyed by subject and were dropped: ${report.bindingSubjects.dropped.join("; ")}`
		)

	// Beside the preset reconcile and for the same reason: a stored version
	// pins its nodes by slug, and this boot's registry sync is what marks a
	// slug `removed` or `provisional` (R-2). A node pinning one halts the run
	// legibly on its own; this is what tells the person whose configuration
	// it is, as a notice on it (NOMENCLATURE §6 *cull → notice*).
	const { reconcilePlacedNodes } = await import(
		"$lib/server/pipelines/boot/placedNodeReconcile"
	)
	report.placedNodes = await reconcilePlacedNodes(db)
	if (report.placedNodes.unbound.length)
		console.warn(
			`[pipelines] ${report.placedNodes.unbound.length} placed node(s) pin a definition ` +
				`this build does not run: ${report.placedNodes.unbound.join(", ")}`
		)

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
