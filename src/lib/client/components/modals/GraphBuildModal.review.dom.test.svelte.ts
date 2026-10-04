/**
 * The review screen keeps what the person did, and Apply sends it whole
 * (plan A21 + B8's GraphBuildModal items).
 *
 * - Layout replaces `graphBuildsCtx.activeBuild` with a new object on EVERY
 *   `activity:update` — any summarize tick, any reconnect. The restore effect
 *   tracked that object, so each broadcast re-copied the proposal and threw
 *   away the person's removals and edits mid-review.
 * - Apply sends the build's `resolvedSceneCast` and its activity, never the
 *   modal's own mode; a removed character takes its relationships with it.
 * - Only this modal's own apply reply closes it — another tab's does not.
 * - The modal reads its own book's build from the shell's store (the real
 *   one, `createGraphBuildsCtx`), never the newest: another book's build
 *   starting took the review away, and after an apply the modal dismissed
 *   whatever build was newest by then — another book's (plan A21 review).
 * - A build that found only who was in each scene can be applied.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

const sent: { event: string; data: any }[] = []
const declared = new Map<string, (msg: any) => void>()

vi.mock("$app/environment", () => ({ dev: true, building: false }))
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => ({
		emit: (event: string, data: any) => sent.push({ event, data }),
		on: () => {},
		off: () => {}
	})
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: (event: string, handler: (msg: any) => void) => {
		declared.set(event, handler)
		return () => {
			if (declared.get(event) === handler) declared.delete(event)
		}
	},
	useInterest: () => {}
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: {
		success: () => {},
		error: () => {},
		info: () => {},
		warning: () => {}
	}
}))

import GraphBuildModal from "./GraphBuildModal.svelte"
import { createGraphBuildsCtx } from "$lib/client/stores/graphBuilds.svelte"

const LOREBOOK_ID = 7

/** The proposal a build parked: one new character, three relationships. */
const proposal = (): Sockets.NarrativeGraph.GraphProposal => ({
	nodes: [
		{ tempId: "new_1", name: "Mira", nodeState: "active", summary: "" }
	],
	relationships: [
		{
			fromTempId: "existing_1",
			toTempId: "existing_2",
			relationshipType: "ally",
			description: "",
			visibility: "acknowledged",
			status: "active",
			sceneId: 11
		},
		{
			fromTempId: "existing_1",
			toTempId: "new_1",
			relationshipType: "mentor",
			description: "",
			visibility: "acknowledged",
			status: "active",
			sceneId: 11
		},
		{
			fromTempId: "new_1",
			toTempId: "existing_2",
			relationshipType: "rival",
			description: "",
			visibility: "acknowledged",
			status: "active",
			sceneId: 11
		}
	],
	updatedNodes: [],
	resolvedSceneCast: [
		{
			sceneId: 11,
			historyEntryId: null,
			participantTempIds: ["existing_1", "existing_2", "new_1"],
			mentionedTempIds: []
		},
		{
			sceneId: 12,
			historyEntryId: null,
			participantTempIds: ["existing_3"],
			mentionedTempIds: []
		}
	]
})

/** A build as Layout copies it out of an `activity:update` — a new object each time. */
const parkedBuild = (mode: "replace" | "extend" = "extend"): GraphBuildState => ({
	activityId: "act-1",
	userId: 1,
	lorebookId: LOREBOOK_ID,
	mode,
	status: "review",
	phase: "done",
	sceneIndex: 0,
	totalScenes: 2,
	nodesFound: 1,
	relsFound: 3,
	proposal: proposal(),
	sceneLabels: ["Scene 1", "Scene 2"],
	seedTempIdMap: {},
	seedNodeNames: { existing_1: "Aria", existing_2: "Kael", existing_3: "Lone" },
	startedAt: "2026-09-30T00:00:00.000Z"
})

/** A build as `activity:update` lists it — what the shell's store reads. */
const activity = (b: GraphBuildState) => ({
	kind: "graph_build",
	id: b.activityId,
	...b
})

/** Another book's build, started after this one. */
const otherBooksBuild = (
	status: GraphBuildState["status"] = "review"
): GraphBuildState => ({
	...parkedBuild(),
	activityId: "other-book-build",
	lorebookId: 99,
	status,
	startedAt: "2026-09-30T01:00:00.000Z"
})

/** What the store dismissed on the server. */
const dismissed: string[] = []

const mounted: ReturnType<typeof mount>[] = []
afterEach(() => {
	for (const app of mounted.splice(0)) unmount(app)
	document.body.innerHTML = ""
	sent.length = 0
	dismissed.length = 0
	declared.clear()
})

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

/**
 * The modal under the shell's own store, holding `build` — and every
 * `activity:update` after is `ctx.receive(...)`, as Layout's is.
 */
async function render(opts: { mode?: "replace" | "extend"; build?: GraphBuildState } = {}) {
	const ctx = createGraphBuildsCtx({ dismiss: (id) => dismissed.push(id) })
	ctx.receive([activity(opts.build ?? parkedBuild())])
	const onOpenChange = vi.fn()
	const host = document.createElement("div")
	document.body.append(host)
	const app = mount(GraphBuildModal, {
		target: host,
		props: {
			open: true,
			onOpenChange,
			lorebookId: LOREBOOK_ID,
			mode: opts.mode ?? "extend",
			readySceneCount: 2
		} as any,
		context: new Map([["graphBuildsCtx", ctx]])
	})
	mounted.push(app)
	await settle()
	return { ctx, onOpenChange }
}

const buttons = (label: string) =>
	[...document.querySelectorAll("button")].filter(
		(b) => b.getAttribute("aria-label") === label
	)
const text = () => document.body.textContent?.replace(/\s+/g, " ") ?? ""
const applyButton = () =>
	[...document.querySelectorAll("button")].find((b) =>
		b.textContent?.includes("Apply graph")
	) as HTMLButtonElement

describe("GraphBuildModal review — edits survive the activity stream", () => {
	test("a streamed activity:update does not put back a removed character or undo an edit", async () => {
		const { ctx } = await render()
		expect(buttons("Remove node")).toHaveLength(1)

		// The person removes Mira and edits the first relationship's type.
		buttons("Remove node")[0].click()
		await settle()
		// Expand the Aria → Kael relationship and edit its type.
		;(
			[...document.querySelectorAll('[role="button"]')].find((el) =>
				el.textContent?.includes("ally")
			) as HTMLElement
		).click()
		await settle()
		const typeInput = document.querySelector(
			'input[aria-label="Relationship type"]'
		) as HTMLInputElement
		typeInput.value = "sworn ally"
		typeInput.dispatchEvent(new Event("input", { bubbles: true }))
		await settle()

		// Another activity ticks: Layout hands the SAME build over as a new object.
		ctx.receive([activity(parkedBuild())])
		await settle()
		ctx.receive([activity({ ...parkedBuild(), phase: "done" })])
		await settle()

		expect(buttons("Remove node")).toHaveLength(0)
		expect(buttons("Restore node")).toHaveLength(1)
		expect(
			(
				document.querySelector(
					'input[aria-label="Relationship type"]'
				) as HTMLInputElement | null
			)?.value
		).toBe("sworn ally")
	})

	test("a NEW build replaces the review — the restore follows the activity, not the object", async () => {
		const { ctx } = await render()
		buttons("Remove node")[0].click()
		await settle()
		ctx.receive([activity({ ...parkedBuild(), activityId: "act-2" })])
		await settle()
		expect(buttons("Remove node")).toHaveLength(1)
	})

	test("another book's build starting does not take this review away", async () => {
		const { ctx } = await render()
		buttons("Remove node")[0].click()
		await settle()

		// Another book's build starts — the newest build now, and the one the
		// activity sidebar shows.
		ctx.receive([activity(parkedBuild()), activity(otherBooksBuild("building"))])
		await settle()
		expect(ctx.activeBuild?.lorebookId).toBe(99)
		// This book's review is still here, with the removal kept.
		expect(buttons("Restore node")).toHaveLength(1)
		expect(applyButton()).toBeDefined()

		// It finishes and is dismissed elsewhere: still the same review.
		ctx.receive([activity(parkedBuild())])
		await settle()
		expect(buttons("Restore node")).toHaveLength(1)
	})
})

describe("GraphBuildModal review — what Apply sends", () => {
	test("sends the build's cast and its activity, never the modal's mode; a removed character takes its relationships", async () => {
		await render({ mode: "extend", build: parkedBuild("replace") })
		buttons("Remove node")[0].click()
		await settle()
		expect(text()).toContain("Removed with Mira")

		applyButton().click()
		await settle()
		const apply = sent.find((s) => s.event === "narrativeGraph:applyProposal")
		expect(apply).toBeDefined()
		const params = apply!.data
		expect(params.activityId).toBe("act-1")
		expect("mode" in params).toBe(false)
		expect(typeof params.requestId).toBe("string")
		expect(params.proposal.nodes).toEqual([])
		expect(
			params.proposal.relationships.map(
				(r: any) => `${r.fromTempId}>${r.toTempId}`
			)
		).toEqual(["existing_1>existing_2"])
		expect(params.proposal.resolvedSceneCast).toEqual([
			{
				sceneId: 11,
				historyEntryId: null,
				participantTempIds: ["existing_1", "existing_2"],
				mentionedTempIds: []
			},
			{
				sceneId: 12,
				historyEntryId: null,
				participantTempIds: ["existing_3"],
				mentionedTempIds: []
			}
		])
	})

	test("a parked Rebuild reviews as a Rebuild, whichever button reopened it", async () => {
		await render({ mode: "extend", build: parkedBuild("replace") })
		expect(text()).toContain(
			"This is a rebuild: applying it deletes the links between cast members in this book"
		)
		expect(text()).not.toContain("Applying adds these to your graph.")
	})

	test("a new character with no name cannot be applied, and the review says why", async () => {
		await render()
		// Expand Mira and clear her name.
		;(
			[...document.querySelectorAll('[role="button"]')].find((el) =>
				el.textContent?.includes("Mira")
			) as HTMLElement
		).click()
		await settle()
		const name = document.querySelector(
			'input[aria-label="Name"]'
		) as HTMLInputElement
		name.value = "   "
		name.dispatchEvent(new Event("input", { bubbles: true }))
		await settle()
		expect(applyButton().disabled).toBe(true)
		expect(text()).toContain("needs a name")
	})

	test("only this modal's own apply reply closes it", async () => {
		const { onOpenChange } = await render()
		applyButton().click()
		await settle()
		const params = sent.find(
			(s) => s.event === "narrativeGraph:applyProposal"
		)!.data
		const applied = declared.get("narrativeGraph:applyProposal")!
		const refused = declared.get("narrativeGraph:applyProposal:error")!

		// Another tab applying the same book: neither answer is this modal's.
		applied({
			lorebookId: LOREBOOK_ID,
			requestId: "someone-else",
			nodes: [],
			relationships: [],
			applyNotes: []
		})
		refused({ lorebookId: LOREBOOK_ID, requestId: "someone-else", error: "x" })
		await settle()
		expect(onOpenChange).not.toHaveBeenCalled()
		expect(applyButton().disabled).toBe(true) // still applying

		applied({
			lorebookId: LOREBOOK_ID,
			requestId: params.requestId,
			nodes: [],
			relationships: [],
			applyNotes: []
		})
		await settle()
		expect(onOpenChange).toHaveBeenCalledWith({ open: false })
	})
})

describe("GraphBuildModal review — after the apply", () => {
	test("forgets only the build it applied — another book's build is neither dismissed nor forgotten", async () => {
		const { ctx } = await render()
		// Another book's review was parked earlier.
		ctx.receive([
			activity(parkedBuild()),
			activity({ ...otherBooksBuild(), startedAt: "2026-09-29T00:00:00.000Z" })
		])
		await settle()
		applyButton().click()
		await settle()
		const params = sent.find(
			(s) => s.event === "narrativeGraph:applyProposal"
		)!.data

		// The server takes the applied build away BEFORE it replies, so the
		// shell's newest build is the other book's by the time the reply lands.
		ctx.receive([
			activity({ ...otherBooksBuild(), startedAt: "2026-09-29T00:00:00.000Z" })
		])
		await settle()
		declared.get("narrativeGraph:applyProposal")!({
			lorebookId: LOREBOOK_ID,
			requestId: params.requestId,
			nodes: [],
			relationships: [],
			applyNotes: []
		})
		await settle()

		expect(dismissed).toEqual([])
		expect(ctx.builds.map((b) => b.activityId)).toEqual(["other-book-build"])
	})

	test("forgets the applied build when its reply lands first", async () => {
		const { ctx } = await render()
		applyButton().click()
		await settle()
		const params = sent.find(
			(s) => s.event === "narrativeGraph:applyProposal"
		)!.data
		declared.get("narrativeGraph:applyProposal")!({
			lorebookId: LOREBOOK_ID,
			requestId: params.requestId,
			nodes: [],
			relationships: [],
			applyNotes: []
		})
		await settle()
		expect(dismissed).toEqual([])
		expect(ctx.builds).toEqual([])
	})
})

describe("GraphBuildModal review — a build that only read who was in each scene", () => {
	test("can be applied, so the casts are saved and the scenes are not read again", async () => {
		const b = parkedBuild()
		b.proposal = {
			nodes: [],
			relationships: [],
			updatedNodes: [],
			resolvedSceneCast: proposal().resolvedSceneCast
		}
		await render({ build: b })
		expect(text()).toContain("who was in 2 scenes")
		expect(applyButton().disabled).toBe(false)
		applyButton().click()
		await settle()
		const params = sent.find(
			(s) => s.event === "narrativeGraph:applyProposal"
		)!.data
		expect(params.proposal.resolvedSceneCast).toHaveLength(2)
	})

	test("but not when the build failed", async () => {
		const b = parkedBuild("replace")
		b.proposal = {
			nodes: [],
			relationships: [],
			updatedNodes: [],
			resolvedSceneCast: proposal().resolvedSceneCast
		}
		b.relationshipDiagnostics = {
			perspectiveCalls: 2,
			scenesSkippedNoPair: 0,
			noJson: 2,
			badJson: 0,
			notArray: 0,
			missingType: 0,
			missingTarget: 0,
			wrongSource: 0,
			retried: 0,
			retriedRecovered: 0,
			unresolvedTargets: []
		}
		await render({ build: b })
		expect(text()).toContain("This build did not run correctly.")
		expect(applyButton().disabled).toBe(true)
	})
})
