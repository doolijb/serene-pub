/**
 * The session a remote widget is handed is composed the way the page composes
 * it (`sessionPageData.svelte.ts`: the store's record, its cast and its rows
 * spread into one value) and posted by REFERENCE (perf-N w1): a streamed frame
 * moves only the log, so `session` is neither posted nor serialised; a real
 * change to a field the widget's `session.v1` carries is posted exactly once.
 *
 * The page's UI workers are stood in for; the store, `RemoteWidget` and the
 * widget wire are real.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import { savedFrameState } from "$lib/client/components/frames/framePort"
import { createSessionStore } from "$lib/client/sessions/store/sessionStore.svelte"
import RemoteWidget from "./RemoteWidget.svelte"

const posted = vi.hoisted(() => [] as Array<Record<string, unknown>>)
vi.mock("$lib/client/components/host/uiWorkers", () => ({
	acquireWorker: () => ({}),
	releaseWorker: () => {},
	listenForRemoteEvents: () => {},
	currentEvent: () => undefined,
	routeMount: () => () => {},
	postToWorker: (_worker: unknown, m: Record<string, unknown>) =>
		posted.push(m)
}))

const settle = () => new Promise((r) => setTimeout(r, 20))
const N = 40
const FRAMES = 50
const pag = { hasMore: false, olderIn: [] } as any

function rowAt(i: number, extra: Record<string, unknown> = {}) {
	return {
		id: i,
		sessionId: 1,
		channel: "main",
		role: i % 2 ? "user" : "assistant",
		content: `line ${i}`,
		metadata: null,
		isGenerating: false,
		updatedAt: "2026-11-13T00:00:00.000Z",
		...extra
	} as any
}

function payload() {
	const rows = Array.from({ length: N }, (_, k) => rowAt(k + 1))
	rows[N - 1] = rowAt(N, {
		role: "assistant",
		isGenerating: true,
		content: ""
	})
	return {
		id: 1,
		name: "S",
		primaryRuleset: "rs",
		rulesetSettings: { rs: { x: 1 } },
		channels: [{ id: "main", mine: false }],
		sessionMessages: rows,
		sessionCharacters: [],
		sessionPersonas: []
	} as any
}

const frame = (n: number, extra: Record<string, unknown> = {}) =>
	rowAt(N, {
		role: "assistant",
		isGenerating: true,
		content: "x".repeat(n),
		updatedAt: `2026-11-13T00:00:${String(n % 60).padStart(2, "0")}.000Z`,
		...extra
	})

async function open() {
	const store = createSessionStore()
	store.open(1)
	store.load(payload(), pag)
	let session!: () => unknown
	const stop = $effect.root(() => {
		// As the page composes it (sessionPageData.svelte.ts:99-104).
		const record = $derived(store.session(1))
		const rows = $derived(record ? store.messagesOf(1) : [])
		const cast = $derived(record ? store.castOf(1) : undefined)
		const composed = $derived(
			record && cast
				? { ...record, ...cast, sessionMessages: rows }
				: undefined
		)
		session = () => composed
	})
	flushSync()
	const props = {
		widget: { id: "acme.quiz:log", title: "Question log" },
		owner: "acme.quiz",
		src: "/plugin-ui/acme.quiz/log.js",
		get session() {
			return session()
		},
		eager: true
	} as Record<string, unknown>
	const target = document.createElement("div")
	document.body.appendChild(target)
	const app = mount(RemoteWidget, { target, props: props as never })
	flushSync()
	const mounted = posted.find((m) => m.k === "mount") as { port: MessagePort }
	const got: Array<Record<string, unknown>> = []
	mounted.port.onmessage = (e) => got.push(e.data)
	mounted.port.postMessage({ t: "ready" })
	await settle()
	return {
		store,
		got,
		close: async () => {
			mounted.port.close()
			await unmount(app)
			stop()
			target.remove()
		}
	}
}

afterEach(() => {
	vi.restoreAllMocks()
	posted.length = 0
	savedFrameState.clear()
})

describe("the session a remote widget is handed, composed as the page composes it", () => {
	test.each([
		["content deltas", (n: number) => frame(n)],
		[
			"content and reasoning",
			(n: number) => frame(n, { metadata: { reasoning: `r${n}` } })
		]
	])(
		"50 streamed frames (%s): the log streams, `session` is not posted or serialised",
		async (_name, make) => {
			const w = await open()
			expect(w.got.filter((m) => m.t === "session")).toHaveLength(1)
			const before = w.got.length
			const stringify = vi.spyOn(JSON, "stringify")
			for (let n = 1; n <= FRAMES; n++) {
				w.store.upsertMessage(make(n))
				flushSync()
				await settle()
			}
			const serialised = stringify.mock.calls.filter(
				(a) => (a[0] as { t?: string } | null)?.t === "session"
			).length
			stringify.mockRestore()
			const after = w.got.slice(before)
			console.log(
				`[remoteWidget] session stringifies / posts over ${FRAMES} frames: ${serialised} / ${after.filter((m) => m.t === "session").length}`
			)
			expect(after.filter((m) => m.t === "session")).toEqual([])
			expect(serialised).toBe(0)
			expect(
				after.some((m) => m.t === "message" || m.t === "messages")
			).toBe(true)
			await w.close()
		}
	)

	test("a real change to a field `session.v1` reads: exactly one `session` post with the new name", async () => {
		const w = await open()
		const before = w.got.length
		w.store.patchSession(1, { name: "Renamed" })
		flushSync()
		await settle()
		const posts = w.got.slice(before).filter((m) => m.t === "session")
		expect(posts).toHaveLength(1)
		expect((posts[0].session as { name: string }).name).toBe("Renamed")
		await w.close()
	})

	test("a nested field it copies (ruleset values, a channel): exactly one post each", async () => {
		const w = await open()
		// The store replaces the session record wholesale (`patchSession` sets a
		// new record); `sessionV1` copies deeply, so its `$derived` hands a new
		// reference whose content moved.
		let before = w.got.length
		w.store.patchSession(1, { rulesetSettings: { rs: { x: 2 } } } as never)
		flushSync()
		await settle()
		let posts = w.got.slice(before).filter((m) => m.t === "session")
		expect(posts).toHaveLength(1)
		expect(
			(posts[0].session as { rulesetSettings: { values: { x: number } } })
				.rulesetSettings.values.x
		).toBe(2)
		before = w.got.length
		w.store.patchSession(1, { channels: [{ id: "main", mine: true }] })
		flushSync()
		await settle()
		posts = w.got.slice(before).filter((m) => m.t === "session")
		expect(posts).toHaveLength(1)
		expect(
			(posts[0].session as { channels: Array<{ mine: boolean }> })
				.channels[0].mine
		).toBe(true)
		await w.close()
	})
})
