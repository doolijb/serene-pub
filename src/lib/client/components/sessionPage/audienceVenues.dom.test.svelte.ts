/**
 * An action outside the viewer's audience is hidden, not listed with a
 * refusal (Dungeon Crawler walk round 2, 2026-10-15: a guest saw _Rest_
 * with "'Rest' is not yours to use here — its audience is owner.").
 */
import { describe, expect, test, vi } from "vitest"
import { flushSync } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false, browser: true }))

import { createActionList } from "./actionList.svelte"
import { withinAudience } from "./audienceVenues"

const action = (key: string, over: Record<string, unknown> = {}) => ({
	key,
	specSlug: "dungeon-crawler",
	name: key,
	slash: key,
	quick: true,
	audience: { see: ["participant"], act: ["participant"] },
	origin: "genre",
	floor: false,
	canAct: true,
	itemGated: false,
	isNew: false,
	enabled: true,
	venue: "composer",
	...over
})
const REST = action("rest", { audience: { see: ["participant"], act: ["owner"] }, canAct: false })
const LOOK = action("look")
const EDIT = action("edit", { venue: "message", canAct: false, itemGated: true })

describe("the composer's actions for a guest", () => {
	test("an action whose audience excludes the viewer is not listed anywhere", () => {
		const handlers: Record<string, (m: any) => void> = {}
		const list = createActionList({
			socket: { emit() {} } as any,
			inbox: { on: (event: string, fn: (m: any) => void) => (handlers[event] = fn) } as any,
			sessionId: () => 5,
			data: {
				session: { id: 5, sessionMessages: [] },
				lastMessage: undefined,
				narratorName: "Narrator",
				needsPersona: false,
				sessionChannels: ["main"],
				messageVerbs: {},
				canControlMessage: () => false
			} as any
		})
		handlers["sessions:actions"]!({
			sessionId: 5,
			venues: {
				composer: { primary: [REST, LOOK], overflow: [] },
				message: { primary: [EDIT], overflow: [] }
			}
		})
		flushSync()
		expect(list.sessionActions.map((a: any) => a.key)).toEqual(["look"])
		expect(list.paletteActions.map((a: any) => a.key)).not.toContain("rest")
		expect(list.actionVenues.composer.overflow).toEqual([])
		// Item-gated stays: it is decided per message.
		expect(list.actionVenues.message.primary.map((a: any) => a.key)).toEqual(["edit"])
	})

	test("the pure filter keeps what the viewer may press", () => {
		const out = withinAudience({ composer: { primary: [REST, LOOK], overflow: [REST] } })
		expect(out.composer!.primary).toEqual([LOOK])
		expect(out.composer!.overflow).toEqual([])
	})
})
