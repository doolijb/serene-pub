/**
 * The **component compile service** (C6, P3): the SDK's one component
 * compiler (`@serene-pub/cli/component-compile`, `compileComponentSource`,
 * `mode: 'in-app'`) run for this server — in a `worker_threads` worker, with
 * a time limit, a heap cap and one compile per authored component at a time.
 *
 * - **Isolated.** Every compile is its own worker: a pathological source
 *   that loops the Svelte compiler or exhausts its heap takes down that
 *   worker, never the server. {@link COMPILE_TIMEOUT_MS} and
 *   {@link COMPILE_HEAP_MB} are the bounds; a compile past either is
 *   stopped and comes back as an error, like any other.
 * - **The toolchain is the app's own.** Native esbuild (the SDK CLI's
 *   bundler, owner ruling 2026-09-25) and the app's `svelte/compiler` are
 *   injected; `resolveFrom` is the app root, so the allowlisted packages
 *   (`@serene-pub/component-client`, `controls`, `core-catalog`, `sdk`)
 *   resolve exactly as the running app resolves them.
 * - **No compiler is a state, not a crash.** On Android there is none by
 *   ruling (nodejs-mobile 18 cannot start esbuild, and the release prunes
 *   it); anywhere the toolchain does not resolve, the same. Callers ask
 *   {@link componentCompilerAvailability} and get a reason; a compile asked
 *   for anyway throws {@link ComponentCompilerUnavailable}, never anything
 *   rawer.
 *
 * ⚠ This module never imports the compiler, esbuild or `svelte/compiler`,
 * not even for types: the compiler's declarations name `svelte/compiler`
 * from the SDK's tree, and a second Svelte in svelte-check's program breaks
 * every `Snippet` type in the app. The worker loads all three by file URL,
 * resolved here; the shapes it answers with are declared locally below.
 */
import { Worker } from "node:worker_threads"
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { getAuthoredComponent, recordAuthoredCompile, type AuthoredComponentRow } from "./store"
import { writeArtifact } from "./cache"

/* ── the shapes the worker answers with (the compiler's, declared locally) ── */

/** Where a compile error sits in the authored file: line 1-based, column 0-based; `line` 0 when it has no place. */
export interface ComponentCompileError {
	file: string
	line: number
	column: number
	text: string
}

/** What one compile gives: the module and its hash, or the errors. */
export interface ComponentCompileOutcome {
	/** The self-contained ES module; `''` when `errors` is not empty. */
	code: string
	/** SHA-256 of `code`, hex — the artifact hash; `''` when `errors` is not empty. */
	hash: string
	errors: ComponentCompileError[]
	/** Said, not fatal. */
	warnings: string[]
	/** The toolchain fingerprint of what built it. */
	fingerprint: string
}

export type ComponentFramework = "svelte" | "vanilla"

export interface ComponentCompileInput {
	files: Record<string, string>
	entry: string
	framework: ComponentFramework
}

/* ── bounds ──────────────────────────────────────────────────────────────── */

/** A compile still running after this is stopped (its worker terminated). */
export const COMPILE_TIMEOUT_MS = 10_000
/** A compile's worker heap (old generation) cap, MB. */
export const COMPILE_HEAP_MB = 384
/** At most this many compile workers at once, server-wide. */
const MAX_CONCURRENT = 2

/* ── the toolchain ───────────────────────────────────────────────────────── */

/** Where the worker loads the three modules from, and where the compiler resolves imports. */
export interface CompilerToolchain {
	/** `file:` (or, in tests, `data:`) URLs of the modules the worker imports. */
	urls: { compile: string; esbuild: string; svelte: string }
	/** The app root: the directory whose `node_modules` the running app resolves from. */
	resolveFrom: string
}

export type CompilerAvailability = { available: true; toolchain: CompilerToolchain } | { available: false; reason: string }

/** Asked for a compile where there is no compiler. `reason` is a sentence. */
export class ComponentCompilerUnavailable extends Error {
	constructor(readonly reason: string) {
		super(`no component compiler on this server: ${reason}`)
		this.name = "ComponentCompilerUnavailable"
	}
}

/** The nearest directory at or above `from` holding both `package.json` and `node_modules`. */
function findAppRoot(from: string): string | null {
	let dir = resolve(from)
	for (;;) {
		if (existsSync(join(dir, "package.json")) && existsSync(join(dir, "node_modules"))) return dir
		const up = dirname(dir)
		if (up === dir) return null
		dir = up
	}
}

/** `name`'s package directory as Node would find it from `root` (no `exports` needed), realpath'd. */
function packageDir(name: string, root: string): string | null {
	let dir = root
	for (;;) {
		const candidate = join(dir, "node_modules", name)
		if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate)
		const up = dirname(dir)
		if (up === dir) return null
		dir = up
	}
}

type ExportsMap = Record<string, unknown>
function exportTarget(pkgDir: string, subpath: string, conditions: string[]): string | null {
	const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as { exports?: ExportsMap; main?: string }
	if (subpath === "." && !pkg.exports) return join(pkgDir, pkg.main ?? "index.js")
	let entry: unknown = pkg.exports?.[subpath]
	while (entry && typeof entry === "object") {
		const map = entry as Record<string, unknown>
		const hit = conditions.find((c) => c in map)
		if (!hit) return null
		entry = map[hit]
	}
	return typeof entry === "string" ? join(pkgDir, entry) : null
}

let resolved: CompilerAvailability | undefined
let override: CompilerAvailability | undefined

/**
 * Whether this server can compile components, and with what. Resolved once
 * (the toolchain cannot change under a running server). Android never has
 * one (`SERENE_PUB_PLATFORM=android`, as `isAndroidWrapper` reads it); any
 * other server has one exactly when esbuild, Svelte's compiler and the SDK
 * CLI's compiler module all resolve from the app root.
 */
export function componentCompilerAvailability(): CompilerAvailability {
	if (override) return override
	if (resolved) return resolved
	resolved = detect()
	return resolved
}

function detect(): CompilerAvailability {
	if (process.env.SERENE_PUB_PLATFORM === "android")
		return { available: false, reason: "components are not compiled on Android — authored components run only from share files that carry their compiled module" }
	const here = (() => {
		try {
			return dirname(fileURLToPath(import.meta.url))
		} catch {
			return process.cwd()
		}
	})()
	const root = findAppRoot(here) ?? findAppRoot(process.cwd())
	if (!root) return { available: false, reason: "the app's node_modules could not be found" }
	const missing: string[] = []
	const find = (name: string, subpath: string, conditions: string[]) => {
		const dir = packageDir(name, root)
		const file = dir ? exportTarget(dir, subpath, conditions) : null
		if (!file || !existsSync(file)) {
			missing.push(subpath === "." ? name : `${name}/${subpath.slice(2)}`)
			return ""
		}
		return pathToFileURL(file).href
	}
	const compile = find("@serene-pub/cli", "./component-compile", ["import", "default"])
	const esbuild = find("esbuild", ".", ["node", "import", "require", "default"])
	const svelte = find("svelte", "./compiler", ["import", "default"])
	if (missing.length) return { available: false, reason: `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not installed` }
	return { available: true, toolchain: { urls: { compile, esbuild, svelte }, resolveFrom: root } }
}

/**
 * @internal Tests only: stand in for the detected toolchain (a slow or
 * missing compiler), or `undefined` to detect afresh.
 */
export function __setComponentCompilerForTests(next: CompilerAvailability | undefined): void {
	override = next
	resolved = undefined
	fingerprintCache = undefined
}

/* ── the worker ──────────────────────────────────────────────────────────── */

/*
 * The worker's whole program. CommonJS text evaluated in the worker, so it
 * is never a module of the app's build — it imports the three modules by the
 * URLs it is handed, and nothing else. `op` is `compile` or `fingerprint`.
 */
const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require("node:worker_threads")
const pick = (m, key) => (m && m[key] ? m : m && m.default && m.default[key] ? m.default : m)
;(async () => {
	let compiler, esbuild, svelte
	try {
		;[compiler, esbuild, svelte] = await Promise.all([
			import(workerData.urls.compile),
			import(workerData.urls.esbuild),
			import(workerData.urls.svelte)
		])
		compiler = pick(compiler, "compileComponentSource")
		esbuild = pick(esbuild, "build")
		svelte = pick(svelte, "compile")
	} catch (e) {
		parentPort.postMessage({ kind: "unavailable", message: String((e && e.message) || e) })
		return
	}
	try {
		if (workerData.op === "fingerprint") {
			const fingerprint = compiler.toolchainFingerprint({ esbuild, svelte, resolveFrom: workerData.resolveFrom })
			parentPort.postMessage({ kind: "fingerprint", fingerprint })
		} else {
			const result = await compiler.compileComponentSource({
				files: workerData.input.files,
				entry: workerData.input.entry,
				framework: workerData.input.framework,
				mode: "in-app",
				esbuild,
				svelte,
				resolveFrom: workerData.resolveFrom
			})
			parentPort.postMessage({ kind: "result", result })
		}
	} catch (e) {
		parentPort.postMessage({ kind: "crash", message: String((e && e.message) || e) })
	} finally {
		try { if (esbuild && typeof esbuild.stop === "function") await esbuild.stop() } catch {}
	}
})()
`

type WorkerAnswer =
	| { kind: "result"; result: ComponentCompileOutcome }
	| { kind: "fingerprint"; fingerprint: string }
	| { kind: "unavailable"; message: string }
	| { kind: "crash"; message: string }

/** A worker's run that did not answer: stopped at the limit, out of heap, or dead. */
class CompileStopped extends Error {}

let active = 0
const waiting: Array<() => void> = []
async function slot<T>(fn: () => Promise<T>): Promise<T> {
	if (active >= MAX_CONCURRENT) await new Promise<void>((r) => waiting.push(r))
	active++
	try {
		return await fn()
	} finally {
		active--
		waiting.shift()?.()
	}
}

let runs = 0
/** How many compile workers this process has started — observability (and the single-flight tests). */
export const componentCompileRuns = (): number => runs

interface RunOptions {
	timeoutMs?: number
	heapMb?: number
}

function runWorker(
	toolchain: CompilerToolchain,
	job: { op: "compile"; input: ComponentCompileInput } | { op: "fingerprint" },
	opts: RunOptions = {}
): Promise<WorkerAnswer> {
	const timeoutMs = opts.timeoutMs ?? COMPILE_TIMEOUT_MS
	const heapMb = opts.heapMb ?? COMPILE_HEAP_MB
	return slot(
		() =>
			new Promise<WorkerAnswer>((resolveAnswer, reject) => {
				runs++
				const worker = new Worker(WORKER_SOURCE, {
					eval: true,
					workerData: { ...job, urls: toolchain.urls, resolveFrom: toolchain.resolveFrom },
					resourceLimits: { maxOldGenerationSizeMb: heapMb, maxYoungGenerationSizeMb: Math.min(64, Math.max(8, heapMb >> 3)) },
					// The worker gets no environment of the server's (keys, tokens).
					env: {}
				})
				let settled = false
				const finish = (fn: () => void) => {
					if (settled) return
					settled = true
					clearTimeout(timer)
					fn()
					void worker.terminate().catch(() => {})
				}
				const timer = setTimeout(
					() =>
						finish(() =>
							reject(new CompileStopped(`the compile took longer than ${Math.round(timeoutMs / 100) / 10} s and was stopped`))
						),
					timeoutMs
				)
				worker.once("message", (m: WorkerAnswer) => finish(() => resolveAnswer(m)))
				worker.once("error", (e: Error & { code?: string }) =>
					finish(() =>
						reject(
							new CompileStopped(
								e.code === "ERR_WORKER_OUT_OF_MEMORY"
									? `the compile ran out of memory (${heapMb} MB) and was stopped`
									: `the compile stopped: ${e.message}`
							)
						)
					)
				)
				worker.once("exit", (code) =>
					finish(() => reject(new CompileStopped(`the compile stopped before answering (exit ${code})`)))
				)
			})
	)
}

function requireToolchain(): CompilerToolchain {
	const a = componentCompilerAvailability()
	if (!a.available) throw new ComponentCompilerUnavailable(a.reason)
	return a.toolchain
}

let fingerprintCache: Promise<string> | undefined

/**
 * The toolchain fingerprint of this server's compiler (`toolchainFingerprint`
 * as the worker computes it — the same value every compile stamps). A stored
 * artifact whose fingerprint differs was built by another toolchain and is
 * recompiled at boot. Throws {@link ComponentCompilerUnavailable} with no compiler.
 */
export function currentToolchainFingerprint(opts: RunOptions = {}): Promise<string> {
	const toolchain = requireToolchain()
	if (!fingerprintCache) {
		const p = runWorker(toolchain, { op: "fingerprint" }, opts).then((a) => {
			if (a.kind === "fingerprint") return a.fingerprint
			if (a.kind === "unavailable") throw new ComponentCompilerUnavailable(a.message)
			throw new Error(a.kind === "crash" ? a.message : "the compiler answered without a fingerprint")
		})
		fingerprintCache = p
		// A failure is not remembered: the next ask tries again.
		p.catch(() => {
			if (fingerprintCache === p) fingerprintCache = undefined
		})
	}
	return fingerprintCache
}

/**
 * Compile a component's source — the P0 compiler in in-app mode, in a
 * worker. Never throws for the author's mistakes or a runaway compile: those
 * come back in `errors` (a stopped compile as one error at the entry, line
 * 0). Throws only {@link ComponentCompilerUnavailable}.
 */
export async function compileComponent(input: ComponentCompileInput, opts: RunOptions = {}): Promise<ComponentCompileOutcome> {
	const toolchain = requireToolchain()
	const job = { op: "compile" as const, input: { files: input.files, entry: input.entry, framework: input.framework } }
	let answer: WorkerAnswer
	try {
		answer = await runWorker(toolchain, job, opts)
	} catch (e) {
		if (!(e instanceof CompileStopped)) throw e
		return stopped(input, e.message, await currentToolchainFingerprint().catch(() => ""))
	}
	if (answer.kind === "result") return answer.result
	if (answer.kind === "unavailable") throw new ComponentCompilerUnavailable(answer.message)
	return stopped(
		input,
		answer.kind === "crash" ? `the compiler failed: ${answer.message}` : "the compiler answered nothing",
		await currentToolchainFingerprint().catch(() => "")
	)
}

const stopped = (input: ComponentCompileInput, text: string, fingerprint: string): ComponentCompileOutcome => ({
	code: "",
	hash: "",
	errors: [{ file: input.entry, line: 0, column: 0, text }],
	warnings: [],
	fingerprint
})

/** Compile errors as the one text `last_error` holds: `file:line:column text`, a line each. */
export function describeCompileErrors(errors: ComponentCompileError[]): string {
	return errors
		.map((e) => `${e.file || "(component)"}${e.line ? `:${e.line}:${e.column}` : ""} ${e.text}`)
		.join("\n")
}

/* ── the internal API P4's socket verbs call ─────────────────────────────── */

/**
 * Compile without saving — the editor's preview. Same compiler, same rules,
 * same bounds as a save; nothing is written, nothing recorded.
 * Throws {@link ComponentCompilerUnavailable} with no compiler.
 */
export function previewCompile(
	files: Record<string, string>,
	entry: string,
	framework: ComponentFramework
): Promise<ComponentCompileOutcome> {
	return compileComponent({ files, entry, framework })
}

export interface CompileAndRecordResult {
	/** False when there is no such component. */
	found: boolean
	/** The source hash that was compiled. */
	sourceHash: string
	outcome: ComponentCompileOutcome
	/** True when the result landed on the row (false: the row's source moved on meanwhile, or it was deleted). */
	recorded: boolean
}

/**
 * Compile an authored component's CURRENT source, put the artifact in the
 * component cache, and record the result on its row (`recordAuthoredCompile`
 * — an artifact hash, or the errors as `last_error`, plus the fingerprint).
 *
 * Single-flight per component: while one compile of `id` runs, every caller
 * after it shares ONE follow-up compile that starts when it ends and reads
 * the row afresh — so a burst of saves is two compiles, and the last one is
 * of the last source. Throws {@link ComponentCompilerUnavailable} with no compiler.
 */
export function compileAndRecord(db: Db, id: string, opts: RunOptions = {}): Promise<CompileAndRecordResult> {
	try {
		requireToolchain()
	} catch (e) {
		return Promise.reject(e)
	}
	let s = flights.get(id)
	if (!s) {
		s = { running: undefined as unknown as Promise<CompileAndRecordResult> }
		flights.set(id, s)
		return launch(s, db, id, opts)
	}
	const slotted = s
	if (!slotted.queued)
		slotted.queued = slotted.running
			.then(
				() => {},
				() => {}
			)
			.then(() => {
				slotted.queued = undefined
				return launch(slotted, db, id, opts)
			})
	return slotted.queued
}

interface Flight {
	running: Promise<CompileAndRecordResult>
	queued?: Promise<CompileAndRecordResult>
}
const flights = new Map<string, Flight>()

function launch(s: Flight, db: Db, id: string, opts: RunOptions): Promise<CompileAndRecordResult> {
	const p: Promise<CompileAndRecordResult> = compileRow(db, id, opts).finally(() => {
		if (s.running === p && !s.queued) flights.delete(id)
	})
	s.running = p
	return p
}

async function compileRow(db: Db, id: string, opts: RunOptions): Promise<CompileAndRecordResult> {
	const row: AuthoredComponentRow | undefined = await getAuthoredComponent(db, id)
	if (!row) return { found: false, sourceHash: "", outcome: stopped({ files: {}, entry: "", framework: "svelte" }, `no authored component '${id}'`, ""), recorded: false }
	const outcome = await compileComponent(
		{ files: row.files, entry: row.entry, framework: row.framework as ComponentFramework },
		opts
	)
	let recorded: boolean
	if (!outcome.errors.length && outcome.hash) {
		await writeArtifact(id, outcome.hash, outcome.code)
		recorded = await recordAuthoredCompile(db, id, {
			sourceHash: row.sourceHash,
			fingerprint: outcome.fingerprint,
			artifactHash: outcome.hash
		})
	} else {
		recorded = await recordAuthoredCompile(db, id, {
			sourceHash: row.sourceHash,
			fingerprint: outcome.fingerprint,
			error: describeCompileErrors(outcome.errors) || "the compile failed"
		})
	}
	return { found: true, sourceHash: row.sourceHash, outcome, recorded }
}
