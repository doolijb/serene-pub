/**
 * The lazy-adapter architecture, enforced instead of remembered.
 *
 * Every other guard in this area is about what an adapter SAYS. This one is
 * about who is allowed to LOAD one, and the failure it prevents is the worst
 * kind available here: it does not throw, does not fail a test, and does not
 * reproduce on any machine a developer or CI runs.
 *
 * `@lmstudio/sdk` uses `\p{Lu}` regex property escapes that fail to PARSE under
 * nodejs-mobile's build of V8. Not "throw at call" — fail to parse, at module
 * evaluation. So any module that reaches `LMStudioAdapter` from the server's
 * startup graph or from anything the client bundles crashes server boot on
 * Android, before a line of app code runs, whether or not the user has ever
 * heard of LM Studio. On Linux everything is green. That asymmetry is why the
 * rule is a test rather than a convention: a convention is only as good as the
 * next person who has no way to observe breaking it.
 *
 * The shape the architecture takes from that:
 *
 *   - `ADAPTER_REGISTRY` holds THUNKS. Importing it loads no adapter module.
 *   - Both loaders (`getConnectionAdapter`, `getImageAdapter`) are lookups over
 *     it, so a module arrives only when a connection of that type is actually
 *     used.
 *   - `manifest.conformance.test.ts` awaits every thunk on purpose — it is the
 *     one sanctioned eager site, and its header says so at length. This file is
 *     what stops a second one appearing quietly.
 *
 * ## Why a source scan rather than a module-graph walk
 *
 * A graph walk would have to resolve aliases, `.svelte` imports and conditional
 * `import()`s, and would be a small bundler with its own bugs. The rule being
 * enforced is about what a human WROTE — "did you type an adapter path here" —
 * so reading the import specifiers is both simpler and closer to the thing. It
 * follows the precedent in `db/defaults.seedIdSequence.test.ts`, which parses
 * source for the same reason: the invariant lives in the text.
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { describe, expect, test } from "vitest"

const ROOT = resolve(__dirname, "../../../..")
const SRC = join(ROOT, "src")

/** The two directories a concrete adapter module can live in. */
const ADAPTER_DIRS = [
	"lib/server/connectionAdapters",
	"lib/server/imageAdapters"
]

/** Does this specifier point into one of the two adapter directories at all? */
const isAdapterDirSpecifier = (spec: string): boolean =>
	/(?:\$lib\/server|\.\.?)\/(?:connectionAdapters|imageAdapters)\//.test(spec)

/**
 * A CONCRETE adapter module — the thing that must stay lazy.
 *
 * BOTH halves are load-bearing. The name alone matches `getConnectionAdapter`
 * and `getImageAdapter`, which are the LOADERS — the very modules everything is
 * supposed to go through — so a name-only rule flags nine correct call sites and
 * gets deleted the same afternoon. Requiring the directory as well is what makes
 * the rule mean "a class that speaks to a backend" rather than "a path that ends
 * in Adapter".
 *
 * `BaseConnectionAdapter`, `BaseImageAdapter`, `types` and `jsonSchemaToGbnf`
 * also live in those directories and are deliberately excluded: they carry types
 * and pure helpers, pull no backend SDK, and server modules import them freely.
 */
const isConcreteAdapter = (spec: string): boolean =>
	isAdapterDirSpecifier(spec) &&
	/\/(?!Base)[A-Za-z0-9]+Adapter$/.test(spec.replace(/\.(ts|js)$/, ""))

interface ImportSite {
	/** Repo-relative, POSIX — what a failure message prints. */
	file: string
	spec: string
	/** A top-level `import ... from`, as opposed to a lazy `import()`. */
	static: boolean
	/** `import type` / `export type` — erased at build, so it loads nothing. */
	typeOnly: boolean
}

/**
 * Every import specifier in a file, with the two distinctions that matter.
 *
 * Deliberately regex rather than a parser: the specifiers are what is being
 * judged and they are unambiguous in the text. A comment mentioning
 * `@lmstudio/sdk` — of which this repo has nine, all of them explaining this
 * very rule — must not read as an import, which is exactly what matching the
 * `from "…"` form rather than the bare string buys.
 */
function importsIn(file: string, source: string): ImportSite[] {
	const out: ImportSite[] = []
	// Static: `import … from "x"`, `export … from "x"`, and bare `import "x"`.
	const statics =
		/(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^'"()]*?\sfrom\s+)?["']([^"']+)["']/g
	let m: RegExpExecArray | null
	while ((m = statics.exec(source)))
		out.push({
			file,
			spec: m[2],
			static: true,
			typeOnly: !!m[1] || /\{\s*type\s/.test(m[0])
		})
	// Lazy: `import("x")`. Never type-only — a dynamic import is a value.
	const dynamics = /\bimport\s*\(\s*["']([^"']+)["']/g
	while ((m = dynamics.exec(source)))
		out.push({ file, spec: m[1], static: false, typeOnly: false })
	return out
}

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		if (entry === "node_modules" || entry.startsWith(".")) continue
		const full = join(dir, entry)
		if (statSync(full).isDirectory()) walk(full, out)
		else if (/\.(ts|svelte)$/.test(entry)) out.push(full)
	}
	return out
}

const ALL_IMPORTS: ImportSite[] = walk(SRC).flatMap((full) => {
	const file = relative(ROOT, full).split("\\").join("/")
	return importsIn(file, readFileSync(full, "utf8"))
})

const isTest = (file: string) => /\.(test|spec)\.ts$/.test(file)
const inAdapterDir = (file: string) =>
	ADAPTER_DIRS.some((d) => file.startsWith(`src/${d}/`))

describe("no client-reachable module may touch an adapter", () => {
	/**
	 * The picker is the reason this is absolute rather than "value imports only".
	 *
	 * `capabilityRows.ts` resolves capabilities for every connection row against
	 * every slot, and it renders in the BROWSER. That is precisely why the
	 * manifest is static data in `$lib/shared` and not a property read off a
	 * class — see its header. A type-only import would be erased and technically
	 * harmless, and is still refused here: it is one `import type` → `import`
	 * edit away from the crash, and a type both sides need belongs in
	 * `$lib/shared` where both sides can have it.
	 */
	test("nothing under shared/, client/ or routes/ imports a server adapter module", () => {
		const CLIENT_REACHABLE = [
			"src/lib/shared/",
			"src/lib/client/",
			"src/routes/"
		]
		const violations = ALL_IMPORTS.filter(
			(i) =>
				CLIENT_REACHABLE.some((p) => i.file.startsWith(p)) &&
				isAdapterDirSpecifier(i.spec)
		).map(
			(i) =>
				`${i.file} imports "${i.spec}". Adapter modules are server-only and must stay lazily loaded; ` +
				`if this is a type both sides need, move the type to $lib/shared.`
		)
		expect(violations).toEqual([])
	})
})

describe("who may load a concrete adapter module", () => {
	/**
	 * The allowlist, with the reason each entry is on it.
	 *
	 * A bare list of paths rots into a list nobody dares shorten. The reasons are
	 * what let the next reader tell a load-bearing entry from an accident — and
	 * two of these ARE accidents that predate the registry, recorded rather than
	 * quietly blessed.
	 */
	const ALLOWED: Record<string, string> = {
		"src/lib/server/adapters/registry.ts":
			"THE sanctioned site. Every import() here lives inside a thunk, which is what makes the whole architecture lazy.",
		"src/lib/server/sockets/ollama.ts":
			"Pre-existing STATIC import, for `ollamaAdapter.connectionDefaults` alone. It pulls the `ollama` client into the socket-registration graph at boot to read a constant — the defaults belong in $lib/shared/utils/connectionDefaults with the rest, and moving them would delete this entry. Harmless today only because it is not the LM Studio module.",
		"src/lib/server/sockets/koboldcpp.ts":
			"The same pre-existing shape: a STATIC import used only for `koboldCppManagedAdapter.connectionDefaults`. Same fix, same reason it is tolerated rather than approved.",
		"src/lib/server/sockets/images.ts":
			"Lazy import() inside a handler, of the managed image adapter. Loads on use, which is the rule; it predates the registry and should become a registry lookup.",
		"src/lib/server/pipelines/runtime/dispatchImage.ts":
			"Lazy import() inside the dispatcher, same module and same note as sockets/images.ts."
	}

	test("every non-test module that loads an adapter is on the allowlist", () => {
		const violations = ALL_IMPORTS.filter(
			(i) =>
				!inAdapterDir(i.file) &&
				!isTest(i.file) &&
				!i.typeOnly &&
				isConcreteAdapter(i.spec) &&
				!ALLOWED[i.file]
		).map(
			(i) =>
				`${i.file} loads "${i.spec}" directly. Go through getConnectionAdapter()/getImageAdapter(), ` +
				`which look the module up in ADAPTER_REGISTRY and keep the import lazy. ` +
				`If this genuinely cannot, add the file to ALLOWED in this test with the reason.`
		)
		expect(violations).toEqual([])
	})

	test("the allowlist has no stale entries", () => {
		// A stale entry is a licence nobody is using — and the next person to need
		// one finds a precedent instead of this test. Both sockets entries exist to
		// be DELETED once their `connectionDefaults` reads move.
		const used = new Set(
			ALL_IMPORTS.filter(
				(i) => !i.typeOnly && isConcreteAdapter(i.spec)
			).map((i) => i.file)
		)
		const stale = Object.keys(ALLOWED).filter((f) => !used.has(f))
		expect(
			stale,
			`These files no longer load an adapter module. Remove them from ALLOWED — an unused exemption is how the next one gets waved through.`
		).toEqual([])
	})

	test("only the two legacy sockets files load an adapter STATICALLY", () => {
		// The distinction the Android crash turns on. A lazy `import()` inside a
		// handler costs nothing until that backend is used; a top-level import puts
		// the module — and its backend SDK — in its importer's graph unconditionally,
		// which for a socket module means at boot. These two are the only ones, and
		// they are pinned by name so a third cannot arrive without this failing.
		const STATIC_OK = [
			"src/lib/server/sockets/ollama.ts",
			"src/lib/server/sockets/koboldcpp.ts"
		]
		const offenders = ALL_IMPORTS.filter(
			(i) =>
				!inAdapterDir(i.file) &&
				!isTest(i.file) &&
				i.static &&
				!i.typeOnly &&
				isConcreteAdapter(i.spec) &&
				!STATIC_OK.includes(i.file)
		).map(
			(i) =>
				`${i.file} statically imports "${i.spec}". Use a lazy import() (or the loader) — ` +
				`a top-level import puts the backend's SDK in this module's graph whether or not anyone uses that backend.`
		)
		expect(offenders).toEqual([])
	})
})

describe("the module that cannot be parsed on Android", () => {
	/**
	 * `LMStudioAdapter` gets its own rule because it is the only one whose misuse
	 * is unobservable here. Every other backend SDK merely costs startup time when
	 * imported carelessly; this one takes the app down on a platform CI does not
	 * run, at parse time, with no stack anybody will connect back to the import.
	 */
	test("LMStudioAdapter is reached only through the registry thunk and its own tests", () => {
		const ALLOWED_LMSTUDIO = [
			"src/lib/server/adapters/registry.ts",
			"src/lib/server/connectionAdapters/LMStudioAdapter.ts",
			"src/lib/server/connectionAdapters/LMStudioAdapter.test.ts"
		]
		const offenders = ALL_IMPORTS.filter(
			(i) =>
				/LMStudioAdapter$/.test(i.spec.replace(/\.(ts|js)$/, "")) &&
				!i.typeOnly &&
				!ALLOWED_LMSTUDIO.includes(i.file)
		).map((i) => `${i.file} imports "${i.spec}"`)
		expect(offenders).toEqual([])
	})

	test("@lmstudio/sdk itself is named by exactly one module", () => {
		// The rule one level down, so a helper cannot re-export the SDK and hand it
		// to a runtime module while every path above still looks clean.
		//
		// Exactly one, not two: `LMStudioAdapter.test.ts` reaches the package only
		// through `vi.mock("@lmstudio/sdk", …)`, which registers a factory and never
		// evaluates the real thing — and is a call, not an import, so it is
		// correctly invisible to the scanner. The adapter is the only module that
		// actually loads it.
		const importers = [
			...new Set(
				ALL_IMPORTS.filter((i) => i.spec.startsWith("@lmstudio/")).map(
					(i) => i.file
				)
			)
		].sort()
		expect(importers).toEqual([
			"src/lib/server/connectionAdapters/LMStudioAdapter.ts"
		])
	})
})

describe("the capability-defaults path stays off the adapters", () => {
	/**
	 * `$lib/shared/capabilities` is the aggregator and the shape mapper: the
	 * modules that decide WHICH capabilities exist and what vocabulary each one
	 * speaks. Admin → Defaults renders from them in the browser, and the
	 * `connectionDefaults:list` handler renders from the same functions on the
	 * server — that single-sourcing is the point, and it is only possible while
	 * the directory imports nothing a browser cannot have.
	 *
	 * The blanket rule above already forbids an adapter DIRECTORY specifier from
	 * anything under `shared/`. This adds the half that rule cannot see: a
	 * `$lib/server/**` import. Reaching for `capabilityGuard`'s
	 * `storedCapabilities` from here is the specific temptation — it is the
	 * correct reader, the aggregator wants it, and taking it would drag
	 * `$lib/server/db` and Drizzle into the client bundle and put the adapter
	 * manifest one edit away from a server-only graph. The server half passes
	 * the already-judged rows IN instead.
	 */
	const CAPABILITIES_DIR = "src/lib/shared/capabilities/"

	test("nothing in shared/capabilities reaches into $lib/server", () => {
		const violations = ALL_IMPORTS.filter(
			(i) =>
				i.file.startsWith(CAPABILITIES_DIR) &&
				!isTest(i.file) &&
				/^(\$lib\/server\/|\.\.\/\.\.\/server\/)/.test(i.spec)
		).map(
			(i) =>
				`${i.file} imports "${i.spec}". This directory renders in the BROWSER as well as on the server; ` +
				`a server import puts Drizzle (and, one edit later, an adapter) in the client bundle. ` +
				`Have the server caller do the reading and pass the rows in.`
		)
		expect(violations).toEqual([])
	})

	test("the aggregator is actually here, and actually reads the manifest", () => {
		// A boundary test over an empty directory is a green check standing
		// where a guard used to be. This pins that the rule above has something
		// to judge, and that the thing it is judging is the union's source.
		const files = [
			...new Set(
				ALL_IMPORTS.filter((i) =>
					i.file.startsWith(CAPABILITIES_DIR)
				).map((i) => i.file)
			)
		]
		expect(files).toContain("src/lib/shared/capabilities/combos.ts")
		expect(files).toContain("src/lib/shared/capabilities/samplingShape.ts")
		expect(
			ALL_IMPORTS.some(
				(i) =>
					i.file === "src/lib/shared/capabilities/combos.ts" &&
					i.spec === "$lib/shared/connectionAdapters/manifest"
			),
			"combos.ts no longer imports the manifest — either the union lost its servable half, or it now reaches for the adapters instead."
		).toBe(true)
	})
})

describe("the eager load stays in one place", () => {
	/**
	 * `ADAPTER_REGISTRY` is safe to import — the values are thunks. What is not
	 * safe is a module that AWAITS them all, because that pulls every backend SDK
	 * into whatever graph it sits in. Exactly one module does that on purpose:
	 * `manifest.conformance.test.ts`, which has to, and says so in its header.
	 *
	 * Consumers cannot be counted by "does it await a thunk" without parsing, so
	 * the check is on the import instead: a new consumer is fine, and adding it
	 * here is how somebody is made to ask "does this await all of them, and where
	 * does this module run?" before the answer stops mattering on Linux.
	 */
	test("registry consumers are enumerated", () => {
		const CONSUMERS = [
			"src/lib/server/connectionAdapters/manifest.conformance.test.ts",
			"src/lib/server/utils/getConnectionAdapter.ts",
			"src/lib/server/utils/getImageAdapter.ts"
		]
		const found = [
			...new Set(
				ALL_IMPORTS.filter(
					(i) =>
						/(?:\$lib\/server|\.\.)\/adapters\/registry$/.test(
							i.spec
						) && !i.typeOnly
				).map((i) => i.file)
			)
		].sort()
		expect(found).toEqual(CONSUMERS.sort())
	})
})

describe("the scanner itself", () => {
	// A boundary test that silently matches nothing is worse than no boundary
	// test: it is a green check standing where a guard used to be. These pin the
	// two ways this one could quietly stop working.

	test("it actually found the files and imports it is judging", () => {
		expect(ALL_IMPORTS.length).toBeGreaterThan(500)
		expect(
			ALL_IMPORTS.some((i) => isConcreteAdapter(i.spec)),
			"No concrete adapter import was found anywhere. Either the repo moved or the specifier pattern stopped matching — the rules above are all vacuously true right now."
		).toBe(true)
	})

	test("it tells an adapter module from its base class and its helpers", () => {
		expect(isConcreteAdapter("../connectionAdapters/LMStudioAdapter")).toBe(
			true
		)
		expect(
			isConcreteAdapter("$lib/server/imageAdapters/A1111Adapter")
		).toBe(true)
		// Base classes and helpers are types and pure code — server modules import
		// them freely, and a rule that caught them would be turned off by whoever
		// hit it first.
		expect(
			isConcreteAdapter("../connectionAdapters/BaseConnectionAdapter")
		).toBe(false)
		expect(isConcreteAdapter("../imageAdapters/BaseImageAdapter")).toBe(
			false
		)
		expect(isConcreteAdapter("$lib/server/connectionAdapters/types")).toBe(
			false
		)
		expect(
			isConcreteAdapter("$lib/server/connectionAdapters/jsonSchemaToGbnf")
		).toBe(false)
	})

	test("a comment mentioning a module is not an import of it", () => {
		// Nine files in this repo explain the Android hazard in prose, naming
		// `@lmstudio/sdk` in a sentence. A scanner that counted those would fail
		// the rule above on its own documentation.
		const sites = importsIn(
			"x.ts",
			`/**\n * @lmstudio/sdk cannot be parsed on Android.\n * import { X } from "@lmstudio/sdk"\n */\nimport { y } from "./real"\n`
		)
		expect(sites.map((s) => s.spec)).toEqual(["./real"])
	})

	test("it separates a type-only import from a real one", () => {
		const sites = importsIn(
			"x.ts",
			`import type { A } from "./a"\nimport { B } from "./b"\nconst c = await import("./c")\n`
		)
		expect(sites.map((s) => [s.spec, s.typeOnly, s.static])).toEqual([
			["./a", true, true],
			["./b", false, true],
			["./c", false, false]
		])
	})
})
