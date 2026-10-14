/**
 * 🚧 The session page's half of live scenes (§14 C): the boundary asks are
 * the asker's alone — a reply or a refusal for another press (another tab's,
 * another widget's) settles nothing here — and the scenes flow runs a
 * divider's *Summarize* in the Process scene window and asks before
 * *Remove boundary*.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, tick } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
const toaster = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	info: vi.fn(),
	warning: vi.fn()
}))
vi.mock("$lib/client/utils/toaster", () => ({ toaster }))

import { setSocket } from "$lib/client/sockets/socketInstance"
import {
	_resetInterestForTests,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import { createPageAsks } from "./pageAsks"
import { createScenesFlow } from "./scenesFlow.svelte"

type Listener = (payload: any) => void
function makeClientSocket() {
	const listeners = new Map<string, Listener[]>()
	return {
		connected: true,
		id: "tab-a",
		emits: [] as Array<{ event: string; payload: any }>,
		on(event: string, fn: Listener) {
			listeners.set(event, [...(listeners.get(event) ?? []), fn])
		},
		off(event: string, fn: Listener) {
			const arr = listeners.get(event) ?? []
			const at = arr.indexOf(fn)
			if (at !== -1) arr.splice(at, 1)
		},
		emit(event: string, payload: any) {
			this.emits.push({ event, payload })
		},
		dispatch(event: string, payload: any) {
			for (const fn of [...(listeners.get(event) ?? [])]) fn(payload)
		}
	}
}

const SESSION = 7
let client: ReturnType<typeof makeClientSocket>

beforeEach(() => {
	client = makeClientSocket()
	setSocket(client as never)
	setInterestUser({ id: 1, isAdmin: false })
})

afterEach(() => {
	_resetInterestForTests()
	setSocket(null)
})

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

const sent = (event: string) => client.emits.filter((e) => e.event === event)
const pageAsks = () =>
	createPageAsks({
		socket: client as never,
		inbox: { on: () => () => {} } as never,
		sessionId: () => SESSION
	})
const reply = (requestId: string, sessionId = SESSION) => ({
	requestId,
	sessionId,
	scene: { id: 12, sessionId, channel: "main", openedAtMessageId: 4, closedAtMessageId: null }
})

describe("the page's boundary asks", () => {
	test("Start scene here settles on its own reply, heard on the session's key; another press's settles nothing", async () => {
		const asks = pageAsks()
		let opened: number | null = null
		void asks
			.openScene({ sessionId: SESSION, channel: "main", atMessageId: 4 })
			.then((r) => (opened = r.scene.id))
		await settle()
		const ask = sent("scenes:open")[0]!.payload
		expect(ask).toMatchObject({ sessionId: SESSION, channel: "main", atMessageId: 4 })
		expect(typeof ask.requestId).toBe("string")

		client.dispatch("scenes:open", reply("another-tab"))
		await settle()
		expect(opened).toBeNull()
		client.dispatch("scenes:open", reply(ask.requestId))
		await settle()
		expect(opened).toBe(12)
		asks.drop("done")
	})

	test("a refusal answers its own press only, in the server's words", async () => {
		const asks = pageAsks()
		let refused: string | null = null
		void asks
			.closeScene({ sessionId: SESSION, sceneId: 12, atMessageId: 6 })
			.catch((e: Error) => (refused = e.message))
		await settle()
		const ask = sent("scenes:close")[0]!.payload
		expect(ask).toMatchObject({ sceneId: 12, atMessageId: 6 })
		expect(ask).not.toHaveProperty("sessionId")
		client.dispatch("scenes:close:error", { error: "Not this one.", requestId: "someone-else" })
		await settle()
		expect(refused).toBeNull()
		client.dispatch("scenes:close:error", {
			error: "A scene cannot end before the message it starts at.",
			requestId: ask.requestId
		})
		await settle()
		expect(refused).toBe("A scene cannot end before the message it starts at.")
		asks.drop("done")
	})

	test("a rename settles on the scene it names; a removal on the scene that went", async () => {
		const asks = pageAsks()
		let renamed = false
		let removed = false
		void asks.renameScene({ sceneId: 12, name: "The cellar" }).then(() => (renamed = true))
		void asks.deleteScene(12).then(() => (removed = true))
		await settle()
		expect(sent("scenes:update")[0]!.payload).toEqual({
			scene: { id: 12, name: "The cellar" },
			requestId: expect.any(String)
		})
		expect(sent("scenes:delete")[0]!.payload).toEqual({
			id: 12,
			requestId: expect.any(String)
		})
		client.dispatch("scenes:update", { scene: { id: 3, name: "Else" } })
		client.dispatch("scenes:delete", { id: 3, sessionId: SESSION })
		await settle()
		expect([renamed, removed]).toEqual([false, false])
		client.dispatch("scenes:update", { scene: { id: 12, name: "The cellar" } })
		client.dispatch("scenes:delete", { id: 12, sessionId: SESSION })
		await settle()
		expect([renamed, removed]).toEqual([true, true])
		asks.drop("done")
	})
})

describe("the scenes flow", () => {
	function flow() {
		let made!: ReturnType<typeof createScenesFlow>
		const cleanup = $effect.root(() => {
			made = createScenesFlow({
				socket: client as never,
				inbox: { on: () => () => {} } as never,
				sessionId: () => SESSION,
				ownLorebookId: () => null,
				data: { session: { id: SESSION, sessionMessages: [] }, markNotFound() {} } as never,
				sceneSummarizesCtx: { activities: [], reviewSceneId: null, setReviewSceneId() {} } as never,
				sessionSummarizesCtx: { activities: [], reviewActivityId: null, setReviewActivityId() {} } as never
			})
		})
		return { scenes: made, cleanup }
	}

	test("a divider's Summarize runs the scene in the Process scene window, kept if abandoned; one window at a time", async () => {
		const { scenes, cleanup } = flow()
		scenes.processScene(12)
		expect(sent("scenes:process").map((e) => e.payload)).toEqual([{ sceneId: 12 }])
		expect([scenes.showProcessSceneModal, scenes.processSceneId]).toEqual([true, 12])
		expect(() => scenes.processScene(13)).toThrow(/another scene's summary is open/)
		scenes.processScene(12)
		expect(sent("scenes:process")).toHaveLength(1)
		cleanup()
	})

	test("Remove boundary is asked first: yes and no each answer once; a session switch keeps it", async () => {
		const { scenes, cleanup } = flow()
		const yes = scenes.confirmRemoveScene({ id: 12, name: "The cellar", summary: "They hid." })
		expect(scenes.removeAsk?.scene).toEqual({ id: 12, name: "The cellar", summarized: true })
		scenes.removeAsk!.answer(true)
		expect(await yes).toBe(true)
		expect(scenes.removeAsk).toBeNull()

		const kept = scenes.confirmRemoveScene({ id: 13, name: null })
		scenes.closeProcess()
		expect(await kept).toBe(false)
		cleanup()
	})
})
