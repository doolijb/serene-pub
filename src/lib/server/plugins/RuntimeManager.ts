/**
 * ⏳ **Tombstone — a compatibility shim, and nothing else.**
 *
 * `RuntimeManager` is now `SandboxManager`, in `./SandboxManager`. The plugin
 * execution environment is a **sandbox**; *runtime* is the pipeline executor's
 * word and only its word (NOMENCLATURE §4 and §12).
 *
 * **Why this file exists.** Two files still import the old name from the old
 * path, and both live under `src/lib/server/pipelines/runtime/`, which another
 * lane owns and this change was told not to touch:
 *
 *   · `pipelines/runtime/pluginBindings.ts` — `import type { RuntimeManager }`
 *   · `pipelines/runtime/pluginBindings.int.test.ts` — `new RuntimeManager(…)`
 *
 * **Delete this file** the moment those two import `SandboxManager` from
 * `$lib/server/plugins/SandboxManager`. It is a one-line change on each side.
 *
 * **What breaks if it outlives that condition:** nothing at runtime — but the
 * old name stays reachable and importable, so the codebase carries two words
 * for one thing and new code can pick either. That is precisely the decay R1
 * exists to prevent, and it is invisible until somebody greps.
 */
export { SandboxManager as RuntimeManager } from "./SandboxManager"
