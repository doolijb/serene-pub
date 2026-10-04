/**
 * Placed text goes at the end by default (owner ruling 2026-10-03).
 *
 * The post-history reminder and the author's note both default to depth 0:
 * right after the newest message, before the reply — the note first, then the
 * reminder, closest to the reply. "The end" has to mean the same place on
 * every wire: before the seed line on the completion wire, after the newest
 * message on the chat wire (where a label-only seed line is not sent), and
 * folded into the newest user line on a `midSystem: 'fold'` connection.
 *
 * Called on the `assemble` binding with the shipped template; the note
 * arrives as the context builder hands it, with NO depth, so the default is
 * what places it.
 */

import { describe, it, expect } from "vitest"
import { CORE_TEMPLATE_ENGINE } from "$lib/server/pipelines/prompt/renderers"
import { SHIPPED_CONTEXT_TEMPLATE } from "$lib/server/pipelines/entities/contextTemplateDefaults"
import { SEED_MESSAGE_ID } from "$lib/server/pipelines/prompt/messages"
import { AUTHORS_NOTE_DEPTH_DEFAULT } from "$lib/server/pipelines/prompt/authorsNote"

const ctx = { countTokens: (t: string) => Math.ceil(t.length / 4) } as any

const NOTE = "[The fog is lifting over the moor.]"
const REMINDER = "Stay in character."
const NEWEST = "Where do the riders patrol?"

const lines = [
	{ id: 1, role: "user", name: "Jody", message: "Hello there." },
	{ id: 2, role: "assistant", name: "Aria", message: "Well met." },
	{ id: 3, role: "user", name: "Jody", message: NEWEST },
	{ id: SEED_MESSAGE_ID, role: "assistant", name: "Aria", message: "" }
]

async function assemble(metadata: Record<string, unknown>) {
	const { coreBindings } = await import("$lib/server/pipelines/runtime/bindings")
	const result: any = await coreBindings()["core:task/assemble@2"]!(
		{
			template: { source: SHIPPED_CONTEXT_TEMPLATE, engine: CORE_TEMPLATE_ENGINE },
			decisions: [],
			messages: lines,
			budget: { total: 100_000 },
			templateContext: {
				instructions: "You're Aria.",
				postHistory: { targetIndex: 0, instructions: REMINDER, hasContent: true },
				// As the context builder hands it — no depth: the default places it.
				authorsNote: { text: NOTE, interval: 1, role: "system", hasContent: true, replyCount: 1 }
			},
			// No `postHistoryDepth`: its default places the reminder.
			params: { postHistoryTokenTrigger: 0 },
			connection: { metadata }
		},
		ctx
	)
	expect(result.kind).toBe("ok")
	return result.value
}

describe("placed text at the end, by default, on every wire", () => {
	it("defaults both to depth 0", async () => {
		expect(AUTHORS_NOTE_DEPTH_DEFAULT).toBe(0)
		const v = await assemble({ wireMode: "chat", midSystem: "keep" })
		expect(v.authorsNote).toMatchObject({ included: true, depth: 0, targetIndex: 3 })
		expect(v.postHistory).toMatchObject({ included: true, depth: 0, targetIndex: 3 })
	}, 60_000)

	it("completion wire: after the newest message, the note then the reminder, then the seed line", async () => {
		const v = await assemble({ wireMode: "completion" })
		const text = v.context.rendered as string
		expect(typeof text, JSON.stringify(v.context)).toBe("string")
		const newest = text.indexOf(NEWEST)
		const note = text.indexOf(NOTE)
		const reminder = text.indexOf(REMINDER)
		const seed = text.lastIndexOf("Aria:")
		expect(newest).toBeGreaterThan(text.indexOf("Well met."))
		expect(note).toBeGreaterThan(newest)
		expect(reminder).toBeGreaterThan(note)
		expect(seed).toBeGreaterThan(reminder)
		// Nothing of the conversation after the line the model continues.
		expect(text.slice(seed)).not.toContain(NEWEST)
	}, 60_000)

	it("chat wire, placed system text kept: the note and the reminder are the last messages", async () => {
		const v = await assemble({ wireMode: "chat", midSystem: "keep" })
		const msgs = v.context.messages as Array<{ role: string; content: string }>
		const newest = msgs.findIndex((m) => m.content.includes(NEWEST))
		const note = msgs.findIndex((m) => m.content.includes(NOTE))
		const reminder = msgs.findIndex((m) => m.content.includes(REMINDER))
		expect(msgs[newest].role).toBe("user")
		expect(note).toBeGreaterThan(newest)
		expect(msgs[note].role).toBe("system")
		expect(reminder).toBeGreaterThanOrEqual(note)
		expect(msgs[reminder].role).toBe("system")
		// The label-only seed line is not sent (B2): nothing follows them.
		expect(reminder).toBe(msgs.length - 1)
	}, 60_000)

	it("chat wire, placed system text folded: both ride the newest user line, after its words", async () => {
		const v = await assemble({ wireMode: "chat", midSystem: "fold" })
		const msgs = v.context.messages as Array<{ role: string; content: string }>
		const last = msgs[msgs.length - 1]
		expect(last.role).toBe("user")
		expect(last.content.indexOf(NEWEST)).toBeGreaterThan(-1)
		expect(last.content.indexOf(`[System note]\n${NOTE}`)).toBeGreaterThan(last.content.indexOf(NEWEST))
		expect(last.content.indexOf(REMINDER)).toBeGreaterThan(last.content.indexOf(NOTE))
		// Only the top system block stays a system message.
		expect(msgs.filter((m) => m.role === "system")).toHaveLength(1)
	}, 60_000)
})
