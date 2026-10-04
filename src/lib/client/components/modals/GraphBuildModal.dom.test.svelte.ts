/**
 * The Rebuild confirmation (places plan L1; owner Q1 2026-09-29: "Rebuild is
 * only for relationships. There should be no rebuild locations because they
 * are largely static.").
 *
 * The warning counts only what a Rebuild deletes — the links between cast
 * members, on every line — says they come back on main alone, and that
 * places and every link with an entry at either end are kept. The screen's
 * report names places and items, not world lore alone (L1 review).
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => ({ emit: () => {}, on: () => {}, off: () => {} })
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: () => () => {},
	useInterest: () => {}
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { success: () => {}, error: () => {}, info: () => {}, warning: () => {} }
}))

import GraphBuildModal from "./GraphBuildModal.svelte"
import { createGraphBuildsCtx } from "$lib/client/stores/graphBuilds.svelte"

const mounted: ReturnType<typeof mount>[] = []
afterEach(() => {
	for (const app of mounted.splice(0)) unmount(app)
	document.body.innerHTML = ""
})

async function render(props: Record<string, unknown>) {
	const host = document.createElement("div")
	document.body.append(host)
	const app = mount(GraphBuildModal, {
		target: host,
		props: {
			open: true,
			onOpenChange: () => {},
			lorebookId: 7,
			mode: "replace",
			readySceneCount: 3,
			...props
		} as any,
		context: new Map([
			["graphBuildsCtx", createGraphBuildsCtx({ dismiss: () => {} })]
		])
	})
	mounted.push(app)
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
	return document.body.textContent?.replace(/\s+/g, " ") ?? ""
}

describe("GraphBuildModal — what a Rebuild deletes", () => {
	test("counts the cast ties it deletes, on every line, and keeps places and entry links", async () => {
		const text = await render({ existingCastToCastCount: 4, existingUnboundNodeCount: 2 })
		expect(text).toContain(
			"This will delete the 4 links between cast members in this book, on main and on every branch, and re-create them on main from your scenes, so any drawn by hand or on a branch do not come back."
		)
		expect(text).toContain("Places, and links with a place or other entry at either end, are kept.")
		expect(text).toContain("including the 2 unbound nodes")
		expect(text).toContain("derive the links between cast members")
		expect(text).not.toContain("fresh graph")
	})

	test("one tie reads in the singular; none deletes nothing and says so", async () => {
		expect(await render({ existingCastToCastCount: 1 })).toContain("delete the 1 link between cast members")
		unmount(mounted.pop()!)
		document.body.innerHTML = ""
		const none = await render({ existingCastToCastCount: 0, existingUnboundNodeCount: 1 })
		expect(none).toContain("This will re-create the links between cast members from your scenes.")
		expect(none).not.toContain("This will delete")
	})
})
