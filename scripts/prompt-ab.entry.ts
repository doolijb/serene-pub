/**
 * The A/B comparison itself. Run through `scripts/prompt-ab.js`.
 *
 * Three stages, and the order of the first two is load-bearing.
 *
 * **1. Snapshot, before anything under `src/lib/server` is imported.**
 * `db/index.ts` opens PGlite, takes the lock and runs `migrate()` at *module
 * scope*, so merely importing anything that transitively reaches it touches a
 * database. The brief for this tool is that it must not mutate anything, and a
 * pending migration applied on import is a mutation however harmless it looks —
 * so the process is pointed at a copy and the real directory is never opened at
 * all. That also removes the constraint the previous comparison tool carried
 * (*"needs the server stopped, since the app holds the PGlite lock"*): a copy
 * has no lock to contend for and this runs happily beside a live app.
 *
 * ⚠ **The data directory is resolved here rather than imported from
 * `db/drizzle.config.ts`**, which exports exactly this function. Importing that
 * module would evaluate it — and its `dataDir` is computed at module scope from
 * the environment as it stands *at that moment*. Setting `SERENE_PUB_DATA_DIR`
 * afterwards would be too late: the cached module would still hold the real
 * path, and `db/index.ts` would open the real database while everything else in
 * this file believed it was working on a copy. Twelve duplicated lines against
 * that failure is a good trade, and the duplication is one-way — if the app's
 * rule ever changes, this stops finding a database rather than quietly finding
 * the wrong one.
 *
 * **2. `__APP_VERSION__`.** Vite replaces it at build time and `db/index.ts`
 * reads it at module scope, so it has to exist before the first server import —
 * which is why the work below is behind dynamic imports rather than static ones
 * that would be hoisted above the assignment.
 *
 * **3. The comparison**, which is `$lib/server/pipelines/measure/promptDiff.ts`.
 */

import {
	cpSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync
} from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, resolve } from "node:path"
import os from "node:os"
import envPaths from "env-paths"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "..")

// ── 1. Where the real database lives ────────────────────────────────────────

/** `db/drizzle.config.ts`'s `getAppDataDir`, deliberately duplicated — see above. */
function appDataDir(): string {
	const override = process.env.SERENE_PUB_DATA_DIR
	if (override) return override
	return envPaths("SerenePub", { suffix: "" }).data
}

/** `db/drizzle.config.ts`'s `getDbDataDir`, same rule. */
function dbDataDir(appDir: string): string {
	if (process.env.CI === "true") return join(os.homedir(), "SerenePubData")
	return join(appDir, "data")
}

const realAppDir = appDataDir()
const realDbDir = dbDataDir(realAppDir)

if (!existsSync(realDbDir)) {
	console.error(
		`No Serene Pub database at ${realDbDir}. ` +
			`Set SERENE_PUB_DATA_DIR to the install you want to measure.`
	)
	process.exit(1)
}

/**
 * A throwaway copy of the database, and links to everything else.
 *
 * Only `data/` is copied — a few tens of megabytes, and the only thing this
 * process writes to. Its siblings (`models`, `koboldcpp`, `Backup`) are tens of
 * gigabytes and are **linked**, because the embedding model has to be findable
 * for `--embeddings` to mean anything and copying seventeen gigabytes to read a
 * few hundred megabytes of it would be absurd. Nothing here writes to them: the
 * run halts before the provider, so no model is called and no file is produced.
 */
const snapshot = mkdtempSync(join(os.tmpdir(), "serene-pub-ab-"))
cpSync(realDbDir, join(snapshot, "data"), { recursive: true })
for (const entry of readdirSync(realAppDir)) {
	if (entry === "data") continue
	try {
		symlinkSync(join(realAppDir, entry), join(snapshot, entry))
	} catch {
		// A link that cannot be made is not a reason to abandon the run —
		// whatever it was is simply not visible to this process.
	}
}
process.env.SERENE_PUB_DATA_DIR = snapshot

// ── 2. The build-time constant ──────────────────────────────────────────────

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
;(globalThis as any).__APP_VERSION__ = pkg.version

// ── 3. The work ─────────────────────────────────────────────────────────────

const { db } = await import("$lib/server/db")
const {
	PRESETS,
	SHIPPED,
	comparePrompts,
	presetVariant,
	renderComparison,
	sessionsWithMessages
} = await import("$lib/server/pipelines/measure/promptDiff")
type Override = import("$lib/server/pipelines/measure/promptDiff").Override

const USAGE = `
  npm run pipeline:ab -- --list
  npm run pipeline:ab -- <preset> [sessionId...] [--full|--summary] [--embeddings]
  npm run pipeline:ab -- --set <nodeKey>:<path>=<json> [...] [sessionId...]
`

function parse(argv: string[]) {
	const sessions: number[] = []
	const sets: Override[] = []
	let preset: string | null = null
	let full = false
	let summaryOnly = false
	let embeddings = false
	let list = false
	let keep = false

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!
		if (arg === "--list") list = true
		else if (arg === "--full") full = true
		else if (arg === "--summary") summaryOnly = true
		else if (arg === "--embeddings") embeddings = true
		else if (arg === "--keep") keep = true
		else if (arg === "--set") {
			const spec = argv[++i]
			if (!spec) throw new Error("--set needs <nodeKey>:<path>=<json>")
			const at = spec.indexOf("=")
			const colon = spec.lastIndexOf(":", at === -1 ? undefined : at)
			if (at === -1 || colon === -1)
				throw new Error(
					`--set '${spec}' is not <nodeKey>:<path>=<json>`
				)
			const nodeKey = spec.slice(0, colon)
			const path = spec.slice(colon + 1, at)
			const raw = spec.slice(at + 1)
			let value: unknown
			try {
				value = JSON.parse(raw)
			} catch {
				// A bare word is a string, which is what somebody typing
				// `lexicalScoring=balanced` meant.
				value = raw
			}
			sets.push({ nodeKey, path, value })
		} else if (/^\d+$/.test(arg)) sessions.push(Number(arg))
		else if (arg.startsWith("-"))
			throw new Error(`unknown flag '${arg}'${USAGE}`)
		else if (preset === null) preset = arg
		else throw new Error(`unexpected argument '${arg}'${USAGE}`)
	}

	return { sessions, sets, preset, full, summaryOnly, embeddings, list, keep }
}

async function main(): Promise<number> {
	const args = parse(process.argv.slice(2))

	if (args.list) {
		console.log("\nThings that ship off, and what turning one on buys:\n")
		for (const [name, preset] of Object.entries(PRESETS))
			console.log(`  ${name.padEnd(14)} ${preset.about}`)
		console.log(
			"\nEach is measured against this install as configured." +
				"\nUse --set <nodeKey>:<path>=<json> for anything not listed.\n"
		)
		return 0
	}

	const variant =
		args.sets.length > 0
			? {
					name: args.sets
						.map((s) => `${s.nodeKey}/${s.path}=${JSON.stringify(s.value)}`)
						.join(", "),
					overrides: args.sets
				}
			: args.preset
				? presetVariant(args.preset)
				: null

	if (!variant) {
		console.error(
			args.preset
				? `No preset called '${args.preset}'. Run with --list.`
				: `Nothing to compare against.${USAGE}`
		)
		return 1
	}

	/**
	 * The embedding model, only when asked for.
	 *
	 * Without it `vector-search` reports itself unavailable and the semantic arm
	 * subtracts a signal — correct behaviour, and useless for measuring the arm.
	 * Loading is slow and may download, so it is a flag rather than a default,
	 * and a failure to load is reported rather than fatal: every other mechanism
	 * is still measurable without one.
	 */
	if (args.embeddings) {
		try {
			const { loadConfiguredEmbeddingModel, getLoadedModelId } =
				await import("$lib/server/embedding")
			await loadConfiguredEmbeddingModel()
			console.log(
				`Embedding model: ${getLoadedModelId() ?? "none configured"}`
			)
		} catch (error) {
			console.log(
				`Embedding model could not be loaded (${(error as Error).message}); ` +
					`the semantic arm will report itself unavailable on both sides.`
			)
		}
	}

	const sessions = args.sessions.length
		? args.sessions
		: await sessionsWithMessages(db)

	if (sessions.length === 0) {
		console.log("No sessions with messages — nothing to compare.")
		return 0
	}

	console.log(
		`\nComparing ${sessions.length} session(s) against '${variant.name}'…`
	)

	let changed = 0
	let identical = 0
	let failed = 0
	let entered = 0
	let left = 0

	for (const sessionId of sessions) {
		try {
			const comparison = await comparePrompts({
				db,
				sessionId,
				baseline: SHIPPED,
				variant
			})
			if (comparison.identical) identical++
			else changed++
			entered += comparison.entered.length
			left += comparison.left.length
			console.log(
				renderComparison(comparison, {
					full: args.full,
					summaryOnly: args.summaryOnly
				})
			)
		} catch (error) {
			failed++
			console.log(`◦ session/${sessionId}  ${(error as Error).message}`)
		}
	}

	console.log(
		`${changed} prompt(s) changed, ${identical} identical, ${failed} could not run — ` +
			`${entered} entr${entered === 1 ? "y" : "ies"} entered, ${left} left.`
	)
	/**
	 * ⚠ **Always 0 when it ran.** A difference is the *point* here, not a
	 * finding: the deleted legacy-versus-pipeline comparison exited non-zero on
	 * divergence because it was a gate, and this is the opposite kind of tool.
	 * A non-zero exit would make it unusable in the loop it is for.
	 */
	return failed === sessions.length ? 1 : 0
}

// Exited explicitly, from one place. PGlite keeps a handle open, so a script
// that merely finishes its work sits there until something kills it — which
// looks exactly like a hang on a large session, and is the first thing anyone
// would blame the comparison for.
const cleanup = (keep: boolean) => {
	if (keep) {
		console.log(`Snapshot kept at ${snapshot}`)
		return
	}
	try {
		rmSync(snapshot, { recursive: true, force: true })
	} catch {
		// A worker may still hold it; the OS reclaims the temp directory.
	}
}

main()
	.then((code) => {
		cleanup(process.argv.includes("--keep"))
		process.exit(code)
	})
	.catch((error) => {
		console.error(error)
		cleanup(process.argv.includes("--keep"))
		process.exit(1)
	})
