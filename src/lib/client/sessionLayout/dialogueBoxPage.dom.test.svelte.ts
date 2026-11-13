/**
 * The page's Dialogue box rules in the layout model: the one automatic voice
 * (a Messages copy waits for a click while a box is drawn) and the shown line
 * dropping when no box is drawn.
 */
import { afterEach, describe, expect, test } from "vitest"
import { flushSync } from "svelte"
import type { PanelLayoutV2 } from "@serene-pub/sdk"
import type { ConversationDossierV1 } from "$lib/shared/widgets/conversation"
import { createSessionLayoutModel } from "./sessionLayoutModel.svelte"
import { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
import { coreDefaultWidgets } from "$lib/client/components/sessionPage/coreWidgets"
import {
	answerShowLine,
	clearShownLine,
	shownLineOf
} from "$lib/client/components/sessionPage/requests/showLine"

const roots: (() => void)[] = []
afterEach(() => {
	for (const stop of roots.splice(0)) stop()
	clearShownLine()
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

function dossier(spokenPlayback?: "auto" | "click" | "never") {
	return {
		composer: { channels: ["main"] },
		...(spokenPlayback ? { spokenPlayback } : {})
	} as unknown as ConversationDossierV1
}

function build(
	layout: PanelLayoutV2,
	page: ConversationDossierV1 | null = dossier("auto")
) {
	const manager = new SurfaceManager()
	manager.init(
		1,
		coreDefaultWidgets(true),
		{ panels: layout } as never,
		() => {}
	)
	let model!: ReturnType<typeof createSessionLayoutModel>
	roots.push(
		$effect.root(() => {
			model = createSessionLayoutModel({
				manager,
				editing: false,
				working: null,
				conversationDossier: page,
				panelsCtx: undefined,
				widgetLabel: (id: string) => id
			} as never)
		})
	)
	flushSync()
	return { model, manager }
}

describe("one automatic voice", () => {
	test("with a Dialogue box, a Messages copy's auto becomes click; never stays", () => {
		const page = dossier("auto")
		const { model } = build(WITH_BOX, page)
		expect(model.holdsDialogueBox).toBe(true)
		expect(model.dossierFor("messages")?.spokenPlayback).toBe("click")
		expect(page.spokenPlayback).toBe("auto")
		const never = dossier("never")
		expect(build(WITH_BOX, never).model.dossierFor("messages")).toBe(never)
		const click = dossier("click")
		expect(build(WITH_BOX, click).model.dossierFor("messages")).toBe(click)
	})

	test("an absent playback counts as auto", () => {
		const { model } = build(WITH_BOX, dossier())
		expect(model.dossierFor("messages")?.spokenPlayback).toBe("click")
	})

	test("a Composer and a Turn line are not changed", () => {
		const { model } = build(WITH_BOX)
		expect(model.dossierFor("composer")?.spokenPlayback).toBe("auto")
		expect(model.dossierFor("turn-line")?.spokenPlayback).toBe("auto")
	})

	test("with no Dialogue box the page's own object is handed", () => {
		const page = dossier("auto")
		const { model } = build(WITHOUT_BOX, page)
		expect(model.holdsDialogueBox).toBe(false)
		expect(model.dossierFor("messages")).toBe(page)
	})
})

describe("the shown line", () => {
	test("is dropped when the layout holds no Dialogue box", () => {
		answerShowLine({ messageId: 9 }, 1)
		build(WITHOUT_BOX)
		expect(shownLineOf(1)).toBeNull()
	})

	test("stays while a Dialogue box is drawn", () => {
		answerShowLine({ messageId: 9 }, 1)
		build(WITH_BOX)
		expect(shownLineOf(1)).toBe(9)
	})

	test("is dropped by a switch to a layout without a box", () => {
		const { manager } = build(WITH_BOX)
		answerShowLine({ messageId: 9 }, 1)
		flushSync()
		expect(shownLineOf(1)).toBe(9)
		// A switch: the arrangement changes and the box is not active.
		manager.setPanels(WITHOUT_BOX)
		manager.close("dialogue-box")
		flushSync()
		expect(shownLineOf(1)).toBeNull()
	})

	test("is dropped when the page goes", () => {
		build(WITH_BOX)
		answerShowLine({ messageId: 9 }, 1)
		for (const stop of roots.splice(0)) stop()
		expect(shownLineOf(1)).toBeNull()
	})
})
