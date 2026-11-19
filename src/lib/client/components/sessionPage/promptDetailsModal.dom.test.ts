/**
 * Prompt details draws no model plumbing for an owner who is not an
 * administrator: the **Format** comes from the connection. An administrator
 * who owns the session sees it as before. The total and limit show to both.
 */
import { afterEach, describe, expect, test } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
import PromptDetailsModal from "./PromptDetailsModal.svelte"

const META = {
	promptFormat: "vicuna-format",
	templateName: null,
	timestamp: "2026-11-16T00:00:00.000Z",
	truncationReason: null,
	currentTurnCharacterId: null,
	tokenCounts: { total: 120, limit: 4096 },
	sessionMessages: { included: 2, total: 2, includedIds: [1, 2], excludedIds: [] },
	sources: {},
	retrieval: { budget: null, blocks: [] }
}

let apps: ReturnType<typeof mount>[] = []
afterEach(() => {
	for (const app of apps) unmount(app)
	apps = []
	document.body.innerHTML = ""
})

async function show(isAdmin: boolean) {
	const host = document.createElement("div")
	document.body.append(host)
	apps.push(
		mount(PromptDetailsModal, {
			target: host,
			props: {
				open: true,
				onOpenChange: () => {},
				promptDetails: { prompt: "p", messages: undefined, meta: META } as any,
				detailsExceeded: false,
				isAdmin
			}
		})
	)
	flushSync()
	await tick()
	return document.body.textContent ?? ""
}

describe("Prompt details: the prompt format", () => {
	test("an owner who is not an administrator sees the total and limit, and no format", async () => {
		const text = await show(false)
		expect(text).toContain("120 / 4,096")
		expect(text).not.toContain("Format:")
		expect(text).not.toContain("vicuna-format")
	})

	test("an administrator who owns the session sees the format as before", async () => {
		const text = await show(true)
		expect(text).toContain("120 / 4,096")
		expect(text).toContain("Format:")
		expect(text).toContain("vicuna-format")
	})
})
