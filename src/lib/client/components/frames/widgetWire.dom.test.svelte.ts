/**
 * The widget wire's C5 rules, over a real MessageChannel: a document nested
 * in a component is handed only what its component forwards and its presses
 * are raised unresolved (with the document's own live check), a scoped
 * section is posted when it changes and withdrawn when its grant goes, and a
 * widget's message pages stay inside its lanes.
 */
import { describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import Fixture from "./WidgetWireFixture.svelte"
import type { WidgetWire, WireInputs } from "./widgetWire.svelte"
import { registerVoucher, vouchFor } from "$lib/client/components/hostElements/activation"

const settle = () => new Promise((r) => setTimeout(r, 20))

async function open(inputs: () => WireInputs, extra: Record<string, unknown> = {}) {
	let wire!: WidgetWire
	const target = document.createElement("div")
	const app = mount(Fixture, { target, props: { inputs, onWire: (w: WidgetWire) => (wire = w), ...extra } })
	const channel = new MessageChannel()
	const got: Array<Record<string, unknown>> = []
	channel.port2.onmessage = (e) => got.push(e.data)
	wire.attach(channel.port1)
	channel.port2.postMessage({ t: "ready" })
	await settle()
	flushSync()
	return {
		got,
		wire,
		send: async (m: unknown) => {
			channel.port2.postMessage(m)
			await settle()
		},
		close: () => {
			wire.detach()
			unmount(app)
		}
	}
}

const base = (): WireInputs => ({ stateKey: "k", session: { id: 1, name: null }, messages: [] })

describe("a document nested in a component (sp-frame)", () => {
	test("is posted none of the page's own sections, and its requests are declined", async () => {
		const w = await open(() => ({ ...base(), props: { answers: [] }, onInvoke: () => {} }))
		const kinds = w.got.map((m) => m.t)
		expect(kinds).toContain("props")
		expect(kinds).not.toContain("annex")
		expect(kinds).not.toContain("viewer")
		expect(kinds).not.toContain("turn-order")
		// `messages` declines silently (the frame protocol's rule); anything else answers no.
		await w.send({ t: "request", requestId: "r1", what: "messages" })
		expect(w.got.some((m) => m.requestId === "r1")).toBe(false)
		await w.send({ t: "request", requestId: "r2", what: "pick-turn", params: {} })
		expect(w.got.find((m) => m.requestId === "r2")).toMatchObject({ t: "response", ok: false })
		w.close()
	})

	test("raises its invoke unresolved, with the document's own live check", async () => {
		const seen: unknown[] = []
		let pressing = false
		const w = await open(
			() => ({ ...base(), onInvoke: (key, args, personBehind) => seen.push([key, args.blockId, personBehind]) }),
			{ options: { personBehind: () => pressing } }
		)
		await w.send({ t: "invoke", key: "core#hide", blockId: "b" })
		pressing = true
		await w.send({ t: "invoke", key: "core#hide" })
		expect(seen).toEqual([
			["core#hide", "b", false],
			["core#hide", undefined, true]
		])
		w.close()
	})

	test("a vouched press reaches only the mount box the element sits in", () => {
		const box = document.createElement("div")
		box.setAttribute("data-sp-owner", "acme")
		const inside = document.createElement("span")
		box.append(inside)
		let vouched = 0
		const off = registerVoucher(box, () => vouched++)
		vouchFor(inside)
		vouchFor(document.createElement("span"))
		off()
		vouchFor(inside)
		expect(vouched).toBe(1)
	})
})

describe("a page widget", () => {
	test("gets the page's sections, and a scoped section once per change — withdrawn when the grant goes", async () => {
		const live = $state({
			scoped: { session_full: { n: 1 } } as WireInputs["scoped"],
			session: { id: 1, name: "a" as string | null }
		})
		const w = await open(() => ({ ...base(), session: live.session, scoped: live.scoped }))
		expect(w.got.map((m) => m.t)).toEqual(expect.arrayContaining(["annex", "viewer", "turn-order", "scoped"]))
		const scopedPosts = () => w.got.filter((m) => m.t === "scoped")
		expect(scopedPosts()).toHaveLength(1)
		// Another section changes: the unchanged dossier is not re-sent.
		live.session = { id: 1, name: "b" }
		flushSync()
		await settle()
		expect(w.got.filter((m) => m.t === "session").at(-1)).toEqual({ t: "session", session: { id: 1, name: "b" } })
		expect(scopedPosts()).toHaveLength(1)
		live.scoped = undefined
		flushSync()
		await settle()
		expect(scopedPosts().at(-1)).toEqual({ t: "scoped", section: "session_full", value: null })
		w.close()
	})

	test("a `ready` said again on the same port is sent every section it reads again — it holds nothing (K4)", async () => {
		const w = await open(() => ({ ...base(), scoped: { session_full: { n: 1 } }, settings: { layout: "strip" } }))
		const before = w.got.length
		await w.send({ t: "ready" })
		const again = w.got.slice(before).map((m) => m.t)
		expect(again).toEqual(expect.arrayContaining(["session", "messages", "settings", "annex", "viewer", "scoped"]))
		w.close()
	})

	test("a page of older messages holds only this widget's lanes", async () => {
		const requests = async () => ({
			rows: [
				{ id: 1, channel: "main" },
				{ id: 2, channel: "board" },
				{ id: 3 }
			]
		})
		const w = await open(() => ({ ...base(), channels: ["main"] }), { requests })
		await w.send({ t: "request", requestId: "r2", what: "messages" })
		const page = w.got.find((m) => m.t === "page" && m.requestId === "r2") as { rows: Array<{ id: number }> }
		expect(page.rows.map((r) => r.id)).toEqual([1, 3])
		w.close()
	})
})

describe("an edit, and who is asked", () => {
	const edit = {
		key: "edit",
		specSlug: "core",
		name: "Edit",
		venue: "message",
		origin: "core",
		canAct: true,
		enabled: true
	}
	const editing = (seen: unknown[]): WireInputs => ({
		...base(),
		actions: { message: { primary: [edit], overflow: [] } } as never,
		actionDispatch: { core: { edit: (args) => seen.push(args) }, fire: () => {} }
	})
	const press = { t: "invoke", key: "edit", messageId: 2, payload: { content: "Hi, friend!" } }
	/** The person's answer to `window.confirm` (the test DOM has none): no. */
	const answerNo = () => {
		const confirm = vi.fn(() => false)
		vi.stubGlobal("confirm", confirm)
		return confirm
	}

	test("core's own component edits unasked, as its native copy does", async () => {
		const confirm = answerNo()
		const seen: unknown[] = []
		const w = await open(() => editing(seen), { options: { trusted: () => true } })
		await w.send(press)
		expect(confirm).not.toHaveBeenCalled()
		expect(seen).toEqual([{ messageId: 2, payload: { content: "Hi, friend!" } }])
		w.close()
		vi.unstubAllGlobals()
	})

	test("any other widget's edit is put to the person, and a no drops it", async () => {
		const confirm = answerNo()
		const seen: unknown[] = []
		const w = await open(() => editing(seen))
		await w.send(press)
		expect(confirm).toHaveBeenCalledTimes(1)
		expect(seen).toEqual([])
		w.close()
		vi.unstubAllGlobals()
	})
})

describe("a message relayed off the worker channel (the ordered outbox)", () => {
	test("is handled as a port message, and ignored once no port is attached", async () => {
		const seen: unknown[] = []
		const w = await open(() => ({
			...base(),
			onAction: (fn: string, messageId?: number) => seen.push([fn, messageId])
		}))
		w.wire.receive({ t: "action", fn: "roll", messageId: 4 })
		expect(seen).toEqual([["roll", 4]])
		w.close()
		w.wire.receive({ t: "action", fn: "roll", messageId: 5 })
		expect(seen).toEqual([["roll", 4]])
	})
})

describe("only the sections a widget reads, each only when it moved (R75, F4)", () => {
	test("a widget that does not read messages is posted no messages — and nothing at all on a token", async () => {
		const live = $state({ messages: [{ id: 1, content: "Hel" }] })
		const w = await open(() => ({
			...base(),
			// A snapshot per read, as the panel hands a remote the log.
			messages: $state.snapshot(live.messages),
			settings: { layout: "strip" },
			reads: ["settings"]
		}))
		const kinds = w.got.map((m) => m.t)
		expect(kinds).toContain("settings")
		expect(kinds).not.toContain("messages")
		expect(kinds).not.toContain("channel")
		expect(kinds).not.toContain("session")
		const before = w.got.length
		live.messages[0].content = "Hello" // a streamed token
		live.messages.push({ id: 2, content: "" }) // and a new line
		flushSync()
		await settle()
		expect(w.got.slice(before)).toEqual([])
		w.close()
	})

	test("the conversation still streams: a token re-posts the log, and only the log", async () => {
		const live = $state({ messages: [{ id: 1, content: "Hel" }] })
		const w = await open(() => ({
			...base(),
			messages: $state.snapshot(live.messages),
			settings: { layout: "strip" }
		}))
		const before = w.got.length
		live.messages[0].content = "Hello"
		flushSync()
		await settle()
		const after = w.got.slice(before)
		// Every other section — session, settings, annex, viewer, turn order,
		// locale, theme — is unchanged, so it is not sent again.
		expect(after.map((m) => m.t)).toEqual(["messages"])
		expect((after[0].messages as Array<{ content: string }>)[0].content).toBe("Hello")
		w.close()
	})

	test("the log is never serialised to be compared — a token costs no JSON of it", async () => {
		const live = $state({ messages: [{ id: 1, content: "Hel" }] })
		const w = await open(() => ({ ...base(), messages: $state.snapshot(live.messages) }))
		const stringify = vi.spyOn(JSON, "stringify")
		live.messages[0].content = "Hello"
		flushSync()
		await settle()
		const logged = stringify.mock.calls.filter(([v]) => {
			const t = (v as { t?: unknown } | null)?.t
			return t === "messages" || t === "channel"
		})
		stringify.mockRestore()
		expect(logged).toEqual([])
		expect(w.got.filter((m) => m.t === "messages").at(-1)).toMatchObject({ messages: [{ content: "Hello" }] })
		w.close()
	})

	test("a widget that does not read messages hears of no arrival either", async () => {
		const live = $state({ messages: [{ id: 1 }] as Array<{ id: number }> })
		const w = await open(() => ({ ...base(), messages: $state.snapshot(live.messages), reads: ["settings"] }))
		live.messages.push({ id: 2 })
		flushSync()
		await settle()
		expect(w.got.some((m) => m.t === "event")).toBe(false)
		w.close()
	})
})

describe("a request carries who asks, and the askers table is held (F9)", () => {
	const recording = (asked: unknown[]) =>
		(async (kind: string, params: unknown, from: unknown) => {
			asked.push([kind, from])
			return kind === "session-entries" ? { lorebookId: 1, ownerOnly: false, rows: [], total: 0, offset: 0 } : undefined
		}) as unknown

	test("a plugin's widget asking a core-only kind is declined in words, and the page is never asked", async () => {
		const asked: unknown[] = []
		const w = await open(() => ({ ...base(), owner: "acme", widgetId: "acme:dice" }), { requests: recording(asked) })
		await w.send({
			t: "request",
			requestId: "r1",
			what: "set-attribute-value",
			params: { owner: { kind: "session", id: 1 }, slotId: "s", value: 3 }
		})
		expect(w.got.find((m) => m.requestId === "r1")).toMatchObject({
			t: "response",
			ok: false,
			error: "only core's own widgets ask 'set-attribute-value'"
		})
		expect(asked).toEqual([])
		w.close()
	})

	test("session-entries without the 'lore' grant is declined; with it, the page is asked and told the grant", async () => {
		const asked: unknown[] = []
		let grants: ("lore" | "characters")[] = ["characters"]
		const w = await open(() => ({ ...base(), owner: "acme", widgetId: "acme:lore", grants }), {
			requests: recording(asked)
		})
		await w.send({ t: "request", requestId: "r1", what: "session-entries", params: {} })
		expect(w.got.find((m) => m.requestId === "r1")).toMatchObject({ ok: false })
		expect(String(w.got.find((m) => m.requestId === "r1")?.error)).toMatch(/'lore' scope/)
		expect(asked).toEqual([])
		grants = ["lore"]
		await w.send({ t: "request", requestId: "r2", what: "session-entries", params: {} })
		expect(w.got.find((m) => m.requestId === "r2")).toMatchObject({ t: "response", ok: true })
		expect(asked).toEqual([["session-entries", { widgetId: "acme:lore", owner: "acme", grants: ["lore"] }]])
		w.close()
	})
})

describe("what the widget holds is what went out (sent-recorded-before-post)", () => {
	test("a section dropped as uncloneable is not held: it is posted once it can be", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		const live = $state({ fn: true })
		const w = await open(() => ({
			...base(),
			reads: ["props"],
			props: live.fn ? { a: 1, f: () => 1 } : { a: 1 }
		}))
		expect(w.got.filter((m) => m.t === "props")).toEqual([])
		// The function goes; the JSON of the section is what it was.
		live.fn = false
		flushSync()
		await settle()
		expect(w.got.filter((m) => m.t === "props")).toEqual([{ t: "props", props: { a: 1 } }])
		warn.mockRestore()
		w.close()
	})

	test("a scoped section that went out but could not be compared (a cycle) is still withdrawn", async () => {
		const cyclic: Record<string, unknown> = { n: 1 }
		cyclic.self = cyclic
		const live = $state({ granted: true })
		const w = await open(() => ({
			...base(),
			scoped: live.granted ? ({ session_full: cyclic } as WireInputs["scoped"]) : undefined
		}))
		// Posted (it cannot be compared, so it may go more than once)…
		expect(w.got.filter((m) => m.t === "scoped").length).toBeGreaterThan(0)
		live.granted = false
		flushSync()
		await settle()
		expect(w.got.filter((m) => m.t === "scoped").at(-1)).toEqual({ t: "scoped", section: "session_full", value: null })
		w.close()
	})
})

describe("layout:changed is told only to a widget that reads layout (R75, K6)", () => {
	const at = (column: number) => ({
		zone: { columns: 3, column, rows: 1, row: 1 },
		box: { cols: 1, rows: null, edges: { top: true, right: false, bottom: true, left: false } },
		tier: "cozy" as const,
		pinned: true,
		collapsed: false,
		drawered: false
	})

	test("a widget reading layout hears the move; one that does not hears nothing", async () => {
		for (const [reads, expected] of [
			[["layout", "settings"], 1],
			[["settings"], 0]
		] as const) {
			const live = $state({ column: 1 })
			const w = await open(() => ({ ...base(), reads: [...reads], placement: at(live.column) }))
			live.column = 2
			flushSync()
			await settle()
			const moved = w.got.filter(
				(m) => m.t === "event" && (m.event as { kind?: string } | undefined)?.kind === "layout:changed"
			)
			expect(moved).toHaveLength(expected)
			if (!reads.includes("layout" as never)) expect(w.got.some((m) => m.t === "layout")).toBe(false)
			w.close()
		}
	})
})

describe("a row crosses without the host's bookkeeping (MESSAGE_HOST_FIELDS)", () => {
	const stored = (id: number) => ({
		id,
		channel: "main",
		role: "user",
		content: `line ${id}`,
		userId: 7,
		queueItemId: 1,
		debugMeta: { prompt: "the whole compiled prompt" },
		embedding: [0.5, 0.25],
		embeddingModel: "m",
		vectorizedAt: "2026-09-25",
		version: 2
	})
	const bookkeeping = ["userId", "queueItemId", "debugMeta", "embedding", "embeddingModel", "vectorizedAt", "version"]
	const clean = (rows: Array<Record<string, unknown>>) => {
		expect(rows.length).toBeGreaterThan(0)
		for (const r of rows) {
			for (const k of bookkeeping) expect(r, k).not.toHaveProperty(k)
			expect(r.content).toBe(`line ${r.id}`)
		}
	}

	test("a page of older messages the page's handler answers", async () => {
		const w = await open(() => ({ ...base(), owner: "acme" }), { requests: async () => ({ rows: [stored(1), stored(2)] }) })
		await w.send({ t: "request", requestId: "p1", what: "messages" })
		clean((w.got.find((m) => m.requestId === "p1") as { rows: Array<Record<string, unknown>> }).rows)
		w.close()
	})

	test("a page served out of what was already pushed (no handler)", async () => {
		const w = await open(() => ({ ...base(), owner: "acme", messages: [stored(1), stored(2)] }))
		await w.send({ t: "request", requestId: "p2", what: "messages" })
		clean((w.got.find((m) => m.requestId === "p2") as { rows: Array<Record<string, unknown>> }).rows)
		w.close()
	})

	test("a token still re-posts the log, stripped, with no JSON of it", async () => {
		const live = $state({ messages: [stored(1)] })
		const w = await open(() => ({ ...base(), owner: "acme", messages: $state.snapshot(live.messages) }))
		const stringify = vi.spyOn(JSON, "stringify")
		live.messages[0].content = "line 1!"
		flushSync()
		await settle()
		const logged = stringify.mock.calls.filter(([v]) => (v as { t?: unknown } | null)?.t === "messages")
		stringify.mockRestore()
		expect(logged).toEqual([])
		const last = w.got.filter((m) => m.t === "messages").at(-1) as { messages: Array<Record<string, unknown>> }
		expect(last.messages[0].content).toBe("line 1!")
		for (const k of bookkeeping) expect(last.messages[0]).not.toHaveProperty(k)
		w.close()
	})
})
