/**
 * A review card names the pipeline it belongs to by its name and genre.
 *
 * Pipeline names carry no genre (NOMENCLATURE §2, ruled 2026-10-05): every
 * genre's reply is "Reply". A card can come from any session, so it says
 * which genre's — "Reply · Adventure" — off the published list and the
 * registry's genre names, both asked for only while a card is up. The slug's
 * tail ("Chat respond") is only the stand-in until they arrive.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

/** Every request sent, and the handler each declared key listens with. */
const requested: string[] = []
const declared = new Map<string, (msg: any) => void>()

vi.mock("$app/environment", () => ({ dev: true, building: false }))
vi.mock("$lib/client/sockets/loadSockets.client", () => ({
	useTypedSocket: () => ({ emit: () => {}, on: () => {}, off: () => {} })
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	requestWithInterest: (event: string, _params: unknown, handler: any) => {
		requested.push(event)
		declared.set(event, handler)
		return () => {
			if (declared.get(event) === handler) declared.delete(event)
		}
	},
	useInterest: () => {}
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { success: () => {}, error: () => {}, info: () => {} }
}))

import PipelineReviewModal from "./PipelineReviewModal.svelte"

const review = (
	id: string,
	specId: string
): Sockets.Pipelines.PendingReview => ({
	id,
	specId,
	nodeKey: "placeholder",
	definitionId: "core:outlet/create-message@1",
	schema: {},
	values: {},
	requestedAt: 1,
	whatIsReviewed: "A new message, before it is posted."
})

const pipelinesList = [
	{
		slug: "core:spec/chat-respond",
		name: "Reply",
		version: "1.0.0",
		event: null,
		enabled: true,
		taxonomy: { role: "primary", genre: "core:genre/chat" }
	},
	{
		slug: "core:spec/adventure-respond",
		name: "Reply",
		version: "1.0.0",
		event: null,
		enabled: true,
		taxonomy: { role: "primary", genre: "core:genre/adventure" }
	},
	{
		slug: "core:spec/summarize-scene",
		name: "Summarize scene",
		version: "1.0.0",
		event: null,
		enabled: true,
		taxonomy: { role: "maintenance" }
	}
]

const genres = [
	{ genreId: "core:genre/chat", name: "Chat", description: "", shape: {} },
	{
		genreId: "core:genre/adventure",
		name: "Adventure",
		description: "",
		shape: {}
	}
]

let app: Record<string, any> | null = null

afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	requested.length = 0
	declared.clear()
})

function open(...reviews: Sockets.Pipelines.PendingReview[]) {
	app = mount(PipelineReviewModal, { target: document.body })
	flushSync()
	declared.get("pipelines:reviews")!({ reviews })
	flushSync()
}

const what = () =>
	document.querySelector("[data-testid=review-what]")?.textContent ?? ""

describe("PipelineReviewModal — the pipeline a card belongs to", () => {
	test("asks for no pipeline list while no card is up", () => {
		open()
		expect(requested).toEqual(["pipelines:reviews"])
	})

	test("names the pipeline and its genre once both lists arrive", () => {
		open(review("r1", "core:spec/adventure-respond"))
		expect(requested).toContain("pipelines:list")
		expect(requested).toContain("sessions:genres")

		declared.get("pipelines:list")!({ pipelinesList })
		declared.get("sessions:genres")!({ genres })
		flushSync()

		expect(what()).toContain("Reply · Adventure · step “placeholder”:")
		expect(what()).not.toMatch(/Adventure respond/)
	})

	test("a pipeline every genre shares shows its bare name", () => {
		open(review("r1", "core:spec/summarize-scene"))
		declared.get("pipelines:list")!({ pipelinesList })
		declared.get("sessions:genres")!({ genres })
		flushSync()

		expect(what()).toContain("Summarize scene · step “placeholder”:")
	})

	test("until the lists arrive, the slug's tail stands in", () => {
		open(review("r1", "core:spec/chat-respond"))
		expect(what()).toContain("Chat respond · step “placeholder”:")
	})
})
