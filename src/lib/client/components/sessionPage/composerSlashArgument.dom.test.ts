/**
 * Lair pass S2 (owner ruling 4, 2026-09-28): a slash command with text works
 * as well as the modal. Core's composer, the BUILT module mounted by the
 * SDK's harness in core's box, with a palette of the Lair's shapes:
 *
 * - `/nudge go north` + Enter presses Nudge with its **slash argument** as the
 *   text, and keeps the draft for the host's run to spend (D1);
 * - `/nudge` alone presses it bare (the page opens the collect modal);
 * - `/advance x` is pressed with its text, and the page refuses it
 *   (`routePress`) — the draft stays, and the footer says why beforehand;
 * - Send runs a slash command where Enter writes a new line (a phone);
 * - a palette row hints the argument; the placeholder names the
 *   `playerLabel`; a shared session's persona-less line shows its member.
 *
 * The page's half — refusal, the prefilled modal, the fire — is `routePress`
 * (collects.test.ts); the clear is `shouldClearDraft` over the composer's
 * reported draft, driven here as the page drives it.
 */
import { describe, expect, test } from "vitest"
import { realpathSync } from "node:fs"
import { resolve } from "node:path"
import { mountComponent, type MountedComponent } from "@serene-pub/cli/testing"
import { componentParitySections } from "@serene-pub/conformance"
import { nextDraftWrite, routePress, shouldClearDraft, type DraftWrite, type ListedCollects } from "./collects"
import { answerDraft } from "./requests/draft"

const CORE_CATALOG = realpathSync(resolve(process.cwd(), "node_modules/@serene-pub/core-catalog"))
const FIELD = "sp-composer-field"

const row = (over: { key: string; specSlug: string; name: string; slash: string; collects?: ListedCollects }) => ({
	audience: { act: ["owner"] },
	canAct: true,
	isNew: false,
	venue: "composer",
	enabled: true,
	...over
})
const NUDGE_COLLECTS: ListedCollects = { text: { need: "required", label: "Direction the party should feel" } }
const WHISPER_COLLECTS: ListedCollects = {
	recipients: { label: "Who hears it", min: 1 },
	text: { need: "required", label: "What do you whisper?" }
}
const ROOM_COLLECTS: ListedCollects = { text: { need: "optional", label: "Describe the room" } }
const PALETTE = [
	row({ key: "nudge", specSlug: "core:spec/lair-nudge", name: "Nudge", slash: "nudge", collects: NUDGE_COLLECTS }),
	row({ key: "whisper", specSlug: "core:spec/lair-whisper", name: "Whisper", slash: "whisper", collects: WHISPER_COLLECTS }),
	row({ key: "room", specSlug: "core:spec/lair-room-answer", name: "Answer the door", slash: "room", collects: ROOM_COLLECTS }),
	row({ key: "narrate", specSlug: "core:spec/narrate", name: "Narrate", slash: "narrator" })
]
const byIdentity = (identity: string) =>
	PALETTE.find((a) => `${a.specSlug}#${a.key}` === identity) as
		| { slash: string; name: string; collects?: ListedCollects }
		| undefined

/** The page, as far as the composer's draft and a Lair session go. */
class Page {
	newMessage = ""
	draft: DraftWrite = { content: "", write: 0 }
	view!: MountedComponent
	constructor(private opts: { tier?: string; member?: string } = {}) {}
	writeDraft(content: string) {
		this.newMessage = content
		this.draft = nextDraftWrite(this.draft, content)
	}
	dossier() {
		const sections = componentParitySections() as { scoped: { session_full: Record<string, any> } }
		const full = sections.scoped.session_full
		const lines = { ...full.lines }
		if (this.opts.member)
			lines[1] = {
				...lines[1],
				speaker: { name: "Dungeon Master", ref: null, face: null, sprite: null, member: this.opts.member }
			}
		return {
			...full,
			lines,
			composer: {
				...full.composer,
				draft: this.draft,
				personas: [],
				personaId: null,
				playerLabel: "Dungeon Master",
				palette: PALETTE
			}
		}
	}
	async open() {
		const sections = componentParitySections() as Record<string, any>
		this.view = await mountComponent({
			root: CORE_CATALOG,
			entry: "dist/components/messages.js",
			owner: "core",
			coreConversation: true,
			timeoutMs: 60_000,
			requests: (kind, params) => {
				if (kind === "draft") return answerDraft(params, { setDraft: (c) => (this.newMessage = c) })
				return new Promise(() => {})
			},
			context: {
				...sections,
				...(this.opts.tier ? { layout: { tier: this.opts.tier } } : {}),
				scoped: { session_full: this.dossier() }
			} as never
		})
		await this.quiet()
		return this
	}
	async quiet() {
		await new Promise((r) => setTimeout(r, 400))
		await this.view.settle()
	}
	field() {
		return this.view.query(FIELD)!.getAttribute("value")
	}
	async type(text: string) {
		await this.view.dispatch(FIELD, "input", { value: text })
		await this.quiet()
	}
	async enter() {
		await this.view.dispatch(FIELD, "key", { key: "Enter", shift: false })
		await this.quiet()
	}
	/** The page's answer to the last press, as `fireOfferedAction` routes it. */
	lastRoute() {
		const inv = this.view.invoked.at(-1)!
		return routePress(byIdentity(inv.key), inv.text !== undefined ? { text: inv.text } : undefined, inv.key)
	}
	/** The run landed: the page spends the draft it carried (D1). */
	async landed(sent: string) {
		if (shouldClearDraft({ success: true }, sent, this.newMessage)) this.writeDraft("")
		await this.view.push("scoped", { session_full: this.dossier() } as never)
		await this.quiet()
	}
}

describe("S2 · slash arguments in core's composer", () => {
	test("/nudge go north + Enter presses Nudge with the argument; the landed run spends the draft", async () => {
		const page = await new Page().open()
		try {
			await page.type("/nudge go north")
			await page.enter()
			expect(page.view.invoked).toEqual([{ key: "core:spec/lair-nudge#nudge", text: "go north" }])
			expect(page.lastRoute()).toEqual({ route: "fire", collected: { text: "go north" } })
			// Kept until the run answers: an error must not lose it.
			expect(page.newMessage).toBe("/nudge go north")
			await page.landed("go north")
			expect(page.field()).toBe("")
			expect(page.newMessage).toBe("")
		} finally {
			await page.view.unmount()
		}
	}, 120_000)

	test("a bare /nudge presses it with no text (the page opens the modal) and empties the field", async () => {
		const page = await new Page().open()
		try {
			await page.type("/nudge")
			await page.enter()
			expect(page.view.invoked).toEqual([{ key: "core:spec/lair-nudge#nudge" }])
			expect(page.lastRoute()).toEqual({ route: "modal", initialText: "" })
			// The draft was only the name: it goes now.
			expect(page.newMessage).toBe("")
		} finally {
			await page.view.unmount()
		}
	}, 120_000)

	test("/whisper hold opens Whisper's modal prefilled, since an argument cannot carry who", async () => {
		const page = await new Page().open()
		try {
			await page.type("/whisper hold")
			await page.enter()
			expect(page.view.invoked).toEqual([{ key: "core:spec/lair-whisper#whisper", text: "hold" }])
			expect(page.lastRoute()).toEqual({ route: "modal", initialText: "hold" })
		} finally {
			await page.view.unmount()
		}
	}, 120_000)

	test("/room <text> is the room's description: it fires with it", async () => {
		const page = await new Page().open()
		try {
			await page.type("/room A mossy crypt,\ndripping.")
			await page.enter()
			expect(page.view.invoked).toEqual([
				{ key: "core:spec/lair-room-answer#room", text: "A mossy crypt,\ndripping." }
			])
			expect(page.lastRoute()).toEqual({ route: "fire", collected: { text: "A mossy crypt,\ndripping." } })
		} finally {
			await page.view.unmount()
		}
	}, 120_000)

	test("/narrator x: the footer says it takes no text, the page refuses the press, the draft stays", async () => {
		const page = await new Page().open()
		try {
			await page.type("/narrator the rain stops")
			const hint = page.view.query('[data-widget-part~="messages.composer-hint"]')
			expect(hint?.hasAttribute("data-refused")).toBe(true)
			expect(hint?.textContent?.trim()).toBe("/narrator takes no text.")
			await page.enter()
			expect(page.lastRoute()).toEqual({ route: "refuse", reason: "/narrator takes no text" })
			expect(page.newMessage).toBe("/narrator the rain stops")
		} finally {
			await page.view.unmount()
		}
	}, 120_000)

	test("on a phone Enter keeps writing the argument; Send runs the command", async () => {
		const page = await new Page({ tier: "compact" }).open()
		try {
			await page.type("/nudge go north")
			expect(page.view.query(FIELD)!.getAttribute("keys") ?? "").not.toContain("Enter")
			await page.view.dispatch(FIELD, "submit", { value: "/nudge go north" })
			await page.quiet()
			expect(page.view.invoked).toEqual([{ key: "core:spec/lair-nudge#nudge", text: "go north" }])
			// A command is never sent as a line.
			expect(page.view.requested.filter((r) => r.kind === "send")).toEqual([])
		} finally {
			await page.view.unmount()
		}
	}, 120_000)

	test("palette rows hint the argument each action takes", async () => {
		const page = await new Page().open()
		try {
			await page.type("/")
			const rows = page.view.queryAll('[data-widget-part~="messages.composer-palette-row"]')
			const said = rows.map((r) => ({
				slash: r.querySelector('[data-widget-part~="messages.composer-palette-slash"]')?.textContent,
				argument: r.querySelector('[data-widget-part~="messages.composer-palette-argument"]')?.textContent ?? null
			}))
			expect(said).toEqual([
				{ slash: "/nudge", argument: "<direction the party should feel>" },
				{ slash: "/whisper", argument: "<what do you whisper>" },
				{ slash: "/room", argument: "[<describe the room>]" },
				{ slash: "/narrator", argument: null }
			])
		} finally {
			await page.view.unmount()
		}
	}, 120_000)

	test("writing as no persona in a genre with a playerLabel: 'Write as the Dungeon Master…'", async () => {
		const page = await new Page().open()
		try {
			expect(page.view.query(FIELD)!.getAttribute("placeholder")).toBe("Write as the Dungeon Master…")
		} finally {
			await page.view.unmount()
		}
	}, 120_000)

	test("a shared session's persona-less line shows its member after the name", async () => {
		const page = await new Page({ member: "jody" }).open()
		try {
			const line = page.view.query('[data-message-id="1"]') ?? page.view.queryAll('[data-widget-part~="messages.message"]')[0]!
			expect(line.querySelector('[data-widget-part~="messages.message-name"]')?.textContent?.trim()).toBe(
				"Dungeon Master"
			)
			expect(line.querySelector('[data-widget-part~="messages.message-member"]')?.textContent?.trim()).toBe(
				"· jody"
			)
			expect(line.getAttribute("aria-label")).toContain("from Dungeon Master · jody:")
			// One member: no suffix — the page sends `member` only for more than one.
			const other = page.view.queryAll('[data-widget-part~="messages.message-member"]')
			expect(other).toHaveLength(1)
		} finally {
			await page.view.unmount()
		}
	}, 120_000)
})
