/**
 * Whether this process already has a database startup pass open.
 *
 * `vite dev` re-executes `./index.ts` in place when a server file changes. If
 * that happens while the previous evaluation is still inside
 * `initialiseDatabase()`, two passes migrate and seed the same database at
 * once. They interleave, and the seed sync is idempotent when it is *re-run*
 * but not when it overlaps itself — the observed result is doubled
 * `Migrations applied.` and `Syncing database defaults...`, duplicate-key
 * violations on `sampling_configs_pkey`,
 * `connection_defaults_input_output_pk` and `widget_styles_slug_unique`, a
 * `[500] GET /` that never clears, and a socket server that never attached.
 *
 * The lock in meta.json cannot see this, and no amount of work on it would fix
 * that: it is a *cross-process* guarantee, and both passes are one process
 * looking at its own lock. That is precisely why it evaluates to `self` and
 * waves them through.
 *
 * **Why this is its own module.** Vite invalidates the module that changed and
 * everything importing it, never its dependencies. `./index.ts` imports this
 * file, so a reload that re-executes `./index.ts` leaves this module — and the
 * flag below — standing, which is the only reason the incoming evaluation can
 * learn anything about the outgoing one. Confirmed rather than assumed: in the
 * reproduction, `./drizzle.config`'s module-scope "Using PGlite database at:"
 * prints once while "Migrations applied." prints twice. A flag placed in
 * `./index.ts` itself would be reset by the very reload it is meant to detect,
 * and `import.meta.hot` is not an option either — SvelteKit's dev SSR runs on
 * Vite's `SSRCompatModuleRunner`, which hard-codes `hmr: false`, so a `dispose`
 * hook is a no-op that looks like a fix.
 *
 * **Dev only.** A bundled production server evaluates each module exactly once,
 * so there is nothing here to observe; every caller is behind `dev` so the
 * production build drops this outright.
 *
 * Deliberately importless. Anything this module imported would be a second
 * module that has to survive the same reload for the flag to mean anything.
 */

/** True from the start of a startup pass until the moment it settles. */
let passOpen = false

/**
 * Record that a startup pass is beginning, and say whether one was already
 * open.
 *
 * Called before the database lock is read, because the answer is about the
 * *outgoing* pass — asking after the incoming one has claimed the flag would
 * only ever answer "yes".
 */
export function openBootPass(): boolean {
	const wasOpen = passOpen
	passOpen = true
	return wasOpen
}

/**
 * Record that this process's startup pass has settled.
 *
 * Settled either way, succeeded or thrown: once the first pass is done there is
 * no second pass for a reload to collide with, and a *failed* boot has to clear
 * this too. Otherwise fixing the error that broke startup would be answered
 * with "restart the dev server" forever.
 */
export function closeBootPass(): void {
	passOpen = false
}
