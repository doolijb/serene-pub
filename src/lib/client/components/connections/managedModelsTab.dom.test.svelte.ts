/**
 * The managed KoboldCPP's Models tab — its Embedding models.
 *
 * Three things fail silently here, so they are pinned:
 *
 *   · an `embeddings` row on the managed KoboldCPP is listed under its own
 *     heading, beside Text and Image, rather than nowhere;
 *   · its "Use in Embeddings" never stars on its own: the server checks the
 *     file and answers the pair (`koboldcpp:connectEmbeddingModel`), and the
 *     star goes through the panel's flow (`onSetDefault`), which confirms the
 *     re-index first;
 *   · a file in the wrong section can be moved to the embedding models.
 *
 * And on both runtimes, a section lists what the server says a model can do
 * (`satisfiableCapabilities`), never its raw modality: a Not sure model is
 * listed under each job it can serve.
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

/** What the server answers for a pair whose model holds this modality. */
const SERVES: Record<string, string[]> = {
	"text-gen": ["text->text"],
	"image-gen": ["text->image"],
	embeddings: ["text->embedding"]
}

const model = (
	id: number,
	file: string,
	modality: string | null,
	satisfiableCapabilities: string[] = SERVES[modality ?? ""] ?? []
) => ({
	id,
	model: file,
	name: file.replace(/\.gguf$/, ""),
	modality,
	enabled: true,
	missingSince: null,
	facts: null,
	contextWindow: null,
	satisfiableCapabilities
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

function render(
	onSetDefault = vi.fn(),
	overrides: {
		connection?: any
		capabilityDefaults?: any
		kind?: "koboldcpp" | "ollama"
	} = {}
) {
	const target = document.createElement("div")
	document.body.appendChild(target)
	mounted.push(
		mount(ManagedModelsTab, {
			target,
			props: {
				kind: overrides.kind ?? "koboldcpp",
				connection: overrides.connection ?? connection,
				capabilityDefaults: overrides.capabilityDefaults ?? {},
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

/** A RowMenu item answers Skeleton's pointer sequence, not a bare click. */
const pick = (item: HTMLElement) => {
	item.dispatchEvent(
		new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" })
	)
	item.click()
	flushSync()
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
		expect(button(target, "Use in Embeddings")).toBeTruthy()
		expect(button(target, "Use in Reply")).toBeTruthy()
		expect(button(target, "Use in Images")).toBeTruthy()
	})

	test("Use in Embeddings asks the server for the pair, then stars it through the panel's flow", async () => {
		const { target, onSetDefault } = render()
		button(target, "Use in Embeddings")!.click()
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
		button(target, "Use in Embeddings")!.click()
		await tick()
		await new Promise((r) => setTimeout(r, 0))
		expect(onSetDefault).not.toHaveBeenCalled()
	})

	test("a text row can be moved to the embedding models, and an embedding row back", async () => {
		const { target } = render()
		const menu = (name: string) => button(target, `More actions for ${name}`)!
		menu("chat").click()
		await tick()
		flushSync()
		// The row's ⋯ is the app's RowMenu: its items are menuitems.
		const moveToEmbeddings = [
			...document.querySelectorAll<HTMLElement>("[role=menuitem]")
		].find((b) => b.textContent?.includes("Move to embedding models"))
		expect(moveToEmbeddings).toBeTruthy()
		pick(moveToEmbeddings!)
		expect(emitted).toContainEqual([
			"koboldcpp:setModelKind",
			{ filename: "chat.gguf", kind: "embeddings" }
		])
	})

	test("Delete from disk is the ⋯ menu's destructive item, and asks first", async () => {
		const { target } = render()
		// Nothing on a row is a filled button: no green Use, no red Delete.
		expect(
			target.querySelectorAll(
				"[data-managed-models] [class*='preset-filled']"
			)
		).toHaveLength(0)
		expect(button(target, "Delete")).toBeUndefined()

		button(target, "More actions for chat")!.click()
		await tick()
		flushSync()
		const items = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")]
		const del = items.find((b) =>
			b.textContent?.includes("Delete from disk")
		)!
		expect(del.className).toContain("text-error")
		pick(del)
		await tick()
		flushSync()
		expect(emitted.map(([e]) => e)).not.toContain("koboldcpp:deleteModel")
		const dialog = document.querySelector("[role='alertdialog']")
		expect(dialog?.textContent).toContain("Delete this model?")
		;[...dialog!.querySelectorAll("button")]
			.find((b) => b.textContent?.trim() === "Delete from disk")!
			.click()
		expect(emitted).toContainEqual([
			"koboldcpp:deleteModel",
			{ modelName: "chat.gguf" }
		])
	})
})

describe("the managed Models tab follows the model-row contract", () => {
	const textOnly = (ids: number[]) =>
		({
			...connection,
			models: ids.map((id) => model(id, `m${id}.gguf`, "text-gen"))
		}) as any
	const names = (root: ParentNode) =>
		[
			...root.querySelectorAll(
				"[data-managed-models] button[title]:not([aria-label])"
			)
		].map((b) => b.getAttribute("title"))

	test("Use says Use in Reply while chat has no model, then Use in the dock", () => {
		const unset = render(vi.fn(), { connection: textOnly([41, 42]) })
		const before = button(unset.target, "Use in Reply")!
		expect(before.querySelector("span")!.textContent).toBe("Use in Reply")
		for (const app of mounted.splice(0)) unmount(app)
		document.body.innerHTML = ""

		const { target } = render(vi.fn(), {
			connection: textOnly([41, 42]),
			capabilityDefaults: {
				"text->text": { connectionId: 9, connectionModelId: 42 }
			}
		})
		// One Use left (the default wears its mark instead), and it keeps
		// the whole verb as its name: the verb is the consequence.
		const use = button(target, "Use in Reply")!
		expect(use.querySelector("span")!.textContent).toBe("Use")
		expect(
			target.querySelectorAll("button[aria-label='Use in Reply']")
		).toHaveLength(1)
	})

	test("a chat default naming a model this runtime does not list is unset", () => {
		const { target } = render(vi.fn(), {
			connection: textOnly([41]),
			capabilityDefaults: {
				"text->text": { connectionId: 9, connectionModelId: 99 }
			}
		})
		const use = button(target, "Use in Reply")!
		expect(use.querySelector("span")!.textContent).toBe("Use in Reply")
	})

	test("the chat default leads the text models", () => {
		const { target } = render(vi.fn(), {
			connection: textOnly([41, 42, 43]),
			capabilityDefaults: {
				"text->text": { connectionId: 9, connectionModelId: 43 }
			}
		})
		expect(names(target)).toEqual(["m43.gguf", "m41.gguf", "m42.gguf"])
	})

	test("the count heads the list; the filter box appears past twelve models", () => {
		const few = render(vi.fn(), { connection: textOnly([41, 42, 43]) })
		expect(few.target.textContent).toContain("3 models")
		expect(few.target.querySelector("#managed-model-filter")).toBeNull()
		for (const app of mounted.splice(0)) unmount(app)
		document.body.innerHTML = ""

		const ids = Array.from({ length: 13 }, (_, i) => 50 + i)
		const { target } = render(vi.fn(), { connection: textOnly(ids) })
		const filter = target.querySelector<HTMLInputElement>(
			"#managed-model-filter"
		)!
		expect(filter.placeholder).toBe("Filter 13 models")
		filter.value = "m55"
		filter.dispatchEvent(new Event("input"))
		flushSync()
		expect(names(target)).toEqual(["m55.gguf"])
	})

	test("no models is an empty state with one way in", () => {
		const onGetModels = vi.fn()
		const target = document.createElement("div")
		document.body.appendChild(target)
		mounted.push(
			mount(ManagedModelsTab, {
				target,
				props: {
					kind: "ollama",
					connection: { ...connection, models: [] },
					capabilityDefaults: {},
					isAdmin: true,
					onOpenModel: () => {},
					onSetDefault: () => {},
					onGetModels,
					onRefresh: () => {}
				}
			})
		)
		flushSync()
		const status = target.querySelector("[role='status']")!
		expect(status.textContent).toContain("No models yet")
		;[...status.querySelectorAll("button")]
			.find((b) => b.textContent?.trim() === "Get a model")!
			.click()
		expect(onGetModels).toHaveBeenCalledOnce()
	})
})

describe("the sections follow the server's answer (satisfiableCapabilities)", () => {
	const ollama = (models: any[]) =>
		({ id: 9, name: "Ollama", type: "ollama", models }) as any
	const section = (root: ParentNode, lane: string) =>
		root.querySelector<HTMLElement>(`[data-managed-models='${lane}']`)
	const listed = (root: ParentNode | null) =>
		root
			? [...root.querySelectorAll("button[title]:not([aria-label])")].map(
					(b) => b.getAttribute("title")
				)
			: []
	const uses = (root: ParentNode | null, label: string) =>
		root
			? [...root.querySelectorAll("button")].filter(
					(b) => b.getAttribute("aria-label") === label
				)
			: []

	test("a Not sure model is listed under every job the server says it can do, with Use in each", () => {
		const onSetDefault = vi.fn()
		const { target } = render(onSetDefault, {
			kind: "ollama",
			connection: ollama([
				model(41, "llama3", "text-gen"),
				model(42, "nomic-embed-text", "embeddings"),
				model(43, "mystery", null, ["text->text", "text->embedding"])
			])
		})
		const chat = section(target, "text")
		const embeddings = section(target, "embeddings")
		expect(listed(chat)).toEqual(["llama3", "mystery"])
		expect(listed(embeddings)).toEqual(["nomic-embed-text", "mystery"])
		expect(uses(chat, "Use in Reply")).toHaveLength(2)
		expect(uses(embeddings, "Use in Embeddings")).toHaveLength(2)

		uses(embeddings, "Use in Embeddings")[1].click()
		expect(onSetDefault).toHaveBeenCalledWith("text->embedding", 9, {
			id: 43,
			name: "mystery"
		})
	})

	test("a Not sure model with no embedding job on this endpoint is listed for chat only", () => {
		const { target } = render(vi.fn(), {
			kind: "ollama",
			connection: ollama([
				model(41, "llama3", "text-gen"),
				model(43, "mystery", null, ["text->text"])
			])
		})
		expect(section(target, "embeddings")).toBeNull()
		expect(listed(section(target, "text"))).toEqual(["llama3", "mystery"])
	})

	test("Use is offered per job: the chat default still offers Use in Embeddings", () => {
		const { target } = render(vi.fn(), {
			kind: "ollama",
			connection: ollama([
				model(41, "llama3", "text-gen"),
				model(43, "mystery", null, ["text->text", "text->embedding"])
			]),
			capabilityDefaults: {
				"text->text": { connectionId: 9, connectionModelId: 43 }
			}
		})
		const chat = section(target, "text")!
		// The default leads its section and wears the mark, without Use.
		expect(listed(chat)).toEqual(["mystery", "llama3"])
		expect(uses(chat, "Use in Reply")).toHaveLength(1)
		expect(
			uses(section(target, "embeddings"), "Use in Embeddings")
		).toHaveLength(1)
	})

	test("a model the server says serves nothing stays listed under its own section, without Use", () => {
		const off = { ...model(41, "llama3", "text-gen", []), enabled: false }
		const gone = {
			...model(42, "nomic-embed-text", "embeddings", []),
			missingSince: "2026-10-01T00:00:00Z"
		}
		const unsure = { ...model(43, "mystery", null, []), enabled: false }
		const { target } = render(vi.fn(), {
			kind: "ollama",
			connection: ollama([off, gone, unsure])
		})
		expect(listed(section(target, "text"))).toEqual(["llama3", "mystery"])
		expect(listed(section(target, "embeddings"))).toEqual([
			"nomic-embed-text"
		])
		expect(uses(target, "Use in Reply")).toHaveLength(0)
		expect(uses(target, "Use in Embeddings")).toHaveLength(0)
	})

	test("a KoboldCPP model the server refuses for chat offers no Use in Reply", () => {
		const { target } = render(vi.fn(), {
			connection: {
				...connection,
				models: [
					model(31, "chat.gguf", "text-gen"),
					model(34, "odd.gguf", "text-gen", [])
				]
			}
		})
		expect(listed(section(target, "text"))).toEqual([
			"chat.gguf",
			"odd.gguf"
		])
		expect(uses(target, "Use in Reply")).toHaveLength(1)
	})
})
