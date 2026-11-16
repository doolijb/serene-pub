/**
 * `dossierFor`'s every branch keeps its reference while its inputs hold.
 *
 * Three of its four branches build a new object per call, so they are stable
 * only because the derived around the call (`{@const dossier = ...}` in the
 * render, `scoped={...}` on the mount) does not rerun while a reply streams.
 * The widget wire skips a scoped section by reference, so a rerun with nothing
 * moved would serialise the dossier again. Per branch: 50 rounds of the same
 * page dossier handed again -> no rerun, same reference; one real change ->
 * one rerun and a new reference carrying the change.
 */
import { afterEach, describe, expect, test } from "vitest"
import { flushSync } from "svelte"
import type { PanelLayoutV2 } from "@serene-pub/sdk"
import type { ConversationDossierV1 } from "$lib/shared/widgets/conversation"
import { createSessionLayoutModel } from "./sessionLayoutModel.svelte"
import { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
import { coreDefaultWidgets } from "$lib/client/components/sessionPage/coreWidgets"
import { clearShownLine } from "$lib/client/components/sessionPage/requests/showLine"
import { setWidgetSettingValues } from "$lib/client/stores/widgetSettings.svelte"

const roots: (() => void)[] = []
afterEach(() => {
	for (const stop of roots.splice(0)) stop()
	clearShownLine()
	setWidgetSettingValues({})
})

const WITH_BOX: PanelLayoutV2 = {
	version: 2,
	left: [],
	middle: [
		{ key: "p1", tabs: ["dialogue-box", "messages"] },
		{ key: "p2", tabs: ["turn-line"] },
		{ key: "p3", tabs: ["composer"] }
	],
	right: []
}
const WITHOUT_BOX: PanelLayoutV2 = {
	version: 2,
	left: [],
	middle: [
		{ key: "p1", tabs: ["messages"] },
		{ key: "p2", tabs: ["turn-line"] },
		{ key: "p3", tabs: ["composer"] }
	],
	right: []
}
// A second Messages copy that claims the Sanctum through its stored settings.
const WITH_CLAIM: PanelLayoutV2 = {
	version: 2,
	left: [],
	middle: [
		{ key: "p1", tabs: ["messages"] },
		{ key: "p1b", tabs: ["messages#sanctum"] },
		{ key: "p3", tabs: ["composer"] }
	],
	right: []
}

function page(
	over: Record<string, unknown> = {},
	channels = ["main"]
): ConversationDossierV1 {
	return {
		composer: { channels },
		spokenPlayback: "auto",
		...over
	} as unknown as ConversationDossierV1
}

/** One mount: the derived the render holds, its run count, and the page input. */
function mount(
	layout: PanelLayoutV2,
	first: ConversationDossierV1,
	id: string
) {
	const manager = new SurfaceManager()
	manager.init(
		1,
		coreDefaultWidgets(true),
		{ panels: layout } as never,
		() => {}
	)
	let held = $state.raw(first)
	let runs = 0
	let seen: ConversationDossierV1 | null = null
	roots.push(
		$effect.root(() => {
			const model = createSessionLayoutModel({
				manager,
				editing: false,
				working: null,
				get conversationDossier() {
					return held
				},
				panelsCtx: undefined,
				widgetLabel: (i: string) => i
			} as never)
			const d = $derived.by(() => {
				runs++
				return model.dossierFor(id)
			})
			// The render reads the derived in the template; an effect stands in.
			$effect(() => {
				seen = d
			})
		})
	)
	flushSync()
	return {
		get runs() {
			return runs
		},
		get seen() {
			return seen
		},
		get page() {
			return held
		},
		// Hand the page dossier: the same reference again, or a new one.
		hand(next: ConversationDossierV1) {
			held = next
			flushSync()
		}
	}
}

/** 50 rounds of the same page dossier handed again: no rerun, one reference. */
function holdRounds(m: ReturnType<typeof mount>, label: string) {
	const runs0 = m.runs
	const ref = m.seen
	expect(ref).not.toBeNull()
	for (let i = 0; i < 50; i++) {
		m.hand(m.page)
		expect(m.seen).toBe(ref)
	}
	console.log(`${label}: reruns over 50 held rounds = ${m.runs - runs0}`)
	expect(m.runs).toBe(runs0)
	return ref!
}

describe("dossierFor keeps its reference while its inputs hold", () => {
	test("1. a Messages copy nothing narrows: the page's own object", () => {
		const p = page()
		const m = mount(WITHOUT_BOX, p, "messages")
		expect(m.seen).toBe(p)
		holdRounds(m, "branch 1")
		const runs0 = m.runs
		const next = page({ settledThrough: 7 })
		m.hand(next)
		console.log(`branch 1: reruns after one change = ${m.runs - runs0}`)
		expect(m.runs).toBe(runs0 + 1)
		expect(m.seen).toBe(next)
	})

	test("2. a Messages copy that claims a channel: a spread", () => {
		setWidgetSettingValues({ "messages#sanctum": { channel: "sanctum" } })
		const p = page({}, ["main", "sanctum"])
		const m = mount(WITH_CLAIM, p, "messages#sanctum")
		expect(m.seen).not.toBe(p)
		expect(m.seen?.composer.channels).toEqual(["sanctum"])
		const ref = holdRounds(m, "branch 2")
		const runs0 = m.runs
		const next = page({ settledThrough: 7 }, ["main", "sanctum"])
		m.hand(next)
		console.log(`branch 2: reruns after one change = ${m.runs - runs0}`)
		expect(m.runs).toBe(runs0 + 1)
		expect(m.seen).not.toBe(ref)
		expect(m.seen).not.toBe(next)
		expect(
			(m.seen as never as { settledThrough: number }).settledThrough
		).toBe(7)
		expect(m.seen?.composer.channels).toEqual(["sanctum"])
	})

	test("3. a Messages copy while a Dialogue box is drawn: a spread", () => {
		const p = page()
		const m = mount(WITH_BOX, p, "messages")
		expect(m.seen).not.toBe(p)
		expect(m.seen?.spokenPlayback).toBe("click")
		const ref = holdRounds(m, "branch 3")
		const runs0 = m.runs
		const next = page({ settledThrough: 7 })
		m.hand(next)
		console.log(`branch 3: reruns after one change = ${m.runs - runs0}`)
		expect(m.runs).toBe(runs0 + 1)
		expect(m.seen).not.toBe(ref)
		expect(m.seen).not.toBe(next)
		expect(
			(m.seen as never as { settledThrough: number }).settledThrough
		).toBe(7)
		expect(m.seen?.spokenPlayback).toBe("click")
	})

	test("4. a Composer: a new object built per call", () => {
		const p = page()
		const m = mount(WITHOUT_BOX, p, "composer")
		expect(m.seen?.composer.target?.instance).toBe("messages")
		const ref = holdRounds(m, "branch 4 (composer)")

		// A real change of the page dossier.
		let runs0 = m.runs
		const next = page({ settledThrough: 7 })
		m.hand(next)
		console.log(`branch 4: reruns after a page change = ${m.runs - runs0}`)
		expect(m.runs).toBe(runs0 + 1)
		expect(m.seen).not.toBe(ref)
		expect(
			(m.seen as never as { settledThrough: number }).settledThrough
		).toBe(7)
		const afterPage = holdRounds(m, "branch 4 (composer, after change)")

		// A real change of its target copy's settings.
		runs0 = m.runs
		setWidgetSettingValues({ messages: { lineWidth: "full" } })
		flushSync()
		console.log(
			`branch 4: reruns after a settings change = ${m.runs - runs0}`
		)
		expect(m.runs).toBe(runs0 + 1)
		expect(m.seen).not.toBe(afterPage)
		expect(m.seen?.composer.target?.lineWidth).toBe("full")
		const afterSettings = holdRounds(
			m,
			"branch 4 (composer, after settings)"
		)

		// An equal write: the store replaces its whole map, so the derived reads a
		// new value and may rerun. Observed below; the wire's JSON fallback covers
		// an equal new object, so this costs one serialise, not a missed change.
		runs0 = m.runs
		setWidgetSettingValues({ messages: { lineWidth: "full" } })
		flushSync()
		const equalReruns = m.runs - runs0
		console.log(
			`branch 4: reruns after an equal settings write = ${equalReruns}`
		)
		expect(m.seen?.composer.target?.lineWidth).toBe("full")
		expect(m.seen).toEqual(afterSettings)
		if (equalReruns === 0) expect(m.seen).toBe(afterSettings)
		else expect(m.seen).not.toBe(afterSettings)
	})

	test("4. a Turn line: a new object built per call", () => {
		const p = page()
		const m = mount(WITHOUT_BOX, p, "turn-line")
		expect(m.seen?.composer.target?.instance).toBe("messages")
		const ref = holdRounds(m, "branch 4 (turn line)")
		const runs0 = m.runs
		const next = page({ settledThrough: 7 })
		m.hand(next)
		console.log(
			`branch 4 (turn line): reruns after one change = ${m.runs - runs0}`
		)
		expect(m.runs).toBe(runs0 + 1)
		expect(m.seen).not.toBe(ref)
		expect(
			(m.seen as never as { settledThrough: number }).settledThrough
		).toBe(7)
	})
})
