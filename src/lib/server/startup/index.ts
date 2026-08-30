import { building } from "$app/environment"
import { eq } from "drizzle-orm"
import { db, dbReady } from "$lib/server/db"
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
		// Embeddings become a connection (20 §14) — one-shot, pointer-guarded.
		name: "embedding",
		run: async () => {
			const { migrateEmbeddingConnection } = await import(
				"$lib/server/embedding/migrateEmbeddingConnection"
			)
			const r = await migrateEmbeddingConnection(db)
			if (r.migrated)
				console.log(
					`[embedding] endpoint config migrated to connection ${r.connectionId}`
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
		 * it is published once per version and never rewritten.
		 *
		 * A type-registry conflict means pipelines cannot run safely on this
		 * build; it does not mean a session cannot start. The report carries
		 * the reason for a diagnostics screen to show.
		 */
		name: "pipelines",
		run: async () => {
			const { bootstrapPipelines } = await import(
				"$lib/server/pipelines/boot/bootstrap"
			)
			const report = await bootstrapPipelines(db)
			if (report.conflict)
				console.warn(
					"[pipelines] type registry conflict — pipelines are disabled on " +
						"this build until it is resolved:\n" +
						report.conflict
				)
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
				.update(schema.koboldCppModels)
				.set({
					status: "error",
					errorMessage: "Server restarted during download"
				})
				.where(eq(schema.koboldCppModels.status, "downloading"))
		}
	}
]

async function runStartupTasks(): Promise<void> {
	if (building) return
	await dbReady
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
 */
export const appReady: Promise<void> = runStartupTasks()
