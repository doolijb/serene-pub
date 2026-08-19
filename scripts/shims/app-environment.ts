/**
 * `$app/environment`, outside SvelteKit.
 *
 * The virtual module the framework injects at build time. A script that imports
 * anything under `src/lib/server` transitively reaches it — `db/index.ts` reads
 * `building` to decide whether to open the database at all — so a standalone
 * tool needs something for it to resolve to.
 *
 * `building: false` is the load-bearing value: it is what tells `db/index.ts`
 * that this is a real process and it should open, migrate and seed. A shim that
 * said `true` would produce a script that ran and touched nothing.
 */
export const building = false
export const dev = false
export const browser = false
export const version = "script"
