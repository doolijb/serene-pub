import { beforeEach, describe, expect, test } from "vitest"
import {
	answerShowChannel,
	clearShownChannels,
	shownChannels
} from "./showChannel"

describe("show-channel", () => {
	beforeEach(() => clearShownChannels())

	test("sets, overwrites, and clears by instance id", () => {
		answerShowChannel({ channel: "main" }, { widgetId: "messages" })
		answerShowChannel(
			{ channel: "sanctum" },
			{ widgetId: "messages#sanctum" }
		)
		expect(shownChannels.get("messages")).toBe("main")
		answerShowChannel({ channel: "ooc" }, { widgetId: "messages" })
		expect(shownChannels.get("messages")).toBe("ooc")
		expect(shownChannels.get("messages#sanctum")).toBe("sanctum")
		clearShownChannels()
		expect(shownChannels.size).toBe(0)
	})

	test("the same value again writes nothing", () => {
		answerShowChannel({ channel: "main" }, { widgetId: "messages" })
		let writes = 0
		const set = shownChannels.set.bind(shownChannels)
		shownChannels.set = (k, v) => {
			writes++
			return set(k, v)
		}
		answerShowChannel({ channel: "main" }, { widgetId: "messages" })
		expect(writes).toBe(0)
		shownChannels.set = set
	})

	test("refuses a missing, blank, non-text or over-long channel", () => {
		const from = { widgetId: "messages" }
		expect(() => answerShowChannel({}, from)).toThrow(
			"needs the channel's name"
		)
		expect(() => answerShowChannel({ channel: "  " }, from)).toThrow(
			"needs the channel's name"
		)
		expect(() => answerShowChannel({ channel: 4 }, from)).toThrow(
			"needs the channel's name"
		)
		expect(() =>
			answerShowChannel({ channel: "x".repeat(201) }, from)
		).toThrow("at most 200")
		expect(shownChannels.size).toBe(0)
	})
})
