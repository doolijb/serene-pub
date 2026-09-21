/**
 * `npm run plugin:install -- <dir>` — the terminal half of the dev install (D-6).
 *
 * Reads the package `serene-pub build` wrote, holds it to this instance's
 * requirements, stores it, and projects what it declares: the genre (which is
 * its create pipeline's published row), the pipelines with their owner, the
 * configs, and the client files its frames are served from. The presets, the
 * prompts, the template engines and the event subscriptions are reconciled from
 * the stored manifest by the same syncs that run at boot.
 *
 * It does **not** enable the plugin. A fresh install is disabled by the SHA pin
 * and every declared permission is refused until an administrator reviews it,
 * and skipping either of those from a terminal would make the terminal the way
 * around them. `--enable` flips the one switch, out loud, and leaves the
 * permission review where it is.
 *
 * ⚠ `SP_PLUGINS_ENABLED` is not checked here, unlike the socket handler: a
 * command run deliberately by the person who owns the machine is the flag's
 * audience, not something it protects them from. The flag exists so a shipped
 * release does not surface the subsystem; a terminal is not a surface.
 */
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

// The build-time constant the app's modules read. Set before `$lib/server/db`
// is imported, because that module initialises at module scope.
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"))
;(globalThis as any).__APP_VERSION__ = pkg.version

const USAGE = `
Serene Pub — install a built plugin package

  npm run plugin:install -- <dir>            install the package built in <dir>
  npm run plugin:install -- <dir> --enable   …and switch it on afterwards

<dir> is the package ROOT — the folder holding dist/plugin/manifest.json.
Run 'serene-pub build' in the package first; a folder with only sources has
nothing to install.
`

const argv = process.argv.slice(2)
const flags = new Set(argv.filter((a) => a.startsWith("--")))
const [dir] = argv.filter((a) => !a.startsWith("--"))

if (!dir || flags.has("--help")) {
	process.stdout.write(USAGE)
	process.exit(dir ? 0 : 1)
}

const { db, dbReady } = await import("$lib/server/db")
await dbReady

/**
 * Core's own specs are published by the startup task, not by opening the
 * database — so on a data directory the app has never started against, every
 * package that references a core spec is refused for "not installed on this
 * instance", which is true and completely misleading. Run the same bootstrap
 * the app runs, which is idempotent by construction (`saveDocument` writes
 * nothing for a document it already holds) and is what the next `npm run dev`
 * would do anyway. `check-db-lock.js` has already established that no app has
 * this directory open.
 */
const { bootstrapPipelines } = await import(
	"$lib/server/pipelines/boot/bootstrap"
)
await bootstrapPipelines(db)

const { installPluginPackage } = await import("$lib/server/plugins/install")
const { setEnabled } = await import("$lib/server/plugins/store")

try {
	const report = await installPluginPackage(db, resolve(dir))
	process.stdout.write(`installed '${report.pluginId}'\n`)
	for (const slug of report.specs) process.stdout.write(`  pipeline  ${slug}\n`)
	for (const id of report.genresDeclared)
		process.stdout.write(`  genre     ${id}\n`)
	for (const key of report.configs) process.stdout.write(`  config    ${key}\n`)
	process.stdout.write(`  files     ${report.files.stored}\n`)

	if (flags.has("--enable")) {
		await setEnabled(db, report.pluginId, true)
		// Everything projected from the stored manifest follows the enable
		// switch: presets, prompts, template engines, event subscriptions,
		// layouts. Run them here so a `--enable` install is complete when the
		// command returns rather than at the next boot.
		const { syncPluginPresets, syncPluginTemplates } = await import(
			"$lib/server/pipelines/boot/registrySync"
		)
		await syncPluginPresets(db)
		await syncPluginTemplates(db)
		const { syncPluginLayouts } = await import("$lib/server/db/pluginLayouts")
		await syncPluginLayouts(db)
		process.stdout.write(`  enabled\n`)
	} else {
		process.stdout.write(
			`\nNot enabled. A fresh install is disabled until somebody switches it on, ` +
				`and its declared permissions stay refused until an administrator reviews ` +
				`them in Admin → Extensions. Re-run with --enable to switch it on.\n`
		)
	}

	for (const line of [...report.warnings, ...report.refused])
		process.stderr.write(`warning: ${line}\n`)
	process.exit(0)
} catch (e) {
	process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`)
	process.exit(1)
}
