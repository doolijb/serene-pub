/**
 * 🚧 Admin › Rulesets › one ruleset — **the editor on the seven sections**
 * (PLAN-rulesets-functions D8, lane A4, 2026-10-23), screen by screen as the
 * design canvas draws them: the rail with its counts and _Playable now_;
 * **Attributes** with **What the model will read** beside them; **Functions**
 * as sentences with inline picks, the catalogue, a fork on **Change how it
 * works** and **Try this function**; **Entry types** and **Zone types** with
 * the sheet preview; **Playtest a scene** (run, run N times, save as a test)
 * and the **Handbook**. Save sends ONE `rulesets:saveDraft` with the whole
 * document, in the sections.
 *
 * ⚠ No DOM node is ever handed to `expect` (a failing assertion on one
 * serialises the whole happy-dom window): every check compares a boolean,
 * a string or plain data.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { emitted, socket, listeners, listen, request, gone, page, guards } = vi.hoisted(() => {
	const emitted: Array<[string, any]> = []
	const listeners = new Map<string, Set<(msg: any) => void>>()
	const listen = (key: string, handler: (msg: any) => void) => {
		let set = listeners.get(key)
		if (!set) listeners.set(key, (set = new Set()))
		set.add(handler)
		return () => set!.delete(handler)
	}
	const request = (key: string, params: unknown, handler: (msg: any) => void) => {
		emitted.push([key, params])
		return listen(key, handler)
	}
	return {
		emitted,
		request,
		socket: {
			emit: (event: string, payload: unknown) => emitted.push([event, payload]),
			on: () => {},
			off: () => {}
		},
		listeners,
		listen,
		gone: [] as Array<[string, unknown]>,
		/** 🚧 What the page told the Admin view about its unsaved edits (RF fix 2, item 5). */
		guards: [] as Array<{ dirty: () => boolean; save?: () => Promise<boolean> }>,
		page: {
			url: new URL("http://localhost/admin/rulesets/new"),
			params: {} as Record<string, string>
		}
	}
})
vi.mock("$lib/client/sockets/typedSocket", () => ({ useTypedSocket: () => socket }))
vi.mock("$lib/client/sockets/loadSockets.client", () => ({ useTypedSocket: () => socket }))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: listen,
	useInterest: listen,
	requestWithInterest: request,
	getAdminInterestContext: () => ({
		declareInterest: listen,
		useInterest: listen,
		requestWithInterest: request
	})
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { error: () => {}, warning: () => {}, info: () => {}, success: () => {} }
}))
vi.mock("$lib/client/admin/adminRouter.svelte", () => ({
	adminGoto: (path: string, opts?: unknown) => {
		gone.push([path, opts])
		return Promise.resolve()
	},
	adminPage: page,
	adminUnsavedEdits: (dirty: () => boolean, save?: () => Promise<boolean>) => void guards.push({ dirty, save }),
	adminRouter: { setQuery: () => {}, path: "/admin/rulesets" },
	interceptAdminLink: () => {}
}))
const store = new Map<string, string>()
vi.stubGlobal("localStorage", {
	getItem: (k: string) => store.get(k) ?? null,
	setItem: (k: string, v: string) => void store.set(k, v),
	removeItem: (k: string) => void store.delete(k)
})

import IdPage from "./IdPage.svelte"

const feed = (key: string, msg: unknown) => {
	for (const h of [...(listeners.get(key) ?? [])]) h(msg)
	flushSync()
}
const ctx = () => new Map<string, unknown>([["userCtx", { user: { id: 1, isAdmin: true } }]])
const settle = async () => {
	await tick()
	await Promise.resolve()
	flushSync()
}

let app: Record<string, any> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	listeners.clear()
	emitted.length = 0
	gone.length = 0
	guards.length = 0
	page.url = new URL("http://localhost/admin/rulesets/new")
})

function type(id: string, value: string) {
	const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement
	el.value = value
	el.dispatchEvent(new Event("input", { bubbles: true }))
	flushSync()
}
/** Type into the element a selector finds. */
function typeIn(selector: string, value: string) {
	const el = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement
	el.value = value
	el.dispatchEvent(new Event("input", { bubbles: true }))
	flushSync()
}
const button = (text: string) =>
	[...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined
const click = (el: Element | null | undefined) => {
	;(el as HTMLElement).click()
	flushSync()
}
const sent = (event: string) => emitted.filter(([e]) => e === event).map(([, p]) => p)
const text = (selector: string) => document.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim() ?? ""

const ID = "acme.lab:ruleset/hollow-hearts@1"
const COMPARE = "core:function/compare@1"
const RESTORE = "core:function/restore@1"
const SAME = "core:function/same-place@1"
const PUSH = "harbour:function/push-your-luck@1"
const listRow = (rulesetId: string, label: string, origin: string, over: Record<string, unknown> = {}) => ({
	rulesetId,
	label,
	name: label,
	description: "",
	origin,
	state: origin === "pub" ? "draft" : "shipped",
	version: null,
	draftChanged: false,
	draftFindings: 0,
	rollsDice: false,
	decides: true,
	playedBy: { sessions: 0, lorebooks: 0 },
	pluginName: null,
	...over
})
const choice = (id: string, name: string, kind: string, decl: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
	id,
	name,
	meaning: `${name}, in a sentence.`,
	kind,
	from: "core",
	source: "Serene Pub",
	decides: kind === "deciding",
	hasBody: !!decl.body,
	decl: { id, name: { en: name }, meaning: { en: `${name}, in a sentence.` }, kind, ...decl },
	...over
})
const CHOICES = [
	choice(COMPARE, "Compare against a target", "deciding", {
		prose: "Compare {{what}} against {{target}}.",
		bindings: { what: { to: "attribute" } },
		form: { target: { type: "integer", label: { en: "Target" } } }
	}),
	choice(RESTORE, "Restore a value", "value", {
		prose: "{{what}} comes back each morning.",
		bindings: { what: { to: "attribute" } },
		phases: ["effects"],
		body: "effects(ctx) {\n  return { deltas: [] }\n}"
	}),
	choice(SAME, "Same place", "scope", { prose: "Everyone in the same place." }),
	choice(PUSH, "Push your luck", "deciding", { prose: "Push your luck.", body: "before() {}" }, { from: "ruleset", source: "Harbour Pool" })
]
const DRAFT = {
	id: ID,
	version: "1.0.0",
	name: { en: "Hollow Hearts" },
	attributes: [
		{ id: "affection", name: { en: "Affection" }, kind: "number", bounds: { min: 0, max: 10 }, carriedBy: ["cast"], visibility: "holder", tags: ["relationship"], prose: "How much someone likes you.", shownAs: "bar" },
		{ id: "nerve", name: { en: "Nerve" }, kind: "pool", bounds: { min: 0, max: 3 }, prose: "Spent to do something brave.", shownAs: "pips" }
	],
	functions: [{ ref: COMPARE, key: "confession", bindings: { what: "affection" }, options: { target: 7 } }],
	entryTypes: [{ id: "keepsakes", name: { en: "Keepsake" }, prose: "Something given that means something.", tags: ["gift"] }],
	zoneTypes: [{ id: "shelf", name: { en: "Shelf" }, owners: ["cast"], holds: ["keepsakes"], limit: 6, visibility: "everyone", prose: "Keepsakes on display." }],
	outcomes: [
		{ id: "awkward", label: { en: "awkward" } },
		{ id: "warmed", label: { en: "warmed" } }
	],
	library: {
		rows: {
			keepsakes: [
				{ id: "note", version: "1.0.0", piece: { name: "Dov's note" } },
				{ id: "flower", version: "1.0.0", piece: { name: "A pressed flower" } }
			]
		}
	}
}
const detailRow = (over: Record<string, unknown> = {}) => ({
	...listRow(ID, "Hollow Hearts", "pub"),
	basedOn: null,
	basedOnName: null,
	draft: DRAFT,
	published: null,
	findings: [],
	upgradeFindings: [],
	ownSlots: [],
	slotChoices: [],
	derivedEntryTypes: [],
	scriptChoices: [],
	playtest: null,
	vocabularyChoices: [],
	functionChoices: CHOICES,
	...over
})
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function open(view = "", over: Record<string, unknown> = {}, id = ID) {
	page.url = new URL(`http://localhost/admin/rulesets/${encodeURIComponent(id)}${view ? `?view=${view}` : ""}`)
	page.params = { id: encodeURIComponent(id) }
	app = mount(IdPage, { target: document.body, context: ctx() })
	flushSync()
	feed("rulesets:detail", { ruleset: detailRow(over) })
}
/** The draft the one Save sent. */
async function saved(): Promise<any> {
	click(button("Save and continue editing"))
	await settle()
	const drafts = sent("rulesets:saveDraft")
	expect(drafts.length).toBe(1)
	return drafts[0].draft
}
/** Open an inline pick by the start of its name, then pick a value. */
function pick(label: string, value: string) {
	const trigger = [...document.querySelectorAll("button[aria-haspopup=listbox]")].find((b) => b.getAttribute("aria-label")?.startsWith(label))
	expect(!!trigger).toBe(true)
	click(trigger)
	click(document.querySelector(`[role=listbox] [data-pick="${value}"]`))
}
const reply = (event: string, result: unknown) => {
	const last = sent(event).at(-1) as { runId?: string }
	feed(event, { rulesetId: ID, runId: last?.runId, ...(result as object) })
}
const RESULT = (over: Record<string, unknown> = {}) => ({
	mode: "resolve",
	findings: [],
	blocks: [{ key: "sections", text: "Hollow Hearts.\nAffection (0–10): How much someone likes you.", tokens: 112, depth: "full", priority: 100 }],
	facts: {},
	outcomes: [],
	explain: [],
	rejected: [],
	changes: [],
	sample: { key: "sample:1", name: "Wren", stats: [], pieces: {} },
	party: [],
	...over
})

describe("the rail and Attributes", () => {
	test("opens on Attributes; the rail counts each section; every attribute with its sentence is Playable now", async () => {
		open()
		expect(document.querySelector("[data-view]")?.getAttribute("data-view")).toBe("attributes")
		const counts = Object.fromEntries([...document.querySelectorAll("[data-rail-count]")].map((c) => [c.getAttribute("data-rail-count"), c.textContent?.trim()]))
		expect(counts).toEqual({ attributes: "2", functions: "1", entryTypes: "1", zoneTypes: "1", outcomes: "2", library: "2", options: "0" })
		expect(document.querySelector("[data-playable]")?.getAttribute("data-playable")).toBe("success")
		expect(text("[data-playable]")).toContain("Two attributes with their sentences is a complete ruleset.")
		const row = text('[data-attribute="affection"]')
		expect(row).toContain("A number, 0 to 10")
		expect(row).toContain("Each character")
		expect(row).toContain("The holder · may show it")
		expect(row).toContain("Changed by: anyone")
		expect(row).toContain("A function uses it: confession")
	})

	test("What the model will read runs the draft for the scene's first member, shows its text and the prompt cost", async () => {
		open()
		await wait(520)
		const runs = sent("rulesets:tryOut") as any[]
		expect(runs.length).toBe(1)
		expect(runs[0]).toMatchObject({ rulesetId: ID, rigour: "mechanics", party: [{ name: "Wren", stats: {}, pieces: { keepsakes: ["note"] } }] })
		expect(runs[0].document).toBeUndefined()
		reply("rulesets:tryOut", { result: RESULT() })
		await settle()
		expect(text("[data-model-reads-text]")).toContain("Affection (0–10): How much someone likes you.")
		expect(text("[data-prompt-cost]")).toContain("112 tokens of 1,500 suggested")
		expect(text("[data-model-reads]")).toContain("For a sample character, Wren.")
	})

	test("an attribute added — a name, words, a sentence — is saved with the others untouched, in the sections", async () => {
		open()
		click(document.querySelector("[data-add-attribute]"))
		const rows = [...document.querySelectorAll("[data-attribute]")]
		expect(rows.length).toBe(3)
		const nameInput = rows[2]!.querySelector("input[id^=attr-name-]") as HTMLInputElement
		nameInput.value = "Mood"
		nameInput.dispatchEvent(new Event("input", { bubbles: true }))
		flushSync()
		pick("Kind of Mood", "label")
		typeIn('[data-attribute="mood"] input[id^=attr-of-]', "shy, warm, guarded")
		typeIn('[data-attribute="mood"] textarea[id^=attr-prose-]', "The mood they are in right now.")
		pick("Who sees Mood", "everyone")
		expect(text('[data-attribute="mood"]')).toContain("Words: shy · warm · guarded")
		const draft = await saved()
		expect(draft.attributes.slice(0, 2)).toEqual(DRAFT.attributes)
		expect(draft.attributes[2]).toEqual({
			id: "mood",
			name: { en: "Mood" },
			kind: "label",
			of: ["shy", "warm", "guarded"],
			visibility: "everyone",
			prose: "The mood they are in right now."
		})
		expect(draft.stats).toBeUndefined()
	})

	test("a shipped ruleset reads the same, with no Save and Copy… instead", () => {
		open("", { rulesetId: "core:ruleset/hollow@1", origin: "core", state: "shipped", draft: null, published: { ...DRAFT, id: "core:ruleset/hollow@1" } }, "core:ruleset/hollow@1")
		expect(text("[data-view]")).toContain("Affection")
		expect(button("Save and continue editing")).toBeUndefined()
		expect(document.querySelectorAll("input[id^=attr-name-]").length).toBe(0)
		expect([...document.querySelectorAll("a")].some((a) => a.getAttribute("href") === `/admin/rulesets/new?from=${encodeURIComponent("core:ruleset/hollow@1")}`)).toBe(true)
		expect(document.querySelectorAll("[data-add-attribute]").length).toBe(0)
	})
})

describe("Functions", () => {
	test("a function reads as a sentence: its binding and option inline, outcomes in your words, what it reads as", () => {
		open("functions")
		const row = '[data-function="confession"]'
		expect(text(`${row} [data-function-sentence]`)).toContain("Compare")
		expect(text(`${row} [data-function-sentence]`)).toContain("Affection")
		expect((document.querySelector(`${row} [data-function-sentence] input`) as HTMLInputElement).value).toBe("7")
		expect(text(`${row} [data-reads-as]`)).toBe("Reads as: “Compare Affection against 7.”")
		expect(text(row)).toContain("awkward")
		expect(text(row)).toContain("warmed")
		expect(text(row)).toContain("from the catalogue · no code")
		pick("what of Compare against a target", "nerve")
		typeIn(`${row} [data-function-sentence] input`, "5")
		expect(text(`${row} [data-reads-as]`)).toBe("Reads as: “Compare Nerve against 5.”")
	})

	test("the catalogue adds a reference; one from another ruleset is forked in; Save writes them all", async () => {
		open("functions")
		expect(text("[data-catalogue]")).toContain("core · your 1 other ruleset")
		click(document.querySelector(`[data-catalogue-choice="${RESTORE}"]`))
		click(document.querySelector(`[data-catalogue-choice="${PUSH}"]`))
		expect([...document.querySelectorAll("[data-function]")].map((f) => f.getAttribute("data-function"))).toEqual(["confession", "restore-a-value", "push-your-luck"])
		pick("what of Restore a value", "nerve")
		expect(text('[data-function="restore-a-value"] [data-reads-as]')).toBe("Reads as: “Nerve comes back each morning.”")
		const draft = await saved()
		expect(draft.functions[0]).toEqual(DRAFT.functions[0])
		expect(draft.functions[1]).toEqual({ ref: RESTORE, key: "restore-a-value", bindings: { what: "nerve" } })
		expect(draft.functions[2]).toMatchObject({ ref: "acme.lab:function/hollow-hearts-push-your-luck@1", key: "push-your-luck", module: { id: "acme.lab:function/hollow-hearts-push-your-luck@1", forkedFrom: PUSH, body: "before() {}" } })
	})

	test("a body is read-only by reference; Change how it works forks it into the ruleset", async () => {
		open("functions")
		click(document.querySelector(`[data-catalogue-choice="${RESTORE}"]`))
		const row = '[data-function="restore-a-value"]'
		click(document.querySelector(`${row} [data-function-body-toggle]`))
		expect(document.querySelector(`${row} [data-function-body] .cm-content`)?.getAttribute("contenteditable")).toBe("false")
		click(document.querySelector(`${row} [data-fork-function]`))
		expect(text(`${row} [data-function-body]`)).toContain(`Your copy of ${RESTORE}`)
		expect(document.querySelector(`${row} [data-function-body] .cm-content`)?.getAttribute("contenteditable")).toBe("true")
		const draft = await saved()
		expect(draft.functions[1]).toMatchObject({ ref: "acme.lab:function/hollow-hearts-restore@1", module: { forkedFrom: RESTORE, phases: ["effects"] } })
	})

	test("Try this function sends its key with the unsaved draft and says what it reads as", async () => {
		open("functions")
		pick("what of Compare against a target", "nerve")
		click(document.querySelector('[data-function="confession"] [data-try-function]'))
		const run = (sent("rulesets:tryOut") as any[]).find((p) => p.fn)!
		expect(run).toMatchObject({ rulesetId: ID, fn: "confession" })
		expect(run.document.functions[0].bindings).toEqual({ what: "nerve" })
		reply("rulesets:tryOut", { result: RESULT({ function: { key: "confession", ref: COMPARE, readsAs: "Compare Nerve against 7.", ran: false } }) })
		await settle()
		expect(text("[data-tried]")).toContain("Reads as: “Compare Nerve against 7.”")
		expect(text("[data-tried]")).toContain("read, not run")
	})
})

describe("Entry types and zone types", () => {
	test("an entry type's card: its shape, who sees it, its library rows and the functions on it; one added is saved", async () => {
		open("entryTypes")
		const card = '[data-entry-type="keepsakes"]'
		expect(text(card)).toContain("Keepsake")
		expect(text(card)).toContain("held")
		expect(text(card)).toContain("Tags: gift")
		expect(text(`${card} [data-entry-shape]`)).toBe("name · description")
		expect(text(card)).toContain("2 rows · in the lorebook")
		click(document.querySelector("[data-add-entry-type]"))
		const added = [...document.querySelectorAll("[data-entry-type]")].at(-1)!
		const name = added.querySelector("input[id^=et-name-]") as HTMLInputElement
		name.value = "Bond"
		name.dispatchEvent(new Event("input", { bubbles: true }))
		flushSync()
		typeIn('[data-entry-type="bond"] textarea', "A tie between two people.")
		click([...document.querySelectorAll('[data-entry-type="bond"] input[type=checkbox]')][0])
		const draft = await saved()
		expect(draft.entryTypes[0]).toEqual(DRAFT.entryTypes[0])
		expect(draft.entryTypes[1]).toEqual({ id: "bond", name: { en: "Bond" }, prose: "A tie between two people.", relational: true })
	})

	test("zone types: only the author's own (the carried list is no card); one added says where it is held; the sheet sketches the first member", async () => {
		open("zoneTypes")
		// 🚧 RF fix 2, item 4: the host's carried list is never a zone-type card, nor counted.
		expect(!!document.querySelector('[data-zone-type="carried"]')).toBe(false)
		expect(text('[data-rail-count="zoneTypes"]')).toBe("1")
		expect(text("[data-zone-fallback]")).toContain("lives with what someone carries")
		expect(text('[data-zone-type="shelf"]')).toContain("Holds: Keepsake")
		expect(text('[data-zone-type="shelf"]')).toContain("Limit: 6")
		expect(text('[data-sheet-zone="shelf"]')).toContain("Wren · Shelf")
		expect(text('[data-sheet-zone="shelf"]')).toContain("Dov's note")
		expect([...document.querySelectorAll("[data-shown-as]")].map((e) => e.getAttribute("data-shown-as"))).toEqual(["bar", "pips"])
		click(document.querySelector("[data-add-zone-type]"))
		const added = [...document.querySelectorAll("[data-zone-type]")].at(-1)!
		const name = added.querySelector("input[id^=zt-name-]") as HTMLInputElement
		name.value = "Pocket"
		name.dispatchEvent(new Event("input", { bubbles: true }))
		flushSync()
		typeIn('[data-zone-type="pocket"] textarea', "What someone keeps to themselves.")
		pick("Who sees what is in Pocket", "holder")
		const draft = await saved()
		expect(draft.zoneTypes[1]).toEqual({ id: "pocket", name: { en: "Pocket" }, owners: ["cast"], holds: "*", visibility: "holder", prose: "What someone keeps to themselves." })
	})
})

describe("Playtest a scene and the Handbook", () => {
	const PLAYTEST = {
		party: [
			{ name: "Wren", stats: { [`acme.lab.hollow-hearts:slot/affection@1`]: 6 }, pieces: { keepsakes: ["note"] } },
			{ name: "Mara", stats: {} }
		],
		situation: { en: "The pier at dusk." },
		change: { owner: "Wren", op: "use", check: "confession", aimedAt: "Mara" }
	}

	test("Run the scene sends the party by slot and the change; what happened reads in the ruleset's words", async () => {
		open("playtest", { playtest: PLAYTEST })
		expect((document.querySelector("[data-scene] textarea") as HTMLTextAreaElement).value).toBe("The pier at dusk.")
		click(document.querySelector("[data-run-scene]"))
		const run = (sent("rulesets:tryOut") as any[]).at(-1)!
		expect(run.party[0]).toEqual({ name: "Wren", stats: { "acme.lab.hollow-hearts:slot/affection@1": 6 }, pieces: { keepsakes: ["note"] } })
		expect(run.deltas).toEqual([{ owner: "Wren", aimedAt: "Mara", op: "use", check: "confession" }])
		expect(run.scripts).toBe(true)
		reply("rulesets:tryOut", {
			result: RESULT({
				mode: "apply",
				outcomes: [{ owner: "sample:1", kind: "check", text: "A confession to Mara: 7 against 7", check: { selector: "confession", label: "warmed" } }],
				explain: [{ target: "x", total: 7, terms: [], text: "7 = Affection 7" }],
				changes: [{ owner: { kind: "session_cast", id: 1 }, slotId: "acme.lab.hollow-hearts:slot/affection@1", op: "add", value: 1 }]
			})
		})
		await settle()
		expect(text("[data-outcome-line]")).toBe("Wren — A confession to Mara: 7 against 7 — warmed")
		expect(text("[data-changes]")).toContain("Mara · Affection + 1")
		expect(text("[data-changes]")).toContain("proposed")
	})

	test("Run it N times sends the count; the tally is drawn; Save as a test keeps the scene in the draft", async () => {
		open("playtest", { playtest: PLAYTEST })
		typeIn('input[aria-label="How many times"]', "50")
		click(document.querySelector("[data-run-repeat]"))
		const run = (sent("rulesets:tryOut") as any[]).at(-1)!
		expect(run).toMatchObject({ repeat: 50, scripts: false })
		reply("rulesets:tryOut", { result: RESULT({ repeat: { runs: 50, tally: [{ outcome: "warmed", count: 30 }, { outcome: "awkward", count: 20 }] } }) })
		await settle()
		expect(text("[data-tally]")).toContain("Over 50 runs:")
		expect(text("[data-tally]")).toContain("warmed")
		expect(text("[data-tally]")).toContain("60%")
		typeIn('input[aria-label="Name for the test"]', "Pier")
		click(document.querySelector("[data-save-test]"))
		expect(text("[data-saved-tests]")).toContain("Pier")
		const draft = await saved()
		expect(draft.playtests).toEqual([
			{
				name: "Pier",
				party: [{ name: "Wren", stats: { "acme.lab.hollow-hearts:slot/affection@1": 6 }, pieces: { keepsakes: ["note"] } }, { name: "Mara" }],
				situation: "The pier at dusk.",
				change: { owner: "Wren", aimedAt: "Mara", op: "use", check: "confession" },
				rigour: "mechanics"
			}
		])
	})

	test("the Handbook is written from the sentences; editing a page makes it yours; a page of your own is saved", async () => {
		open("playtest")
		const pages = [...document.querySelectorAll("[data-handbook-page]")].map((p) => p.textContent?.replace(/\s+/g, " ").trim())
		expect(pages).toEqual(["How to play Hollow Hearts generated", "What people carry generated", "How things are decided generated", "Things people keep generated", "How outcomes read generated"])
		click(document.querySelector('[data-handbook-page="what-people-carry"]'))
		expect(text("[data-handbook-article]")).toContain("Affection — How much someone likes you.")
		click(document.querySelector("[data-handbook-edit]"))
		typeIn("[data-handbook-article] textarea", "Affection is how warm someone is to you.")
		click(document.querySelector("[data-add-page]"))
		typeIn("[data-handbook-article] textarea", "Play kindly.")
		const draft = await saved()
		expect(draft.handbook).toEqual([
			{ title: "What people carry", body: "Affection is how warm someone is to you." },
			{ title: "A note from the author", body: "Play kindly." }
		])
	})
})

describe("🚧 RF fix 2: the owner's hands-on (2026-10-23)", () => {
	/** The documents the preview sent, newest last (only runs that carried the unsaved draft). */
	const previewDocs = () => sent("rulesets:tryOut").filter((p: any) => p.document && !p.fn && !p.repeat).map((p: any) => p.document)

	test("item 1: a new entry type is not judged while blank; its id comes from its name; findings land on its row after Save, never above the form", async () => {
		open("entryTypes")
		click(document.querySelector("[data-add-entry-type]"))
		await wait(500)
		// Blank: nothing of it is run (the preview runs nothing new), and the row says nothing.
		expect(previewDocs().every((d: any) => (d.entryTypes ?? []).length === 1)).toBe(true)
		const added = [...document.querySelectorAll("[data-entry-type]")].at(-1)!
		expect(added.querySelectorAll("[data-row-findings]").length).toBe(0)
		// Named, its id is the name's slug, kept clear of the others' (as New ruleset makes the ruleset's).
		const name = added.querySelector("input[id^=et-name-]") as HTMLInputElement
		name.value = "Keepsake"
		name.dispatchEvent(new Event("input", { bubbles: true }))
		flushSync()
		const draft = await saved()
		expect(draft.entryTypes.map((e: { id: string }) => e.id)).toEqual(["keepsakes", "keepsake"])
		// The server names what it lacks; the row says it, the form's summary does not.
		feed("rulesets:saveDraft", { rulesetId: ID, findings: [`[missing-prose] ${ID}.entryTypes[1] has no prose. Say in a sentence what the model reads about it.`] })
		await settle()
		expect(text('[data-entry-type="keepsake"] [data-row-findings]')).toContain("Has no prose")
		expect(text('[data-entry-type="keepsakes"] [data-row-findings]')).toBe("")
		expect(document.querySelectorAll("[role=alert]").length).toBe(0)
	})

	test("item 1: a blank row is left out of the Save", async () => {
		open("zoneTypes")
		click(document.querySelector("[data-add-zone-type]"))
		click(document.querySelector("[data-add-zone-type]"))
		const draft = await saved()
		expect(draft.zoneTypes).toEqual(DRAFT.zoneTypes)
	})

	test("item 5: the page tells the Admin view its unsaved edits, with a Save the question can run", async () => {
		open("attributes")
		expect(guards.length).toBe(1)
		expect(guards[0]!.dirty()).toBe(false)
		type("ruleset-label", "Hollow Hearts, revised")
		expect(guards[0]!.dirty()).toBe(true)
		const saving = guards[0]!.save!()
		await settle()
		expect(sent("rulesets:saveDraft").length).toBe(1)
		feed("rulesets:saveDraft", { rulesetId: ID, findings: [] })
		expect(await saving).toBe(true)
		expect(guards[0]!.dirty()).toBe(false)
		// Save from the question stays on the page (no landing on the list).
		expect(gone.length).toBe(0)
	})

	test("item 6: removing an entry type asks about its library rows, empties the zone type that held it and is saved whole", async () => {
		open("entryTypes")
		click(document.querySelector('[data-entry-type="keepsakes"] [data-entry-type-edit]'))
		click(document.querySelector('[data-entry-type="keepsakes"] [data-remove-entry-type]'))
		expect(text("[data-remove-confirm]")).toContain("Also remove the 2 library rows of Keepsake?")
		click(document.querySelector("[data-remove-with-rows]"))
		expect(document.querySelectorAll("[data-entry-type]").length).toBe(0)
		click(document.querySelector('[data-rail-item="zoneTypes"]'))
		await settle()
		expect(text('[data-zone-type="shelf"]')).toContain("Holds: Nothing yet")
		expect(text('[data-zone-type="shelf"] [data-holds-nothing]')).toContain("Holds nothing yet")
		const draft = await saved()
		expect(draft.entryTypes).toBeUndefined()
		expect(draft.zoneTypes[0].holds).toEqual([])
		expect(draft.library?.rows ?? {}).toEqual({})
	})

	test("item 6: keeping the rows removes the type alone; removing an attribute shows the function's hole to fill", async () => {
		open("entryTypes")
		click(document.querySelector('[data-entry-type="keepsakes"] [data-entry-type-edit]'))
		click(document.querySelector('[data-entry-type="keepsakes"] [data-remove-entry-type]'))
		click(document.querySelector("[data-remove-keep-rows]"))
		click(document.querySelector('[data-rail-item="attributes"]'))
		await settle()
		click(document.querySelector('[data-attribute="affection"] [data-attribute-more]'))
		click(document.querySelector('[data-attribute="affection"] [data-remove-attribute]'))
		click(document.querySelector('[data-rail-item="functions"]'))
		await settle()
		expect(text('[data-function="confession"] [data-function-holes]')).toContain("was Affection, which you removed")
		const draft = await saved()
		expect(draft.functions[0].bindings).toBeUndefined()
		expect(draft.functions[0].options).toEqual({ target: 7 })
		expect(Object.keys(draft.library.rows)).toEqual(["keepsakes"])
		expect(draft.entryTypes).toBeUndefined()
	})

	test("item 7: tags are called Tags and say what functions do with them", async () => {
		open("entryTypes")
		click(document.querySelector('[data-entry-type="keepsakes"] [data-entry-type-edit]'))
		expect(text('[data-entry-type="keepsakes"] label[for^=et-tags-]')).toBe("Tags")
		expect(text('[data-entry-type="keepsakes"] [id$=-help]')).toContain("A function bound by tag picks up every type that carries it")
		click(document.querySelector('[data-rail-item="attributes"]'))
		await settle()
		click(document.querySelector('[data-attribute="affection"] [data-attribute-more]'))
		expect(text('[data-attribute="affection"] label[for^=attr-tags-]')).toBe("Tags")
		expect(text('[data-attribute="affection"] [id$=-tags-help], [data-attribute="affection"] p[id^=attr-tags-]')).toContain("A function bound by tag picks up every attribute that carries it")
	})

	test("item 8: a draft always saves — what it lacks is said on its rows and in the rail, and only Publish waits", async () => {
		open("entryTypes")
		click(document.querySelector("[data-add-entry-type]"))
		// A sentence and no name: no id yet. The Save sends it; naming what it lacks is the server's.
		typeIn("[data-entry-type]:last-of-type textarea", "Something unnamed.")
		const draft = await saved()
		expect(draft.entryTypes.length).toBe(2)
		feed("rulesets:saveDraft", { rulesetId: ID, findings: [`[bad-entry-type] ${ID}.entryTypes[1].id is ''. An entry type is named in lowercase words joined by '-' — 'keepsakes'.`] })
		await settle()
		expect(text("[data-playable]")).toContain("1 problem before publish.")
		expect(text("[data-entry-type]:last-of-type [data-row-findings]")).toContain("Id is ''")
		click(document.querySelector("[data-rail-problems]"))
		await settle()
		expect(text("#ruleset-publish-blocked")).toBe("Fix the problems above first.")
	})

	test("item 2: an attribute may be free text — no bounds, a few sentences to start from", async () => {
		open("attributes")
		click(document.querySelector("[data-add-attribute]"))
		const row = [...document.querySelectorAll("[data-attribute]")].at(-1)!
		const name = row.querySelector("input[id^=attr-name-]") as HTMLInputElement
		name.value = "Vow"
		name.dispatchEvent(new Event("input", { bubbles: true }))
		flushSync()
		pick("Kind of Vow", "text")
		typeIn('[data-attribute="vow"] textarea[id^=attr-prose-]', "What someone has sworn to do.")
		typeIn('[data-attribute="vow"] textarea[id^=attr-start-]', "To see the sea once.")
		click(document.querySelector('[data-attribute="vow"] [data-attribute-required-toggle]'))
		const draft = await saved()
		expect(draft.attributes[2]).toEqual({ id: "vow", name: { en: "Vow" }, kind: "text", start: "To see the sea once.", prose: "What someone has sworn to do.", required: true })
	})
})

describe("🚧 RF fix 6: typed roles, and a removal that clears (2026-10-23)", () => {
	const NUMBERS = ["number", "pool", "tally"]
	const MOOD = { id: "mood", name: { en: "Mood" }, kind: "text", prose: "How someone is, in their own words." }

	test("the page keeps its ruleset when Admin's address moves on under it: Save after a removal goes to it, never to ''", async () => {
		// The router's params as the Admin view hands them: live, so a move to the list empties them.
		const live = $state({ params: { id: encodeURIComponent(ID) } as Record<string, string> })
		Object.defineProperty(page, "params", { get: () => live.params, configurable: true })
		try {
			page.url = new URL(`http://localhost/admin/rulesets/${encodeURIComponent(ID)}?view=functions`)
			app = mount(IdPage, { target: document.body, context: ctx() })
			flushSync()
			feed("rulesets:detail", { ruleset: detailRow() })
			// Admin moves to the list; its section is still on screen while the list loads (or fails to).
			live.params = {}
			flushSync()
			click(document.querySelector('[data-function="confession"] [data-remove-function]'))
			const draft = await saved()
			expect(sent("rulesets:saveDraft")[0].rulesetId).toBe(ID)
			expect(draft.id).toBe(ID)
			expect(draft.functions).toBeUndefined()
		} finally {
			Object.defineProperty(page, "params", { value: {}, writable: true, configurable: true })
		}
	})

	test("a role offers only the attributes of a kind it takes, and its pick says why the others are not there", async () => {
		const choices = CHOICES.map((c) =>
			c.id === RESTORE ? { ...c, decl: { ...c.decl, bindings: { what: { to: "attribute", kinds: NUMBERS, label: { en: "Restore" } } } } } : c
		)
		open("functions", {
			functionChoices: choices,
			draft: { ...DRAFT, attributes: [...DRAFT.attributes, MOOD], functions: [{ ref: RESTORE, key: "refill" }] }
		})
		pickOpen("Restore of Restore a value")
		const offered = [...document.querySelectorAll("[role=listbox] [data-pick]")].map((b) => b.getAttribute("data-pick"))
		expect(offered).toEqual(["affection", "nerve"])
		expect(text("[role=listbox] [data-pick-note]")).toBe("Restore takes a number, a pool or a tally, so Mood is not offered.")
	})

	test("removing a function judges the draft as it stands: its findings go at once, without a Save", async () => {
		open("functions", { findings: [`[unbound-function-binding] ${ID}.functions[0]: ${COMPARE} needs 'what' (attribute) bound — it is resolved by no tag and no pick.`] })
		expect(text("[data-playable]")).toContain("1 problem before publish.")
		click(document.querySelector('[data-function="confession"] [data-remove-function]'))
		await wait(400)
		const check = sent("rulesets:tryOut").at(-1) as { runId: string; rigour: string; document: { functions?: unknown } }
		expect(check.runId.startsWith("check-")).toBe(true)
		expect(check.rigour).toBe("prose")
		expect(check.document.functions).toBeUndefined()
		feed("rulesets:tryOut", { rulesetId: ID, runId: check.runId, result: RESULT() })
		await settle()
		expect(text("[data-playable]")).not.toContain("problem")
		// The focus stays in the form (Ctrl+S still saves): the list's own button holds it.
		expect(document.activeElement?.hasAttribute("data-add-function")).toBe(true)
	})
})

describe("🚧 RF fix 6: the default way, removed", () => {
	test("the next way takes over and the list says so; with none left, it says the table judges in words", async () => {
		open("functions", { draft: { ...DRAFT, functions: [...DRAFT.functions, { ref: PUSH, key: "push" }] } })
		click(document.querySelector('[data-function="confession"] [data-remove-function]'))
		await settle()
		expect(text("[data-functions-removed]")).toBe("Push your luck is now the way a moment is decided when it names none.")
		click(document.querySelector('[data-function="push"] [data-remove-function]'))
		await settle()
		expect(text("[data-functions-removed]")).toBe("No way to decide is left: whoever runs the game judges each moment in words.")
	})
})

/** Open an inline pick by the start of its name. */
function pickOpen(label: string) {
	const trigger = [...document.querySelectorAll("button[aria-haspopup=listbox]")].find((b) => b.getAttribute("aria-label")?.startsWith(label))
	expect(!!trigger).toBe(true)
	click(trigger)
}
