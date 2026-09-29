/**
 * The slot control's exhibits (SlotControl, shared by World State and Stats;
 * R21): every state of a slot the fixture's snapshot never draws — a control
 * under the pointer or reached from the keyboard, each editor open (a line, a
 * number, a list with its items and the lorebook picker, a story time), what
 * each editor refuses, and the flags a slot can carry (required, retired,
 * derived, a switch on and off).
 *
 * Every selector is a role, an accessible name or `data-slot-id`, never the
 * markup's own vocabulary, so one exhibit reads the same state before and
 * after the markup moves (the point of recording them first).
 *
 * The fixture has no required, retired, derived, switch or story-time slot,
 * and no socket authors one (stored declarations have no socket yet), so
 * `withSlotFlags` hands the page's own state store a `state:get` answer that
 * carries them: the server's answer, with flags set on two of its slots and
 * four slots of a made-up owner (`gate:`) added. The widget, its host and
 * the stylesheet are the real ones; only the answer is written here, as the
 * DOM tests do (`serverSays`). Nothing in these exhibits writes, so the store
 * keeps the answer until the next exhibit opens the page afresh.
 */
import type { Locator } from "playwright"
import { ask } from "../engine"
import { reloadOn, until, type WidgetCtx, type WidgetSpec } from "./kit"
import { setValue, storeLayout, world, castOwner, FIXTURE_WIDGET_SETTINGS, type StateOwner } from "./adventure"

type Exhibits = NonNullable<WidgetSpec["exhibits"]>

/** The pointer let go and parked in the page's corner. */
export async function pointerAway(ctx: WidgetCtx) {
	await ctx.page.mouse.up()
	await ctx.page.mouse.move(0, 0)
}
/** Transitions and the remote's round trip run out. */
const settle = (ctx: WidgetCtx) => ctx.page.waitForTimeout(700)

/** Hover `target` from a parked pointer, and let it settle. */
async function hover(ctx: WidgetCtx, target: Locator) {
	await pointerAway(ctx)
	await target.hover()
	await settle(ctx)
}

/** Focus reached from the keyboard, so `:focus-visible` holds: focus the element after `target`, then Shift+Tab. */
async function tabBackTo(ctx: WidgetCtx, after: Locator) {
	await pointerAway(ctx)
	await after.focus()
	await ctx.page.keyboard.press("Shift+Tab")
	await settle(ctx)
}

/* ── the answer with flags ──────────────────────────────────────────────── */

/** The made-up owner's slots: a derived value, a switch on, a switch off, and a story time with nothing set. */
const FLAGGED = [
	{ slotId: "gate:slot/age@1", label: "Age", type: "derived", value: 31 },
	{ slotId: "gate:slot/lit@1", label: "Lit", type: "boolean", field: { type: "boolean" }, value: true },
	{ slotId: "gate:slot/sealed@1", label: "Sealed", type: "boolean", field: { type: "boolean" }, value: false },
	{ slotId: "gate:slot/when@1", label: "When", type: "text", field: { type: "text", format: "story-time" } }
] as const

/**
 * The server's `state:get` answer for the session, with `required` on
 * `required`, `retired` on `retired`, and FLAGGED added to `owner` — handed to
 * the page's store as if the server had sent it, and waited on until the
 * widget draws the story time's slot.
 */
export async function withSlotFlags(
	ctx: WidgetCtx,
	o: { owner: "world" | string; required: string; retired: string }
) {
	const { page, f } = ctx
	const got = await ask(page, "state:get", { sessionId: f.sessionId }, { where: { sessionId: f.sessionId } })
	const answer = structuredClone(got)
	answer.slots.find((s: { slotId: string }) => s.slotId === o.required).required = true
	answer.slots.find((s: { slotId: string }) => s.slotId === o.retired).retired = true
	const owner = answer.owners.find((x: { key: string }) => x.key === o.owner)
	if (!owner) throw new Error(`state:get has no owner ${o.owner}`)
	// A cast member's values sit under its key and again under its id (`byId`, the second index).
	const bags: Array<Record<string, unknown>> =
		o.owner === "world"
			? [(answer.state.world ??= {})]
			: [
					answer.state.cast[o.owner],
					...Object.values(answer.state.cast.byId as Record<string, { key: string }>).filter((c) => c.key === o.owner)
				].filter(Boolean)
	for (const s of FLAGGED) {
		const qualifiedKey = s.slotId.replace(/^(\w+):slot\/([\w-]+)@\d+$/, "$1_$2")
		answer.slots.push({
			slotId: s.slotId,
			key: s.label.toLowerCase(),
			qualifiedKey,
			label: s.label,
			type: s.type,
			...("field" in s ? { field: s.field } : {}),
			appliesTo: [o.owner === "world" ? "world" : "cast"]
		})
		owner.configs[s.slotId] = {}
		if ("value" in s) for (const bag of bags) bag[qualifiedKey] = s.value
	}
	await page.evaluate(async (payload) => {
		const live = (globalThis as unknown as { __gateImport: (path: string) => Promise<any> }).__gateImport
		const socket = (await live("/src/lib/client/sockets/socketInstance.ts")).getSocket()
		if (!socket) throw new Error("the app's socket is not there")
		for (const listener of socket.listeners("state:get")) listener(payload)
	}, answer)
	await until(
		page,
		(sel) => !!document.querySelector(`${sel} [data-slot-id="gate:slot/when@1"]`),
		ctx.sel,
		10_000,
		() => "the flagged slots were never drawn"
	)
	await settle(ctx)
}

/* ── the exhibits ───────────────────────────────────────────────────────── */

/** An item that is a word, and a held reference to a lorebook entry: what the list editor draws its rows from. */
async function withItems(ctx: WidgetCtx, owner: StateOwner, list: Locator) {
	const bridge = ctx.f.entries.get("Lantern Bridge")!
	await setValue(ctx.page, ctx.f, owner, "inventory", ["rope", { entryId: bridge, count: 2 }])
	await list.getByRole("button", { name: /^Inventory\b.*, edit$/ }).filter({ hasText: "Lantern Bridge" }).waitFor({ timeout: 10_000 })
}

/** Open a slot's editor by its edit button, and wait for what it opens. */
async function openEditor(ctx: WidgetCtx, slot: Locator, label: string, opened: Locator) {
	await pointerAway(ctx)
	await slot.getByRole("button", { name: new RegExp(`^${label}\\b.*, edit$`) }).click()
	await opened.waitFor({ timeout: 8_000 })
}

/**
 * World State's: the strip is compact, so these are the compact slot's.
 * Location is a line of text, Weather a chip over a closed set, Inventory a
 * list; the flagged slots are added to the world.
 */
export function worldSlotExhibits(): Exhibits {
	const slot = (ctx: WidgetCtx, id: string) => ctx.page.locator(`${ctx.sel} [data-slot-id="core:slot/${id}@1"]`).first()
	const inventory = (ctx: WidgetCtx) => slot(ctx, "inventory")
	const editor = (ctx: WidgetCtx) => inventory(ctx).getByRole("group", { name: "Inventory value" })
	const picker = (ctx: WidgetCtx) => inventory(ctx).getByRole("group", { name: "Add to Inventory from the lorebook" })
	const openList = async (ctx: WidgetCtx, items: boolean) => {
		if (items) await withItems(ctx, world(ctx.f), inventory(ctx))
		await openEditor(ctx, inventory(ctx), "Inventory", editor(ctx))
		await settle(ctx)
	}
	const openPicker = async (ctx: WidgetCtx) => {
		await openList(ctx, true)
		await editor(ctx).getByRole("button", { name: "Add from the lorebook" }).click()
		await picker(ctx).getByRole("list", { name: "Other entries" }).waitFor({ timeout: 10_000 })
		await pointerAway(ctx)
		await settle(ctx)
	}
	const flagged = (ctx: WidgetCtx) =>
		withSlotFlags(ctx, { owner: "world", required: "core:slot/location@1", retired: "core:slot/weather@1" })
	const when = (ctx: WidgetCtx) => ctx.page.locator(`${ctx.sel} [data-slot-id="gate:slot/when@1"]`)
	const whenEditor = (ctx: WidgetCtx) => when(ctx).getByRole("group", { name: "When value" })
	const openWhen = async (ctx: WidgetCtx) => {
		await flagged(ctx)
		await openEditor(ctx, when(ctx), "When", whenEditor(ctx))
		await settle(ctx)
	}
	return [
		{ name: "Location hovered", show: (ctx) => hover(ctx, slot(ctx, "location").getByRole("button", { name: "Location, edit" })) },
		{
			name: "Location's field open",
			show: async (ctx) => {
				await openEditor(ctx, slot(ctx, "location"), "Location", slot(ctx, "location").getByRole("textbox", { name: "Location value" }))
				await pointerAway(ctx)
				await settle(ctx)
			}
		},
		{ name: "Weather hovered", show: (ctx) => hover(ctx, slot(ctx, "weather").getByRole("button", { name: "Weather, edit" })) },
		{
			name: "Weather's menu open",
			show: async (ctx) => {
				await pointerAway(ctx)
				await slot(ctx, "weather").getByRole("button", { name: "Weather, edit" }).click()
				await ctx.page.locator('[role=menu][aria-label="Weather value"]').waitFor({ timeout: 8_000 })
				await pointerAway(ctx)
				await settle(ctx)
			}
		},
		{ name: "the list's editor open, empty", show: (ctx) => openList(ctx, false) },
		{ name: "the list's editor open, with items", show: (ctx) => openList(ctx, true) },
		{
			name: "a held item's + hovered",
			show: async (ctx) => {
				await openList(ctx, true)
				await hover(ctx, editor(ctx).getByRole("button", { name: "One more Lantern Bridge ×2" }))
			}
		},
		{
			name: "a held item's − hovered",
			show: async (ctx) => {
				await openList(ctx, true)
				await hover(ctx, editor(ctx).getByRole("button", { name: "One fewer Lantern Bridge ×2" }))
			}
		},
		{
			name: "an item's move hovered",
			show: async (ctx) => {
				await openList(ctx, true)
				await hover(ctx, editor(ctx).getByRole("button", { name: "Move rope down" }))
			}
		},
		{
			name: "an item's remove hovered",
			show: async (ctx) => {
				await openList(ctx, true)
				await hover(ctx, editor(ctx).getByRole("button", { name: "Remove rope" }))
			}
		},
		{
			name: "Done hovered",
			show: async (ctx) => {
				await openList(ctx, true)
				await hover(ctx, editor(ctx).getByRole("button", { name: "Done", exact: true }))
			}
		},
		{
			name: "Add from the lorebook hovered",
			show: async (ctx) => {
				await openList(ctx, true)
				await hover(ctx, editor(ctx).getByRole("button", { name: "Add from the lorebook" }))
			}
		},
		{ name: "the picker open", show: openPicker },
		{
			name: "the picker, a row hovered",
			show: async (ctx) => {
				await openPicker(ctx)
				await hover(ctx, picker(ctx).getByRole("button", { name: "Bell Tower" }))
			}
		},
		{
			name: "the picker, a row chosen and hovered",
			show: async (ctx) => {
				await openPicker(ctx)
				await picker(ctx).getByRole("button", { name: "Old Mill" }).click()
				await picker(ctx).getByRole("button", { name: "Add Old Mill" }).waitFor({ timeout: 8_000 })
				await settle(ctx)
			}
		},
		{
			name: "the picker, Add hovered",
			show: async (ctx) => {
				await openPicker(ctx)
				await picker(ctx).getByRole("button", { name: "Old Mill" }).click()
				await hover(ctx, picker(ctx).getByRole("button", { name: "Add Old Mill" }))
			}
		},
		{
			name: "the picker, Close hovered",
			show: async (ctx) => {
				await openPicker(ctx)
				await hover(ctx, picker(ctx).getByRole("button", { name: "Close", exact: true }))
			}
		},
		{
			name: "the picker refuses: nothing chosen",
			show: async (ctx) => {
				await openPicker(ctx)
				await picker(ctx).getByRole("spinbutton", { name: "How many to add" }).press("Enter")
				await editor(ctx).getByRole("alert").waitFor({ timeout: 8_000 })
				await settle(ctx)
			}
		},
		{ name: "flags: required, retired, derived, a switch, a story time", show: flagged },
		{
			name: "flags: a switch hovered",
			show: async (ctx) => {
				await flagged(ctx)
				await hover(ctx, ctx.page.locator(`${ctx.sel} [data-slot-id="gate:slot/lit@1"]`).getByRole("button"))
			}
		},
		{ name: "the story time's editor open", show: openWhen },
		{
			name: "the story time's Save hovered",
			show: async (ctx) => {
				await openWhen(ctx)
				await hover(ctx, whenEditor(ctx).getByRole("button", { name: "Save", exact: true }))
			}
		},
		{
			name: "the story time's Cancel hovered",
			show: async (ctx) => {
				await openWhen(ctx)
				await hover(ctx, whenEditor(ctx).getByRole("button", { name: "Cancel", exact: true }))
			}
		},
		{
			name: "the story time refuses: a day with no month",
			show: async (ctx) => {
				await openWhen(ctx)
				await whenEditor(ctx).getByRole("spinbutton", { name: "Year" }).fill("1204")
				const day = whenEditor(ctx).getByRole("spinbutton", { name: "Day" })
				await day.fill("3")
				await day.press("Enter")
				await whenEditor(ctx).getByRole("alert").waitFor({ timeout: 8_000 })
				await pointerAway(ctx)
				await settle(ctx)
			}
		}
	]
}

/**
 * Stats': Rook's card, full density (and compact once). Health is a bar, Mood
 * a chip, Inventory a list; the flagged slots are added to Rook.
 */
export function statsSlotExhibits(spec: () => WidgetSpec): Exhibits {
	const rook = (ctx: WidgetCtx) => ctx.page.locator(`${ctx.sel} [data-owner-key="c7_gate_rook"]`)
	const slot = (ctx: WidgetCtx, id: string) => rook(ctx).locator(`[data-slot-id="core:slot/${id}@1"]`)
	const health = (ctx: WidgetCtx) => slot(ctx, "hp").getByRole("button", { name: /^Health .*, edit$/ })
	return [
		{ name: "Health hovered", show: (ctx) => hover(ctx, health(ctx)) },
		{ name: "Health focused", show: (ctx) => tabBackTo(ctx, slot(ctx, "inventory").getByRole("button", { name: /^Inventory\b.*, edit$/ })) },
		{
			name: "Health's field open",
			show: async (ctx) => {
				await openEditor(ctx, slot(ctx, "hp"), "Health", slot(ctx, "hp").getByRole("spinbutton", { name: "Health value" }))
				await pointerAway(ctx)
				await settle(ctx)
			}
		},
		{ name: "Mood hovered", show: (ctx) => hover(ctx, slot(ctx, "mood").getByRole("button", { name: "Mood, edit" })) },
		{
			name: "Mood's menu open",
			show: async (ctx) => {
				await pointerAway(ctx)
				await slot(ctx, "mood").getByRole("button", { name: "Mood, edit" }).click()
				// Each card has a Mood menu; Rook's is the one showing.
				await ctx.page.locator('[role=menu][aria-label="Mood value"]:visible').waitFor({ timeout: 8_000 })
				await pointerAway(ctx)
				await settle(ctx)
			}
		},
		{
			name: "the list's editor open, with items",
			show: async (ctx) => {
				await withItems(ctx, castOwner(ctx.f, "rook"), slot(ctx, "inventory"))
				await openEditor(ctx, slot(ctx, "inventory"), "Inventory", slot(ctx, "inventory").getByRole("group", { name: "Inventory value" }))
				await settle(ctx)
			}
		},
		{
			name: "flags: required, retired, derived, a switch, a story time",
			show: (ctx) => withSlotFlags(ctx, { owner: "c7_gate_rook", required: "core:slot/hp@1", retired: "core:slot/mood@1" })
		},
		{
			name: "compact",
			show: async (ctx) => {
				await storeLayout(ctx.page, ctx.f.sessionId, { ...FIXTURE_WIDGET_SETTINGS, stats: { density: "compact" } })
				await reloadOn(ctx, spec())
				await pointerAway(ctx)
				await settle(ctx)
			}
		}
	]
}

/** The widget settings the fixture stores, put back after the compact exhibit. */
export const restoreStatsSettings = (ctx: WidgetCtx) => storeLayout(ctx.page, ctx.f.sessionId)
