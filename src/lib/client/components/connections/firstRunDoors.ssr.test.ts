/**
 * The first-run doors on an empty Connections index, rendered.
 *
 * `render` from `svelte/server`, like `indexRows.ssr.test.ts`. What is pinned
 * is the gating: the "KoboldCPP, run by Serene Pub" door installs and runs
 * KoboldCPP, which the Android app cannot do (the server refuses to switch
 * either manager on), so it hides there on `canRunLocalRuntimes` — the same
 * predicate the Add menu and the setup wizard hide their local-runtime items
 * on.
 *
 * ⚠ Not a design assertion. It checks the doors' sentences, never layout.
 */
import { describe, expect, test, vi } from "vitest"
import { render } from "svelte/server"

vi.mock("$app/environment", () => ({ dev: false, building: false }))
vi.mock("$lib/client/sockets/socketInstance", () => ({
	getSocket: () => ({ emit: () => {}, on: () => {}, off: () => {} })
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	useInterest: () => {},
	declareInterest: () => () => {},
	requestWithInterest: () => {}
}))

import ConnectionIndexView from "./ConnectionIndexView.svelte"

const noop = () => {}

function renderEmptyIndex(settings: {
	isAndroidWrapper?: boolean
	localOnnxAvailability?: { available: boolean; reason: string | null }
}) {
	return render(ConnectionIndexView, {
		props: {
			connectionsList: [],
			isLoading: false,
			syncingIds: new Set<number>(),
			syncingAll: false,
			onAddNew: noop,
			onEnableManager: noop,
			onOpenConnection: noop,
			onRefresh: noop
		},
		context: new Map<string, unknown>([
			["systemSettingsCtx", { settings }],
			["userCtx", { user: { id: 1, isAdmin: true } }]
		])
	}).body
}

/**
 * The doors carry the setup wizard's road names and sentences (plan §E, one
 * vocabulary for the roads), so the two screens never name a road twice.
 */
const LOCAL_DOOR =
	"Serene Pub downloads KoboldCPP and a model that suits your computer, then runs it for you."
const SERVICE_DOOR = "An online service"
const CUSTOM_DOOR = "A custom connection"

describe("the first-run doors", () => {
	test("offer running KoboldCPP on this machine where it can run", () => {
		const html = renderEmptyIndex({ isAndroidWrapper: false })
		expect(html).toContain("Where should the writing happen?")
		expect(html).toContain("KoboldCPP, run by Serene Pub")
		expect(html).toContain(LOCAL_DOOR)
		expect(html).toContain(SERVICE_DOOR)
		expect(html).toContain(CUSTOM_DOOR)
	})

	test("hide the on-this-machine door in the Android app", () => {
		const html = renderEmptyIndex({ isAndroidWrapper: true })
		expect(html).toContain("Where should the writing happen?")
		expect(html).not.toContain(LOCAL_DOOR)
		expect(html).not.toContain("KoboldCPP, run by Serene Pub")
		// The other two doors stay — an online service, or a custom connection.
		expect(html).toContain(SERVICE_DOOR)
		expect(html).toContain(CUSTOM_DOOR)
	})
})

/**
 * The "Later, optionally" doors (Images, Embeddings, Named entities) were job
 * doors; jobs live in the Models view since the split (plan 2026-10-11), so
 * the empty Connections index offers only the three ways to connect.
 */
describe("no job doors on an empty Connections index", () => {
	test("Later, optionally is gone; the three connect doors stay", () => {
		const html = renderEmptyIndex({
			localOnnxAvailability: { available: false, reason: "no binary" }
		})
		expect(html).not.toContain("Later, optionally")
		expect(html).not.toContain("Named entities")
		expect(html).not.toContain("Powers Search by meaning")
		expect(html).toContain("KoboldCPP, run by Serene Pub")
		expect(html).toContain(SERVICE_DOOR)
		expect(html).toContain(CUSTOM_DOOR)
	})
})

/**
 * A local ONNX connection on a machine whose ONNX runtime didn't load. The row
 * stays listed, and says why in place of its lane's state — no Set up or Fix,
 * which would lead to a Download the server refuses.
 */
describe("a local ONNX row where the runtime didn't load", () => {
	const REASON = "the Android app can't run the ONNX runtime"
	const onnxRow = {
		id: 3,
		name: "Local embeddings",
		type: "local-onnx",
		preset: null,
		baseUrl: null,
		modality: "embeddings",
		models: [
			{
				id: 9,
				name: "MiniLM",
				model: "Xenova/all-MiniLM-L6-v2",
				enabled: true,
				missingSince: null,
				satisfiableCapabilities: ["text->embedding"],
				local: { state: "not_downloaded" }
			}
		],
		modelsSync: { at: null, error: null }
	}

	function renderIndex(localOnnxAvailability: {
		available: boolean
		reason: string | null
	}) {
		return render(ConnectionIndexView, {
			props: {
				connectionsList: [onnxRow] as any,
				isLoading: false,
				syncingIds: new Set<number>(),
				syncingAll: false,
				onAddNew: noop,
				onEnableManager: noop,
				onOpenConnection: noop,
				onRefresh: noop
			},
			context: new Map<string, unknown>([
				["systemSettingsCtx", { settings: { localOnnxAvailability } }],
				["userCtx", { user: { id: 1, isAdmin: true } }]
			])
		}).body
	}

	test("unavailable: listed, says why, offers no Set up", () => {
		const html = renderIndex({ available: false, reason: REASON })
		expect(html).toContain("Local embeddings")
		expect(html).toContain("Unavailable")
		expect(html).toContain(`Not available on this machine: ${REASON}`)
		expect(html).not.toContain("Set up — Local embeddings")
	})

	test("available: the lane's own state and its Set up", () => {
		const html = renderIndex({ available: true, reason: null })
		expect(html).not.toContain("Not available on this machine")
		expect(html).toContain("Set up — Local embeddings")
	})
})
