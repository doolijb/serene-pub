/**
 * What a streamed token costs the widget wire, on its own (perf-F w4): a
 * content frame moves only `messages`, so no other section is posted again
 * and, for an input that is replaced rather than mutated, none is serialised
 * to find that out either (`postChangedFrom`).
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import Fixture from "./WidgetWireFixture.svelte"
import type { WidgetWire, WireInputs } from "./widgetWire.svelte"

const settle = () => new Promise((r) => setTimeout(r, 20))

type Row = { id: number; content: string }
const rows = (n: number, last: string): Row[] =>
	Array.from({ length: n }, (_, k) => ({
		id: k + 1,
		content: k === n - 1 ? last : `row ${k + 1}`
	}))

// The page's sections as one reference each, handed unchanged on every token.
const SESSION = { id: 1, name: null as string | null }
const SETTINGS = { layout: "strip" }
const DOSSIER = { session: { id: 1 }, note: "full" } as never

async function open(inputs: () => WireInputs) {
	let wire!: WidgetWire
	const target = document.createElement("div")
	const app = mount(Fixture, {
		target,
		props: { inputs, onWire: (w: WidgetWire) => (wire = w) }
	})
	const channel = new MessageChannel()
	const got: Array<Record<string, unknown>> = []
	channel.port2.onmessage = (e) => got.push(e.data)
	wire.attach(channel.port1)
	channel.port2.postMessage({ t: "ready" })
	await settle()
	flushSync()
	return {
		got,
		ready: async () => {
			channel.port2.postMessage({ t: "ready" })
			await settle()
		},
		close: () => {
			wire.detach()
			unmount(app)
		}
	}
}

afterEach(() => vi.restoreAllMocks())

describe("a token moves only the log", () => {
	test("50 content frames: 50 messages posts, no other section re-posted, and the JSON the wire does", async () => {
		let msgs = $state.raw<Row[]>(rows(40, "a"))
		const props = { answers: [1, 2, 3] }
		const w = await open(() => ({
			stateKey: "k",
			session: SESSION,
			props,
			settings: SETTINGS,
			scoped: { session_full: DOSSIER },
			messages: msgs
		}))
		const first = w.got.map((m) => m.t)
		expect(first).toEqual(
			expect.arrayContaining([
				"session",
				"props",
				"settings",
				"annex",
				"turn-order",
				"attendance",
				"viewer",
				"scoped",
				"messages"
			])
		)
		const before = w.got.length
		const stringify = vi.spyOn(JSON, "stringify")
		for (let n = 1; n <= 50; n++) {
			msgs = rows(40, "a".repeat(n + 1))
			flushSync()
			await settle()
		}
		const calls = stringify.mock.calls.length
		const sections = (t: string) =>
			stringify.mock.calls.filter(
				(c) => (c[0] as { t?: string } | null)?.t === t
			).length
		const bySection = {
			session: sections("session"),
			settings: sections("settings"),
			scoped: sections("scoped")
		}
		stringify.mockRestore()
		const posted = w.got.slice(before)
		console.log(`[perToken] JSON.stringify calls over 50 pushes: ${calls}`)
		expect(posted.filter((m) => m.t === "messages")).toHaveLength(50)
		expect(posted.filter((m) => m.t !== "messages")).toEqual([])
		expect(
			(posted.at(-1) as { messages: Row[] }).messages.at(-1)!.content
		).toBe("a".repeat(51))
		// One section is still compared by content, one stringify per push: the
		// viewer (a fresh object on every read). Session, settings, scoped,
		// props, actions, annex, turn order, attendance, theme and locale are
		// skipped by reference. Before the identity check this was 600 (twelve
		// per push); before session, settings and scoped joined it, 150.
		expect(bySection).toEqual({ session: 0, settings: 0, scoped: 0 })
		expect(calls).toBe(50 * 1)
		w.close()
	})

	test("props that change reference and content: one props post", async () => {
		let props = $state.raw<Record<string, unknown>>({ n: 1 })
		const w = await open(() => ({
			stateKey: "k",
			session: SESSION,
			props,
			messages: []
		}))
		const before = w.got.length
		props = { n: 2 }
		flushSync()
		await settle()
		const posted = w.got.slice(before)
		expect(posted.filter((m) => m.t === "props")).toEqual([
			{ t: "props", props: { n: 2 } }
		])
		w.close()
	})

	test("props that change reference but not content: no post", async () => {
		let props = $state.raw<Record<string, unknown>>({ n: 1 })
		const w = await open(() => ({
			stateKey: "k",
			session: SESSION,
			props,
			messages: []
		}))
		const before = w.got.length
		props = { n: 1 }
		flushSync()
		await settle()
		expect(w.got.slice(before).filter((m) => m.t === "props")).toEqual([])
		w.close()
	})

	test("a `ready` again resends everything, though no reference moved", async () => {
		const props = { n: 1 }
		const w = await open(() => ({
			stateKey: "k",
			session: SESSION,
			props,
			settings: SETTINGS,
			messages: []
		}))
		const before = w.got.length
		await w.ready()
		expect(w.got.slice(before).map((m) => m.t)).toEqual(
			expect.arrayContaining([
				"session",
				"props",
				"settings",
				"annex",
				"turn-order",
				"attendance",
				"viewer",
				"messages"
			])
		)
		w.close()
	})
})
