/**
 * 🚧 The filing tools (lane 2 of PLAN-genre-restructure, 2026-10-19):
 * `write_entry`, `remember`, `forget` and `generate_image` go through the
 * doors the host hands them, and say what happened — filed, or held for the
 * person — and refuse by name where no door is granted.
 */
import { describe, expect, it } from "vitest"
import { ToolError, type ToolContext } from "./index"
import { forget, generateImage, remember, WRITE_TOOL_NAMES, writeEntry } from "./writeTools"
import { TOOL_KINDS } from "./assistantTools"
import { coreTool } from "./coreTools"

const doors = (held: boolean) => {
	const filed: unknown[] = []
	const ctx: ToolContext = {
		read: async () => [],
		sessionId: 1,
		fileLore: async (entry) => {
			filed.push(entry)
			return { id: 5, lorebookId: 2, held, where: held ? "this session's own notes" : "the lorebook attached to this session" }
		},
		forgetLore: async (name) => ({ archived: name === "Tea" ? [9] : [] }),
		makeImage: async (prompt) => ({ messageId: 77, caption: prompt })
	}
	return { ctx, filed }
}

describe("the filing tools", () => {
	it("are core tools, offered under their kinds", () => {
		for (const name of WRITE_TOOL_NAMES) expect(coreTool(name), name).toBeTruthy()
		expect(TOOL_KINDS["lorebook-write"]).toEqual(["write_entry", "remember", "forget"])
		expect(TOOL_KINDS.image).toEqual(["generate_image"])
	})

	it("write_entry files by kind, and says whether it was filed or held", async () => {
		const full = doors(false)
		const out: any = await writeEntry.run({ name: "The Mill", content: "A ruin by the river.", kind: "place" }, full.ctx)
		expect(full.filed).toEqual([{ name: "The Mill", content: "A ruin by the river.", entryType: "core:entry/location" }])
		expect(out.held).toBe(false)
		expect(out.message).toContain("was filed in the lorebook attached")

		const review = doors(true)
		const held: any = await writeEntry.run({ name: "Tea", content: "Likes it green." }, review.ctx)
		expect(review.filed[0]).toMatchObject({ entryType: "core:entry/world-lore" })
		expect(held.message).toContain("waiting for the person")
	})

	it("remember titles a note from its words when none is given", async () => {
		const { ctx, filed } = doors(false)
		await remember.run({ content: "Their cat is called Miso and hates thunder." }, ctx)
		expect(filed[0]).toMatchObject({ name: "Their cat is called Miso and", entryType: "core:entry/world-lore" })
	})

	it("forget takes a kept note back, and says so when there is none", async () => {
		const { ctx } = doors(false)
		expect(((await forget.run({ name: "Tea" }, ctx)) as any).archived).toEqual([9])
		await expect(forget.run({ name: "Coffee" }, ctx)).rejects.toBeInstanceOf(ToolError)
	})

	it("generate_image posts through the host's door", async () => {
		const { ctx } = doors(false)
		expect(await generateImage.run({ prompt: "a lighthouse at dusk" }, ctx)).toMatchObject({ messageId: 77 })
	})

	it("with no door, each refuses in a sentence", async () => {
		const bare: ToolContext = { read: async () => [] }
		await expect(writeEntry.run({ name: "a", content: "b" }, bare)).rejects.toBeInstanceOf(ToolError)
		await expect(remember.run({ content: "b" }, bare)).rejects.toBeInstanceOf(ToolError)
		await expect(forget.run({ name: "a" }, bare)).rejects.toBeInstanceOf(ToolError)
		await expect(generateImage.run({ prompt: "x" }, bare)).rejects.toBeInstanceOf(ToolError)
	})
})
