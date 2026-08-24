/**
 * The script engine, pinned (18 §7).
 *
 * QuickJS compiled to WASM, in-process. The interpreter lives inside WASM
 * linear memory, so even an interpreter bug can only corrupt its own sandbox
 * and nothing host-side is reachable unless we bridge it deliberately. No
 * native addon, so multi-platform packaging is untouched — PGlite's trick,
 * applied to compute rather than storage.
 *
 * ## Why not the obvious alternatives
 *
 * Stated once, here, so nobody re-derives them under time pressure:
 *
 * - `node:vm` is not a security boundary. Its own documentation says so.
 * - `vm2` was discontinued in 2023 after an unpatchable escape; its README
 *   tells you not to use it.
 * - Plain `worker_threads` gives the script the full Node API. A worker is a
 *   *container* for a sandbox, never a sandbox.
 * - `isolated-vm` is a native addon in maintenance mode, with an API that makes
 *   handing a reference across the boundary easy.
 * - SES / Hardened JS is a real capability boundary but same-realm: no memory
 *   cap, no CPU containment, and `lockdown()` freezes intrinsics app-wide.
 *
 * ## The threat model
 *
 * Scripts arrive in shared documents, so assume adversarial authors. The prize
 * on this server is connection credentials; the acceptable failure is bad text
 * in a prompt. The architecture already pre-quarantines the prize — F18 keeps
 * connection material out of the pipeline layer entirely, so scripts execute
 * below the line where keys exist. This is the outer wall, not the only one.
 */

import { getQuickJS, type QuickJSWASMModule } from "quickjs-emscripten"

/**
 * The compiled module, once per process.
 *
 * Compilation is the expensive half and instantiation is the cheap one, which
 * is exactly the split that lets §7's "fresh instance per evaluation" be
 * affordable: the security property, the purity law (F11) and the replay
 * property all come from a context that has never seen another script, and it
 * costs a millisecond because the module above it is already compiled.
 */
let modulePromise: Promise<QuickJSWASMModule> | undefined

export function scriptEngine(): Promise<QuickJSWASMModule> {
	modulePromise ??= getQuickJS()
	return modulePromise
}

/**
 * The pinned version, asserted rather than trusted.
 *
 * ⚠ §7 item 6 asks for the `fetchedDependencies` discipline applied to the
 * thing that executes untrusted text: a vendored, checksummed artifact rather
 * than whatever the registry resolved this morning. This install has no
 * lockfile — deliberately, for multi-platform builds — so the pin lives in
 * `package.json` as an exact version and this constant is what fails the build
 * when the two disagree.
 *
 * It is a version check and not a hash of the `.wasm`, which is the weaker of
 * the two and worth naming as such: it catches an accidental bump, not a
 * compromised tarball. Hashing the binary is the follow-on once the artifact is
 * vendored into the repository instead of resolved from npm.
 */
export const PINNED_ENGINE = "0.32.0"

/** Memory ceiling per context (§7 item 4). Allocation bombs surface as script errors. */
export const DEFAULT_MEMORY_BYTES = 48 * 1024 * 1024

/** Per-call CPU budget, enforced between VM instructions (§7 item 3, F36). */
export const DEFAULT_TIMEOUT_MS = 250

/**
 * How far past the interrupt budget counts as "the interrupt did not work".
 *
 * ⚠ **Not a kill, and the difference is worth being exact about.** §7 asks for
 * two clocks: the interrupt handler inside the VM, and a wall-clock kill
 * outside it as a backstop. Only the first of those is implemented here,
 * because `evalCode` is a synchronous call — nothing on this thread runs while
 * the VM does, so an outer timer has no moment in which to act. A real
 * out-of-band kill needs the evaluation to be on a worker (§7 item 5), where
 * `terminate()` is the backstop above both clocks.
 *
 * What this constant buys in the meantime is *detection*: if control returns
 * having spent more than this, the interrupt failed to fire and the failure is
 * labelled as that rather than as an ordinary timeout. A silent hang becomes a
 * named one, which is the difference between a bug someone can report and a
 * server nobody can explain.
 *
 * The interrupt itself is load-bearing and measured rather than assumed, which
 * §7 item 3 explicitly asks for: it **does** fire during regex backtracking on
 * this build — `/^(a+)+$/` against 40 `a`s and a `b` is interrupted mid-`exec`,
 * with the native frame in the stack. So a hostile ReDoS pattern is not a gap
 * between the clocks on 0.32.0, and no separate regex budget is needed.
 * Removing that interrupt hangs the process outright, which is what makes the
 * corpus case non-negotiable: do not delete it.
 */
export const WALL_CLOCK_FACTOR = 8
