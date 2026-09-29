/**
 * The flows of one editable slot (SlotControl, shared by World State and
 * Stats; R21, R80): Enter commits, Escape cancels, leaving the field commits
 * what was typed, and leaving it untouched writes nothing. Each is driven
 * through the widget as a person would, and held to the server's own answer
 * (`state:get`) and to a second socket's copy of the widget.
 */
import type { Page } from "playwright"
import { ask } from "../engine"
import { serverValue, type AdventureFixture, type StateOwner } from "./adventure"
import { pushArrives, reloadOn, until, type WidgetCtx, type WidgetSpec } from "./kit"

export type EditableSlot = {
	/** The slot's element inside the widget (`[data-slot-id=…]`, under its owner's card). */
	slot: string
	/** Its label: the edit button reads `<label>…, edit`, the field `<label> value`. */
	label: string
	owner: (f: AdventureFixture) => StateOwner
	short: string
	/** The field it opens: a text box, or a number's spin button. */
	kind: "text" | "integer"
	/** How the control reads a value (`14/20` for a bar). */
	shown: (value: string | number) => string
	/** The value typed for each flow, in the field's own words. */
	values: { enter: string; escape: string; blur: string }
	/** The typed value as the server stores it. */
	stored: (typed: string) => string | number
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** What the control shows, and whether its field is open. */
const read = (page: Page, sel: string) =>
	page.evaluate((sel) => {
		const el = document.querySelector(sel)
		const control = el?.querySelector(`[data-widget-part~="stat-slot.control"]`)
		return { there: !!el, open: !!control?.querySelector("input"), text: (control?.textContent ?? "").replace(/\s+/g, " ").trim() }
	}, sel)

/** The session state's version: it moves on every write, and on nothing else. */
export async function stateVersion(page: Page, f: AdventureFixture): Promise<unknown> {
	const got = await ask(page, "state:get", { sessionId: f.sessionId }, { where: { sessionId: f.sessionId } })
	return got?.state?.version ?? null
}

export function slotFlows(spec: () => WidgetSpec, s: EditableSlot): WidgetSpec["flows"] {
	const at = (ctx: WidgetCtx) => `${ctx.sel} ${s.slot}`
	const openField = async (ctx: WidgetCtx) => {
		const slot = ctx.page.locator(at(ctx))
		await slot.getByRole("button", { name: new RegExp(`^${esc(s.label)}\\b.*, edit$`) }).click()
		const field = slot.getByRole(s.kind === "integer" ? "spinbutton" : "textbox", { name: `${s.label} value` })
		await field.waitFor({ timeout: 8_000 })
		return field
	}
	/** The control closed, showing `want` — on `page`. */
	const shows = (ctx: WidgetCtx, page: Page, want: string, timeout = 10_000) =>
		until(
			page,
			({ sel, want }) => {
				const control = document.querySelector(sel)?.querySelector(`[data-widget-part~="stat-slot.control"]`)
				return !!control && !control.querySelector("input") && (control.textContent ?? "").replace(/\s+/g, " ").trim() === want
			},
			{ sel: at(ctx), want },
			timeout,
			async () => {
				const r = await read(page, at(ctx))
				return `${s.label} ${r.open ? "still has its field open" : `reads ${JSON.stringify(r.text)}`}, not ${JSON.stringify(want)}${page === ctx.page ? "" : " on the second socket"}`
			}
		)
	const serverSays = async (ctx: WidgetCtx, want: string | number, when: string) => {
		const got = await serverValue(ctx.page, ctx.f, s.owner(ctx.f), s.short)
		if (got !== want) throw new Error(`${when}, the server holds ${JSON.stringify(got)} for ${s.label}, not ${JSON.stringify(want)}`)
	}

	return [
		{
			name: `${s.label}: Enter`,
			run: async (ctx) => {
				const before = await serverValue(ctx.page, ctx.f, s.owner(ctx.f), s.short)
				const field = await openField(ctx)
				// The field opens holding the stored value (a remote's value reaches the page through the host).
				let held = await field.inputValue()
				for (let i = 0; i < 30 && held !== String(before); i++) await ctx.page.waitForTimeout(100), (held = await field.inputValue())
				if (held !== String(before)) throw new Error(`the field opened holding ${JSON.stringify(held)}, not the stored ${JSON.stringify(before)}`)
				await field.fill(s.values.enter)
				const t0 = Date.now()
				await field.press("Enter")
				const want = s.shown(s.stored(s.values.enter))
				await shows(ctx, ctx.page, want)
				await pushArrives(ctx, `${s.label} (Enter)`, t0, ({ sel, want }) => {
					const c = document.querySelector(sel)?.querySelector(`[data-widget-part~="stat-slot.control"]`)
					return (c?.textContent ?? "").replace(/\s+/g, " ").trim() === want
				}, { sel: at(ctx), want })
				await serverSays(ctx, s.stored(s.values.enter), "after Enter")
				await reloadOn(ctx, spec())
				await shows(ctx, ctx.page, want)
				return "the field opens holding the stored value; Enter closes it, and the new value shows, is the server's, reaches a second socket, and survives a reload"
			}
		},
		{
			name: `${s.label}: Escape`,
			run: async (ctx) => {
				const before = await serverValue(ctx.page, ctx.f, s.owner(ctx.f), s.short)
				const version = await stateVersion(ctx.page, ctx.f)
				const field = await openField(ctx)
				await field.fill(s.values.escape)
				await field.press("Escape")
				const want = s.shown(before as string | number)
				await shows(ctx, ctx.page, want)
				// Nothing written: wait out a write's round trip, then ask.
				await ctx.page.waitForTimeout(1500)
				await serverSays(ctx, before as string | number, "after Escape")
				const now = await stateVersion(ctx.page, ctx.f)
				if (now !== version) throw new Error(`Escape wrote: the state's version moved from ${JSON.stringify(version)} to ${JSON.stringify(now)}`)
				await shows(ctx, ctx.second, want, 2_000)
				return "Escape closes the field on the stored value, and nothing is written (the server's version and a second socket's copy stay)"
			}
		},
		{
			name: `${s.label}: leaving the field`,
			run: async (ctx) => {
				const field = await openField(ctx)
				await field.fill(s.values.blur)
				const t0 = Date.now()
				// A person moves on: Tab takes the focus out of the field.
				await field.press("Tab")
				const want = s.shown(s.stored(s.values.blur))
				await shows(ctx, ctx.page, want)
				await pushArrives(ctx, `${s.label} (blur)`, t0, ({ sel, want }) => {
					const c = document.querySelector(sel)?.querySelector(`[data-widget-part~="stat-slot.control"]`)
					return (c?.textContent ?? "").replace(/\s+/g, " ").trim() === want
				}, { sel: at(ctx), want })
				await serverSays(ctx, s.stored(s.values.blur), "after leaving the field")
				return "leaving the field commits what was typed: it shows, is the server's, and reaches a second socket"
			}
		},
		{
			name: `${s.label}: leaving it untouched`,
			run: async (ctx) => {
				const before = await serverValue(ctx.page, ctx.f, s.owner(ctx.f), s.short)
				const version = await stateVersion(ctx.page, ctx.f)
				const field = await openField(ctx)
				await field.press("Tab")
				await shows(ctx, ctx.page, s.shown(before as string | number))
				await ctx.page.waitForTimeout(1500)
				const now = await stateVersion(ctx.page, ctx.f)
				if (now !== version) throw new Error(`leaving an untouched field wrote: the state's version moved from ${JSON.stringify(version)} to ${JSON.stringify(now)}`)
				return "leaving an untouched field closes it and writes nothing"
			}
		}
	]
}
