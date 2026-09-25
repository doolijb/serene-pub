/**
 * C0b's proof: core's messages widget, built by the CLI's component bundler
 * from the very source the page mounts natively, runs in a UI worker and
 * mirrors through the host-element vocabulary — rendering the log, following
 * a streamed reply, and editing a line through the `edit` verb.
 */
import { describe, expect, test } from "vitest"
import { resolve } from "node:path"
import { mountComponent } from "@serene-pub/cli/testing"
import type { ConversationDossierV1 } from "$lib/shared/widgets/conversation"

const APP = resolve(import.meta.dirname, "../../../../../..")

const row = (id: number, role: string, content: string, extra: Record<string, unknown> = {}) => ({
	id,
	role,
	content,
	channel: "main",
	characterId: role === "assistant" ? 3 : null,
	personaId: role === "user" ? 9 : null,
	createdAt: "2026-09-24T10:00:00Z",
	...extra
})
const line = (name: string) => ({
	controllable: true,
	speaker: { name, ref: null, face: null, sprite: null },
	swipes: { show: false, right: false },
	embedding: "hidden" as const
})
const facts: ConversationDossierV1 = {
	sessionId: 1,
	lines: { 1: line("You"), 2: line("Mira"), 3: line("Mira") },
	scenes: [],
	scened: [],
	hasOlder: false,
	loadingOlder: false,
	isOwner: true,
	cast: { sessionPersonas: [], sessionCharacters: [] },
	writes: { scenes: true, lore: true },
	debugPrompts: false,
	selectForSummary: 0,
	summaryEnded: 0,
	composer: {
		draft: "",
		personas: [{ personaId: 9, name: "You" }],
		personaId: 9,
		addPersona: false,
		hidden: false,
		channels: ["main"],
		usage: null,
		tabs: [],
		actions: false,
		notice: false,
		overflow: [],
		palette: [],
		newest: null,
		sendTonal: false
	},
	turn: { order: [], candidates: [], show: false, canChoose: false },
	readOnly: null,
	state: { ledgers: {}, pending: {}, waiting: [] },
	backdrop: false
}
const edit = {
	key: "edit",
	specSlug: "core",
	name: "Edit",
	icon: "pencil",
	slash: "edit",
	audience: { see: ["participant"], act: ["item"] },
	venue: "message",
	origin: "core",
	canAct: true,
	itemGated: true,
	isNew: false,
	enabled: true,
	quick: true
}

describe("core's messages widget as a remote (C0b)", () => {
	test("renders, streams and edits with no change to its source", { timeout: 120_000 }, async () => {
		const view = await mountComponent({
			root: APP,
			alias: { $lib: resolve(APP, "src/lib") },
			entry: "src/lib/client/components/sessionMessages/remote/messages-widget.ts",
			timeoutMs: 60_000,
			context: {
				session: { id: 1, name: "Proof" },
				messages: [row(1, "user", "Hello there"), row(2, "assistant", "Hi! *waves*")],
				settings: {},
				actions: { message: { primary: [edit], overflow: [] } },
				viewer: { userId: 1, isAdmin: false, isGuest: false },
				scoped: { session_full: facts }
			}
		})
		try {
			expect(view.refused).toEqual([])
			expect(view.queryAll(".sp-msg-name").map((n) => n.textContent?.trim())).toEqual(["You", "Mira"])
			expect(view.queryAll("sp-message-body").map((b) => b.getAttribute("text"))).toEqual([
				"Hello there",
				"Hi! *waves*"
			])

			// A reply streaming in: it arrives generating, grows, and settles.
			await view.push("messages", [
				row(1, "user", "Hello there"),
				row(2, "assistant", "Hi! *waves*"),
				row(3, "assistant", "Once upon", { isGenerating: true })
			])
			const last = () => view.queryAll("sp-message-body").at(-1)!
			expect(last().getAttribute("text")).toBe("Once upon")
			expect(last().hasAttribute("streaming")).toBe(true)
			await view.push("messages", [
				row(1, "user", "Hello there"),
				row(2, "assistant", "Hi! *waves*"),
				row(3, "assistant", "Once upon a time.")
			])
			expect(last().getAttribute("text")).toBe("Once upon a time.")
			expect(last().hasAttribute("streaming")).toBe(false)

			// Editing a line: its quick Edit, change the text, Save — the
			// widget's own edit mode, committed through the `edit` verb.
			const second = view.queryAll(".sp-msg")[1]!
			second.querySelector('button[aria-label="Edit"]')!.setAttribute("data-proof", "edit")
			await view.click('[data-proof="edit"]')
			expect(view.queryAll("textarea")).toHaveLength(1)
			await view.input("textarea", "Hi, friend!")
			const save = view.queryAll("button").find((b) => /save/i.test(b.textContent ?? ""))!
			save.setAttribute("data-proof", "save")
			await view.click('[data-proof="save"]')
			expect(view.invoked).toEqual([{ key: "edit", messageId: 2, payload: { content: "Hi, friend!" } }])
			expect(view.queryAll("textarea")).toHaveLength(0)
		} finally {
			await view.unmount()
		}
	})
})
