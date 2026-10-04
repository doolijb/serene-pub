/**
 * A review screen that saves into a lorebook says so BEFORE the work when the
 * person's lorebook writes from sessions are Off (plan A22) — the compile is
 * the case here: it does not start, and a review reopened after the setting
 * moved cannot save. Under Review changes it runs as it always did.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
import { LORE_WRITES_OFF_NOTICE } from "$lib/shared/lorebooks/loreWriteMode"

const sent: { event: string; data: any }[] = []

vi.mock("$app/environment", () => ({ dev: true, building: false }))
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => ({
		emit: (event: string, data: any) => sent.push({ event, data }),
		on: () => {},
		off: () => {}
	})
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: () => () => {},
	useInterest: () => {}
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { success: () => {}, error: () => {}, info: () => {}, warning: () => {} }
}))

import CompileHistoryEntryModal from "./CompileHistoryEntryModal.svelte"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"

const entry = {
	id: 21,
	lorebookId: 3,
	typeId: HISTORY_TYPE_ID,
	branchId: null,
	year: 4,
	month: null,
	day: null,
	content: "The caravan set out.",
	isCompleted: false
} as any

const mounted: ReturnType<typeof mount>[] = []
afterEach(() => {
	for (const app of mounted.splice(0)) unmount(app)
	document.body.innerHTML = ""
	sent.length = 0
})

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

function render(own: string | null, props: Record<string, unknown>) {
	const host = document.createElement("div")
	document.body.append(host)
	const app = mount(CompileHistoryEntryModal, {
		target: host,
		props: { open: true, onOpenChange: () => {}, historyEntry: entry, ...props } as any,
		context: new Map<string, unknown>([
			["userSettingsCtx", { settings: { loreWriteMode: own } }],
			["systemSettingsCtx", { settings: { loreWriteModeDefault: "review" }, capabilityDefaults: {} }]
		])
	})
	mounted.push(app)
	return app
}

describe("the compile under lorebook writes from sessions", () => {
	test("Off: it says so on open and never starts", async () => {
		render("off", { initialStep: "running" })
		await settle()
		expect(document.body.textContent).toContain(LORE_WRITES_OFF_NOTICE)
		expect(sent.map((s) => s.event)).not.toContain("scenes:compile")
	})

	test("Off: a review reopened after the setting moved says so and cannot save", async () => {
		render("off", { activityId: "act-1", pendingResult: { content: "Dawn." }, initialStep: "review" })
		await settle()
		expect(document.body.textContent).toContain(LORE_WRITES_OFF_NOTICE)
		const save = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Save to Entry"))
		save?.click()
		await settle()
		expect(sent.map((s) => s.event)).not.toContain("entries:update")
	})

	test("following the instance's Review changes, it compiles as it always did", async () => {
		render(null, { initialStep: "running" })
		await settle()
		expect(document.body.textContent).not.toContain(LORE_WRITES_OFF_NOTICE)
		expect(sent.map((s) => s.event)).toContain("scenes:compile")
	})
})
