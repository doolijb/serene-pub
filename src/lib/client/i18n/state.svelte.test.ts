/**
 * The client translation runtime (R5).
 *
 * Four behaviours, each of which fails invisibly if it regresses — the screen
 * still renders, in English, which is also what "working correctly on an
 * English install" looks like:
 *
 *   1. **English costs nothing.** It is every install's default, so the whole
 *      mechanism must be inert until somebody changes a setting.
 *   2. **A source is asked about once per session.** `t()` runs on every render;
 *      re-requesting a string the server could not translate is an infinite
 *      request loop keyed to the framerate.
 *   3. **A miss returns the English.** Never a blank, never a key.
 *   4. **The browser cache primes the catalog**, so a returning visitor paints
 *      translated text on the first frame instead of flashing English.
 *
 * Since phase 2 of the socket-interest plan there is a fifth: the catalog
 * request goes through the **interest registry**, so the `interest:sync` naming
 * `language:catalog` must leave BEFORE the request does. `language:catalog` is
 * a gated event — a reply the server sees no interest in is a translation it
 * never runs — so a request that overtook its own sync would answer nothing.
 *
 * `environment: "node"` (vitest.config.ts), so `localStorage` is stubbed and
 * `document` is deliberately left undefined — the module guards for it, and the
 * guard is what keeps this importable during SSR.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const emitted: Array<{ event: string; payload: any }> = []
let socket: {
	connected: boolean
	emit: (event: string, payload: any) => void
	on: any
	off: any
} | null

vi.mock("$app/environment", () => ({ dev: false, building: false }))
vi.mock("$lib/client/sockets/socketInstance", () => ({
	getSocket: () => socket
}))

function makeStorage() {
	const map = new Map<string, string>()
	return {
		getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
		setItem: (k: string, v: string) => void map.set(k, String(v)),
		removeItem: (k: string) => void map.delete(k),
		clear: () => map.clear(),
		raw: map
	}
}

let storage: ReturnType<typeof makeStorage>

beforeEach(() => {
	vi.useFakeTimers()
	emitted.length = 0
	storage = makeStorage()
	vi.stubGlobal("localStorage", storage)
	socket = {
		connected: true,
		emit: (event: string, payload: any) => emitted.push({ event, payload }),
		on: () => {},
		off: () => {}
	}
	vi.resetModules()
})

afterEach(() => {
	vi.useRealTimers()
	vi.unstubAllGlobals()
})

const load = () => import("./state.svelte")

/**
 * Runs the debounce that coalesces one render pass's misses.
 *
 * Advanced by a fixed amount rather than `runAllTimers`: the interest registry
 * keeps a 30s self-healing sync interval, and an interval never exhausts.
 */
function flushRequests() {
	vi.advanceTimersByTime(200)
}

/** The catalog traffic, with the registry's interest syncs filtered out. */
function catalogEmits() {
	return emitted.filter((e) => e.event === "language:catalog")
}

describe("English", () => {
	test("is the identity and asks for nothing", async () => {
		const { t } = await load()
		expect(t("Language")).toBe("Language")
		flushRequests()
		expect(emitted).toEqual([])
	})
})

describe("a miss", () => {
	test("returns the English and requests the string once", async () => {
		const { t, setLanguage } = await load()
		setLanguage("es")

		expect(t("Language")).toBe("Language")
		// Re-rendering the same component must not queue it again.
		expect(t("Language")).toBe("Language")
		flushRequests()

		expect(catalogEmits()).toEqual([
			{ event: "language:catalog", payload: { sources: ["Language"] } }
		])
	})

	test("is not re-requested even when the server had no answer", async () => {
		// The loop this guards against: auto-translation off means the server
		// answers with an empty catalog, so the string stays a miss forever.
		const { t, setLanguage, applyCatalog } = await load()
		setLanguage("es")
		t("Language")
		flushRequests()
		applyCatalog({ language: "es", entries: {} })

		emitted.length = 0
		expect(t("Language")).toBe("Language")
		flushRequests()
		expect(catalogEmits()).toEqual([])
	})

	test("coalesces one render pass into a single request", async () => {
		const { t, setLanguage } = await load()
		setLanguage("es")
		t("Language")
		t("Settings")
		t("Characters")
		flushRequests()

		expect(catalogEmits()).toHaveLength(1)
		expect(catalogEmits()[0].payload.sources).toEqual([
			"Language",
			"Settings",
			"Characters"
		])
	})
})

describe("a hit", () => {
	test("renders the translation once the catalog arrives", async () => {
		const { t, setLanguage, applyCatalog } = await load()
		setLanguage("es")
		expect(t("Language")).toBe("Language")

		applyCatalog({ language: "es", entries: { Language: "Idioma" } })
		expect(t("Language")).toBe("Idioma")
	})

	test("a catalog for a language since moved away from is ignored", async () => {
		// A response in flight when the user switches must not paint the old
		// language's strings over the new one's.
		const { t, setLanguage, applyCatalog } = await load()
		setLanguage("es")
		setLanguage("de")
		applyCatalog({ language: "es", entries: { Language: "Idioma" } })
		expect(t("Language")).toBe("Language")
	})
})

describe("the browser cache", () => {
	test("is written on arrival and primes the catalog on return", async () => {
		const { t, setLanguage, applyCatalog } = await load()
		setLanguage("es")
		t("Language")
		// Settle the first instance's pending debounce before swapping modules,
		// so its timer cannot fire against the second instance's assertions.
		flushRequests()
		applyCatalog({ language: "es", entries: { Language: "Idioma" } })
		expect(storage.getItem("sp-i18n-es")).toContain("Idioma")

		// A fresh page load, same browser.
		vi.resetModules()
		emitted.length = 0
		const next = await load()
		next.setLanguage("es")
		// Translated on the first read, with no round trip at all.
		expect(next.t("Language")).toBe("Idioma")
		flushRequests()
		expect(catalogEmits()).toEqual([])
	})

	test("storage being unavailable costs a round trip, not an error", async () => {
		vi.stubGlobal("localStorage", {
			getItem: () => {
				throw new Error("blocked")
			},
			setItem: () => {
				throw new Error("blocked")
			}
		})
		const { t, setLanguage, applyCatalog } = await load()
		setLanguage("es")
		expect(t("Language")).toBe("Language")
		expect(() =>
			applyCatalog({ language: "es", entries: { Language: "Idioma" } })
		).not.toThrow()
		expect(t("Language")).toBe("Idioma")
	})
})

describe("before the socket exists", () => {
	test("a request is dropped rather than throwing", async () => {
		// The app is still starting. `t()` is called during first paint, and a
		// throw here would take the whole render down.
		socket = null
		const { t, setLanguage } = await load()
		setLanguage("es")
		expect(t("Language")).toBe("Language")
		expect(() => flushRequests()).not.toThrow()
	})
})

describe("the interest registry", () => {
	test("syncs the key before the request that wants its reply", async () => {
		// Ruling 3, at this consumer: one ordered connection, sync first, so
		// the handler answering `language:catalog` already sees the key. A
		// request that arrived first would be answered to nobody, because the
		// event is gated.
		const { t, setLanguage } = await load()
		setLanguage("es")
		t("Language")
		flushRequests()

		const order = emitted.map((e) => e.event)
		expect(order.indexOf("interest:sync")).toBeGreaterThanOrEqual(0)
		expect(order.indexOf("interest:sync")).toBeLessThan(
			order.indexOf("language:catalog")
		)
		const sync = emitted.find((e) => e.event === "interest:sync")!
		expect(sync.payload.keys).toContain("language:catalog")
	})

	test("a shell registration is released without taking the store's with it", async () => {
		// Two shells register (the main Layout and Document View's
		// AccessibleShell), and the store itself holds one. The registry counts
		// subscribers by reference, so each registration must be its own
		// closure or the first teardown blinds the rest.
		const { applyCatalog, registerLanguageSocket, setLanguage, t } =
			await load()
		setLanguage("es")
		const offOne = registerLanguageSocket()
		const offTwo = registerLanguageSocket()
		offOne()

		t("Language")
		flushRequests()
		const sync = [...emitted]
			.reverse()
			.find((e) => e.event === "interest:sync")!
		expect(sync.payload.keys).toContain("language:catalog")

		// And the surviving registration still renders what arrives.
		applyCatalog({ language: "es", entries: { Language: "Idioma" } })
		expect(t("Language")).toBe("Idioma")
		offTwo()
	})
})

/**
 * A run's status (R-19): a locale map with `{vars}` the client resolves.
 *
 *   · a locale the author shipped for the user's language is used as written;
 *   · otherwise the `en` TEMPLATE goes through `t()` with its placeholders
 *     intact — one stable source string however many speakers there are —
 *     and the variables are substituted after;
 *   · English costs nothing and no status asks for anything.
 */
describe("statusText", () => {
	const typing = {
		i18n: { en: "{speaker} is typing", fr: "{speaker} écrit" },
		vars: { speaker: "Jasmine" }
	}

	test("renders English with its variables and requests nothing", async () => {
		const { statusText } = await load()
		expect(statusText(typing)).toBe("Jasmine is typing")
		expect(statusText(null)).toBe("")
		expect(statusText(undefined)).toBe("")
		flushRequests()
		expect(emitted).toEqual([])
	})

	test("uses a shipped locale as written", async () => {
		const { statusText, setLanguage } = await load()
		setLanguage("fr")
		expect(statusText(typing)).toBe("Jasmine écrit")
		flushRequests()
		expect(catalogEmits()).toEqual([])
	})

	test("translates the en template — placeholders intact — then fills the variables", async () => {
		const { statusText, setLanguage, applyCatalog } = await load()
		setLanguage("es")
		expect(statusText(typing)).toBe("Jasmine is typing")
		flushRequests()
		expect(catalogEmits()[0].payload.sources).toEqual([
			"{speaker} is typing"
		])
		applyCatalog({
			language: "es",
			entries: { "{speaker} is typing": "{speaker} está escribiendo" }
		})
		expect(statusText(typing)).toBe("Jasmine está escribiendo")
		// A second speaker is the same source string, not a second request.
		emitted.length = 0
		expect(
			statusText({ ...typing, vars: { speaker: "Tom" } })
		).toBe("Tom está escribiendo")
		flushRequests()
		expect(catalogEmits()).toEqual([])
	})
})
