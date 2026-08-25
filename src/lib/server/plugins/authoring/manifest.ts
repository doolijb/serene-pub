/**
 * The manifest compiler — the author-side authoring shape (the SDK surface a
 * plugin's entrypoint declares, frozen for the 0.6.0 preview).
 *
 * A plugin's entrypoint (which is *not* shipped in the bundle) exports a
 * declaration of what the plugin contains — its id, hooks, components,
 * pipelines, and requested permissions. `compileManifest` validates and
 * normalizes that into the manifest JSON the app stores and the runtime reads
 * (the `plugins.manifest` column, which `permissions.ts` interprets). It is the
 * one place the authoring vocabulary is pinned, so drift is caught at build
 * time, not at install.
 *
 * `backends`/`requiresV8` is deliberately **not** an input: it is a compiled
 * fact the app's conformance harness derives by loading the bundle on both
 * sandboxes. An author declares intent (permissions, hooks); the environment
 * decides capability.
 *
 * This is the reference implementation of the shape; the published SDK package
 * (../serene-pub-sdk) re-exports it. Kept dependency-free and pure so it runs in
 * any author toolchain.
 */

const ID_RE = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/
const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+].+)?$/
const HOSTNAME_RE = /^[a-z0-9.-]+(?::\d+)?$/i

export interface ManifestInput {
	/** "namespace/name" — lowercase, the stable address. */
	id: string
	name: string
	version: string
	/** Declared hook names (must be valid identifiers). */
	hooks?: string[]
	/** Declared UI component names. */
	components?: string[]
	/** Included pipeline slugs. */
	pipelines?: string[]
	/** Sequential-only execution (manifest-declared). */
	sequential?: boolean
	permissions?: {
		storage?: { quotaBytes?: number }
		network?: { hosts?: string[] }
		resources?: string[]
		events?: string[]
	}
}

export interface CompiledManifest {
	id: string
	name: string
	version: string
	hooks: string[]
	components: string[]
	pipelines: string[]
	sequential: boolean
	permissions: {
		storage?: { quotaBytes: number }
		network?: { hosts: string[] }
		resources?: string[]
		events?: string[]
	}
}

/** A quota may be declared in bytes; keep it sane (1 KB … 256 MB). */
const MIN_QUOTA = 1024
const MAX_QUOTA = 256 * 1024 * 1024

function fail(msg: string): never {
	throw new Error(`manifest: ${msg}`)
}

function uniqueIdents(list: unknown, field: string): string[] {
	if (list == null) return []
	if (!Array.isArray(list)) fail(`${field} must be an array`)
	const out: string[] = []
	const seen = new Set<string>()
	for (const v of list) {
		if (typeof v !== "string" || !IDENT_RE.test(v))
			fail(`${field} entry '${String(v)}' is not a valid identifier`)
		if (!seen.has(v)) {
			seen.add(v)
			out.push(v)
		}
	}
	return out
}

export function compileManifest(input: ManifestInput): CompiledManifest {
	if (!input || typeof input !== "object") fail("declaration is required")
	if (typeof input.id !== "string" || !ID_RE.test(input.id))
		fail(`id '${String(input.id)}' must be lowercase "namespace/name"`)
	if (typeof input.name !== "string" || input.name.trim() === "")
		fail("name is required")
	if (typeof input.version !== "string" || !SEMVER_RE.test(input.version))
		fail(`version '${String(input.version)}' must be semver (x.y.z)`)

	const hooks = uniqueIdents(input.hooks, "hooks")
	const components = uniqueIdents(input.components, "components")

	const pipelines: string[] = []
	for (const p of input.pipelines ?? []) {
		if (typeof p !== "string" || p.trim() === "")
			fail("pipelines entries must be non-empty strings")
		pipelines.push(p)
	}

	const permissions: CompiledManifest["permissions"] = {}
	const pin = input.permissions ?? {}
	if (pin.storage) {
		const q = pin.storage.quotaBytes ?? 5 * 1024 * 1024
		if (typeof q !== "number" || !Number.isFinite(q) || q < MIN_QUOTA || q > MAX_QUOTA)
			fail(`storage.quotaBytes must be ${MIN_QUOTA}…${MAX_QUOTA}`)
		permissions.storage = { quotaBytes: Math.floor(q) }
	}
	if (pin.network) {
		const hosts = pin.network.hosts ?? []
		if (!Array.isArray(hosts) || hosts.length === 0)
			fail("network requires a non-empty hosts allowlist")
		for (const host of hosts)
			if (typeof host !== "string" || !HOSTNAME_RE.test(host))
				fail(`network host '${String(host)}' is not a valid host[:port]`)
		permissions.network = { hosts: [...new Set(hosts)] }
	}
	if (pin.resources && pin.resources.length) {
		for (const r of pin.resources)
			if (typeof r !== "string" || r.trim() === "")
				fail("resources entries must be non-empty strings")
		permissions.resources = [...new Set(pin.resources)]
	}
	if (pin.events && pin.events.length) {
		for (const e of pin.events)
			if (typeof e !== "string" || e.trim() === "")
				fail("events entries must be non-empty strings")
		permissions.events = [...new Set(pin.events)]
	}

	return {
		id: input.id,
		name: input.name.trim(),
		version: input.version,
		hooks,
		components,
		pipelines,
		sequential: !!input.sequential,
		permissions
	}
}
