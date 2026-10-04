/**
 * The widget-style store (PLAN 25, ruled 2026-08-30).
 *
 * Mostly its pure half: the LIST REDUCER (a
 * `widgetStyles:list` reply scoped to one widget must not wipe the rows of
 * every other widget) and the SANITISER/SCOPER, which is the security boundary
 * — a widget skin is user-authored CSS that can be marked `shared`, so it runs
 * in other people's browsers. The earlier style-bleed bug is why the scoping
 * half is asserted as hard as the stripping half: a skin that escapes its own
 * widget is a bug even when it fetches nothing.
 *
 * The last describe is the socket path, driven through the real interest
 * registry against a fake socket. Three properties, each of which fails
 * silently: the list interest is DECLARED before the request that wants it
 * (the reply is gated — a request that overtook its own sync would be answered
 * to nobody), one raw listener exists per event name however many keys are
 * held, and the two writes that nothing reads a reply for declare no interest
 * at all, so the gate can skip replies the store was never going to fold in.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

/** The live socket the registry and the store both read. */
let socket: ReturnType<typeof makeSocket> | null = null

vi.mock("$app/environment", () => ({ dev: false, building: false }))
vi.mock("$lib/client/sockets/socketInstance", () => ({
	getSocket: () => socket
}))

import {
	canManageStyle,
	checkWidgetCss,
	createDebouncer,
	mergeStyles,
	nextArmed,
	nextSaveState,
	overlayVisible,
	sanitizeWidgetCss,
	scopeWidgetCss,
	skinToRender,
	stylePickerOptions,
	varsToStyle,
	type PendingSave,
	type WidgetStyleRow
} from "./widgetStyles.svelte"

function row(p: Partial<WidgetStyleRow> & { id: number }): WidgetStyleRow {
	return {
		slug: `w:${p.id}`,
		widgetSlug: "scene-portraits",
		source: "user",
		ownerUserId: 1,
		visibility: "private",
		title: `Style ${p.id}`,
		css: "",
		vars: {},
		updatedAt: "2026-08-30T00:00:00.000Z",
		...p
	}
}

describe("mergeStyles", () => {
	test("a widget-scoped reply replaces only that widget's rows", () => {
		const prev = [
			row({ id: 1, widgetSlug: "scene-portraits" }),
			row({ id: 2, widgetSlug: "messages" })
		]
		const next = mergeStyles(
			prev,
			[row({ id: 3, widgetSlug: "scene-portraits" })],
			"scene-portraits"
		)
		expect(next.map((r) => r.id).sort()).toEqual([2, 3])
	})

	test("an unscoped reply is the whole set", () => {
		const prev = [row({ id: 1 }), row({ id: 2, widgetSlug: "messages" })]
		expect(mergeStyles(prev, [row({ id: 9 })]).map((r) => r.id)).toEqual([
			9
		])
	})

	test("a scoped reply carrying another widget's row ignores the stray", () => {
		// The scope is the caller's, not the server's: a reply that over-answers
		// must not smuggle rows into a widget the reducer was not told about.
		const next = mergeStyles(
			[row({ id: 2, widgetSlug: "messages" })],
			[row({ id: 3 }), row({ id: 4, widgetSlug: "stats" })],
			"scene-portraits"
		)
		expect(next.map((r) => r.id).sort()).toEqual([2, 3])
	})

	test("system rows sort ahead of user rows within a widget", () => {
		const next = mergeStyles(
			[],
			[
				row({ id: 5, title: "Zebra", source: "user" }),
				row({ id: 6, title: "Alpha", source: "system" })
			],
			"scene-portraits"
		)
		expect(next.map((r) => r.id)).toEqual([6, 5])
	})
})

describe("canManageStyle", () => {
	const mine = row({ id: 1, ownerUserId: 7, visibility: "private" })
	const theirs = row({ id: 2, ownerUserId: 8, visibility: "private" })
	const shared = row({ id: 3, ownerUserId: 8, visibility: "shared" })
	const system = row({
		id: 4,
		source: "system",
		ownerUserId: null,
		visibility: "system"
	})

	test("a system row is read-only for everyone, admin included", () => {
		expect(canManageStyle(system, { id: 7, isAdmin: true })).toBe(false)
	})
	test("a private row is the owner's alone", () => {
		expect(canManageStyle(mine, { id: 7, isAdmin: false })).toBe(true)
		expect(canManageStyle(theirs, { id: 7, isAdmin: true })).toBe(false)
	})
	test("a shared row is the owner's or an admin's", () => {
		expect(canManageStyle(shared, { id: 8, isAdmin: false })).toBe(true)
		expect(canManageStyle(shared, { id: 7, isAdmin: true })).toBe(true)
		expect(canManageStyle(shared, { id: 7, isAdmin: false })).toBe(false)
	})
})

describe("stylePickerOptions", () => {
	test("groups Built-in / Mine / Shared and drops other widgets' rows", () => {
		const rows = [
			row({
				id: 1,
				source: "system",
				visibility: "system",
				ownerUserId: null,
				title: "Default"
			}),
			row({ id: 2, ownerUserId: 7, title: "My skin" }),
			row({
				id: 3,
				ownerUserId: 8,
				visibility: "shared",
				title: "Team skin"
			}),
			row({ id: 4, widgetSlug: "messages", title: "Not mine to show" })
		]
		expect(stylePickerOptions(rows, "scene-portraits", 7)).toEqual([
			{ value: "1", label: "Default", group: "Built-in" },
			{ value: "2", label: "My skin", group: "Mine" },
			{ value: "3", label: "Team skin", group: "Shared" }
		])
	})
})

describe("sanitizeWidgetCss", () => {
	test("drops @import outright", () => {
		expect(
			sanitizeWidgetCss('@import url("https://evil.test/x.css");')
		).not.toMatch(/@import/i)
	})

	test("drops an @import hidden inside a media block", () => {
		const out = sanitizeWidgetCss(
			"@media (min-width:1px){@import 'https://evil.test/x.css';.a{color:red}}"
		)
		expect(out).not.toMatch(/@import/i)
		expect(out).toMatch(/color:\s*red/)
	})

	test("strips a </style> break-out attempt", () => {
		expect(
			sanitizeWidgetCss('.a{content:"</style><script>alert(1)</script>"}')
		).not.toMatch(/<\/style/i)
	})

	test("neutralises url() to an external host but keeps data:", () => {
		const out = sanitizeWidgetCss(
			".a{background:url(https://evil.test/p.png)}" +
				".b{background:url('data:image/gif;base64,R0lGOD')}" +
				".c{background:url(//evil.test/p.png)}" +
				".d{background:url(/local/p.png)}"
		)
		expect(out).not.toMatch(/evil\.test/)
		expect(out).toMatch(/data:image\/gif/)
		expect(out).toMatch(/url\(\/local\/p\.png\)/)
	})

	test("neutralises a bare-string image-set(), which needs no url()", () => {
		const out = sanitizeWidgetCss(
			'.a{background-image:image-set("https://evil.test/p.png" 1x)}'
		)
		expect(out).not.toMatch(/evil\.test/)
	})

	test("drops the globally-scoped at-rules a skin has no business owning", () => {
		const out = sanitizeWidgetCss(
			"@font-face{font-family:Inter;src:url(data:font/woff2;base64,AA)}" +
				"@property --x{syntax:'<color>';inherits:false;initial-value:red}" +
				"@counter-style thumbs{system:cyclic}" +
				".a{color:red}"
		)
		expect(out).not.toMatch(/@font-face|@property|@counter-style/i)
		expect(out).toMatch(/color:\s*red/)
	})

	test("survives an unterminated block without emitting garbage", () => {
		expect(() => sanitizeWidgetCss(".a{color:red")).not.toThrow()
	})
})

describe("scopeWidgetCss", () => {
	const S = '[data-skin-scope="ws-1"]'

	test("prefixes every selector in a list", () => {
		expect(scopeWidgetCss(".a,.b{color:red}", "ws-1")).toBe(
			`${S} .a, ${S} .b{color:red}`
		)
	})

	test("re-points page-level selectors at the widget container itself", () => {
		expect(scopeWidgetCss(":root{--x:1px}", "ws-1")).toBe(`${S}{--x:1px}`)
		expect(scopeWidgetCss("body .a{color:red}", "ws-1")).toBe(
			`${S} .a{color:red}`
		)
	})

	test("scopes inside a media block and keeps the prelude", () => {
		expect(
			scopeWidgetCss("@media (min-width:100px){.a{color:red}}", "ws-1")
		).toBe(`@media (min-width:100px){${S} .a{color:red}}`)
	})

	test("does not prefix keyframe stops, and namespaces the animation", () => {
		// A bare `@keyframes fade` is global: two skins naming the same
		// animation would fight, which is bleed by another route.
		const out = scopeWidgetCss(
			"@keyframes fade{from{opacity:0}to{opacity:1}}.a{animation:fade 1s}",
			"ws-1"
		)
		expect(out).toMatch(/@keyframes ws-1-fade\{from\{opacity:0\}/)
		expect(out).toMatch(/animation:\s*ws-1-fade 1s/)
		expect(out).not.toMatch(new RegExp(`\\${S[0]}[^{]*from\\{`))
	})

	test("a leading [data-mode] is the container's own attribute", () => {
		// `WidgetHost` mirrors <html>'s `data-mode` onto the scope wrapper, so a
		// skin CAN write a dark-only rule — but only if the attribute is
		// concatenated onto the scope. `${S} [data-mode="dark"] .card` would be
		// a descendant that never exists.
		expect(scopeWidgetCss('[data-mode="dark"] .card{color:red}', "ws-1")).toBe(
			`${S}[data-mode="dark"] .card{color:red}`
		)
		// The page-level spellings a copy-paste brings along land in the same place.
		expect(
			scopeWidgetCss(':root[data-mode="dark"] .card{color:red}', "ws-1")
		).toBe(`${S}[data-mode="dark"] .card{color:red}`)
		expect(
			scopeWidgetCss('html[data-mode="dark"] .card{color:red}', "ws-1")
		).toBe(`${S}[data-mode="dark"] .card{color:red}`)
	})

	test("only data-mode is folded onto the scope, not any leading attribute", () => {
		// A skin targeting a descendant BY attribute still means a descendant —
		// folding that onto the container would break every such rule.
		expect(
			scopeWidgetCss('[data-msg-state="selected"]{color:red}', "ws-1")
		).toBe(`${S} [data-msg-state="selected"]{color:red}`)
	})

	test("a selector starting with & means the container", () => {
		expect(scopeWidgetCss("&.big{color:red}", "ws-1")).toBe(
			`${S}.big{color:red}`
		)
	})

	test("cannot be escaped by closing the author's own block early", () => {
		// The classic bleed: `}` in the middle of the sheet, then a bare
		// selector meant to hit the whole app.
		const out = scopeWidgetCss(
			".a{color:red}} .everything{color:blue}",
			"ws-1"
		)
		expect(out).toMatch(/\.everything/)
		expect(out).not.toMatch(/(^|\})\s*\.everything/)
		expect(out).toContain(`${S} .everything`)
	})

	test("an empty sheet stays empty", () => {
		expect(scopeWidgetCss("", "ws-1")).toBe("")
	})
})

describe("varsToStyle", () => {
	test("normalises names and emits custom properties", () => {
		expect(varsToStyle({ "--a": "1px", b: "red" })).toBe("--a:1px;--b:red;")
	})

	test("drops a name that is not a custom-property identifier", () => {
		expect(varsToStyle({ "a;color": "red", "--ok": "1" })).toBe("--ok:1;")
	})

	test("a value cannot close its own declaration or fetch a host", () => {
		expect(
			varsToStyle({ "--a": "red; background:url(https://evil.test/x)" })
		).not.toMatch(/evil\.test/)
		expect(varsToStyle({ "--a": "red;}" })).toBe("--a:red;")
	})
})

describe("checkWidgetCss", () => {
	// The save gate. It must say no to EXACTLY what the server says no to —
	// looser and the save bounces with a socket error, stricter and the editor
	// refuses CSS the instance would happily have stored.
	test("mirrors the server's refusals, in the server's words", () => {
		expect(checkWidgetCss('@import "x.css";')).toBe(
			"Theme CSS cannot contain @import."
		)
		expect(
			checkWidgetCss(".a{background:url(https://evil.test/x)}")
		).toMatch(/cannot reference external URLs/)
		expect(checkWidgetCss(".a{background:url(//evil.test/x)}")).toMatch(
			/cannot reference external URLs/
		)
	})

	test("passes what the server accepts, the render sanitiser's extras included", () => {
		// `@font-face` is stored happily and only DROPPED at render — so the
		// editor must not block it, or the two layers disagree about what a
		// style is allowed to contain.
		expect(
			checkWidgetCss(
				"@font-face{font-family:x;src:url(data:font/woff2;base64,AA)}" +
					".a{background:url(/local/p.png)}"
			)
		).toBeNull()
	})
})

/* ── the hover overlay's pure state (ruled 2026-09-09) ─────────────────────
 * Styling moved out of the settings panel and onto the widget itself: hover a
 * panel, its style controls fade in over it. Three pieces of that are pure and
 * are tested here rather than through the DOM — WHICH widget is pinned open,
 * WHEN the overlay shows at all, and what the widget RENDERS while an unsaved
 * draft is being typed. */

describe("nextArmed — one pinned overlay at a time", () => {
	test("arming pins that widget", () => {
		expect(nextArmed(null, { type: "arm", widgetId: "sample-map" })).toBe(
			"sample-map"
		)
	})

	test("arming a second widget releases the first", () => {
		expect(
			nextArmed("sample-map", {
				type: "arm",
				widgetId: "scene-portraits"
			})
		).toBe("scene-portraits")
	})

	test("arming the pinned widget again keeps it pinned", () => {
		// Interacting with an open overlay must not toggle it shut — every
		// click inside it (picker, New, Edit) re-arms.
		expect(
			nextArmed("sample-map", { type: "arm", widgetId: "sample-map" })
		).toBe("sample-map")
	})

	test("a widget only releases its OWN pin", () => {
		expect(
			nextArmed("sample-map", {
				type: "disarm",
				widgetId: "scene-portraits"
			})
		).toBe("sample-map")
		expect(
			nextArmed("sample-map", { type: "disarm", widgetId: "sample-map" })
		).toBe(null)
	})

	test("leaving style mode releases whatever was pinned", () => {
		expect(nextArmed("sample-map", { type: "exit" })).toBe(null)
		expect(nextArmed(null, { type: "exit" })).toBe(null)
	})
})

describe("overlayVisible", () => {
	const base = {
		styleMode: true,
		hovered: false,
		focused: false,
		armed: false
	}

	test("never outside style mode, whatever else is true", () => {
		expect(
			overlayVisible({
				styleMode: false,
				hovered: true,
				focused: true,
				armed: true
			})
		).toBe(false)
	})

	test("hidden until the widget is hovered, focused or pinned", () => {
		expect(overlayVisible(base)).toBe(false)
		expect(overlayVisible({ ...base, hovered: true })).toBe(true)
		expect(overlayVisible({ ...base, focused: true })).toBe(true)
		// Pinned survives the pointer leaving — that is what lets the picker's
		// portalled popup and the editor be used at all.
		expect(overlayVisible({ ...base, armed: true })).toBe(true)
	})
})

describe("skinToRender — live apply, and the revert", () => {
	const saved = { css: ".a{color:red}", vars: { "--accent": "red" } }
	const draft = {
		widgetId: "sample-map",
		css: ".a{color:blue}",
		vars: { "--accent": "blue" }
	}

	test("the saved row is what a widget wears with no draft open", () => {
		expect(skinToRender("sample-map", saved, null)).toEqual({
			css: ".a{color:red}",
			vars: { "--accent": "red" }
		})
	})

	test("an open draft wins for ITS widget only", () => {
		expect(skinToRender("sample-map", saved, draft).css).toBe(
			".a{color:blue}"
		)
		// Another widget keeps its own saved skin — one editor must not repaint
		// every panel on screen.
		expect(skinToRender("scene-portraits", saved, draft).css).toBe(
			".a{color:red}"
		)
	})

	test("dropping the draft reverts to the saved row (Cancel)", () => {
		expect(skinToRender("sample-map", saved, null).css).toBe(
			".a{color:red}"
		)
	})

	test("a widget with no style at all renders bare, never undefined", () => {
		expect(skinToRender("sample-map", undefined, null)).toEqual({
			css: "",
			vars: {}
		})
	})

	test("an emptied draft is honoured, not treated as absent", () => {
		// Clearing the textarea must actually clear the widget, or the author
		// cannot see what their rules are worth.
		expect(
			skinToRender("sample-map", saved, {
				widgetId: "sample-map",
				css: "",
				vars: {}
			})
		).toEqual({ css: "", vars: {} })
	})
})

describe("createDebouncer — typing applies once it settles", () => {
	beforeEach(() => vi.useFakeTimers())
	afterEach(() => vi.useRealTimers())

	test("runs only the last call in a burst, after the delay", () => {
		const seen: string[] = []
		const d = createDebouncer(150)
		d.schedule(() => seen.push("a"))
		vi.advanceTimersByTime(100)
		d.schedule(() => seen.push("b"))
		vi.advanceTimersByTime(149)
		expect(seen).toEqual([])
		vi.advanceTimersByTime(1)
		expect(seen).toEqual(["b"])
	})

	test("cancel drops a pending call (Cancel must not re-apply the draft)", () => {
		const seen: string[] = []
		const d = createDebouncer(150)
		d.schedule(() => seen.push("a"))
		d.cancel()
		vi.advanceTimersByTime(1000)
		expect(seen).toEqual([])
	})
})

describe("nextSaveState — holding the preview until the save lands", () => {
	const edit: PendingSave = { widgetId: "messages", id: 7 }
	const fresh: PendingSave = { widgetId: "messages", id: null }

	test("an edit holds until the widget resolves to the row it saved", () => {
		expect(nextSaveState(edit, { type: "resolved", id: 3 })).toEqual({
			pending: edit,
			drop: false
		})
		expect(nextSaveState(edit, { type: "resolved", id: 7 })).toEqual({
			pending: null,
			drop: true
		})
	})

	test("a new style has no id until its own reply names one", () => {
		// The refreshed list cannot say which row is the new one, so no
		// resolution settles a create before the reply arrives.
		expect(nextSaveState(fresh, { type: "resolved", id: 12 })).toEqual({
			pending: fresh,
			drop: false
		})
		const named = nextSaveState(fresh, { type: "created", id: 12 })
		expect(named).toEqual({
			pending: { widgetId: "messages", id: 12 },
			drop: false
		})
		// …and it still holds until the PIN lands too — the row existing is not
		// the widget wearing it.
		expect(
			nextSaveState(named.pending, { type: "resolved", id: 12 })
		).toEqual({ pending: null, drop: true })
	})

	test("a widget resolving to nothing is not a landing", () => {
		for (const id of [null, undefined]) {
			expect(nextSaveState(edit, { type: "resolved", id })).toEqual({
				pending: edit,
				drop: false
			})
		}
	})

	test("a refusal stops the wait but KEEPS the preview", () => {
		for (const p of [edit, fresh]) {
			expect(nextSaveState(p, { type: "refused" })).toEqual({
				pending: null,
				drop: false
			})
		}
	})

	test("nothing in flight is nothing to decide", () => {
		for (const e of [
			{ type: "resolved", id: 7 } as const,
			{ type: "created", id: 7 } as const,
			{ type: "refused" } as const
		]) {
			expect(nextSaveState(null, e)).toEqual({
				pending: null,
				drop: false
			})
		}
	})
})

// ── The socket path ─────────────────────────────────────────────────────────

type Listener = (payload: any) => void

/** The same shape `sockets/interest.test.ts` drives the registry with. */
function makeSocket() {
	const listeners = new Map<string, Listener[]>()
	return {
		connected: true,
		emits: [] as Array<{ event: string; payload: any }>,
		listeners,
		on(event: string, fn: Listener) {
			listeners.set(event, [...(listeners.get(event) ?? []), fn])
		},
		off(event: string, fn: Listener) {
			const arr = listeners.get(event)
			if (!arr) return
			const at = arr.indexOf(fn)
			if (at !== -1) arr.splice(at, 1)
			if (arr.length === 0) listeners.delete(event)
		},
		once() {},
		emit(event: string, payload: any) {
			this.emits.push({ event, payload })
		},
		/** The server pushing an event down this socket. */
		dispatch(event: string, payload: any) {
			for (const fn of [...(listeners.get(event) ?? [])]) fn(payload)
		},
		listenerCount(event: string) {
			return (listeners.get(event) ?? []).length
		}
	}
}

/** A fresh module graph, so the module-scoped store and registry start empty. */
async function loadStore() {
	vi.resetModules()
	return await import("./widgetStyles.svelte")
}

/** The key list of the most recent interest sync. */
function lastSyncKeys(): string[] | null {
	const syncs = (socket?.emits ?? []).filter(
		(e) => e.event === "interest:sync"
	)
	return syncs.length ? syncs[syncs.length - 1].payload.keys : null
}

/** Everything but the registry's own syncs. */
function requests() {
	return (socket?.emits ?? []).filter((e) => e.event !== "interest:sync")
}

describe("the socket path", () => {
	beforeEach(() => {
		socket = makeSocket()
	})

	afterEach(() => {
		socket = null
	})

	test("declares what it reads, then asks for the list", async () => {
		const { widgetStylesStore } = await loadStore()
		widgetStylesStore()

		// The sync went first, and it names the key the reply comes back on.
		expect(socket!.emits[0].event).toBe("interest:sync")
		expect(socket!.emits[0].payload.keys).toContain("widgetStyles:list")
		expect(requests()).toEqual([{ event: "widgetStyles:list", payload: {} }])

		// The create pair and the five error twins are held too — an error
		// event is never gated, but the store still reads it through the one
		// listener path.
		const keys = lastSyncKeys()!
		expect(keys).toContain("widgetStyles:create")
		expect(keys).toContain("widgetStyles:clone")
		expect(keys).toContain("widgetStyles:update:error")
	})

	test("one raw listener per event name, and the rows land through it", async () => {
		const { widgetStylesStore } = await loadStore()
		const store = widgetStylesStore()
		// A second reader is a second caller of the same store.
		widgetStylesStore()

		expect(socket!.listenerCount("widgetStyles:list")).toBe(1)

		socket!.dispatch("widgetStyles:list", {
			styles: [row({ id: 1 }), row({ id: 2 })]
		})
		expect(store.rows.map((r) => r.id)).toEqual([1, 2])
		expect(store.loaded).toBe(true)
	})

	test("a create asks on the event its reply comes back on", async () => {
		const { widgetStylesStore } = await loadStore()
		const store = widgetStylesStore()
		socket!.emits.length = 0

		store.create({
			widgetSlug: "scene-portraits",
			title: "Cozy",
			css: "",
			vars: {}
		})

		expect(requests().map((e) => e.event)).toEqual(["widgetStyles:create"])
		expect(lastSyncKeys()).toContain("widgetStyles:create")
	})

	test("update and delete declare nothing — nothing reads their reply", async () => {
		// The store folds in the refreshed `:list` the server pushes after a
		// write, never the write's own reply. Holding no key for those two is
		// what lets the gate skip building them at all.
		const { widgetStylesStore } = await loadStore()
		const store = widgetStylesStore()
		socket!.emits.length = 0

		store.update({ id: 3, title: "Cosy" })
		store.remove(3)

		expect(requests().map((e) => e.event)).toEqual([
			"widgetStyles:update",
			"widgetStyles:delete"
		])
		const keys = lastSyncKeys()
		if (keys) {
			expect(keys).not.toContain("widgetStyles:update")
			expect(keys).not.toContain("widgetStyles:delete")
		}
	})

	test("stopping releases every listener it took", async () => {
		const { stopWidgetStyles, widgetStylesStore } = await loadStore()
		widgetStylesStore()
		expect(socket!.listenerCount("widgetStyles:list")).toBe(1)

		stopWidgetStyles()

		expect(socket!.listenerCount("widgetStyles:list")).toBe(0)
		expect(socket!.listenerCount("widgetStyles:create")).toBe(0)
		// The sync that tells the server is microtask-debounced, so that one
		// screen closing twenty widgets sends one packet rather than twenty.
		await Promise.resolve()
		expect(lastSyncKeys()).toEqual([])
	})
})
