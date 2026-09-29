/**
 * A message row crosses to a widget without the host's bookkeeping
 * (`MESSAGE_HOST_FIELDS`): no `debugMeta` (the compiled prompt, which can
 * carry other users' lore and connection details — R53), no `embedding`
 * vector, no `userId`, `queueItemId`, `embeddingModel`, `vectorizedAt` or
 * `version`. A plugin's remote, an authored remote and core's own
 * conversation are all fed the same projection — core reads a recorded
 * prompt's presence off its dossier line (`promptDetails`), and the prompt
 * through `prompt-details`. The page's UI workers are stood in for; the
 * widget wire is the real one.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import { MESSAGE_HOST_FIELDS } from "@serene-pub/sdk"
import { savedFrameState } from "$lib/client/components/frames/framePort"
import { CORE_CONVERSATION } from "$lib/client/components/sessionPage/coreWidgets"
import RemoteWidget from "./RemoteWidget.svelte"

const posted = vi.hoisted(() => [] as Array<Record<string, unknown>>)
vi.mock("$lib/client/components/host/uiWorkers", () => ({
	acquireWorker: () => ({}),
	releaseWorker: () => {},
	listenForRemoteEvents: () => {},
	currentEvent: () => undefined,
	routeMount: () => () => {},
	postToWorker: (_worker: unknown, m: Record<string, unknown>) => posted.push(m)
}))

const settle = () => new Promise((r) => setTimeout(r, 20))

/** A stored row as `sessions:get` sends it — the bookkeeping included. */
const row = (id: number, channel: string) => ({
	id,
	sessionId: 42,
	channel,
	role: "assistant",
	content: `line ${id}`,
	characterId: 3,
	userId: 7,
	queueItemId: 99,
	debugMeta: { prompt: "SYSTEM: other user's secret lore", connection: { baseUrl: "http://10.0.0.2" } },
	embedding: [0.1, 0.2, 0.3],
	embeddingModel: "bge-small",
	vectorizedAt: "2026-09-25T00:00:00.000Z",
	version: 4
})

async function remote(owner: string, src: string, reads: readonly string[] | undefined, channels: string[] = []) {
	const target = document.createElement("div")
	document.body.appendChild(target)
	const app = mount(RemoteWidget, {
		target,
		props: {
			widget: { id: "w", title: "W" },
			owner,
			src,
			session: { id: 42, name: "Real", sessionMessages: [row(1, "main"), row(2, "board")] },
			channels,
			reads: reads as never
		}
	})
	flushSync()
	const mounted = posted.find((m) => m.k === "mount") as { port: MessagePort }
	const got: Array<Record<string, unknown>> = []
	mounted.port.onmessage = (e) => got.push(e.data)
	mounted.port.postMessage({ t: "ready" })
	await settle()
	return {
		got,
		close: async () => {
			mounted.port.close()
			await unmount(app)
			target.remove()
		}
	}
}

/** Every row the widget was posted, off `messages` and `channel` posts alike. */
const rowsIn = (got: Array<Record<string, unknown>>) =>
	got
		.filter((m) => m.t === "messages" || m.t === "channel")
		.flatMap((m) => m.messages as Array<Record<string, unknown>>)

const expectStripped = (rows: Array<Record<string, unknown>>) => {
	expect(rows.length).toBeGreaterThan(0)
	for (const r of rows) {
		for (const field of MESSAGE_HOST_FIELDS) expect(r, field).not.toHaveProperty(field)
		// What a widget renders from is untouched.
		expect(r).toMatchObject({ role: "assistant", characterId: 3, sessionId: 42 })
		expect(r.content).toBe(`line ${r.id}`)
	}
}

afterEach(() => {
	posted.length = 0
	savedFrameState.clear()
})

describe("rows reach a widget without the host's bookkeeping", () => {
	test("a plugin's remote", async () => {
		const w = await remote("acme", "/plugin-ui/acme/board.js", undefined)
		expectStripped(rowsIn(w.got))
		await w.close()
	})

	test("a plugin's remote scoped to lanes (`channel` posts)", async () => {
		const w = await remote("acme", "/plugin-ui/acme/board.js", undefined, ["board"])
		const posts = w.got.filter((m) => m.t === "channel")
		expect(posts).toHaveLength(1)
		expectStripped(rowsIn(w.got))
		await w.close()
	})

	test("an authored remote", async () => {
		const w = await remote("authored.abcdefghij", "/authored-ui/authored.abcdefghij/0123456789abcdef.js", undefined)
		expectStripped(rowsIn(w.got))
		await w.close()
	})

	test("core's own conversation too (defence in depth)", async () => {
		const w = await remote("core", CORE_CONVERSATION.src, CORE_CONVERSATION.reads)
		expectStripped(rowsIn(w.got))
		await w.close()
	})
})

/**
 * The per-token clone never copies the bookkeeping: the row is projected
 * BEFORE the snapshot, so `$state.snapshot` never walks an `embedding`
 * vector or a `debugMeta` prompt — it is not so much as read. Counted
 * through getters on the stored row.
 */
describe("the log's snapshot never walks the host's bookkeeping", () => {
	test("embedding and debugMeta are never read on the way to the wire", async () => {
		const reads = { embedding: 0, debugMeta: 0 }
		const counted = (id: number) => {
			const r: Record<string, unknown> = { ...row(id, "main") }
			delete r.embedding
			delete r.debugMeta
			Object.defineProperty(r, "embedding", {
				enumerable: true,
				get: () => (reads.embedding++, [0.1, 0.2, 0.3])
			})
			Object.defineProperty(r, "debugMeta", {
				enumerable: true,
				get: () => (reads.debugMeta++, { prompt: "SYSTEM: secret" })
			})
			return r
		}
		const target = document.createElement("div")
		document.body.appendChild(target)
		const app = mount(RemoteWidget, {
			target,
			props: {
				widget: { id: "w", title: "W" },
				owner: "acme",
				src: "/plugin-ui/acme/board.js",
				session: { id: 42, name: "Real", sessionMessages: [counted(1), counted(2)] }
			}
		})
		flushSync()
		const mounted = posted.find((m) => m.k === "mount") as { port: MessagePort }
		const got: Array<Record<string, unknown>> = []
		mounted.port.onmessage = (e) => got.push(e.data)
		mounted.port.postMessage({ t: "ready" })
		await settle()
		// The widget still got its rows — stripped, as before.
		expect(rowsIn(got).map((r) => r.id)).toEqual([1, 2])
		expectStripped(rowsIn(got))
		expect(reads).toEqual({ embedding: 0, debugMeta: 0 })
		mounted.port.close()
		await unmount(app)
		target.remove()
	})
})
