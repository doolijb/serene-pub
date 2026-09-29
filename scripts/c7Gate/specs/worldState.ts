/**
 * World State (R21): the session's world slots as one strip above the
 * conversation, each editable in place.
 *
 * Records: Adventure's four world slots in slot-id order — Inventory (the
 * list stat the world carries since state phase 3b, which the fixture leaves
 * unset), Location, Time of day, Weather — each reading what the fixture set
 * (or the genre's default), under the world's owner.
 * Exhibits: the slot control's states in the strip (`slotExhibits`).
 * Flows: the Location line's Enter / Escape / leave / leave-untouched
 * (`slotFlows`), the Weather chip's closed set picked from its menu, and a
 * place (state phase 4): a location entry given an Inventory value is drawn
 * as its own group under the world's slots, on both sockets, and goes when
 * the value is cleared. The flow makes and deletes its own location entry, so
 * the fixture (and the golden, which has no place) is left as it was.
 */
import { resetValues, serverValue, world, WORLD_VALUES } from "./adventure"
import { ask } from "../engine"
import { pushArrives, until, type WidgetSpec } from "./kit"
import { slotFlows } from "./slotFlows"
import { worldSlotExhibits } from "./slotExhibits"

const LOCATION = '[data-slot-id="core:slot/location@1"]'
const WEATHER = '[data-slot-id="core:slot/weather@1"]'
const LOCATION_ENTRY = "core:entry/location"
/** The place the phase-4 flow makes, and what it leaves lying there. */
const PLACE = { name: "C7 gate Cellar", keys: "cellar", content: "A damp cellar under the mill.", item: "lantern" } as const

export const worldStateSpec: WidgetSpec = {
	name: "world-state",
	title: "World State",
	root: '[data-state-widget="world-state"]',
	drawn: async (ctx, page) => {
		await until(
			page,
			(sel) => !!document.querySelector(`${sel} [data-slot-id]`),
			ctx.sel,
			30_000,
			() => "World State drew no slot"
		)
	},
	records: async (ctx) => {
		const seen = await ctx.page.evaluate((sel) => {
			const root = document.querySelector(sel)!
			return {
				owner: root.getAttribute("data-owner-key"),
				slots: [...root.querySelectorAll("[data-slot-id]")].map((el) => ({
					id: el.getAttribute("data-slot-id"),
					label: (el.querySelector(`[data-widget-part~="stat-slot.label"]`)?.textContent ?? "").replace(/\s+/g, " ").trim(),
					value: (el.querySelector(`[data-widget-part~="stat-slot.control"]`)?.textContent ?? "").replace(/\s+/g, " ").trim()
				})),
				alerts: [...root.querySelectorAll("[role=alert]")].map((a) => a.textContent?.trim())
			}
		}, ctx.sel)
		const wrong: string[] = []
		if (seen.owner !== "world") wrong.push(`the strip is filed under ${JSON.stringify(seen.owner)}, not the world`)
		const want = [
			{ id: "core:slot/inventory@1", label: "Inventory", value: "not set" },
			{ id: "core:slot/location@1", label: "Location", value: WORLD_VALUES.location },
			{ id: "core:slot/time-of-day@1", label: "Time of day", value: "morning" },
			{ id: "core:slot/weather@1", label: "Weather", value: WORLD_VALUES.weather }
		]
		const said = (xs: typeof want) => xs.map((x) => `${x.label}=${x.value}`).join(", ")
		if (JSON.stringify(seen.slots) !== JSON.stringify(want)) wrong.push(`the strip reads ${said(seen.slots as typeof want)}; the fixture is ${said(want)}`)
		for (const a of seen.alerts) wrong.push(`the strip says an error: ${a}`)
		return wrong
	},
	exhibits: worldSlotExhibits(),
	flows: [
		...slotFlows(() => worldStateSpec, {
			slot: LOCATION,
			label: "Location",
			owner: world,
			short: "location",
			kind: "text",
			shown: String,
			values: { enter: "The Old Mill", escape: "Nowhere at all", blur: "The Salt Road" },
			stored: (typed) => typed
		}),
		{
			name: "Weather: pick from the chip",
			run: async (ctx) => {
				const slot = ctx.page.locator(`${ctx.sel} ${WEATHER}`)
				await slot.getByRole("button", { name: "Weather, edit" }).click()
				// The menu is named by its trigger (aria-labelledby) and labelled "Weather value".
				const menu = ctx.page.locator('[role=menu][aria-label="Weather value"]')
				await menu.waitFor({ timeout: 8_000 })
				const items = await menu.getByRole("menuitem").evaluateAll((els) => els.map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim()))
				const t0 = Date.now()
				await menu.getByRole("menuitem").filter({ hasText: /^\s*rain\s*$/ }).click()
				const shows = ({ sel, want }: { sel: string; want: string }) =>
					(document.querySelector(sel)?.querySelector(`[data-widget-part~="stat-slot.control"]`)?.textContent ?? "").replace(/\s+/g, " ").trim() === want
				await until(ctx.page, shows, { sel: `${ctx.sel} ${WEATHER}`, want: "rain" }, 10_000, () => "Weather never read rain")
				await pushArrives(ctx, "Weather (menu)", t0, shows, { sel: `${ctx.sel} ${WEATHER}`, want: "rain" })
				const got = await serverValue(ctx.page, ctx.f, world(ctx.f), "weather")
				if (got !== "rain") throw new Error(`the server holds ${JSON.stringify(got)} for Weather, not "rain"`)
				return `the chip opens its closed set (${items.join(" | ")}); a pick writes it, shows it, and reaches a second socket`
			}
		},
		{
			name: "a place: a location with a value is drawn under the world",
			run: async (ctx) => {
				const { page, f } = ctx
				const made = await ask(
					page,
					"entries:create",
					{ entry: { typeId: LOCATION_ENTRY, lorebookId: f.lorebookId, name: PLACE.name, keys: PLACE.keys, content: PLACE.content } },
					{ scope: f.lorebookId, refusable: true }
				)
				const entryId = made?.entry?.id as number | undefined
				if (!entryId) throw new Error(`the location entry was refused: ${JSON.stringify(made)}`)
				const slotId = f.slots.get("inventory")
				if (!slotId) throw new Error("the Adventure session tracks no inventory slot")
				const owner = { kind: "session_location", id: entryId }
				const put = async (value: unknown) => {
					const r = await ask(page, "state:set", { sessionId: f.sessionId, owner, slotId, value }, { where: { sessionId: f.sessionId }, refusable: true })
					if (r?.error) throw new Error(`state:set on the place was refused: ${r.error}`)
				}
				type Seen = { key: string | null; label: string | null; head: string; slots: Array<{ id: string | null; value: string }> }
				const places = (sel: string) =>
					[...document.querySelectorAll(`${sel} section[data-widget-part~="world-state.place"][data-owner-key]`)].map((el) => ({
						key: el.getAttribute("data-owner-key"),
						label: el.getAttribute("aria-label"),
						head: (el.querySelector('[data-widget-part~="world-state.place-head"]')?.textContent ?? "").replace(/\s+/g, " ").trim(),
						slots: [...el.querySelectorAll("[data-slot-id]")].map((s) => ({
							id: s.getAttribute("data-slot-id"),
							value: (s.querySelector(`[data-widget-part~="stat-slot.control"]`)?.textContent ?? "").replace(/\s+/g, " ").trim()
						}))
					}))
				const drawn = ({ sel, name }: { sel: string; name: string }) =>
					[...document.querySelectorAll(`${sel} section[data-widget-part~="world-state.place"][data-owner-key]`)].some((el) => el.getAttribute("aria-label") === name)
				const gone = (sel: string) => !document.querySelector(`${sel} section[data-widget-part~="world-state.place"]`)
				try {
					if (!(await page.evaluate(gone, ctx.sel))) throw new Error("a place group is drawn before any place has a value")
					const t0 = Date.now()
					await put([PLACE.item])
					await until(page, drawn, { sel: ctx.sel, name: PLACE.name }, 10_000, () => `no place group for ${PLACE.name} was drawn once it held a value`)
					await pushArrives(ctx, "a place's value", t0, drawn, { sel: ctx.sel, name: PLACE.name })
					const seen = (await page.evaluate(places, ctx.sel)) as Seen[]
					const one = seen.find((p) => p.label === PLACE.name)!
					const wrong: string[] = []
					if (seen.length !== 1) wrong.push(`${seen.length} place groups are drawn, not 1`)
					if (!/^location:/.test(one.key ?? "")) wrong.push(`the place is filed under ${JSON.stringify(one.key)}, not a location:<slug> key`)
					if (one.head !== PLACE.name) wrong.push(`its head reads ${JSON.stringify(one.head)}, not ${JSON.stringify(PLACE.name)}`)
					if (one.slots.length !== 1 || one.slots[0]!.id !== slotId) wrong.push(`it draws ${JSON.stringify(one.slots.map((s) => s.id))}, not only ${slotId}`)
					if (!one.slots[0]?.value.includes(PLACE.item)) wrong.push(`its Inventory reads ${JSON.stringify(one.slots[0]?.value)}, not the ${PLACE.item}`)
					const world = await page.evaluate(
						(sel) => [...document.querySelectorAll(`${sel} [data-slot-id]`)].filter((el) => !el.closest('[data-widget-part~="world-state.place"]')).length,
						ctx.sel
					)
					if (world !== 4) wrong.push(`the world's own slots number ${world} beside the place, not 4`)
					if (wrong.length) throw new Error(wrong.join("; "))
					await put(null)
					await until(page, gone, ctx.sel, 10_000, () => "the place group stayed once its value was cleared")
					await until(ctx.second, gone, ctx.sel, 10_000, () => "the second socket's place group stayed once its value was cleared")
					return `a location given an Inventory value (${one.slots[0]!.value}) is drawn as its own group (${one.key}, headed "${one.head}") under the world's four slots, on both sockets; cleared, it goes`
				} finally {
					await put(null).catch(() => {})
					await ask(page, "entries:delete", { id: entryId, typeId: LOCATION_ENTRY, lorebookId: f.lorebookId }, { scope: f.lorebookId, refusable: true })
				}
			}
		}
	],
	reset: (ctx) => resetValues(ctx.page, ctx.f)
}
