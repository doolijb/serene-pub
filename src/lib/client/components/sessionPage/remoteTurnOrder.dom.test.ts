/**
 * Core's remote Turn order (PLAN-core-widgets W1) — the built module
 * (`@serene-pub/core-catalog/components/turn-order.js`) mounted through the
 * SDK's component harness in core's box, posted what the page posts it: the
 * session's stored turn order (`turnOrder.v1`), the cast from the page's own
 * projection (`projectCharacters`), the viewer, and only the base sections
 * its declaration reads. Its two presses are answered by the page's own
 * handlers (`answerFireTurn`, `answerPickTurn`).
 *
 * The head line is held to the composer's *Who is due next* words
 * (`NextCharacterBlock`): the same `order[0]`, the same sentences.
 */
import { afterAll, describe, expect, test } from "vitest"
import { createRequire } from "node:module"
import { mountComponent, type MountedComponent } from "@serene-pub/cli/testing"
import type { TurnOrderV1, ViewerV1 } from "@serene-pub/sdk"
import { CORE_WIDGETS } from "$lib/shared/widgets/types"
import { coreDefaultWidgets } from "./coreWidgets"
import {
	projectCharacters,
	type CharacterCard,
	type CharactersSourceSession
} from "./projections/characters"
import { answerFireTurn } from "./requests/fireTurn"
import { answerPickTurn } from "./requests/pickTurn"

const require = createRequire(import.meta.url)
const BUILT = require.resolve(
	"@serene-pub/core-catalog/components/turn-order.js"
)
const CORE_CATALOG = BUILT.replace(/\/dist\/components\/turn-order\.js$/, "")
const DECL = CORE_WIDGETS.find((w) => w.id === "turn-order")!

/* ── one session, as the page holds it ─────────────────────────────────── */

const U = (n: number) => `00000000-0000-4000-8000-00000000000${n}`
const FACE = `/media/${U(1)}?r=1`

const wren: CharacterCard = {
	id: 3,
	userId: 10,
	name: "Wren",
	avatarMedia: { uuid: U(1), rev: 1 }
}
const bram: CharacterCard = { id: 4, userId: 10, name: "Bram", nickname: "Bee" }
const moss: CharacterCard = { id: 5, userId: 10, name: "Moss" }
const kit: CharacterCard = { id: 8, userId: 10, name: "Kit" }
const sable: CharacterCard = { id: 9, userId: 30, name: "Sable" }

const session: CharactersSourceSession = {
	userId: 10,
	sessionCharacters: [
		{ isActive: true, removedAt: null, position: 0, character: wren },
		{ isActive: true, removedAt: null, position: 1, character: bram },
		// Benched (switched off in Participants): in the session, never a candidate.
		{ isActive: false, removedAt: null, position: 2, character: moss }
	],
	sessionPersonas: [
		{ removedAt: null, position: 0, persona: kit },
		{ removedAt: null, position: 1, persona: sable }
	],
	sessionMessages: []
}

/** The turn pool's answer for that cast: the active characters, then the personas. */
const candidates: TurnOrderV1["candidates"] = [
	{
		ref: "character:3",
		kind: "character",
		name: "Wren",
		position: 0,
		ownerUserId: 10
	},
	{
		ref: "character:4",
		kind: "character",
		name: "Bram",
		nickname: "Bee",
		position: 1,
		ownerUserId: 10
	},
	{
		ref: "character:8",
		kind: "persona",
		name: "Kit",
		position: 0,
		ownerUserId: 10
	},
	{
		ref: "character:9",
		kind: "persona",
		name: "Sable",
		position: 1,
		ownerUserId: 30
	}
]
const turnOrder = (order: TurnOrderV1["order"]): TurnOrderV1 => ({
	v: 1,
	order,
	candidates,
	basedOnAt: 1,
	computedAt: 2,
	runId: null,
	event: "core:event/message-created@1",
	strategy: "core:task/turn-round-robin@1"
})
const ROUND = turnOrder([
	{ ref: "character:3", via: "strategy" },
	{ ref: "character:4", via: "strategy" }
])

const OWNER: ViewerV1 = { userId: 10, isAdmin: false, isGuest: false }

/* ── the remote, as the page mounts it ─────────────────────────────────── */

const fired: Array<string | undefined> = []
let pickerOpened = 0
const views: MountedComponent[] = []

async function mount(
	o: {
		order?: TurnOrderV1
		viewer?: ViewerV1
		settings?: Record<string, unknown>
	} = {}
) {
	const viewer = o.viewer ?? OWNER
	const view = await mountComponent({
		entry: BUILT,
		root: CORE_CATALOG,
		owner: "core",
		timeoutMs: 60_000,
		reads: DECL.reads,
		context: {
			session: { id: 1, name: "The Guard Room" },
			settings: o.settings ?? {},
			viewer,
			turnOrder: o.order ?? ROUND,
			actions: {},
			scoped: {
				characters: projectCharacters({
					session,
					viewerUserId: viewer.userId,
					sceneImages: { left: null, right: null }
				})
			}
		},
		requests: (kind, params) => {
			if (kind === "fire-turn")
				return answerFireTurn(params, {
					fireTurn: (channel) => fired.push(channel)
				})
			if (kind === "pick-turn")
				return answerPickTurn(params, {
					showTurnPicker: () => pickerOpened++
				})
			throw new Error(`not asked: ${kind}`)
		}
	})
	views.push(view)
	await view.settle()
	return view
}

afterAll(async () => {
	for (const v of views) await v.unmount()
})

const part = (name: string) => `[data-widget-part~="turn-order.${name}"]`
const text = (el: Element | null | undefined) =>
	el?.textContent?.replace(/\s+/g, " ").trim() ?? null
const rows = (view: MountedComponent) =>
	view.queryAll(part("row")).map((r) => ({
		ref: r.getAttribute("data-ref"),
		state: r.getAttribute("data-state"),
		name: text(r.querySelector(part("name"))),
		chip: text(r.querySelector(part("state"))),
		face: r.querySelector(`img${part("face")}`)?.getAttribute("src") ?? null
	}))
const control = (view: MountedComponent, name: "continue" | "pick") => {
	const b = view.query<HTMLButtonElement>(part(name))!
	return {
		disabled: b.hasAttribute("disabled"),
		title: b.getAttribute("title")
	}
}

describe("core's remote Turn order", () => {
	test(
		"the head row is due and the rest follow, each with its face; the head line is the composer's",
		{ timeout: 120_000 },
		async () => {
			const view = await mount()
			expect(view.refused).toEqual([])
			expect(text(view.query(part("head")))).toBe(
				"Wren is ready to continue"
			)
			expect(rows(view)).toEqual([
				{
					ref: "character:3",
					state: "due",
					name: "Wren",
					chip: "Due",
					face: FACE
				},
				{
					ref: "character:4",
					state: "then",
					name: "Bee",
					chip: "Then",
					face: null
				}
			])
			expect(control(view, "continue")).toEqual({
				disabled: false,
				title: "Continue"
			})
			expect(text(view.query(part("strategy")))).toBe(
				"Strategy: Round robin"
			)
			expect(view.errors).toEqual([])
		}
	)

	test(
		"the viewer's own persona is You, and its turn is taken by writing",
		{ timeout: 120_000 },
		async () => {
			const view = await mount({
				order: turnOrder([
					{ ref: "character:8", via: "strategy" },
					{ ref: "character:3", via: "strategy" }
				])
			})
			expect(text(view.query(part("head")))).toBe("Your turn")
			expect(rows(view).map((r) => [r.name, r.state, r.chip])).toEqual([
				["Kit", "you", "You"],
				["Wren", "then", "Then"]
			])
			expect(control(view, "continue")).toEqual({
				disabled: true,
				title: "A person's turn is taken by writing."
			})
		}
	)

	test(
		"a benched character is never a row: the turn pool never seats one",
		{ timeout: 120_000 },
		async () => {
			const view = await mount()
			expect(rows(view).map((r) => r.ref)).not.toContain("character:5")
			expect(view.query('[data-ref="character:5"]')).toBeNull()
		}
	)

	test(
		"Continue fires the head's turn through the page's fire-turn; Pick who speaks opens the picker",
		{ timeout: 120_000 },
		async () => {
			const view = await mount()
			fired.length = 0
			pickerOpened = 0
			await view.click(part("continue"))
			await view.click(part("pick"))
			await view.settle()
			expect(view.requested).toEqual([
				{ kind: "fire-turn", params: { channel: "main" } },
				{ kind: "pick-turn", params: {} }
			])
			expect(fired).toEqual(["main"])
			expect(pickerOpened).toBe(1)
			expect(view.queryAll("[role='alert']")).toEqual([])
		}
	)

	test(
		"a guest with no seat sees both controls greyed with the reason as their title, never hidden",
		{ timeout: 120_000 },
		async () => {
			const view = await mount({
				viewer: { userId: 77, isAdmin: false, isGuest: true }
			})
			const reason =
				"Guests without a seat in this session can watch the turns, not take them."
			expect(control(view, "continue")).toEqual({
				disabled: true,
				title: reason
			})
			expect(control(view, "pick")).toEqual({
				disabled: true,
				title: reason
			})
			// Still drawn: the order is for looking at.
			expect(rows(view)).toHaveLength(2)
			// A guest with a seat (Sable's person) may move the turns on.
			const seated = await mount({
				viewer: { userId: 30, isAdmin: false, isGuest: true }
			})
			expect(control(seated, "continue").disabled).toBe(false)
		}
	)

	test(
		"faces off draws none; the strategy line hides with its setting",
		{ timeout: 120_000 },
		async () => {
			const view = await mount({
				settings: { faces: false, showStrategy: false }
			})
			expect(view.queryAll(part("face"))).toEqual([])
			expect(view.query(part("strategy"))).toBeNull()
		}
	)

	test(
		"W6: a benched character (Moss) is listed under the order only with showBenched, and takes no turn",
		{ timeout: 120_000 },
		async () => {
			const hidden = await mount()
			expect(hidden.query(part("benched"))).toBeNull()
			expect(rows(hidden).map((r) => r.ref)).toEqual(["character:3", "character:4"])

			const shown = await mount({ settings: { showBenched: true } })
			expect(shown.query(part("benched"))?.getAttribute("aria-label")).toBe("Benched")
			expect(rows(shown)).toEqual([
				{ ref: "character:3", state: "due", name: "Wren", chip: "Due", face: FACE },
				{ ref: "character:4", state: "then", name: "Bee", chip: "Then", face: null },
				{ ref: "character:5", state: "benched", name: "Moss", chip: "Benched", face: null }
			])
			expect(
				shown.queryAll(`${part("benched")} ${part("row")}`).map((r) => r.getAttribute("data-ref"))
			).toEqual(["character:5"])
		}
	)

	test(
		"🚧 the Lair's Party panel: a seated player's planned turn waits for them; the owner alone may Continue past them",
		{ timeout: 120_000 },
		async () => {
			// The plan's turns (Lair rewrite D5): Sable's player's delver, then Wren.
			const planned = turnOrder([
				{ ref: "character:9", via: "plan" },
				{ ref: "character:3", via: "plan" }
			])
			const owner = await mount({ order: planned })
			expect(text(owner.query(part("head")))).toBe("Waiting for Sable")
			const go = owner.query<HTMLButtonElement>(part("continue"))!
			expect(go.hasAttribute("disabled")).toBe(false)
			expect(go.getAttribute("aria-label")).toBe("Continue without Sable")
			// Another guest at the table waits too, and may not move past anybody.
			const guest = await mount({
				order: planned,
				viewer: { userId: 77, isAdmin: false, isGuest: true }
			})
			expect(text(guest.query(part("head")))).toBe("Waiting for Sable")
			expect(control(guest, "continue").disabled).toBe(true)
			// Sable's player: their own turn, taken by writing.
			const player = await mount({
				order: planned,
				viewer: { userId: 30, isAdmin: false, isGuest: true }
			})
			expect(text(player.query(part("head")))).toBe("Your turn")
			expect(control(player, "continue")).toEqual({
				disabled: true,
				title: "A person's turn is taken by writing."
			})
			expect(rows(player).map((r) => [r.name, r.chip])).toEqual([
				["Sable", "You"],
				["Wren", "Then"]
			])
		}
	)

	test(
		"nothing prepared: waiting, with Pick offered and Continue greyed",
		{ timeout: 120_000 },
		async () => {
			const view = await mount({ order: turnOrder([]) })
			expect(text(view.query(part("head")))).toBe(
				"Waiting for a message — or pick who speaks next"
			)
			expect(rows(view)).toEqual([])
			expect(control(view, "pick").disabled).toBe(false)
			expect(control(view, "continue")).toEqual({
				disabled: true,
				title: "Nothing is prepared to take a turn."
			})
		}
	)
})

describe("the page mounts Turn order remote", () => {
	test("core's own module at /core-ui/turn-order, granted the cast, reading its declaration's sections", () => {
		const widget = coreDefaultWidgets().find((p) => p.id === "turn-order")!
		expect(widget.surface).toEqual({
			kind: "remote",
			owner: "core",
			component: "turn-order"
		})
		expect(widget.src).toBe("/core-ui/turn-order")
		expect(widget.grants).toEqual(["characters"])
		expect(widget.reads).toEqual([
			"turnOrder",
			"viewer",
			"actions",
			"settings",
			"locale"
		])
		expect(DECL.maxInstances).toBe(1)
	})
})
