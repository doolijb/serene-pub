/**
 * The registry: ONE map, and importing it must load nothing.
 *
 * Two properties, both of which fail silently on the machine that runs CI:
 *
 *   1. **The thunks stay thunks.** `@lmstudio/sdk` uses `\p{Lu}` regex property
 *      escapes that fail to PARSE under nodejs-mobile's V8, so a static import
 *      anywhere in this module's graph crashes server boot on Android — before
 *      any code runs, whether or not LM Studio was ever configured. On Linux it
 *      imports perfectly, every test stays green, and the first report is a phone
 *      that will not start. Turning `import()` into a top-level import is a
 *      one-line "simplification" with no local symptom, which is precisely why it
 *      is asserted rather than trusted to the comment on the file.
 *   2. **The loaders read this map and nothing else.** They used to be two
 *      `switch` statements, and the point of collapsing them is that the
 *      conformance test walks the same mapping the render path does. A loader
 *      that grew a case of its own would give a type an adapter the manifest
 *      knows nothing about — or refuse one it declares — and neither shows up
 *      until someone binds that connection to a slot.
 *
 * Every adapter module is replaced by a marker that records the moment it is
 * imported, so nothing heavy loads here and "was it loaded" is observable at all.
 * This is a narrower question than the import-boundary test, which asks whether
 * the CLIENT path (manifest → capability rows) can reach an adapter module; this
 * one is about the server-side map itself staying lazy.
 */

import { describe, expect, it, vi } from "vitest"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

const { loaded, stub, STUBBED } = vi.hoisted(() => {
	const loaded: string[] = []
	/** Every module this file stands in for — filled as the mocks are declared. */
	const STUBBED: string[] = []
	/** A module that exists only to say it was imported. */
	const stub = (name: string) => {
		STUBBED.push(name)
		return () => {
			loaded.push(name)
			return { default: { Adapter: class {}, __name: name } }
		}
	}
	return { loaded, stub, STUBBED }
})

vi.mock("$lib/server/connectionAdapters/LMStudioAdapter", stub("LMStudio"))
vi.mock("$lib/server/connectionAdapters/OllamaAdapter", stub("Ollama"))
vi.mock("$lib/server/connectionAdapters/OpenAIChatAdapter", stub("OpenAIChat"))
vi.mock("$lib/server/connectionAdapters/LlamaCppAdapter", stub("LlamaCpp"))
vi.mock("$lib/server/connectionAdapters/KoboldCppAdapter", stub("KoboldCpp"))
vi.mock(
	"$lib/server/connectionAdapters/KoboldCppManagedAdapter",
	stub("KoboldCppManaged")
)
vi.mock("$lib/server/connectionAdapters/AnthropicAdapter", stub("Anthropic"))
vi.mock("$lib/server/imageAdapters/A1111Adapter", stub("A1111"))
vi.mock(
	"$lib/server/imageAdapters/KoboldCppManagedImageAdapter",
	stub("KoboldCppManagedImage")
)

describe("ADAPTER_REGISTRY", () => {
	/**
	 * ⚠ ONE test, and it must stay FIRST in this file.
	 *
	 * A factory mock is evaluated once per run and `vi.resetModules()` does not
	 * clear the mock registry, so "was this module loaded" can be observed exactly
	 * once — after that every import is a cache hit and the log stops moving.
	 * Split into two tests this would quietly stop asserting anything the moment
	 * either one ran second, which is the failure mode a test file about lazy
	 * loading can least afford.
	 */
	it("stays lazy: importing loads nothing, and a lookup loads only what it names", async () => {
		const { ADAPTER_REGISTRY } = await import("./registry")
		// Not vacuous: the map is populated, and still nothing was pulled in.
		expect(Object.keys(ADAPTER_REGISTRY).length).toBeGreaterThan(0)
		expect(loaded).toEqual([])

		// Through the LOADER rather than the raw thunk, because that is the path
		// production takes and it is where a walk over the map would be written —
		// an eager `Promise.all` here imports every backend's SDK on the first
		// render, which on Android is a boot the user never sees complete.
		const { getImageAdapter } = await import("../utils/getImageAdapter")
		await getImageAdapter(CONNECTION_TYPE.A1111)
		expect(loaded).toEqual(["A1111"])
	})

	it("gives every registered type at least one module", async () => {
		// An entry that is all comment and no thunk is a type both loaders refuse
		// while the manifest still describes it — a connection nobody can use, with
		// nothing anywhere saying why.
		const { ADAPTER_REGISTRY } = await import("./registry")
		for (const [type, modules] of Object.entries(ADAPTER_REGISTRY))
			expect({ type, has: !!(modules.text || modules.image) }).toEqual({
				type,
				has: true
			})
	})
})

describe("the loaders", () => {
	it("route exactly what the registry says, both families", async () => {
		const { ADAPTER_REGISTRY } = await import("./registry")
		const { getConnectionAdapter } = await import(
			"../utils/getConnectionAdapter"
		)
		const { getImageAdapter } = await import("../utils/getImageAdapter")

		for (const [type, modules] of Object.entries(ADAPTER_REGISTRY)) {
			// `.then(() => true, () => false)` rather than rejects.toThrow in a
			// loop: what is under test is WHICH types resolve, and a boolean pair
			// names the offender in the diff instead of failing on an assertion
			// whose message says nothing about `type`.
			const text = await getConnectionAdapter(type).then(
				() => true,
				() => false
			)
			const image = await getImageAdapter(type).then(
				() => true,
				() => false
			)
			expect({ type, text, image }).toEqual({
				type,
				text: !!modules.text,
				image: !!modules.image
			})
		}

		// Every mock above was actually reached — which is how a mistyped mock path
		// is caught. An unmocked module loads for REAL here and pushes nothing, so
		// the loop would still pass while this file quietly imported
		// `@lmstudio/sdk` — the one import the whole arrangement exists to keep out
		// of a module graph. A new adapter module means a new `vi.mock` above.
		expect([...new Set(loaded)].sort()).toEqual([...STUBBED].sort())
	})

	it("refuse a type nothing serves, rather than returning something empty", async () => {
		// A row can carry a type from a newer version, or from an adapter that was
		// removed. Both loaders throw for it; an undefined module handed back would
		// fail at `new Adapter(...)` with no mention of the connection.
		const { getConnectionAdapter } = await import(
			"../utils/getConnectionAdapter"
		)
		const { getImageAdapter } = await import("../utils/getImageAdapter")
		await expect(getConnectionAdapter("not-a-type")).rejects.toThrow(
			/Unsupported connection type/
		)
		await expect(getImageAdapter("not-a-type")).rejects.toThrow(
			/No image adapter/
		)
	})
})
