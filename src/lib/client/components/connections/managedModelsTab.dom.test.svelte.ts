/**
 * The managed KoboldCPP's Models tab — its Embedding models.
 *
 * Three things fail silently here, so they are pinned:
 *
 *   · an `embeddings` row on the managed KoboldCPP is listed under its own
 *     heading, beside Text and Image, rather than nowhere;
 *   · its "Use for embeddings" never stars on its own: the server checks the
 *     file and answers the pair (`koboldcpp:connectEmbeddingModel`), and the
 *     star goes through the panel's flow (`onSetDefault`), which confirms the
 *     re-index first;
 *   · a file in the wrong section can be moved to the embedding models.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))
const emitted: Array<[string, any]> = []
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => ({
		emit: (event: string, payload: unknown) =>
			emitted.push([event, payload])
	})
}))
const asked: any[] = []
let reply: (opts: any) => Promise<any> = async () => ({})
vi.mock("$lib/client/utils/awaitReply", () => ({
	awaitReply: (opts: any) => {
		asked.push(opts)
		return reply(opts)
	},
	isReplyTimeout: () => false
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { error: () => {}, info: () => {}, success: () => {} }
}))

import ManagedModelsTab from "./ManagedModelsTab.svelte"

const model = (id: number, file: string, modality: string) => ({
	id,
	model: file,
	name: file.replace(/\.gguf$/, ""),
	modality,
	enabled: true,
	missingSince: null,
	facts: null,
	contextWindow: null
})

const connection = {
	id: 9,
	name: "KoboldCPP",
	type: "koboldcpp_managed",
	models: [
		model(31, "chat.gguf", "text-gen"),
		model(32, "sdxl.gguf", "image-gen"),
		model(33, "nomic.gguf", "embeddings")
	]
} as any

const mounted: ReturnType<typeof mount>[] = []
beforeEach(() => {
	emitted.length = 0
	asked.length = 0
	reply = async (opts) => ({
		filename: opts.params.filename,
		connectionId: 9,
		modelId: 33,
		name: "nomic"
	})
})
afterEach(() => {
	for (const app of mounted.splice(0)) unmount(app)
	document.body.innerHTML = ""
})

function render(onSetDefault = vi.fn()) {
	const target = document.createElement("div")
	document.body.appendChild(target)
	mounted.push(
		mount(ManagedModelsTab, {
			target,
			props: {
				kind: "koboldcpp",
				connection,
				capabilityDefaults: {},
				isAdmin: true,
				onOpenModel: () => {},
				onSetDefault,
				onGetModels: () => {},
				onRefresh: () => {}
			}
		})
	)
	flushSync()
	return { target, onSetDefault }
}

const button = (root: ParentNode, label: string) =>
	[...root.querySelectorAll("button")].find(
		(b) => b.getAttribute("aria-label") === label
	)

describe("the managed KoboldCPP's Models tab", () => {
	test("lists embedding models under their own heading, beside text and image", () => {
		const { target } = render()
		const headings = [...target.querySelectorAll("h3")].map((h) =>
			h.textContent?.trim()
		)
		expect(headings).toEqual([
			"Text models",
			"Image models",
			"Embedding models"
		])
		expect(button(target, "Use for embeddings")).toBeTruthy()
		expect(button(target, "Use for chat")).toBeTruthy()
		expect(button(target, "Use for images")).toBeTruthy()
	})

	test("Use for embeddings asks the server for the pair, then stars it through the panel's flow", async () => {
		const { target, onSetDefault } = render()
		button(target, "Use for embeddings")!.click()
		await tick()
		await new Promise((r) => setTimeout(r, 0))

		expect(asked).toHaveLength(1)
		expect(asked[0]).toMatchObject({
			event: "koboldcpp:connectEmbeddingModel",
			errorEvent: "koboldcpp:connectEmbeddingModel:error",
			params: { filename: "nomic.gguf" }
		})
		// Its own answer only.
		expect(asked[0].match({ filename: "nomic.gguf" })).toBe(true)
		expect(asked[0].match({ filename: "other.gguf" })).toBe(false)
		// Never a star of its own: `connections:setDefault` is the panel's.
		expect(emitted.map(([e]) => e)).not.toContain("connections:setDefault")
		expect(onSetDefault).toHaveBeenCalledWith("text->embedding", 9, {
			id: 33,
			name: "nomic"
		})
	})

	test("a refused pair stars nothing", async () => {
		reply = async () => {
			throw new Error("That's a text model.")
		}
		const { target, onSetDefault } = render()
		button(target, "Use for embeddings")!.click()
		await tick()
		await new Promise((r) => setTimeout(r, 0))
		expect(onSetDefault).not.toHaveBeenCalled()
	})

	test("a text row can be moved to the embedding models, and an embedding row back", async () => {
		const { target } = render()
		const menu = (name: string) => button(target, `More actions — ${name}`)!
		menu("chat").click()
		await tick()
		flushSync()
		const moveToEmbeddings = [...document.querySelectorAll("button")].find(
			(b) => b.textContent?.includes("Move to embedding models")
		)
		expect(moveToEmbeddings).toBeTruthy()
		moveToEmbeddings!.click()
		expect(emitted).toContainEqual([
			"koboldcpp:setModelKind",
			{ filename: "chat.gguf", kind: "embeddings" }
		])
	})
})
