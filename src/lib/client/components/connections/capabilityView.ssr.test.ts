/**
 * The capability view, rendered.
 *
 * `render` from `svelte/server`, like `indexRows.ssr.test.ts`: the repo has no
 * browser test environment, and what this view DOES is the assembly — a status
 * card, the registered pair, the pairs that could replace it, and the door to
 * the finder. `capabilityView.test.ts` pins every sentence and row it puts
 * together; this pins that they reach the screen, in both of the two states
 * that read completely differently (nothing configured, and something).
 *
 * The list arrives through the interest registry, so that is the seam the
 * fixture is fed through — the same call the component makes, answered
 * immediately rather than over a socket.
 *
 * ⚠ Not a design assertion. It checks sentences and the two classes that carry
 * meaning (the gold default chip, the primary Get button), never layout.
 */
import { describe, expect, test, vi } from "vitest"
import { render } from "svelte/server"

vi.mock("$app/environment", () => ({ dev: false, building: false }))
vi.mock("$lib/client/sockets/socketInstance", () => ({
	getSocket: () => ({ emit: () => {}, on: () => {}, off: () => {} })
}))

/** Whatever the current test put on the wire, handed to the first subscriber. */
let listResponse: unknown = { connectionsList: [] }
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	useInterest: (_key: string, handler: (data: unknown) => void) =>
		handler(listResponse),
	declareInterest: () => () => {},
	requestWithInterest: () => {}
}))

import CapabilityView from "./CapabilityView.svelte"

function model(over: Record<string, unknown> = {}) {
	return {
		id: 1,
		connectionId: 1,
		model: "llama-3",
		name: "llama-3",
		enabled: true,
		missingSince: null,
		contextWindow: null,
		promptFormat: null,
		tokenCounter: null,
		sortOrder: 0,
		satisfiableCapabilities: ["text->text"],
		...over
	}
}

function connection(over: Record<string, unknown> = {}) {
	return {
		id: 1,
		name: "Local",
		type: "ollama",
		models: [model()],
		modelsSync: { at: null, error: null },
		...over
	}
}

const props = {
	capability: "text->text",
	onBack: () => {},
	onOpenModel: () => {},
	onGetModel: () => {},
	onSelectDefault: () => {}
}

describe("the capability view renders", () => {
	test("nothing configured: the cost, the empty section, a gold door out", () => {
		listResponse = { connectionsList: [] }
		const html = render(CapabilityView, { props }).body
		expect(html).toContain("Chat")
		expect(html).toContain("Not set")
		expect(html).toContain("sessions can't reply")
		expect(html).not.toContain("Not set · sessions can't reply")
		expect(html).toContain("Not set · pick one below")
		expect(html).toContain("Nothing here can chat yet.")
		expect(html).toContain("Get a chat model")
		// Nothing anywhere can chat, so the way out is the primary (R7).
		expect(html).toContain("preset-filled-primary-500")
	})

	test("a registered pair, an alternative, and what is switched off", () => {
		listResponse = {
			connectionsList: [
				connection({
					models: [
						model(),
						model({ id: 2, name: "mistral" }),
						model({
							id: 3,
							name: "old",
							enabled: false,
							satisfiableCapabilities: []
						})
					]
				})
			]
		}
		const html = render(CapabilityView, {
			props: {
				...props,
				// The shell's copy of the defaults is what this view reads.
				capability: "text->text"
			},
			context: new Map([
				[
					"systemSettingsCtx",
					{
						capabilityDefaults: {
							"text->text": {
								connectionId: 1,
								connectionModelId: 1
							}
						}
					}
				]
			])
		}).body

		expect(html).toContain("Ready")
		expect(html).toContain(
			"Every session replies with this unless its pipeline says otherwise."
		)
		// The pair: name, the gold chip, and the connection line under it.
		expect(html).toContain("llama-3")
		expect(html).toContain("preset-tonal-primary")
		expect(html).toContain("Local · Ollama · listed")
		// The alternative, with its one action.
		expect(html).toContain("Also able to chat · 1 model")
		expect(html).toContain("mistral")
		expect(html).toContain("Use")
		expect(html).toContain("1 more is switched off or not listed")
		// Something already chats, so the door out is tonal.
		expect(html).toContain("Get another chat model")
		expect(html).not.toContain("preset-filled-primary-500")
	})
})

/**
 * A local ONNX pair whose files never arrived, on a machine whose ONNX runtime
 * didn't load. Both ways to a download stay on screen — the fix's Download and
 * the "N more" door — disabled, with the reason in words beside them.
 */
describe("local ONNX downloads where the runtime didn't load", () => {
	const REASON =
		"Not available on this machine: the Android app can't run the ONNX runtime"
	const onnx = (id: number, name: string) =>
		model({
			id,
			name,
			model: name,
			satisfiableCapabilities: ["text->embedding"],
			local: { state: "not_downloaded" }
		})

	function renderEmbeddings(localOnnxAvailability: {
		available: boolean
		reason: string | null
	}) {
		listResponse = {
			connectionsList: [
				connection({
					name: "Local embeddings",
					type: "local-onnx",
					models: [onnx(1, "MiniLM"), onnx(2, "BGE")]
				})
			]
		}
		return render(CapabilityView, {
			props: { ...props, capability: "text->embedding" },
			context: new Map([
				[
					"systemSettingsCtx",
					{
						settings: { localOnnxAvailability },
						capabilityDefaults: {
							"text->embedding": {
								connectionId: 1,
								connectionModelId: 1
							}
						}
					}
				]
			])
		}).body
	}
	/** Each `<button>` opening tag whose body says this. */
	const buttonsSaying = (html: string, words: string) =>
		[...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
			.filter(([, , body]) => body.includes(words))
			.map(([, attrs]) => attrs)
	/** The boolean attribute, not the `disabled:` class variants. */
	const isDisabled = (attrs: string) => /\sdisabled(?=[\s=>]|$)/.test(attrs)
	const count = (html: string, words: string) => html.split(words).length - 1

	test("unavailable: Download and the door are disabled and say why", () => {
		const html = renderEmbeddings({
			available: false,
			reason: "the Android app can't run the ONNX runtime"
		})
		const download = buttonsSaying(html, "Download")
		expect(download).toHaveLength(1)
		expect(isDisabled(download[0])).toBe(true)
		const door = buttonsSaying(html, "1 more is available to download")
		expect(door).toHaveLength(1)
		expect(isDisabled(door[0])).toBe(true)
		// In each one's tooltip, and in words beside each: nothing hover-only.
		expect(count(html, `title="${REASON}"`)).toBe(2)
		expect(count(html, REASON)).toBe(4)
	})

	test("available: both enabled, and no reason", () => {
		const html = renderEmbeddings({ available: true, reason: null })
		expect(isDisabled(buttonsSaying(html, "Download")[0])).toBe(false)
		expect(
			isDisabled(buttonsSaying(html, "1 more is available to download")[0])
		).toBe(false)
		expect(html).not.toContain("Not available on this machine")
	})
})

/**
 * Where the runtime didn't load, a local ONNX model can't be made active even
 * with its files on disk — the server refuses the star with the machine's
 * reason — and named entities have no other provider, so the finder door
 * would lead to a finder whose one destination is disabled.
 */
describe("making local ONNX models active where the runtime didn't load", () => {
	const CLAUSE = "the Android app can't run the ONNX runtime"
	const REASON = `Not available on this machine: ${CLAUSE}`
	const buttonsSaying = (html: string, words: string) =>
		[...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
			.filter(([, , body]) => body.includes(words))
			.map(([, attrs]) => attrs)
	const isDisabled = (attrs: string) => /\sdisabled(?=[\s=>]|$)/.test(attrs)
	const count = (html: string, words: string) => html.split(words).length - 1

	function renderView(
		capability: string,
		connectionsList: unknown[],
		localOnnxAvailability: { available: boolean; reason: string | null }
	) {
		listResponse = { connectionsList }
		return render(CapabilityView, {
			props: { ...props, capability },
			context: new Map([
				[
					"systemSettingsCtx",
					{
						settings: { localOnnxAvailability },
						capabilityDefaults: {}
					}
				]
			])
		}).body
	}
	const onDisk = (id: number, name: string, capability: string) =>
		model({
			id,
			name,
			model: name,
			satisfiableCapabilities: [capability],
			local: { state: "on_disk" }
		})
	const localEmbeddings = connection({
		name: "Local embeddings",
		type: "local-onnx",
		models: [
			onDisk(1, "MiniLM", "text->embedding"),
			onDisk(2, "BGE", "text->embedding")
		]
	})

	test("unavailable: each downloaded model's Use is disabled, and the reason is said once", () => {
		const html = renderView("text->embedding", [localEmbeddings], {
			available: false,
			reason: CLAUSE
		})
		const uses = buttonsSaying(html, "Use")
		expect(uses).toHaveLength(2)
		for (const attrs of uses) {
			expect(isDisabled(attrs)).toBe(true)
			expect(attrs).toContain(`title="${REASON}"`)
		}
		// Twice as a tooltip, once in words under the rows.
		expect(count(html, REASON)).toBe(5)
	})

	test("available: Use is offered and nothing is said", () => {
		const html = renderView("text->embedding", [localEmbeddings], {
			available: true,
			reason: null
		})
		const uses = buttonsSaying(html, "Use")
		expect(uses).toHaveLength(2)
		for (const attrs of uses) expect(isDisabled(attrs)).toBe(false)
		expect(html).not.toContain("Not available on this machine")
	})

	test("named entities: the finder door is disabled, its note the reason", () => {
		const html = renderView("text->entities", [], {
			available: false,
			reason: CLAUSE
		})
		const door = buttonsSaying(html, "Get a named entities model")
		expect(door).toHaveLength(1)
		expect(isDisabled(door[0])).toBe(true)
		expect(html).not.toContain("Opens the model finder")
		expect(count(html, REASON)).toBe(2)
	})

	test("embeddings: the finder door stays, a service can still embed", () => {
		const html = renderView("text->embedding", [], {
			available: false,
			reason: CLAUSE
		})
		const door = buttonsSaying(html, "Get an embeddings model")
		expect(door).toHaveLength(1)
		expect(isDisabled(door[0])).toBe(false)
	})
})
