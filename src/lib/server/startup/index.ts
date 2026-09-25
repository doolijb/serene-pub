import { building } from "$app/environment"
import { eq } from "drizzle-orm"
import { db, dbReady } from "$lib/server/db"
import {
	describeDatabaseUnopenable,
	isDatabaseUnopenableError,
	type DatabaseUnopenableError
} from "$lib/server/db/errors"
import * as schema from "$lib/server/db/schema"

/**
 * Ordered startup tasks that run once, after the database is ready.
 *
 * These used to live at the bottom of `db/index.ts`, which owned them only
 * because it happened to be the module everything imported. The database
 * module has no business knowing about plugins, pipelines or KoboldCPP
 * downloads; keeping them there made "what runs at startup, in what order, and
 * what happens when one fails" invisible unless you read a 500-line file that
 * is nominally about Drizzle. Here it is a list.
 *
 * **Failure policy.** Every task below is non-fatal by design: a subsystem that
 * cannot bootstrap must not stop the app from serving sessions. That was
 * already the trade each of these made individually; stating it once as
 * `critical` makes it a property of the list rather than a convention four
 * `try`/`catch` blocks happen to share. A task marked critical would reject
 * `appReady` — none currently is, and adding one is a deliberate act.
 *
 * **Ordering is real, not incidental.** They run sequentially in array order:
 * the one-shot data migrations must land before anything reads the tables they
 * rewrite, and plugins load last so they see a fully bootstrapped core.
 */
export interface StartupTask {
	/** Log prefix, e.g. "plugins" — also what an error is attributed to. */
	name: string
	/** When true, a failure rejects `appReady` instead of being logged. */
	critical?: boolean
	run: () => Promise<void>
}

export const startupTasks: StartupTask[] = [
	{
		/**
		 * Account recovery from the environment (26 §10, tier 3). First in the
		 * list: if an operator is booting specifically to get back into a
		 * locked-out instance, that should happen before anything else — and
		 * well before the `services` task can bring a tunnel up and make the
		 * instance reachable.
		 */
		name: "recovery",
		run: async () => {
			const { applyEnvironmentRecovery } = await import("./recovery")
			await applyEnvironmentRecovery()
		}
	},
	{
		// The message-model migration (20 §5): one-shot, idempotent, before
		// anything reads messages. After the first pass the store's runtime
		// mirror keeps the legacy table and the new model in step, so this
		// finds nothing.
		name: "messages",
		run: async () => {
			const { migrateMessages } = await import(
				"$lib/server/messages/store"
			)
			const { migrated } = await migrateMessages(db)
			if (migrated)
				console.log(`[messages] migrated ${migrated} legacy message(s)`)
		}
	},
	{
		/**
		 * The half of migration 0127 that SQL cannot do.
		 *
		 * 0127 projects the old embedding singleton into a connection and stars
		 * it, but it can neither re-encrypt the API key across key classes nor
		 * resolve the row's capabilities against the adapter manifest. This
		 * finishes both, exactly once — the quarantined envelope is consumed, so
		 * a second boot finds nothing to do.
		 */
		name: "embedding",
		run: async () => {
			const { migrateEmbeddingConnection } = await import(
				"$lib/server/embedding/migrateEmbeddingConnection"
			)
			const r = await migrateEmbeddingConnection(db)
			if (r.keysConverted)
				console.log(
					`[embedding] re-encrypted ${r.keysConverted} API key(s) under the connection key class`
				)
			if (r.keysFailed)
				console.warn(
					`[embedding] ${r.keysFailed} API key(s) could not be decrypted and were dropped — re-enter them on the connection`
				)
			if (r.capabilitiesResolved)
				console.log(
					`[embedding] resolved capabilities for ${r.capabilitiesResolved} embedding connection(s)`
				)
		}
	},
	{
		/**
		 * Pipeline tables: the type registry, and core's own published specs.
		 *
		 * Separate from the seed `sync()` in db/index.ts because the two are
		 * different kinds of thing. Seeded rows there are user-editable
		 * content, upserted so a user's edits survive; a published spec version
		 * is immutable by construction — it is what a run resolved against — so
		 * it is published once per document and never rewritten.
		 *
		 * A declaration this build changed publishes under a new hash and the
		 * slug's pointer moves (ruling 2026-09-10). The log says which, because
		 * a pointer moving under an unchanged pin is the one event here worth
		 * being able to correlate an incident with.
		 */
		name: "pipelines",
		run: async () => {
			const { bootstrapPipelines } = await import(
				"$lib/server/pipelines/boot/bootstrap"
			)
			const report = await bootstrapPipelines(db)
			if (report.types.republished.length)
				console.info(
					"[pipelines] these slugs now resolve to a new declaration: " +
						report.types.republished.join(", ")
				)
			if (report.entryProjection) {
				// A constraint with no way to see what violates it is worse
				// than no constraint, so the audit's findings are said out loud
				// rather than left in a report nobody reads.
				const { describeEntryProjection } = await import(
					"$lib/server/pipelines/boot/entryProjection"
				)
				for (const line of describeEntryProjection(
					report.entryProjection
				))
					console.warn(`[entries] ${line}`)
			}
		}
	},
	{
		// Plugins load after every core startup task, so a plugin sees a fully
		// bootstrapped core. Inert unless SP_PLUGINS_ENABLED is set.
		name: "plugins",
		run: async () => {
			const { bootstrapPlugins } = await import("$lib/server/plugins")
			await bootstrapPlugins(db)
		}
	},
	{
		/**
		 * The event map's laws over what is installed (PLAN-turn-order §B3):
		 * a listed event nothing fires (C28), a loop nothing stops (C29).
		 * After `plugins`, so a plugin's genres and listeners are judged too.
		 * Warnings, never a refusal — the owner reads them in the log.
		 */
		name: "eventMap",
		run: async () => {
			const { eventMapFindings } = await import(
				"$lib/server/pipelines/boot/eventMapCheck"
			)
			for (const line of await eventMapFindings(db))
				console.warn(`[eventMap] ${line}`)
		}
	},
	{
		/**
		 * A default layout preset per genre (PLAN 25 redesign).
		 *
		 * HERE, and not beside the other seeds in `db/index.ts`, because a
		 * genre is a ROW: `listSessionGenres` reads published create specs, and
		 * those are written by the `pipelines` task above and by plugin specs
		 * the `plugins` task publishes. Seeding from db/index.ts would run
		 * before either and see nothing but the standard floor — the reconciler
		 * would appear to work while quietly seeding one genre forever.
		 *
		 * The standard genre is unioned in regardless, so the floor gets its
		 * default even on a build where pipelines bootstrap failed. The
		 * reconciler is idempotent, and its prune is scoped to the genres it is
		 * handed, so a genre missing from this pass keeps the default it has.
		 *
		 * Known gap: a plugin installed while the server is RUNNING registers
		 * its genre after this task, so that genre has no default preset until
		 * the next boot. Harmless — an absent default resolves to `{}`, which
		 * is the built-in arrangement — but it is why the presets list can be
		 * empty for a freshly installed genre.
		 */
		name: "layout-presets",
		run: async () => {
			const { syncLayoutPresets } = await import(
				"$lib/server/db/layoutPresets"
			)
			const { listSessionGenres, STANDARD_GENRE_ID } = await import(
				"$lib/server/pipelines/entities/sessionGenres"
			)
			const { CORE_LAYOUT_PRESETS } = await import(
				"@serene-pub/core-catalog"
			)
			const genres = await listSessionGenres(db)
			// The shipped arrangements go LAST: `syncLayoutPresets` keys on the
			// genre id and takes the last entry for each, so a genre that
			// appears both as a bare id above and as a furnished entry here gets
			// the arrangement its package declares. A genre with no shipped
			// layout keeps the empty default, which is the built-in surface.
			// Provenance for the rows this pass writes (`seeded_by_version`),
			// the same stamp `syncWidgetStyles` takes. Deferred like every
			// other import in this task.
			const { appVersion } = await import(
				"$lib/shared/constants/version"
			)
			await syncLayoutPresets(
				[
					{ genreId: STANDARD_GENRE_ID },
					...genres.map((g) => ({ genreId: g.genreId })),
					...CORE_LAYOUT_PRESETS.filter((l) =>
						genres.some((g) => g.genreId === l.genreId)
					)
				],
				{ version: appVersion || "0.0.0" }
			)
		}
	},
	{
		/**
		 * Managed local processes: recover from however the last run ended,
		 * then start whatever is configured to start on its own.
		 *
		 * Last in the list on purpose — a tunnel that auto-starts is about to
		 * make this instance reachable from the internet, and it should not do
		 * that until every migration and bootstrap above has finished.
		 */
		name: "services",
		run: async () => {
			const { registerCoreServices } = await import(
				"$lib/server/services/register"
			)
			const { reconcileServices, installShutdownHandlers } = await import(
				"$lib/server/services"
			)
			const { getRegisteredServices } = await import(
				"$lib/server/services"
			)
			await registerCoreServices()
			installShutdownHandlers()
			await reconcileServices()
			// Printed unconditionally: which local processes this instance is
			// prepared to supervise is exactly the thing an admin reading a
			// startup log wants to confirm, and its absence is how you notice
			// the registry never ran.
			console.log(
				`Managed services: ${getRegisteredServices()
					.map((s) => s.id)
					.join(", ")}`
			)
		}
	},
	{
		// A download in flight when the server stopped has no writer left to
		// finish or fail it, so it would otherwise sit at "downloading" forever.
		name: "downloads",
		run: async () => {
			await db
				.update(schema.localModels)
				.set({
					status: "error",
					errorMessage: "Server restarted during download"
				})
				.where(eq(schema.localModels.status, "downloading"))
		}
	}
]

/**
 * Whether the database opened, and what to say if it did not.
 *
 * A *state* rather than a rejection, and that is the whole point of it. A
 * `dbReady` that rejected used to reject `appReady` with it, which every entry
 * point awaits — so the app answered every request with a stack trace, or from
 * a desktop shortcut with nothing at all, and the owner was never told that
 * their data was still sitting untouched in a directory with backups next to
 * it. Recorded here instead, the HTTP server comes up and can explain itself.
 *
 * Only `DatabaseUnopenableError` lands here. Anything else still rejects
 * `appReady` exactly as it did — an unrecognised boot failure is not something
 * to serve a friendly page about.
 */
export type DatabaseState =
	| { ok: true }
	| { ok: false; error: DatabaseUnopenableError }

let databaseState: DatabaseState = { ok: true }

/**
 * Meaningful only after `appReady` has settled — every caller awaits that
 * first, so the optimistic initial value is never the one anybody reads.
 */
export function getDatabaseState(): DatabaseState {
	return databaseState
}

async function runStartupTasks(): Promise<void> {
	if (building) return
	try {
		await dbReady
	} catch (error) {
		if (!isDatabaseUnopenableError(error)) throw error
		databaseState = { ok: false, error }
		console.error(describeDatabaseUnopenable(error))
		// Every task below queries the database. Running them would turn one
		// clear explanation into a screen of failures with a different cause
		// named in each.
		return
	}
	for (const task of startupTasks) {
		try {
			await task.run()
		} catch (err) {
			if (task.critical) throw err
			console.warn(`[${task.name}] startup task failed:`, err)
		}
	}
}

/**
 * Resolves once the database is ready and every startup task has run.
 *
 * This is what the app's entry points await — `hooks.server.ts` per request and
 * `attachSocketServer` before registering handlers — so nothing serves traffic
 * against a half-bootstrapped instance.
 *
 * Started here at module scope but deliberately **not** awaited at module
 * scope: doing so would make this an async module in a cycle with `db`, which
 * is the exact shape that deadlocks the production bundle (see db/index.ts).
 *
 * Reassignable only for `restartAfterRecovery()` below. Every consumer reads it
 * through the live binding — `hooks.server.ts` re-imports this module per
 * request — so a replacement is seen by the next request rather than by nobody.
 */
export let appReady: Promise<void> = runStartupTasks()

/**
 * Whether the instance came up, and what stopped it if not.
 *
 * Its own type rather than `DatabaseState`, because the two answer different
 * questions once a recovery has happened: `DatabaseState` is what the app is
 * serving *now*, while this is what the attempt just did — and an attempt can
 * fail for a reason (a migration, a seed) that is not "the database will not
 * open" and has no business being reported as one.
 */
export type RecoveryRestart = { ok: true } | { ok: false; error: unknown }

/**
 * Come up properly, on an instance that booted into recovery mode.
 *
 * The other half of `reopenDatabase()`: that one gets the database open, this
 * one runs everything that was skipped because it could not be. Both are needed
 * and neither is enough — a restore that reopened the database but never ran
 * the startup tasks would give the owner an app with no plugins, no pipeline
 * specs, no layout presets and no managed services, which looks like a second,
 * stranger failure rather than a recovery.
 *
 * **Guarded to the recovery direction only.** It refuses on an instance whose
 * database is already fine, because re-running these tasks on a live instance
 * would reconcile managed services and reinstall shutdown handlers underneath a
 * running app for no reason. There is no path here that turns a healthy
 * instance into a restarting one.
 */
export async function restartAfterRecovery(): Promise<RecoveryRestart> {
	if (databaseState.ok) return { ok: true }

	const { reopenDatabase } = await import("$lib/server/db")
	const opened = await reopenDatabase()
	if (!opened.ok) {
		// Still broken. `databaseState` keeps an explanation so the recovery
		// page goes on saying something true, but the error handed BACK is this
		// attempt's — a migration that failed on a restored database is not the
		// boot failure that state is still carrying, and showing the old one
		// would send the owner after the wrong problem.
		if (isDatabaseUnopenableError(opened.error)) {
			databaseState = { ok: false, error: opened.error }
			console.error(describeDatabaseUnopenable(opened.error))
		} else {
			console.error(
				"[db] The database was replaced, but bringing it up failed:",
				opened.error
			)
		}
		return { ok: false, error: opened.error }
	}

	databaseState = { ok: true }
	appReady = runStartupTasks()
	await appReady

	// The socket server never attached, because there was nothing for its
	// handlers to query (see loadSockets.server.ts). Now there is.
	try {
		const { attachSocketServerAfterRecovery } = await import(
			"$lib/server/sockets/loadSockets.server"
		)
		await attachSocketServerAfterRecovery()
	} catch (error) {
		// A recovered instance with no sockets is still a recovered instance,
		// and a restart fixes it. Failing the recovery over this would not.
		console.warn(
			"[db] Recovered, but the socket server did not attach — restart Serene Pub:",
			error
		)
	}

	return { ok: true }
}
