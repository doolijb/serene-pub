/**
 * Stats (R21): one card per cast member, one row per slot they carry.
 *
 * Records: a card for each of the fixture's cast in seat order — Rook, Wren,
 * then the persona Ash — filed under its own owner key, each row reading the
 * server's resolved value (a bar reads `value/max`); Rook's Health and Mood
 * are the fixture's.
 * Exhibits: the slot control's states on Rook's card (`slotExhibits`).
 * Flows: Rook's Health bar — Enter / Escape / leave / leave-untouched
 * (`slotFlows`).
 */
import { ask } from "../engine"
import { castOwner, CAST, resetValues, ROOK_VALUES } from "./adventure"
import { until, type WidgetSpec } from "./kit"
import { slotFlows } from "./slotFlows"
import { restoreStatsSettings, statsSlotExhibits } from "./slotExhibits"

export const statsSpec: WidgetSpec = {
	name: "stats",
	title: "Stats",
	root: '[data-state-widget="stats"]',
	drawn: async (ctx, page) => {
		await until(
			page,
			(sel) => document.querySelectorAll(`${sel} [data-widget-part~="stats.card"] [data-slot-id]`).length > 0,
			ctx.sel,
			30_000,
			() => "Stats drew no card"
		)
	},
	records: async (ctx) => {
		const seen = await ctx.page.evaluate((sel) => {
			const flat = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim()
			return [...document.querySelectorAll(`${sel} [data-widget-part~="stats.card"]`)].map((card) => ({
				key: card.getAttribute("data-owner-key"),
				name: flat(card.querySelector(`[data-widget-part~="stats.card-head"]`)?.textContent),
				rows: Object.fromEntries(
					[...card.querySelectorAll("[data-slot-id]")].map((el) => [
						el.getAttribute("data-slot-id"),
						flat(el.querySelector(`[data-widget-part~="stat-slot.control"]`)?.textContent)
					])
				)
			}))
		}, ctx.sel)
		const wrong: string[] = []
		const names = [CAST.rook.name, CAST.wren.name, CAST.ash.name]
		if (JSON.stringify(seen.map((c) => c.name)) !== JSON.stringify(names))
			wrong.push(`the cards read ${seen.map((c) => c.name).join(", ") || "none"}; the cast is ${names.join(", ")}`)
		// Each row is the server's resolved value, drawn as its control draws it.
		const got = await ask(ctx.page, "state:get", { sessionId: ctx.f.sessionId }, { where: { sessionId: ctx.f.sessionId } })
		for (const card of seen) {
			const owner = (got?.owners ?? []).find((o: { key: string }) => o.key === card.key)
			if (!owner) {
				wrong.push(`the card "${card.name}" is filed under ${card.key}, which is no owner of this session's state`)
				continue
			}
			const who = Object.entries(CAST).find(([k]) => ctx.f.cast[k as keyof typeof CAST] === owner.id)?.[1]?.name
			if (owner.kind !== "session_cast" || who !== card.name) wrong.push(`the card "${card.name}" is filed under ${card.key}, which is ${who ?? `owner ${owner.id}`}`)
			for (const slot of got.slots as Array<{ slotId: string; qualifiedKey: string; label: string }>) {
				const shown = card.rows[slot.slotId]
				if (shown === undefined) continue
				const value = got.state?.cast?.[card.key!]?.[slot.qualifiedKey]
				const max = (owner.configs?.[slot.slotId] as { max?: number } | undefined)?.max
				const want = value === undefined ? "not set" : typeof value === "number" && max !== undefined ? `${value}/${max}` : String(value)
				if (shown !== want) wrong.push(`${card.name}'s ${slot.label} reads ${JSON.stringify(shown)}; the server's value draws ${JSON.stringify(want)}`)
			}
		}
		const rook = seen.find((c) => c.name === CAST.rook.name)
		if (rook && (rook.rows["core:slot/hp@1"] !== `${ROOK_VALUES.hp}/20` || rook.rows["core:slot/mood@1"] !== ROOK_VALUES.mood))
			wrong.push(`Rook's Health and Mood read ${rook.rows["core:slot/hp@1"]} / ${rook.rows["core:slot/mood@1"]}; the fixture set ${ROOK_VALUES.hp}/20 / ${ROOK_VALUES.mood}`)
		return wrong
	},
	exhibits: statsSlotExhibits(() => statsSpec),
	flows: slotFlows(() => statsSpec, {
		slot: '[data-owner-key="c7_gate_rook"] [data-slot-id="core:slot/hp@1"]',
		label: "Health",
		owner: (f) => castOwner(f, "rook"),
		short: "hp",
		kind: "integer",
		shown: (v) => `${v}/20`,
		values: { enter: "9", escape: "3", blur: "12" },
		stored: Number
	}),
	reset: async (ctx) => {
		await resetValues(ctx.page, ctx.f)
		await restoreStatsSettings(ctx)
	}
}
