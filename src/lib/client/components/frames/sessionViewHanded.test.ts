/** 🚧 M1 fix: what a genre's session-view frame is handed — lore when the genre declares a lorebook, and a write grant per channel. */
import { describe, expect, test } from "vitest"
import { widgetRequestRefusal } from "@serene-pub/sdk"
import { sessionViewHanded } from "./sessionViewHanded"

describe("sessionViewHanded", () => {
	test("one write channel and grant per channel slug; lore only when declared", () => {
		expect(sessionViewHanded({ declaresLorebook: true, channels: ["main", "phone", "narration"] })).toEqual({
			writeChannels: ["main", "phone", "narration"],
			grants: ["lore", "channel:main:write", "channel:phone:write", "channel:narration:write"]
		})
		expect(sessionViewHanded({ declaresLorebook: false, channels: ["main", "main:2"] })).toEqual({
			writeChannels: ["main"],
			grants: ["channel:main:write"]
		})
	})

	test("the request door lets such a frame send on main and on a phone lane, and nowhere else", () => {
		const handed = sessionViewHanded({ declaresLorebook: true, channels: ["main", "phone"] })
		const from = { owner: "acme.world", grants: handed.grants, channels: handed.writeChannels }
		const send = (channel: string) => widgetRequestRefusal("send", from, { content: "hi", personaId: null, channel })
		expect(send("main")).toBeNull()
		expect(send("phone:12")).toBeNull()
		expect(send("ooc")).toMatch(/not one of this widget's channels/)
	})
})
