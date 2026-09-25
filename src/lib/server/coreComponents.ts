/**
 * Core's own components, served to the page's UI worker (C7).
 *
 * A plugin's components arrive built, in its package (`/plugin-ui/…`); core's
 * are built here from the app's source until they move into the core library
 * (C7 cutover) — the same bundler `serene-pub build` runs, so what the page
 * mounts is what a package would ship. Built on first request and again when
 * any file the module was built from changes. Dev only: a production build
 * serves nothing here until the cutover ships them prebuilt.
 */
import { mkdir, readFile, stat } from "node:fs/promises"
import { createHash } from "node:crypto"
import { join, resolve } from "node:path"

/** Core component slug → its entry, relative to the app root. */
export const CORE_COMPONENT_ENTRIES: Readonly<Record<string, string>> = {
	messages: "src/lib/client/components/sessionMessages/remote/messages-widget.ts"
}

interface Built {
	code: string
	etag: string
	inputs: string[]
	builtAt: number
}

const built = new Map<string, Built>()
const building = new Map<string, Promise<Built>>()

async function newestChange(files: string[]): Promise<number> {
	let newest = 0
	for (const f of files) {
		const m = await stat(f).then(
			(s) => s.mtimeMs,
			() => Number.POSITIVE_INFINITY // a vanished input is a change
		)
		if (m > newest) newest = m
	}
	return newest
}

async function build(slug: string, entry: string): Promise<Built> {
	const root = process.cwd()
	const { bundleComponent } = await import("@serene-pub/cli")
	const dir = join(root, "node_modules", ".cache", "serene-pub-core-ui")
	await mkdir(dir, { recursive: true })
	const outfile = join(dir, `${slug}.js`)
	const result = await bundleComponent({
		entry: resolve(root, entry),
		outfile,
		root,
		alias: { $lib: resolve(root, "src/lib") }
	})
	const code = await readFile(outfile, "utf8")
	return {
		code,
		etag: `"${createHash("sha256").update(code).digest("hex").slice(0, 32)}"`,
		inputs: result.inputs,
		builtAt: Date.now()
	}
}

/** The built module for a core component slug, or null for one core does not ship. */
export async function coreComponentModule(slug: string): Promise<Built | null> {
	const entry = CORE_COMPONENT_ENTRIES[slug]
	if (!entry) return null
	const held = built.get(slug)
	if (held && (await newestChange(held.inputs)) <= held.builtAt) return held
	let pending = building.get(slug)
	if (!pending) {
		pending = build(slug, entry).finally(() => building.delete(slug))
		building.set(slug, pending)
	}
	const fresh = await pending
	built.set(slug, fresh)
	return fresh
}
