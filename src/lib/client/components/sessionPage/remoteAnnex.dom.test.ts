/**
 * Core's remote Annex widget (PLAN-core-widgets W9) — the built module
 * (`@serene-pub/core-catalog/components/annex.js`) mounted through the SDK's
 * component harness in core's box, posted what the page posts it: the
 * viewer's view of the annex (`annex.v1`), the session's listing
 * (`actions.v1`, where a settable field is one action at the `widget`
 * venue), the viewer, and only the base sections its declaration reads.
 *
 * Its Edit is the Session data list's: shown for a text field the listing
 * makes the viewer's to set (`annexEditsAsText`'s rule), and its Save is
 * the press that list's Save makes — the field's ready-made action
 * (`annexFieldActionOf`) with `{ value }` — which the page's own routing
 * (`makeInvoke`) resolves at the `widget` venue and fires with the value
 * intact.
 */
import { afterAll, describe, expect, test } from "vitest"
import { createRequire } from "node:module"
import { mountComponent, type MountedComponent } from "@serene-pub/cli/testing"
import type {
	ActionsV1,
	AnnexV1,
	ViewerV1,
	WidgetAction
} from "@serene-pub/sdk"
import { CORE_WIDGETS } from "$lib/shared/widgets/types"
import { makeInvoke, projectActions } from "$lib/shared/widgets/context"
import {
	annexEditsAsText,
	annexFieldActionOf
} from "$lib/shared/sessions/annexInspect"

const require = createRequire(import.meta.url)
const BUILT = require.resolve("@serene-pub/core-catalog/components/annex.js")
const CORE_CATALOG = BUILT.replace(/\/dist\/components\/annex\.js$/, "")
const DECL = CORE_WIDGETS.find((w) => w.id === "annex")!

/* ── one session's annex and listing, as the page holds them ───────────── */

const NOTES = "Rolled twice.\nThe second was a 20."
const ANNEX: AnnexV1 = {
	"acme.dice": {
		notes: NOTES,
		"last-roll": 17,
		tags: ["brave", "tired"],
		sheet: { hp: 7, name: "Bram" }
	}
}

/** A settable field, as the server lists it (`sessionGenres.ts`): one action at the `widget` venue. */
const fieldAction = (
	owner: string,
	key: string,
	name: string,
	over: Partial<WidgetAction> = {}
): WidgetAction => ({
	key,
	specSlug: `${owner}:annex`,
	name,
	slash: key,
	quick: false,
	audience: { see: ["owner"], act: ["owner"] },
	venue: "widget",
	origin: "foreign",
	floor: false,
	canAct: true,
	itemGated: false,
	isNew: false,
	enabled: true,
	...over
})

/** The owner's listing: the notes are theirs to set. */
const LISTING: ActionsV1 = {
	widget: {
		primary: [fieldAction("acme.dice", "notes", "Table notes")],
		overflow: []
	}
}
/** A member's: the notes are listed, not theirs to set. */
const NOT_MINE: ActionsV1 = {
	widget: {
		primary: [
			fieldAction("acme.dice", "notes", "Table notes", { canAct: false })
		],
		overflow: []
	}
}

const OWNER: ViewerV1 = { userId: 10, isAdmin: false, isGuest: false }

/* ── the remote, as the page mounts it ─────────────────────────────────── */

const views: MountedComponent[] = []

async function mountAnnex(
	o: {
		annex?: AnnexV1
		actions?: ActionsV1
		settings?: Record<string, unknown>
	} = {}
) {
	const view = await mountComponent({
		entry: BUILT,
		root: CORE_CATALOG,
		owner: "core",
		timeoutMs: 60_000,
		reads: DECL.reads,
		context: {
			session: { id: 1, name: "The Dice Table" },
			settings: o.settings ?? {},
			viewer: OWNER,
			annex: o.annex ?? ANNEX,
			actions: o.actions ?? LISTING
		},
		requests: (kind) => {
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

const part = (name: string) => `[data-widget-part~="annex.${name}"]`
const text = (el: Element | null | undefined) =>
	el?.textContent?.replace(/\s+/g, " ").trim() ?? null

describe("core's remote Annex", () => {
	test(
		"text is prose, titled by the field's label; the label line only when asked",
		{ timeout: 120_000 },
		async () => {
			const view = await mountAnnex({
				settings: { key: "acme.dice.notes" }
			})
			expect(view.refused).toEqual([])
			const root = view.query(part("root"))!
			expect(root.getAttribute("data-state")).toBe("value")
			expect(root.getAttribute("data-shape")).toBe("text")
			expect(root.getAttribute("aria-label")).toBe("Table notes")
			// Its own line breaks, kept: the sheet draws it `pre-wrap`.
			expect(view.query(part("prose"))?.textContent).toBe(NOTES)
			expect(view.query(part("label"))).toBeNull()

			const labelled = await mountAnnex({
				settings: { key: "acme.dice.notes", showLabel: true }
			})
			expect(text(labelled.query(part("label")))).toBe("Table notes")
			expect(view.errors).toEqual([])
		}
	)

	test(
		"a list is chips, an object a row per member, a number one row titled by its key",
		{ timeout: 120_000 },
		async () => {
			const tags = await mountAnnex({
				settings: { key: "acme.dice.tags" }
			})
			expect(tags.queryAll(part("chip")).map(text)).toEqual([
				"brave",
				"tired"
			])

			const sheet = await mountAnnex({
				settings: { key: "acme.dice.sheet" }
			})
			const rows = sheet
				.queryAll(part("row"))
				.map((r) => [
					text(r.querySelector(part("row-label"))),
					text(r.querySelector(part("row-value")))
				])
			expect(rows).toEqual([
				["Hp", "7"],
				["Name", "Bram"]
			])

			const roll = await mountAnnex({
				settings: { key: "acme.dice.last-roll" }
			})
			// Nobody may set it, so no listing names it: the key is its title.
			expect(roll.query(part("root"))?.getAttribute("aria-label")).toBe(
				"last-roll"
			)
			expect(text(roll.query(part("row-value")))).toBe("17")
		}
	)

	test(
		"never silent: no key, nothing written, nothing to see — each one line",
		{ timeout: 120_000 },
		async () => {
			const pick = await mountAnnex()
			expect(pick.query(part("root"))?.getAttribute("data-state")).toBe(
				"pick"
			)
			expect(pick.query(part("root"))?.getAttribute("aria-label")).toBe(
				"Annex"
			)
			expect(text(pick.query(part("empty")))).toBe(
				"Pick a key in settings"
			)

			const unwritten = await mountAnnex({
				settings: { key: "acme.dice.score" }
			})
			expect(text(unwritten.query(part("empty")))).toBe(
				"Nothing written yet"
			)

			// A key whose `see` leaves the viewer out is absent from their view,
			// as an unwritten one is; the Castellan's notes are the Castellan's.
			const blank = await mountAnnex({
				annex: {},
				settings: { key: "core.castellan-scratchpad" }
			})
			expect(text(blank.query(part("empty")))).toBe("Nothing written yet")
		}
	)

	test(
		"Edit only where the listing makes the field the viewer's to set — the Session data list's rule",
		{ timeout: 120_000 },
		async () => {
			const mine = await mountAnnex({
				settings: { key: "acme.dice.notes" }
			})
			expect(mine.query(part("edit"))).not.toBeNull()
			expect(
				annexEditsAsText({ act: ["owner"], shape: { type: "text" } })
			).toBe(true)

			const notMine = await mountAnnex({
				actions: NOT_MINE,
				settings: { key: "acme.dice.notes" }
			})
			expect(notMine.query(part("edit"))).toBeNull()

			const unlisted = await mountAnnex({
				actions: {},
				settings: { key: "acme.dice.notes" }
			})
			expect(unlisted.query(part("edit"))).toBeNull()

			// A number is never edited as text, there or here.
			const roll = await mountAnnex({
				actions: {
					widget: {
						primary: [
							fieldAction("acme.dice", "last-roll", "Last roll")
						],
						overflow: []
					}
				},
				settings: { key: "acme.dice.last-roll" }
			})
			expect(roll.query(part("edit"))).toBeNull()
			expect(
				annexEditsAsText({ act: ["owner"], shape: { type: "integer" } })
			).toBe(false)
		}
	)

	test(
		"Save presses the field's ready-made action with { value } — the Session data list's write, routed by the page",
		{ timeout: 120_000 },
		async () => {
			const view = await mountAnnex({
				settings: { key: "acme.dice.notes" }
			})
			await view.click(part("edit"))
			const box = view.query<HTMLTextAreaElement>(part("text"))!
			expect(box.value).toBe(NOTES)
			expect(box.getAttribute("aria-label")).toBe("Table notes")
			await view.input(part("text"), "Three rolls now.")
			await view.click(part("save"))

			const identity = annexFieldActionOf("acme.dice", "notes")
			expect(view.invoked).toEqual([
				{ key: identity, payload: { value: "Three rolls now." } }
			])
			// Closed on Save: the new value comes back through `annex.v1`.
			expect(view.query(part("editor"))).toBeNull()
			await view.push("annex", {
				"acme.dice": {
					...ANNEX["acme.dice"],
					notes: "Three rolls now."
				}
			})
			expect(view.query(part("prose"))?.textContent).toBe(
				"Three rolls now."
			)

			// The page's half: resolved at the `widget` venue and fired with the
			// value intact — what the Session data list's Save emits
			// (`sessions:fireAction` with `action` and `payload`).
			const fired: unknown[] = []
			const invoke = makeInvoke(
				() => projectActions(LISTING),
				() => {
					throw new Error(
						"the generic action verb is not the page's fire"
					)
				},
				"annex",
				{ core: {}, fire: (a, args) => fired.push({ ...a, ...args }) }
			)
			const { key, ...args } = view.invoked[0]!
			invoke(key, args)
			expect(fired).toEqual([
				expect.objectContaining({
					specSlug: "acme.dice:annex",
					key: "notes",
					payload: { value: "Three rolls now." }
				})
			])

			// Cancel closes the editor and presses nothing.
			await view.click(part("edit"))
			await view.click(part("cancel"))
			expect(view.query(part("editor"))).toBeNull()
			expect(view.invoked).toHaveLength(1)
		}
	)
})
