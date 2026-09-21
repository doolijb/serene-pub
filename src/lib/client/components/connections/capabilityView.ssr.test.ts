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
