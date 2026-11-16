/**
 * A frame that declares `takes: ["message"]` on its `ready` (★M-1, 2026-11-14)
 * is sent a streamed update as one `{ t: "message" }` row; every other push
 * is the full list. A frame that says nothing sees the full list every time,
 * exactly as before. The frame's document is stood in for: the test takes the
 * port the load hands over and speaks for the frame on it.
 */
import { describe, expect, test } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import PluginFrame from "./PluginFrame.svelte"

const settle = () => new Promise((r) => setTimeout(r, 20))

type Row = Record<string, unknown> & {
	id: number
	content: string
	isGenerating?: boolean
}
const base = (): Row[] => [
	{ id: 1, content: "one" },
	{ id: 2, content: "two" },
	{ id: 3, content: "" }
]

async function open(ready: Record<string, unknown>, initial: Row[] = base()) {
	// Rows keep their reference unless the test replaces them: a getter prop
	// over a raw state, so an unchanged row is the very object the wire saw.
	let msgs = $state.raw<Row[]>(initial)
	const target = document.createElement("div")
	document.body.appendChild(target)
	const app = mount(PluginFrame, {
		target,
		props: {
			src: "about:blank",
			title: "Map",
			surface: "session-view",
			session: { id: 1, name: "S" },
			get messages() {
				return msgs
			}
		} as never
	})
	flushSync()
	await settle()
	const iframe = target.querySelector("iframe")!
	let handed: MessagePort | undefined
	Object.defineProperty(iframe, "contentWindow", {
		configurable: true,
		value: {
			postMessage: (_m: unknown, _o: string, transfer: MessagePort[]) =>
				(handed = transfer[0])
		}
	})
	iframe.dispatchEvent(new Event("load"))
	const got: Array<Record<string, unknown>> = []
	handed!.onmessage = (e) => got.push(e.data)
	handed!.postMessage({ t: "ready", ...ready })
	await settle()
	const log = () =>
		got.filter((m) =>
			["messages", "message", "channel"].includes(m.t as string)
		)
	return {
		log,
		set: async (next: Row[]) => {
			msgs = next
			flushSync()
			await settle()
		},
		rows: () => msgs,
		close: () => {
			handed?.close()
			unmount(app)
			target.remove()
		}
	}
}

/** The sequence: five streamed frames, the settle, an add, a remove. */
async function run(f: Awaited<ReturnType<typeof open>>) {
	const text = ["H", "He", "Hel", "Hell", "Hello"]
	for (const c of text) {
		const r = f.rows()
		await f.set([
			...r.slice(0, 2),
			{ id: 3, content: c, isGenerating: true }
		])
	}
	await f.set([...f.rows().slice(0, 2), { id: 3, content: "Hello" }])
	await f.set([...f.rows(), { id: 4, content: "four" }])
	await f.set(f.rows().slice(1))
}

const summary = (log: Array<Record<string, unknown>>) =>
	log.map((m) =>
		m.t === "message"
			? `message:${(m.message as Row).id}:${(m.message as Row).content}`
			: `messages:${(m.messages as Row[]).length}`
	)

describe("a frame's ready.takes (★M-1)", () => {
	test("a declaring frame is sent one message per streamed frame, the full list otherwise", async () => {
		const f = await open({ takes: ["message"] })
		await run(f)
		expect(summary(f.log())).toEqual([
			"messages:3",
			"message:3:H",
			"message:3:He",
			"message:3:Hel",
			"message:3:Hell",
			"message:3:Hello",
			"messages:3",
			"messages:4",
			"messages:3"
		])
		f.close()
	})

	test("a silent frame is sent the full projected list every time, byte-identical", async () => {
		const f = await open({})
		const lists: Row[][] = [base()]
		const text = ["H", "He", "Hel", "Hell", "Hello"]
		for (const c of text) {
			const next = [
				...f.rows().slice(0, 2),
				{ id: 3, content: c, isGenerating: true }
			]
			lists.push(next)
			await f.set(next)
		}
		const settled = [...f.rows().slice(0, 2), { id: 3, content: "Hello" }]
		lists.push(settled)
		await f.set(settled)
		const added = [...f.rows(), { id: 4, content: "four" }]
		lists.push(added)
		await f.set(added)
		const removed = f.rows().slice(1)
		lists.push(removed)
		await f.set(removed)
		const log = f.log()
		expect(summary(log)).toEqual([
			"messages:3",
			"messages:3",
			"messages:3",
			"messages:3",
			"messages:3",
			"messages:3",
			"messages:3",
			"messages:4",
			"messages:3"
		])
		log.forEach((m, k) =>
			expect(JSON.stringify(m)).toBe(
				JSON.stringify({ t: "messages", messages: lists[k] })
			)
		)
		f.close()
	})

	test("the one message row carries no host field", async () => {
		const f = await open({ takes: ["message"] })
		const r = f.rows()
		await f.set([
			...r.slice(0, 2),
			{
				id: 3,
				content: "x",
				isGenerating: true,
				embedding: [1, 2],
				debugMeta: { a: 1 },
				userId: 9
			}
		])
		const one = f.log().at(-1) as {
			t: string
			message: Record<string, unknown>
		}
		expect(one.t).toBe("message")
		expect(one.message.content).toBe("x")
		for (const k of ["embedding", "debugMeta", "userId"])
			expect(one.message).not.toHaveProperty(k)
		f.close()
	})

	test.each([
		["an empty list", []],
		["an unknown entry", ["something-else"]],
		["a non-array", "message"]
	])("%s is the same as saying nothing", async (_n, takes) => {
		const f = await open({ takes })
		await run(f)
		expect(f.log().every((m) => m.t === "messages")).toBe(true)
		expect(f.log()).toHaveLength(9)
		f.close()
	})
})
