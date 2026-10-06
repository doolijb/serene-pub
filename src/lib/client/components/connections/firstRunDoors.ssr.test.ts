/**
 * The first-run doors on an empty Connections index, rendered.
 *
 * `render` from `svelte/server`, like `indexRows.ssr.test.ts`. What is pinned
 * is the gating: the "On this machine" door installs and runs KoboldCPP, which
 * the Android app cannot do (the server refuses to switch either manager on),
 * so it hides there on `canRunLocalRuntimes` — the same predicate the Add menu
 * and the setup wizard hide their local-runtime items on.
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
			onOpenModel: noop,
			onOpenCapability: noop,
			onSetUpChat: noop,
			onGetModel: noop,
			onOpenDownloads: noop,
			onRefresh: noop,
			onAddModel: noop
		},
		context: new Map<string, unknown>([
			["systemSettingsCtx", { settings }],
			["userCtx", { user: { id: 1, isAdmin: true } }]
		])
	}).body
}

const LOCAL_DOOR = "KoboldCPP, installed and run by Serene Pub."

describe("the first-run doors", () => {
	test("offer running KoboldCPP on this machine where it can run", () => {
		const html = renderEmptyIndex({ isAndroidWrapper: false })
		expect(html).toContain("Where should the writing happen?")
		expect(html).toContain(LOCAL_DOOR)
		expect(html).toContain("A service")
		expect(html).toContain("Something I already run")
	})

	test("hide the on-this-machine door in the Android app", () => {
		const html = renderEmptyIndex({ isAndroidWrapper: true })
		expect(html).toContain("Where should the writing happen?")
		expect(html).not.toContain(LOCAL_DOOR)
		// The other two doors stay — a service, or a server run elsewhere.
		expect(html).toContain("A service")
		expect(html).toContain("Something I already run")
	})
})

/**
 * The "Later, optionally" doors where local ONNX can't run. Named entities
 * come from local ONNX alone, so that door is disabled and says why rather
 * than opening a view whose every way to a model is disabled. Embeddings
 * still come from a service, so that door stays and only stops promising a
 * local download.
 */
describe("the later doors where local ONNX can't run", () => {
	const CLAUSE = "the ONNX runtime didn't load (no binary for darwin/x64)"
	/** The `<button>` whose body names this door, as [attributes, body]. */
	const door = (html: string, title: string) =>
		[...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find(
			([, , body]) => body.includes(title)
		)!
	const isDisabled = (attrs: string) => /\sdisabled(?=[\s=>]|$)/.test(attrs)

	test("unavailable: Named entities is disabled with the reason; Embeddings stays", () => {
		const html = renderEmptyIndex({
			localOnnxAvailability: { available: false, reason: CLAUSE }
		})
		const [, entityAttrs, entityBody] = door(html, "Named entities")
		expect(isDisabled(entityAttrs)).toBe(true)
		expect(entityBody).toContain(`Not available on this machine: ${CLAUSE}`)
		expect(entityBody).not.toContain("Find people and places")
		const [, embedAttrs, embedBody] = door(html, "Embeddings")
		expect(isDisabled(embedAttrs)).toBe(false)
		expect(embedBody).toContain("Smarter lore retrieval")
		expect(embedBody).not.toContain("local download")
	})

	test("available: both doors open, as written", () => {
		const html = renderEmptyIndex({
			localOnnxAvailability: { available: true, reason: null }
		})
		const [, entityAttrs, entityBody] = door(html, "Named entities")
		expect(isDisabled(entityAttrs)).toBe(false)
		expect(entityBody).toContain("Find people and places in text · local")
		expect(door(html, "Embeddings")[2]).toContain(
			"Smarter lore retrieval · local download"
		)
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
				onOpenModel: noop,
				onOpenCapability: noop,
				onSetUpChat: noop,
				onGetModel: noop,
				onOpenDownloads: noop,
				onRefresh: noop,
				onAddModel: noop
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
