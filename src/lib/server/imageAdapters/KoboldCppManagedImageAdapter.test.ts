/**
 * The managed image connection's TEST and LIST, which A1111's own get wrong.
 *
 * Both failures here are silent in the sense that matters: they produce a
 * confident, plausible answer about a connection that is fine, and the person
 * reading it has no way to tell it apart from a real fault.
 *
 *   - A1111's `testConnection` asks `/sdapi/v1/sd-models`, which 404s whenever
 *     koboldcpp holds a text model. With one model resident at a time that is the
 *     resting state, so a correctly configured image connection reported
 *     "Reachable, but it has no image API."
 *   - A1111's `listModels` returns the checkpoints the server already holds. The
 *     Manager holds none until a render asks for one, so the Checkpoint dropdown
 *     came back empty and there was nothing to pick.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

let settings: any
let models: any[]
let pinged: string[] = []
let pingOk = true
/** Files the (mocked) image directory actually contains. */
let onDisk: string[] = []

vi.mock("$lib/server/db", () => ({
	db: {
		query: {
			koboldCppSettings: { findFirst: async () => settings },
			koboldCppModels: { findMany: async () => models }
		}
	}
}))

vi.mock("$lib/server/koboldcpp/kcppHttp", () => ({
	pingKoboldCPP: async (baseUrl: string) => {
		pinged.push(baseUrl)
		return pingOk
	}
}))

vi.mock("$lib/server/koboldcpp/modelsDir", () => ({
	resolveModelPath: async (
		_kind: string,
		filename: string,
		_settings: unknown,
		_opts: unknown
	) => {
		if (!onDisk.includes(filename))
			throw new Error(`Model file not found: ${filename}`)
		return `/models/image/${filename}`
	}
}))

const connection = (over: Record<string, unknown> = {}) =>
	({
		id: 4,
		name: "SDXL Turbo",
		type: "koboldcpp_managed_image",
		modality: "image-gen",
		// Stale on purpose. A managed row's own URL is a display value; the
		// Manager's settings say where the process actually is.
		baseUrl: "http://localhost:9999",
		model: "sdxl-turbo-q8.gguf",
		extraJson: {},
		...over
	}) as unknown as SelectConnection

const load = async () => (await import("./KoboldCppManagedImageAdapter")).default

beforeEach(() => {
	vi.resetModules()
	pinged = []
	pingOk = true
	onDisk = ["sdxl-turbo-q8.gguf"]
	settings = {
		koboldCppManagerEnabled: true,
		koboldCppManagedMode: "managed",
		koboldCppManagerBaseUrl: "http://localhost:5001",
		koboldCppManagerModelsDir: "/models/llm",
		koboldCppImageModelsDir: "/models/image"
	}
	models = [
		{ filename: "sdxl-turbo-q8.gguf", kind: "image", status: "complete" },
		{ filename: "flux1-schnell.gguf", kind: "image", status: "complete" },
		{ filename: "MN-12B-Lyra-v4.gguf", kind: "text", status: "complete" }
	]
})

describe("testConnection", () => {
	it("passes while the process is holding a text model, which is the normal resting state", async () => {
		// The reported bug, inverted into a property: nothing here asks whether
		// the backend can draw RIGHT NOW, because loading the image model is
		// deferred to render time exactly as it is for an LLM. A test that asked
		// would fail every correctly configured connection.
		const adapter = await load()
		const res = await adapter.testConnection(connection())
		expect(res.ok).toBe(true)
		expect(res.error).toBeUndefined()
	})

	it("asks the Manager's address, not the row's own", async () => {
		// A port changed after the connection was created lives only in
		// koboldcpp_settings; testing the row's stale copy would report a working
		// Manager as unreachable.
		const adapter = await load()
		await adapter.testConnection(connection())
		expect(pinged).toEqual(["http://localhost:5001"])
	})

	it("reports the probe as natively image-capable", async () => {
		// The manifest already says so, which is what makes this type usable
		// before anything has been loaded. A probe that answered with silence
		// would read as a downgrade the first time someone pressed Test.
		const adapter = await load()
		const res = await adapter.testConnection(connection())
		expect((res.extra as any)?.capabilities).toEqual({
			"text->image": "native"
		})
	})

	it("fails, naming the file, when the model this row points at is gone", async () => {
		// The row can outlive the file — a manual delete, a half-finished
		// download. Every render would fail at load with an error from deep
		// inside the loader, so the test is where it should be caught.
		onDisk = []
		const adapter = await load()
		const res = await adapter.testConnection(connection())
		expect(res.ok).toBe(false)
		expect(res.error).toContain("sdxl-turbo-q8.gguf")
	})

	it("passes with NO model chosen, so the Checkpoint list can be filled in", async () => {
		// connections:test only calls listModels when the test passes, and that
		// list is the dropdown. Failing an unconfigured connection would leave a
		// new one with nothing to choose from and no way out of it.
		const adapter = await load()
		const res = await adapter.testConnection(connection({ model: "" }))
		expect(res.ok).toBe(true)
	})

	it("says the Manager is disabled rather than reporting a bare connection failure", async () => {
		// This type has no server of its own to point at, so "disabled" is the
		// whole diagnosis and a fetch error would bury it.
		settings.koboldCppManagerEnabled = false
		const adapter = await load()
		const res = await adapter.testConnection(connection())
		expect(res.ok).toBe(false)
		expect(res.error).toMatch(/Manager is disabled/i)
		// And nothing was pinged: there is nothing to ping.
		expect(pinged).toEqual([])
	})

	it("passes in MANAGED mode with nothing running, because it is started on demand", async () => {
		// The same mistake as the sd-models 404, one layer out: a cold managed
		// instance is the expected state between sessions, and failing the test
		// for it would report a working connection as broken. The preflight's own
		// rule — only managed mode may spawn — is the one applied here.
		pingOk = false
		const adapter = await load()
		const res = await adapter.testConnection(connection())
		expect(res.ok).toBe(true)
		expect((res.extra as any)?.running).toBe(false)
	})

	it("fails in EXTERNAL mode with nothing running, because nobody will start it", async () => {
		pingOk = false
		settings.koboldCppManagedMode = "external"
		const adapter = await load()
		const res = await adapter.testConnection(connection())
		expect(res.ok).toBe(false)
		expect(res.error).toContain("http://localhost:5001")
	})
})

describe("listModels", () => {
	it("offers the image models the Manager knows about, not the server's checkpoints", async () => {
		const adapter = await load()
		const res = await adapter.listModels(connection())
		expect(res.models).toEqual([
			"flux1-schnell.gguf",
			"sdxl-turbo-q8.gguf"
		])
	})

	it("never offers a text model", async () => {
		// The whole point of the type split. A text GGUF handed to the image
		// loader is a failed load with a filename nobody would connect to a
		// dropdown they picked from days earlier.
		const adapter = await load()
		const res = await adapter.listModels(connection())
		expect(res.models).not.toContain("MN-12B-Lyra-v4.gguf")
	})

	it("never offers an unfinished download", async () => {
		models.push({
			filename: "half-downloaded.gguf",
			kind: "image",
			status: "downloading"
		})
		const adapter = await load()
		const res = await adapter.listModels(connection())
		expect(res.models).not.toContain("half-downloaded.gguf")
	})

	it("leaves an unclassified file out, because a <select> cannot say 'Unverified'", async () => {
		// The Manager shows `unknown` in both lists with a badge and a one-click
		// override. A bare dropdown has neither, so an unknown offered here is
		// indistinguishable from a verified one — the route for a new
		// architecture is to mark it in the Manager.
		models.push({
			filename: "brand-new-arch.gguf",
			kind: "unknown",
			status: "complete"
		})
		const adapter = await load()
		const res = await adapter.listModels(connection())
		expect(res.models).not.toContain("brand-new-arch.gguf")
	})
})

describe("the profile schema", () => {
	it("keeps A1111's own fields alongside the KoboldCPP ones", async () => {
		// The render IS A1111's, so its profile fields still apply. Replacing
		// the schema rather than extending it would silently drop
		// overrideSettings from a form that still sends it.
		const adapter = await load()
		expect(Object.keys(adapter.profileSchema!)).toEqual(
			expect.arrayContaining([
				"restoreFaces",
				"overrideSettings",
				"sdThreads",
				"sdQuant"
			])
		)
	})

	it("offers quantisation by name, because that is what the form renders", async () => {
		// SchemaForm prints an enum's `of` strings verbatim as the option labels.
		// Declaring 0/1/2 would put three bare digits on screen; the ints are
		// koboldcpp's spelling and live behind sdQuantToInt.
		const adapter = await load()
		expect((adapter.profileSchema as any).sdQuant.of).toEqual([
			"off",
			"q8",
			"q4"
		])
	})

	it("declares no default threads, so KoboldCPP keeps deciding", async () => {
		const adapter = await load()
		expect(adapter.profileDefaults).not.toHaveProperty("sdThreads")
	})
})

describe("sdQuantToInt", () => {
	it("maps the form's words onto koboldcpp's ints", async () => {
		const { sdQuantToInt } = await import("./KoboldCppManagedImageAdapter")
		expect(sdQuantToInt("off")).toBe(0)
		expect(sdQuantToInt("q8")).toBe(1)
		expect(sdQuantToInt("q4")).toBe(2)
	})

	it("accepts the ints themselves, however they were stored", async () => {
		// SchemaForm stores strings; anything set through another route may not.
		const { sdQuantToInt } = await import("./KoboldCppManagedImageAdapter")
		expect(sdQuantToInt(2)).toBe(2)
		expect(sdQuantToInt("2")).toBe(2)
	})

	it("returns nothing for a value it cannot read, rather than falling back to 0", async () => {
		// 0 is "don't quantise", a real instruction. Substituting it for a value
		// we failed to read would hide the misconfiguration behind a render at
		// the wrong precision instead of leaving the key off the .kcpps.
		const { sdQuantToInt } = await import("./KoboldCppManagedImageAdapter")
		expect(sdQuantToInt("q6")).toBeUndefined()
		expect(sdQuantToInt(undefined)).toBeUndefined()
		expect(sdQuantToInt("")).toBeUndefined()
	})
})
