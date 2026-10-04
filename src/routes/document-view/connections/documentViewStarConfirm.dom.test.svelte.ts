/**
 * The document view's "Use … for embeddings" moves the star with the same
 * confirmation as the Connections view and Admin → Defaults: priced by the
 * server first, and written only once the answer is yes.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { emitted, socket, listeners, listen } = vi.hoisted(() => {
	const emitted: Array<[string, any]> = []
	const listeners = new Map<string, (msg: any) => void>()
	return {
		emitted,
		socket: {
			emit: (event: string, payload: unknown) =>
				emitted.push([event, payload]),
			on: () => {},
			off: () => {}
		},
		listeners,
		listen: (key: string, handler: (msg: any) => void) => {
			listeners.set(key, handler)
			return () => {
				if (listeners.get(key) === handler) listeners.delete(key)
			}
		}
	}
})
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/loadSockets.client", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: listen,
	useInterest: listen,
	requestWithInterest: (key: string, params: unknown, handler: any) => {
		listen(key, handler)
		emitted.push([key, params])
		return () => {}
	}
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { error: () => {}, info: () => {}, success: () => {} }
}))

import Page from "./+page.svelte"

const EMBED = "text->embedding"
const embeddingModel = (id: number, name: string) => ({
	id,
	name,
	model: name,
	enabled: true,
	missingSince: null,
	satisfiableCapabilities: [EMBED]
})

let app: ReturnType<typeof mount> | null = null
beforeEach(() => {
	emitted.length = 0
	listeners.clear()
	const host = document.createElement("div")
	document.body.append(host)
	app = mount(Page, {
		target: host,
		context: new Map<string, unknown>([
			["userCtx", { user: { id: 1, isAdmin: true } }],
			[
				"systemSettingsCtx",
				{
					settings: {},
					capabilityDefaults: {
						[EMBED]: { connectionId: 1, connectionModelId: 11 }
					}
				}
			]
		])
	})
	flushSync()
	listeners.get("connections:list")!({
		connectionsList: [
			{
				id: 1,
				name: "Hosted",
				type: "openai-embeddings",
				modality: "embeddings",
				models: [embeddingModel(11, "bge-small")]
			},
			{
				id: 2,
				name: "Elsewhere",
				type: "openai-embeddings",
				modality: "embeddings",
				models: [embeddingModel(21, "bge-large")]
			}
		]
	})
	flushSync()
})
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

const button = (words: string) =>
	[...document.querySelectorAll("button")].find((b) =>
		b.textContent?.replace(/\s+/g, " ").includes(words)
	) as HTMLButtonElement | undefined
const setDefaults = () =>
	emitted.filter(([e]) => e === "connections:setDefault")

describe("the document view's embeddings star", () => {
	test("asks the price before it moves, and moves on Switch and re-embed", async () => {
		button("Use bge-large for embeddings")!.click()
		expect(setDefaults()).toEqual([])
		expect(emitted).toContainEqual([
			"vectorization:reindexCost",
			{ target: { connectionId: 2, modelId: 21 } }
		])
		listeners.get("vectorization:reindexCost")!({
			rows: 7,
			target: { connectionId: 2, modelId: 21 }
		})
		await new Promise((r) => setTimeout(r, 0))
		flushSync()
		await tick()
		expect(document.body.textContent).toContain(
			"Switch embeddings to bge-large?"
		)
		button("Switch and re-embed")!.click()
		expect(setDefaults()).toEqual([
			[
				"connections:setDefault",
				{ capability: EMBED, id: 2, modelId: 21 }
			]
		])
	})
})
