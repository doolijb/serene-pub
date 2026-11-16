/**
 * `peerTakesOneMessage`: a streamed frame — a push that changed exactly one
 * input row, a generating one — posts that row alone as `{ t: "message" }`;
 * every other push (the settle, an edit, an add or remove, nothing moved)
 * posts the full list, as does every push without the option.
 */
import { describe, expect, test } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import Fixture from "./WidgetWireFixture.svelte"
import type {
	WidgetWire,
	WidgetWireOptions,
	WireInputs
} from "./widgetWire.svelte"

const settle = () => new Promise((r) => setTimeout(r, 20))

type Row = {
	id: number
	content: string
	channel?: string
	isGenerating?: boolean
}
const rows = (n: number, last = "a"): Row[] =>
	Array.from({ length: n }, (_, k) => ({
		id: k + 1,
		content: k === n - 1 ? last : `row ${k + 1}`
	}))

async function open(
	inputs: () => WireInputs,
	options: Partial<WidgetWireOptions>,
	readyMessage: Record<string, unknown> = { t: "ready" }
) {
	let wire!: WidgetWire
	const app = mount(Fixture, {
		target: document.createElement("div"),
		props: { inputs, options, onWire: (w: WidgetWire) => (wire = w) }
	})
	const channel = new MessageChannel()
	const got: Array<Record<string, unknown>> = []
	channel.port2.onmessage = (e) => got.push(e.data)
	wire.attach(channel.port1)
	channel.port2.postMessage(readyMessage)
	await settle()
	flushSync()
	const log = (from: number) =>
		got
			.slice(from)
			.filter((m) =>
				["messages", "message", "channel"].includes(m.t as string)
			)
	return {
		got,
		log,
		ready: async (message: Record<string, unknown> = { t: "ready" }) => {
			channel.port2.postMessage(message)
			await settle()
		},
		attachFresh: async (
			message: Record<string, unknown> = { t: "ready" }
		) => {
			const fresh = new MessageChannel()
			fresh.port2.onmessage = (e) => got.push(e.data)
			wire.attach(fresh.port1)
			fresh.port2.postMessage(message)
			await settle()
		},
		close: () => {
			wire.detach()
			unmount(app)
		}
	}
}

const on = { peerTakesOneMessage: true }
const frame = async () => {
	flushSync()
	await settle()
}

describe("peerTakesOneMessage", () => {
	test("streaming frames on the last row: one message each, no list", async () => {
		let msgs = $state.raw<Row[]>(rows(40))
		const w = await open(() => ({ stateKey: "k", messages: msgs }), on)
		expect(w.log(0).length).toBeGreaterThan(0)
		expect(w.log(0).every((m) => m.t === "messages")).toBe(true)
		const before = w.got.length
		for (let n = 1; n <= 10; n++) {
			msgs = [
				...msgs.slice(0, 39),
				{ id: 40, content: "a".repeat(n + 1), isGenerating: true }
			]
			await frame()
		}
		const posted = w.log(before)
		expect(posted).toHaveLength(10)
		expect(posted.every((m) => m.t === "message")).toBe(true)
		expect(posted.at(-1)).toEqual({
			t: "message",
			message: { id: 40, content: "a".repeat(11), isGenerating: true }
		})
		w.close()
	})

	test("the settle, an edit and a push with no row moved each post the full list", async () => {
		let msgs = $state.raw<Row[]>(rows(5))
		let props = $state.raw({ n: 0 })
		const w = await open(
			() => ({ stateKey: "k", messages: msgs, props }),
			on
		)
		msgs = [
			...msgs.slice(0, 4),
			{ id: 5, content: "b", isGenerating: true }
		]
		await frame()
		for (const next of [
			// The settle: the generating row lands as a settled one.
			() => {
				msgs = [...msgs.slice(0, 4), { id: 5, content: "bc" }]
			},
			// An edit of a settled row.
			() => {
				msgs = [{ id: 1, content: "edited" }, ...msgs.slice(1)]
			},
			// Another section moved; no row did.
			() => {
				props = { n: 1 }
			}
		]) {
			const before = w.got.length
			next()
			await frame()
			expect(
				w
					.log(before)
					.filter((m) => m.t !== "props")
					.map((m) => m.t)
			).toEqual(["messages"])
		}
		w.close()
	})

	test("an append, a removal and a reorder each post the full list", async () => {
		let msgs = $state.raw<Row[]>(rows(5))
		const w = await open(() => ({ stateKey: "k", messages: msgs }), on)
		for (const next of [
			() => [...msgs, { id: 6, content: "new" }],
			() => msgs.slice(1),
			() => [msgs[1], msgs[0], ...msgs.slice(2)]
		]) {
			const before = w.got.length
			msgs = next()
			await frame()
			expect(w.log(before).map((m) => m.t)).toEqual(["messages"])
		}
		w.close()
	})

	test("channels: a listed lane gets one message, an unlisted lane nothing, a move posts channels", async () => {
		let msgs = $state.raw<Row[]>([
			{ id: 1, content: "m", channel: "main" },
			{ id: 2, content: "s", channel: "side" },
			{ id: 3, content: "x", channel: "elsewhere" }
		])
		const w = await open(
			() => ({
				stateKey: "k",
				messages: msgs,
				channels: ["main", "side"]
			}),
			on
		)
		expect(w.log(0).length).toBeGreaterThan(0)
		expect(w.log(0).every((m) => m.t === "channel")).toBe(true)
		let before = w.got.length
		msgs = [
			msgs[0],
			{ id: 2, content: "s2", channel: "side", isGenerating: true },
			msgs[2]
		]
		await frame()
		expect(w.log(before)).toEqual([
			{
				t: "message",
				message: {
					id: 2,
					content: "s2",
					channel: "side",
					isGenerating: true
				}
			}
		])
		before = w.got.length
		msgs = [
			msgs[0],
			msgs[1],
			{ id: 3, content: "y", channel: "elsewhere", isGenerating: true }
		]
		await frame()
		expect(w.log(before)).toEqual([])
		before = w.got.length
		msgs = [msgs[0], { ...msgs[1], channel: "main" }, msgs[2]]
		await frame()
		expect(w.log(before).map((m) => m.t)).toEqual(["channel", "channel"])
		w.close()
	})

	test("ready again resends the list, then the next frame is one message", async () => {
		let msgs = $state.raw<Row[]>(rows(5))
		const w = await open(() => ({ stateKey: "k", messages: msgs }), on)
		let before = w.got.length
		await w.ready()
		expect(w.log(before).map((m) => m.t)).toEqual(["messages"])
		before = w.got.length
		msgs = [
			...msgs.slice(0, 4),
			{ id: 5, content: "z", isGenerating: true }
		]
		await frame()
		expect(w.log(before).map((m) => m.t)).toEqual(["message"])
		w.close()
	})

	test("without the option every frame posts the full list", async () => {
		let msgs = $state.raw<Row[]>(rows(40))
		const w = await open(() => ({ stateKey: "k", messages: msgs }), {})
		const before = w.got.length
		for (let n = 1; n <= 10; n++) {
			msgs = [
				...msgs.slice(0, 39),
				{ id: 40, content: "a".repeat(n + 1), isGenerating: true }
			]
			await frame()
		}
		const posted = w.log(before)
		expect(posted).toHaveLength(10)
		expect(posted.every((m) => m.t === "messages")).toBe(true)
		w.close()
	})
})

describe("declared on ready (★M-1)", () => {
	const declared = { t: "ready", takes: ["message"] }
	const stream = (msgs: Row[], content: string) => [
		...msgs.slice(0, msgs.length - 1),
		{ id: msgs.length, content, isGenerating: true }
	]

	test("a declared ready alone turns the one-row post on", async () => {
		let msgs = $state.raw<Row[]>(rows(5))
		const w = await open(
			() => ({ stateKey: "k", messages: msgs }),
			{},
			declared
		)
		const before = w.got.length
		msgs = stream(msgs, "z")
		await frame()
		expect(w.log(before).map((m) => m.t)).toEqual(["message"])
		w.close()
	})

	test("a replayed ready without takes turns it off", async () => {
		let msgs = $state.raw<Row[]>(rows(5))
		const w = await open(
			() => ({ stateKey: "k", messages: msgs }),
			{},
			declared
		)
		await w.ready()
		const before = w.got.length
		msgs = stream(msgs, "z")
		await frame()
		expect(w.log(before).map((m) => m.t)).toEqual(["messages"])
		w.close()
	})

	test("a new port with a silent ready starts from full lists", async () => {
		let msgs = $state.raw<Row[]>(rows(5))
		const w = await open(
			() => ({ stateKey: "k", messages: msgs }),
			{},
			declared
		)
		await w.attachFresh()
		const before = w.got.length
		msgs = stream(msgs, "z")
		await frame()
		expect(w.log(before).map((m) => m.t)).toEqual(["messages"])
		w.close()
	})

	test("channels: a generating row in a lane not held posts nothing", async () => {
		let msgs = $state.raw<Row[]>([
			{ id: 1, content: "m", channel: "main" },
			{ id: 2, content: "x", channel: "elsewhere" }
		])
		const w = await open(
			() => ({ stateKey: "k", messages: msgs, channels: ["main"] }),
			{},
			declared
		)
		const before = w.got.length
		msgs = [
			msgs[0],
			{ id: 2, content: "y", channel: "elsewhere", isGenerating: true }
		]
		await frame()
		expect(w.log(before)).toEqual([])
		w.close()
	})
})
