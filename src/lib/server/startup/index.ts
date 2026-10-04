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
 * `try`/`catch` blocks happen to share. A task marked critical rejects
 * `appReady` — only `attic` is, and adding one is a deliberate act.
 *
 * Between the two sits `failsHealth`: the app keeps serving, but an instance
 * without this task is not one the launcher may call healthy — its health
 * route reports `failed` (`launcher/controlRoutes.ts`), so an update that
 * breaks it is rolled back instead of committed. Only `pipelines` is: without
 * it nothing can generate, create a session or run an action.
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
	/**
	 * When true, a failure is logged and the app keeps serving, but the
	 * launcher's health reports `failed` (see `getStartupFailures`).
	 */
	failsHealth?: boolean
	run: () => Promise<void>
}

export const startupTasks: StartupTask[] = [
	{
		/**
		 * The 0.5.3 upgrade's restore (`$lib/server/attic`): every row the
		 * migration stashed in the attic goes back in the 0.6 shape, in one
		 * transaction. First, before env-account recovery can touch a user in
		 * the emptied `users` table. **Critical**: a failure rolls the restore
		 * back and stops the boot rather than serving an empty app over
		 * somebody's data — the attic is still there, and the next start tries
		 * again. With no attic (every install but an upgrading 0.5.3) it is one
		 * catalog query.
		 */
		name: "attic",
		critical: true,
		run: async () => {
			const { restoreFromAttic } = await import("$lib/server/attic/restore")
			const report = await restoreFromAttic(db)
			if (report && !report.alreadyRestored)
				console.log(
					`[attic] 0.5.3 data restored in the 0.6 shape; its upgrade notes are in Admin → History once the configurations are wired`
				)
		}
	},
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
		 * A reply generating when the server stopped has no run left to finish
		 * or fail it: it would say "generating" until someone pressed Stop,
		 * refuse every Regenerate in its session, and never be embedded.
		 * Settled with the text that arrived, and handed to the embedding
		 * queue (`sessions/derelictReplies.ts`). Rows this process is
		 * generating are never taken, so a re-run on a live instance is safe.
		 */
		name: "replies",
		run: async () => {
			const { reconcileDerelictReplies } = await import(
				"$lib/server/sessions/derelictReplies"
			)
			const settled = await reconcileDerelictReplies({ db })
			if (settled)
				console.log(
					`[replies] settled ${settled} reply(s) left generating when the server stopped`
				)
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
		failsHealth: true,
		run: async () => {
			const { bootstrapPipelines } = await import(
				"$lib/server/pipelines/boot/bootstrap"
			)
			const report = await bootstrapPipelines(db)
			// The 0.5.3 upgrade's last step, once the configurations it wires
			// have somewhere to go; it drops the attic. A no-op on every other
			// install.
			const { finishAtticUpgrade } = await import("$lib/server/attic/finish")
			const wired = await finishAtticUpgrade(db)
			if (wired)
				console.log(
					`[attic] 0.5.3 upgrade finished: configurations wired, ${wired.rebinds} turn order(s) set; the attic is gone`
				)
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
		 * Authored components (C6): recompile every one whose artifact was
		 * built by another toolchain or is gone from the component cache;
		 * a failure lands in `last_error` and that widget is not offered.
		 * Skipped with the extension subsystem off, and where the server has
		 * no compiler (Android) — rows are then left exactly as they are.
		 */
		name: "components",
		run: async () => {
			const { bootAuthoredComponents } = await import(
				"$lib/server/components/boot"
			)
			const r = await bootAuthoredComponents(db)
			if (r.recompiled.length)
				console.info(
					`[components] recompiled ${r.recompiled.length} authored component(s) for this toolchain`
				)
			for (const f of r.failed)
				console.warn(
					`[components] authored.${f.id} does not compile and is not offered: ${f.error}`
				)
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
		 * The layouts core's genres ship (`GenreDecl.layouts`), one row each;
		 * a plugin genre's are its owner's (`syncPluginLayouts`, run by the
		 * `plugins` task and on every install, enable and disable).
		 *
		 * HERE, and not beside the other seeds in `db/index.ts`, because a
		 * genre is a ROW: `listSessionGenres` reads published create specs, and
		 * those are written by the `pipelines` task above. Seeding from
		 * db/index.ts would run before it and see nothing but the standard
		 * floor — the reconciler would appear to work while quietly seeding
		 * one genre forever.
		 *
		 * The standard genre is unioned in regardless, so the floor gets its
		 * default even on a build where pipelines bootstrap failed. The
		 * reconciler is idempotent and writes only what changed, and its prune
		 * of a core genre's rows is scoped to the genres it is handed, so a
		 * genre missing from this pass keeps the rows it has.
		 */
		name: "layout-presets",
		run: async () => {
			const { syncLayoutPresets } = await import(
				"$lib/server/db/layoutPresets"
			)
			const { listSessionGenres, STANDARD_GENRE_ID } = await import(
				"$lib/server/pipelines/entities/sessionGenres"
			)
			const genres = await listSessionGenres(db)
			// Provenance for the rows this pass writes (`seeded_by_version`),
			// the same stamp `syncWidgetStyles` takes. Deferred like every
			// other import in this task.
			const { appVersion } = await import(
				"$lib/shared/constants/version"
			)
			// Every genre the instance has: the reconciler seeds the core ones'
			// declared layouts and leaves a plugin genre's to its owner
			// (`syncPluginLayouts`). A layout it moves reaches no session (each
			// holds its copy) — only the **Updated** label, pushed to any tab
			// already connected (brief 6b; at a cold boot, none is).
			const { afterLayoutReconcile } = await import(
				"$lib/server/sessions/startedFromPush"
			)
			await afterLayoutReconcile(() =>
				syncLayoutPresets(
					[STANDARD_GENRE_ID, ...genres.map((g) => g.genreId)],
					{ version: appVersion || "0.0.0" }
				)
			)
		}
	},
	{
		/**
		 * ⏳ The copy model's one-shot step (brief 3 of
		 * `PLAN-layout-one-format-2026-09-28`; delete it at the pre-release
		 * migrations squash): every session layout row written before the copy
		 * model is made whole with exactly what the screen drew — its own slots
		 * over the preset it was drawn over. After BOTH reconcilers (`plugins`
		 * above runs `syncPluginLayouts`; `layout-presets` just ran), because
		 * that preset is one of their rows, and before sockets accept (they
		 * await `appReady`), because the handlers now read the row alone.
		 * Idempotent: a finished row is never selected again.
		 */
		name: "session-layouts",
		run: async () => {
			const { completeSessionLayouts } = await import(
				"$lib/server/db/sessionLayoutBackfill"
			)
			await completeSessionLayouts()
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

/**
 * The `critical` and `failsHealth` tasks that failed in the latest run of the
 * startup tasks.
 *
 * Read by the launcher's health route without awaiting anything, so it is
 * meaningful once `appReady` has settled; a recovery restart re-runs the tasks
 * and starts the list over.
 */
let startupFailures: string[] = []

export function getStartupFailures(): readonly string[] {
	return startupFailures
}

async function runStartupTasks(): Promise<void> {
	startupFailures = []
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
			if (task.critical || task.failsHealth) startupFailures.push(task.name)
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
 * Attach the socket server the moment startup finishes, not at the first page
 * render.
 *
 * The root layout's load attaches it too (`src/routes/+layout.server.ts`), and
 * for years that was the only place — so after a restart, a tab that was
 * already open reconnected to a server with no Socket.IO on it, got a 404 on
 * the WebSocket upgrade ("websocket error"), and only got in on a later retry
 * after some page render had attached it. The launcher's health poll loads
 * this module on a launcher-spawned server, so the socket server is up before
 * anyone asks. A recovery boot attaches from `restartAfterRecovery()` instead.
 */
async function attachSocketsAfterStartup(): Promise<void> {
	if (!databaseState.ok) return
	const httpServer = (globalThis as { __SERENE_PUB_HTTP_SERVER__?: unknown })
		.__SERENE_PUB_HTTP_SERVER__
	if (!httpServer) return
	try {
		const { attachSocketServer } = await import(
			"$lib/server/sockets/loadSockets.server"
		)
		await attachSocketServer(httpServer as Parameters<typeof attachSocketServer>[0])
	} catch (err) {
		// The layout load tries again on the first page render.
		console.warn("[sockets] Could not attach the socket server at startup:", err)
	}
}
appReady.then(attachSocketsAfterStartup, () => {})

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
