/**
 * Session, settings and scoped sections take the identity skip (perf-N w1):
 * the same reference as the one the widget holds is neither posted nor
 * serialised; a new reference with new content is posted once; a new
 * reference with equal content is not posted (the JSON fallback).
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import Fixture from "./WidgetWireFixture.svelte"
import type { WidgetWire, WireInputs } from "./widgetWire.svelte"

const settle = () => new Promise((r) => setTimeout(r, 20))

type Row = { id: number; content: string }
const rows = (n: number): Row[] =>
	Array.from({ length: 3 }, (_, k) => ({
		id: k + 1,
		content: `row ${k + 1} ${n}`
	}))

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

type Case = {
	name: string
	/** Is this message the section's post? */
	is: (m: Record<string, unknown>) => boolean
	/** The inputs, the section being `v`. */
	inputs: (v: unknown, msgs: Row[]) => WireInputs
	make: (n: number) => unknown
	/** What the post carries. */
	carried: (m: Record<string, unknown>) => unknown
	/** Does this JSON.stringify argument serialise the section? */
	isSerialised: (a: unknown) => boolean
}

const cases: Case[] = [
	{
		name: "session",
		is: (m) => m.t === "session",
		inputs: (v, msgs) => ({
			stateKey: "k",
			session: v as never,
			messages: msgs
		}),
		make: (n) => ({ id: 1, name: `n${n}` }),
		carried: (m) => m.session,
		isSerialised: (a) => (a as { t?: string } | null)?.t === "session"
	},
	{
		name: "settings",
		is: (m) => m.t === "settings",
		inputs: (v, msgs) => ({
			stateKey: "k",
			session: { id: 1 } as never,
			settings: v as never,
			messages: msgs
		}),
		make: (n) => ({ layout: `l${n}` }),
		carried: (m) => m.settings,
		isSerialised: (a) => (a as { t?: string } | null)?.t === "settings"
	},
	{
		name: "scoped:session_full",
		is: (m) => m.t === "scoped" && m.section === "session_full",
		inputs: (v, msgs) => ({
			stateKey: "k",
			session: { id: 1 } as never,
			scoped: v === undefined ? {} : ({ session_full: v } as never),
			messages: msgs
		}),
		make: (n) => ({ note: `d${n}` }),
		carried: (m) => m.value,
		isSerialised: (a) => {
			const x = a as { t?: string; section?: string } | null
			return x?.t === "scoped" && x.section === "session_full"
		}
	}
]

describe.each(cases)("$name", (c) => {
	test("the same reference across 50 pushes: no post, no serialisation", async () => {
		const held = c.make(0)
		let msgs = $state.raw<Row[]>(rows(0))
		const w = await open(() => c.inputs(held, msgs))
		expect(w.got.filter(c.is)).toHaveLength(1)
		const before = w.got.length
		const stringify = vi.spyOn(JSON, "stringify")
		for (let n = 1; n <= 50; n++) {
			msgs = rows(n)
			flushSync()
			await settle()
		}
		const serialised = stringify.mock.calls.filter((a) =>
			c.isSerialised(a[0])
		).length
		stringify.mockRestore()
		expect(serialised).toBe(0)
		expect(w.got.slice(before).filter(c.is)).toEqual([])
		expect(
			w.got.slice(before).filter((m) => m.t === "messages")
		).toHaveLength(50)
		w.close()
	})

	test("a new reference with new content: exactly one post with the new value", async () => {
		let v = $state.raw<unknown>(c.make(0))
		const w = await open(() => c.inputs(v, rows(0)))
		const before = w.got.length
		const next = c.make(1)
		v = next
		flushSync()
		await settle()
		const posted = w.got.slice(before).filter(c.is)
		expect(posted).toHaveLength(1)
		expect(c.carried(posted[0])).toEqual(next)
		w.close()
	})

	test("a new reference with equal content: no post", async () => {
		let v = $state.raw<unknown>(c.make(0))
		const w = await open(() => c.inputs(v, rows(0)))
		const before = w.got.length
		v = c.make(0)
		flushSync()
		await settle()
		expect(w.got.slice(before).filter(c.is)).toEqual([])
		w.close()
	})

	test("a `ready` again resends the section once, though no reference moved", async () => {
		const held = c.make(0)
		const w = await open(() => c.inputs(held, rows(0)))
		const before = w.got.length
		await w.ready()
		const posted = w.got.slice(before).filter(c.is)
		expect(posted).toHaveLength(1)
		expect(c.carried(posted[0])).toEqual(held)
		w.close()
	})
})

describe("scoped withdrawal", () => {
	test("removing the section withdraws it once; the same old reference handed back is posted again", async () => {
		const old = { note: "d0" }
		let v = $state.raw<unknown>(old)
		const scopedCase = cases[2]
		const w = await open(() => scopedCase.inputs(v, rows(0)))
		const before = w.got.length
		v = undefined
		flushSync()
		await settle()
		expect(w.got.slice(before).filter(scopedCase.is)).toEqual([
			{ t: "scoped", section: "session_full", value: null }
		])
		const mid = w.got.length
		v = old
		flushSync()
		await settle()
		const again = w.got.slice(mid).filter(scopedCase.is)
		expect(again).toHaveLength(1)
		expect(again[0].value).toEqual(old)
		w.close()
	})
})

describe("nested in-place mutation: the contract owners must keep", () => {
	// Pinned direction: a value held in a `$state` proxy and mutated deep in
	// place is NOT re-posted by the wire alone; the owner must hand a new
	// reference. Owners proven to replace: the session page's composed session
	// (`remoteWidget.identity.dom.test.svelte.ts`) and `Panel`'s settings and
	// scoped contexts (`panel.identity.dom.test.svelte.ts`).
	test("session: deep in-place change is not re-posted; the same change by replacement is posted once", async () => {
		let held = $state<{ id: number; deep: { x: number } }>({
			id: 1,
			deep: { x: 1 }
		})
		const w = await open(() => ({
			stateKey: "k",
			session: held as never,
			messages: rows(0)
		}))
		const before = w.got.length
		held.deep.x = 2
		flushSync()
		await settle()
		expect(w.got.slice(before).filter((m) => m.t === "session")).toEqual([])
		held = { id: 1, deep: { x: 3 } }
		flushSync()
		await settle()
		const posted = w.got.slice(before).filter((m) => m.t === "session")
		expect(posted).toHaveLength(1)
		expect((posted[0].session as { deep: { x: number } }).deep.x).toBe(3)
		w.close()
	})
})
