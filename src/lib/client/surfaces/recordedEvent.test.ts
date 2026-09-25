/**
 * A package's recorded event reaches every widget (R56, E1d): the session
 * page hands the server's push to the manager, and the manager's one fan-out
 * delivers it — with no channel, so no widget's channel scope narrows it away.
 */
import { describe, expect, it } from "vitest"
import type { WidgetEvent } from "@serene-pub/sdk"
import { SurfaceManager } from "./panelManager.svelte"
import { eventInScope } from "$lib/shared/widgets/context"

describe("event:recorded", () => {
	it("fans out to every subscriber as one widget event, in scope for any channel set", () => {
		const m = new SurfaceManager()
		const heard: WidgetEvent[] = []
		const off = m.subscribe((e) => heard.push(e))
		m.announceRecordedEvent({
			event: "twenty:event/guessed@1",
			payload: { guess: "a lamp", verdict: "no" },
			at: 7
		})
		off()
		m.announceRecordedEvent({
			event: "twenty:event/guessed@1",
			payload: null,
			at: 8
		})
		expect(heard).toEqual([
			{
				kind: "event:recorded",
				event: "twenty:event/guessed@1",
				payload: { guess: "a lamp", verdict: "no" },
				at: 7
			}
		])
		expect(eventInScope(heard[0]!, ["cell-phone"])).toBe(true)
	})
})
