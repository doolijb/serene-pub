/**
 * Core's remote Actions widget (PLAN-core-widgets W8) — the built module
 * (`@serene-pub/core-catalog/components/actions.js`) mounted through the
 * SDK's component harness in core's box, posted what the page posts it: the
 * session's listed actions (`actions.v1`), the viewer, and only the base
 * sections its declaration reads. Its newcomers are told to the page's own
 * `actions-seen` answer.
 *
 * A press is `invoke(identity)`; what the page does with one is the page's
 * own routing, run here on the press the widget made: `makeInvoke` resolves
 * it against the same venues, and the page's `routePress` sends a collecting
 * action to the collect modal — mounted, as the page mounts it.
 */
import { afterAll, afterEach, describe, expect, test } from "vitest"
import { createRequire } from "node:module"
import { flushSync, mount, tick, unmount } from "svelte"
import { mountComponent, type MountedComponent } from "@serene-pub/cli/testing"
import type { ActionsV1, ViewerV1, WidgetAction } from "@serene-pub/sdk"
import { CORE_WIDGETS } from "$lib/shared/widgets/types"
import {
	findAction,
	makeInvoke,
	projectActions
} from "$lib/shared/widgets/context"
import CollectModal from "./CollectModal.svelte"
import { routePress, type ListedCollects } from "./collects"
import { answerActionsSeen } from "./requests/actionsSeen"

const require = createRequire(import.meta.url)
const BUILT = require.resolve("@serene-pub/core-catalog/components/actions.js")
const CORE_CATALOG = BUILT.replace(/\/dist\/components\/actions\.js$/, "")
const DECL = CORE_WIDGETS.find((w) => w.id === "actions")!

/* ── one session's listing, as the page holds it ───────────────────────── */

const act = (
	over: Partial<WidgetAction> & Pick<WidgetAction, "key" | "venue" | "name">
): WidgetAction => ({
	specSlug: "core",
	slash: over.key,
	quick: true,
	audience: { see: ["participant"], act: ["participant"] },
	origin: "core",
	floor: false,
	canAct: true,
	itemGated: false,
	isNew: false,
	enabled: true,
	...over
})

const CONTINUE = act({
	key: "advance",
	venue: "extra",
	name: "Continue",
	icon: "message-square-more"
})
const PICK = act({
	key: "pick",
	venue: "extra",
	name: "Pick who speaks",
	icon: "message-square-plus"
})
/** The Lair's Nudge: collects text before it fires (lair pass R3). */
const NUDGE = {
	...act({
		key: "nudge",
		specSlug: "core:spec/lair-nudge",
		origin: "companion",
		venue: "composer",
		name: "Nudge",
		description: "Tell the narrator what you want next."
	}),
	collects: {
		text: { need: "required", label: "Direction the party should feel" }
	} as ListedCollects
}
const SURVEY = act({
	key: "survey",
	specSlug: "core:spec/adventure-survey",
	origin: "companion",
	venue: "composer",
	name: "Survey",
	enabled: false,
	reason: { i18n: { en: "set a location first" } }
})
/** Another namespace's, switched on for this genre — and new to this viewer. */
const ROLL = act({
	key: "roll",
	specSlug: "acme:spec/dice",
	origin: "foreign",
	venue: "composer",
	name: "Roll",
	icon: "dice-5",
	isNew: true
})
const EDIT = act({ key: "edit", venue: "message", name: "Edit" })

/** Listed as the server lists it: the genre's composer row in the listing's own order. */
const LISTING: ActionsV1 = {
	composer: { primary: [ROLL, NUDGE, SURVEY], overflow: [ROLL, NUDGE] },
	extra: { primary: [CONTINUE, PICK], overflow: [] },
	message: { primary: [EDIT], overflow: [] },
	widget: { primary: [], overflow: [] }
}

const OWNER: ViewerV1 = { userId: 10, isAdmin: false, isGuest: false }

/* ── the remote, as the page mounts it ─────────────────────────────────── */

const seen: string[][] = []
const views: MountedComponent[] = []

async function mountActions(
	o: { actions?: ActionsV1; settings?: Record<string, unknown> } = {}
) {
	const view = await mountComponent({
		entry: BUILT,
		root: CORE_CATALOG,
		owner: "core",
		timeoutMs: 60_000,
		reads: DECL.reads,
		context: {
			session: { id: 1, name: "The Guard Room" },
			settings: o.settings ?? {},
			viewer: OWNER,
			actions: o.actions ?? LISTING
		},
		requests: (kind, params) => {
			if (kind === "actions-seen")
				return answerActionsSeen(params, {
					markActionsSeen: (keys) => seen.push(keys)
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

let modals: ReturnType<typeof mount>[] = []
const modalHosts: HTMLElement[] = []
afterEach(() => {
	for (const m of modals) unmount(m)
	modals = []
	for (const h of modalHosts.splice(0)) h.remove()
})

const part = (name: string) => `[data-widget-part~="actions.${name}"]`
const text = (el: Element | null | undefined) =>
	el?.textContent?.replace(/\s+/g, " ").trim() ?? null
const groups = (view: MountedComponent) =>
	view.queryAll(part("group")).map((g) => ({
		group: g.getAttribute("data-group"),
		head: text(g.querySelector(part("group-head"))),
		buttons: [...g.querySelectorAll(part("button"))].map((b) =>
			b.getAttribute("data-identity")
		)
	}))
const button = (view: MountedComponent, identity: string) =>
	view.query<HTMLButtonElement>(
		`${part("button")}[data-identity="${identity}"]`
	)!

describe("core's remote Actions", () => {
	test(
		"the turn controls first, then the genre's own, then the added — a message's actions are not drawn",
		{ timeout: 120_000 },
		async () => {
			const view = await mountActions()
			expect(view.refused).toEqual([])
			expect(groups(view)).toEqual([
				{
					group: "turn",
					head: "Turn controls",
					buttons: ["core#advance", "core#pick"]
				},
				{
					group: "genre",
					head: "Genre actions",
					buttons: [
						"core:spec/lair-nudge#nudge",
						"core:spec/adventure-survey#survey"
					]
				},
				{
					group: "foreign",
					head: "Added actions",
					buttons: ["acme:spec/dice#roll"]
				}
			])
			expect(view.query('[data-identity="core#edit"]')).toBeNull()
			expect(view.query(part("root"))?.getAttribute("data-size")).toBe(
				"compact"
			)
			expect(view.errors).toEqual([])
		}
	)

	test(
		"a greyed action stays, with its reason as its title and description; pressing it fires nothing",
		{ timeout: 120_000 },
		async () => {
			const view = await mountActions()
			const survey = button(view, "core:spec/adventure-survey#survey")
			expect(survey.getAttribute("aria-disabled")).toBe("true")
			expect(survey.getAttribute("title")).toBe(
				"Survey — set a location first"
			)
			const reason = survey.querySelector(part("reason"))!
			expect(text(reason)).toBe("set a location first")
			expect(survey.getAttribute("aria-describedby")).toBe(reason.id)
			await view.click(survey)
			expect(view.invoked).toEqual([])
			// An action that may be pressed carries no reason and is not greyed.
			const pick = button(view, "core#pick")
			expect(pick.hasAttribute("aria-disabled")).toBe(false)
			expect(pick.querySelector(part("reason"))).toBeNull()
		}
	)

	test(
		"a press invokes the action by its identity",
		{ timeout: 120_000 },
		async () => {
			const view = await mountActions()
			await view.click(button(view, "core#advance"))
			await view.click(button(view, "acme:spec/dice#roll"))
			expect(view.invoked.map((r) => r.key)).toEqual([
				"core#advance",
				"acme:spec/dice#roll"
			])
		}
	)

	test(
		"a collecting action's press opens the page's collect modal, by the page's own routing",
		{ timeout: 120_000 },
		async () => {
			const view = await mountActions()
			await view.click(button(view, "core:spec/lair-nudge#nudge"))
			expect(view.invoked.map((r) => r.key)).toEqual([
				"core:spec/lair-nudge#nudge"
			])

			// The page's half: the widget's invoke, resolved against the same
			// venues and sent to the fire the page threads down — whose
			// `routePress` opens the collect modal for an action that collects.
			const opened: string[] = []
			const invoke = makeInvoke(
				() => projectActions(LISTING),
				() => {
					throw new Error(
						"the generic action verb is not the page's fire"
					)
				},
				"actions",
				{
					core: {},
					fire: (a) => {
						const listed = findAction(
							projectActions(LISTING),
							`${a.specSlug}#${a.key}`
						) as
							| (WidgetAction & { collects?: ListedCollects })
							| undefined
						const route = routePress(
							listed
								? {
										slash: listed.slash,
										name: listed.name,
										collects: listed.collects
									}
								: undefined,
							undefined,
							a.key
						)
						if (route.route !== "modal") return
						opened.push(listed!.name)
						const host = document.createElement("div")
						document.body.append(host)
						modalHosts.push(host)
						modals.push(
							mount(CollectModal, {
								target: host,
								props: {
									open: true,
									// routePress said "modal", so the action collects.
									action: {
										...listed!,
										collects: listed!.collects!
									},
									cast: [],
									onSubmit: () => {},
									onCancel: () => {}
								}
							})
						)
					}
				}
			)
			const { key, ...args } = view.invoked[0]!
			invoke(key, args)
			flushSync()
			await tick()
			expect(opened).toEqual(["Nudge"])
			expect(document.querySelector("[role=dialog]")).not.toBeNull()
			expect(document.body.textContent).toContain(
				"Direction the party should feel"
			)
		}
	)

	test(
		"groups: turn draws the turn controls alone",
		{ timeout: 120_000 },
		async () => {
			const view = await mountActions({ settings: { groups: "turn" } })
			expect(groups(view).map((g) => g.group)).toEqual(["turn"])
			expect(view.query(part("empty"))).toBeNull()
			// A group with nothing listed says so instead.
			const none = await mountActions({
				actions: { extra: LISTING.extra },
				settings: { groups: "genre" }
			})
			expect(text(none.query(part("empty")))).toBe(
				"This session offers none of these actions here."
			)
		}
	)

	test(
		"size: large is the tile grid, on the root",
		{ timeout: 120_000 },
		async () => {
			const view = await mountActions({ settings: { size: "large" } })
			expect(view.query(part("root"))?.getAttribute("data-size")).toBe(
				"large"
			)
		}
	)

	test(
		"a newcomer wears the new mark and is told to the page as met, once",
		{ timeout: 120_000 },
		async () => {
			seen.length = 0
			const view = await mountActions()
			expect(
				button(view, "acme:spec/dice#roll").hasAttribute("data-new")
			).toBe(true)
			expect(button(view, "core#advance").hasAttribute("data-new")).toBe(
				false
			)
			expect(seen).toEqual([["acme:spec/dice#roll"]])
			// The listing re-posted with the mark still on: not told twice.
			await view.push("actions", { ...LISTING })
			expect(
				view.requested.filter((r) => r.kind === "actions-seen")
			).toHaveLength(1)
		}
	)
})
