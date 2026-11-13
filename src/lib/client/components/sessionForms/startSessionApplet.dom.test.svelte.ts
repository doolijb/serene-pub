/**
 * Start a session › applet genres (M2c): choosing one opens its launcher, "Use the start form" keeps this form,
 * and an applet's own create-session request collapses to a one-press confirm.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
const { gotoMock } = vi.hoisted(() => ({ gotoMock: vi.fn() }))
vi.mock("$app/navigation", () => ({ goto: gotoMock }))

const { listeners, requests, socket } = vi.hoisted(() => ({
	listeners: new Map<string, Array<(msg: any) => void>>(),
	requests: [] as Array<{ key: string; params: any }>,
	socket: { emit: () => {}, on: () => {}, off: () => {} }
}))
vi.mock("$lib/client/sockets/loadSockets.client", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/interest.svelte", () => {
	const declareInterest = (key: string, handler: (msg: any) => void) => {
		listeners.set(key, [...(listeners.get(key) ?? []), handler])
		return () =>
			listeners.set(
				key,
				(listeners.get(key) ?? []).filter((h) => h !== handler)
			)
	}
	return {
		declareInterest,
		useInterest: declareInterest,
		requestWithInterest: (
			key: string,
			params: unknown,
			handler: (msg: any) => void
		) => {
			requests.push({ key, params })
			return declareInterest(key, handler)
		}
	}
})
const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: {
		success: () => {},
		error: toastError,
		info: () => {},
		warning: () => {}
	}
}))

import StartSessionForm from "./StartSessionForm.svelte"

const APPLET = "acme.cards:genre/solitaire"
const PLAIN = "core:genre/story"
const SHAPE = { characters: { min: 0, max: 3 }, personas: { min: 0, max: 1 } }

let app: ReturnType<typeof mount> | null = null
let host: HTMLElement
afterEach(() => {
	if (app) unmount(app)
	app = null
	listeners.clear()
	requests.length = 0
	gotoMock.mockReset()
	toastError.mockReset()
	document.body.innerHTML = ""
})

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}
const feed = (key: string, msg: unknown) => {
	for (const h of listeners.get(key) ?? []) h(msg)
}

/** What a test may change about the genres and lists the form is fed. */
interface RenderOptions {
	appletShape?: Record<string, unknown>
	characters?: unknown[]
	lorebooks?: unknown[]
	/** The applet preset's start asks (`PresetRow.asks`), none by default. */
	presetAsks?: unknown[]
	/** The applet genre's rules offer, none by default. */
	rules?: unknown
}

async function render(prefill?: any, opts: RenderOptions = {}) {
	host = document.createElement("div")
	document.body.append(host)
	app = mount(StartSessionForm, {
		target: host,
		context: new Map([["userSettingsCtx", { settings: { showAdvancedControls: true } }]]),
		props: {
			onCreated: () => {},
			onCancel: () => {},
			sessions: [] as any,
			prefill
		}
	})
	await settle()
	feed("sessions:genres", {
		genres: [
			{ genreId: PLAIN, name: "Story", description: "", shape: SHAPE },
			{
				genreId: APPLET,
				name: "Solitaire",
				description: "",
				shape: {
					...SHAPE,
					applet: true,
					view: "acme.cards",
					fields: {
						deck: { type: "text", label: "Deck" },
						seed: { type: "number", label: { en: "Seed" } }
					},
					...opts.appletShape
				},
				appletCard: { title: "Card Table" },
				...(opts.rules ? { rules: opts.rules } : {})
			}
		]
	})
	feed("sessionPresets:list", {
		presets: [
			{
				id: 1,
				genreId: PLAIN,
				name: "Plain",
				enabled: true,
				isDefault: true
			},
			{
				id: 2,
				genreId: APPLET,
				name: "Plain",
				enabled: true,
				isDefault: true,
				...(opts.presetAsks ? { asks: opts.presetAsks } : {})
			}
		]
	})
	feed("characters:list", { characterList: opts.characters ?? [] })
	feed("lorebooks:list", { lorebookList: opts.lorebooks ?? [] })
	await settle()
}

const radio = (id: string) =>
	host.querySelector<HTMLButtonElement>(
		`[data-genre-card="${id}"] button[role="radio"]`
	)!

describe("Start a session › applet genres", () => {
	test("choosing an applet genre opens its launcher", async () => {
		await render()
		radio(APPLET).click()
		await settle()
		expect(gotoMock).toHaveBeenCalledWith("/apps/acme.cards")
		expect(radio(APPLET).getAttribute("aria-checked")).toBe("false")
	})

	test("a plain genre does not", async () => {
		await render()
		radio(PLAIN).click()
		await settle()
		expect(gotoMock).not.toHaveBeenCalled()
	})

	test("Use the start form keeps the generic form", async () => {
		await render()
		host.querySelector<HTMLButtonElement>(
			`[data-use-start-form="${APPLET}"]`
		)!.click()
		await settle()
		expect(gotoMock).not.toHaveBeenCalled()
		expect(radio(APPLET).getAttribute("aria-checked")).toBe("true")
		expect(host.querySelector("[data-use-start-form]")).toBeNull()
	})

	test("an applet's own request collapses to a confirm with Change", async () => {
		await render({ genreId: APPLET, fromApplet: "acme.cards", fields: {} })
		expect(gotoMock).not.toHaveBeenCalled()
		const confirm = host.querySelector("[data-applet-confirm]")
		expect(confirm).not.toBeNull()
		expect(confirm!.textContent).toContain("Start Solitaire")
		const change = [...host.querySelectorAll("button")].find((b) =>
			b.textContent?.includes("Change…")
		)!
		change.click()
		await settle()
		expect(host.querySelector("[data-applet-confirm]")).toBeNull()
		expect(host.querySelector("[data-genre-card]")).not.toBeNull()
	})

	test("the confirm lists the applet's field values under the genre's declared labels (2026-10-31)", async () => {
		await render({
			genreId: APPLET,
			fromApplet: "acme.cards",
			fields: { deck: "Classic", seed: 7, stray: "x" }
		})
		const rows = [
			...host.querySelectorAll(
				"[data-applet-confirm] [data-applet-field]"
			)
		].map((li) => li.textContent?.replace(/\s+/g, " ").trim())
		expect(rows).toEqual(["Deck: Classic", "Seed: 7"])
	})

	test("an object field is written by its declared sub-fields; an undeclared shape says (details) (owner 2026-11-05)", async () => {
		await render(
			{
				genreId: APPLET,
				fromApplet: "acme.cards",
				fields: {
					hero: {
						age: 24,
						origin: "local",
						traits: {
							personality: ["Calm", "Curious"],
							interests: []
						}
					},
					home: { zone: "east", x: 64 }
				}
			},
			{
				appletShape: {
					fields: {
						hero: {
							type: "object",
							label: { en: "Your character" },
							fields: {
								age: { type: "integer", label: "Age" },
								origin: {
									type: "string",
									label: { en: "Background" }
								},
								traits: { type: "json", label: "Traits" }
							}
						},
						home: { type: "json", label: "Home" }
					}
				}
			}
		)
		const rows = [
			...host.querySelectorAll(
				"[data-applet-confirm] [data-applet-field]"
			)
		].map((li) => li.textContent?.replace(/\s+/g, " ").trim())
		expect(rows).toEqual([
			"Your character: Age 24 · Background local · Traits personality: Calm, Curious",
			"Home: (details)"
		])
	})

	test("the confirm's Start sends the create request", async () => {
		await render({ genreId: APPLET, fromApplet: "acme.cards" })
		const start = [
			...host.querySelectorAll<HTMLButtonElement>(
				"[data-applet-confirm] button"
			)
		].find((b) => b.textContent?.includes("Start Solitaire"))!
		start.click()
		await settle()
		expect(requests.some((r) => r.key === "sessions:create")).toBe(true)
	})

	test("a prefilled field the preset asks at start is sent as the person's answer (gate walk 2026-11-05)", async () => {
		// `sentGenreFields` takes every untouched ask OUT so the session inherits the preset; the
		// applet's value IS the answer, given in its own wizard, and must survive Start.
		await render(
			{
				genreId: APPLET,
				fromApplet: "acme.cards",
				fields: { deck: "Classic", seed: 7 }
			},
			{
				presetAsks: [
					{
						key: "deck",
						label: "Deck",
						control: "text",
						value: "Default",
						fixed: true
					}
				]
			}
		)
		const start = [
			...host.querySelectorAll<HTMLButtonElement>(
				"[data-applet-confirm] button"
			)
		].find((b) => b.textContent?.includes("Start Solitaire"))!
		start.click()
		await settle()
		const sent = requests.filter((r) => r.key === "sessions:create")
		expect(sent).toHaveLength(1)
		expect(sent[0].params.session.genreFields).toMatchObject({
			deck: "Classic",
			seed: 7
		})
	})
})

describe("Start a session › the persona draft (M3b)", () => {
	const DEFAULT_PERSONA = {
		id: 5,
		name: "You",
		isPersona: true,
		isDefaultPersona: true
	}
	const WREN = { id: 6, name: "Wren", isPersona: true }
	const BOOK = { id: 7, name: "Porto Alto" }
	const DRAFT = { name: "Mia", description: "A pilot." }
	const asked = (key: string) => requests.filter((r) => r.key === key)
	const confirmText = () =>
		host
			.querySelector("[data-applet-confirm]")!
			.textContent!.replace(/\s+/g, " ")
	const startButton = () =>
		[
			...host.querySelectorAll<HTMLButtonElement>(
				"[data-applet-confirm] button"
			)
		].find((b) => b.textContent?.includes("Start Solitaire"))!
	const preselecting = {
		appletShape: { personas: { min: 0, max: 1, preselectDefault: true } }
	}
	const request = (over: Record<string, unknown> = {}) => ({
		genreId: APPLET,
		fromApplet: "acme.cards",
		persona: DRAFT,
		...over
	})

	test("the confirm says Playing as <name> (new), and the person's default persona is not chosen", async () => {
		await render(request(), {
			...preselecting,
			characters: [DEFAULT_PERSONA]
		})
		const text = confirmText()
		expect(text).toContain("Playing as Mia (new)")
		expect(text).not.toContain("Playing as You")
		expect(asked("characters:create")).toHaveLength(0)
		expect(asked("sessions:create")).toHaveLength(0)
	})

	test("the cast line shows for a castFromLorebook genre with a book chosen and the switch field on", async () => {
		const opts = {
			appletShape: {
				lorebook: "optional",
				castFromLorebook: { field: "seat" },
				fields: {
					seat: { type: "boolean", label: "Seat", default: true }
				}
			},
			lorebooks: [BOOK]
		}
		await render(request({ lorebookId: 7 }), opts)
		expect(confirmText()).toContain("Who is in it: the world's own people")
	})

	test("the cast line is absent when the switch field is off, or no book is chosen", async () => {
		const opts = {
			appletShape: {
				lorebook: "optional",
				castFromLorebook: { field: "seat" },
				fields: {
					seat: { type: "boolean", label: "Seat", default: true }
				}
			},
			lorebooks: [BOOK]
		}
		await render(request({ lorebookId: 7, fields: { seat: false } }), opts)
		expect(confirmText()).not.toContain("Who is in it")
		unmount(app!)
		app = null
		listeners.clear()
		document.body.innerHTML = ""
		await render(request(), opts)
		expect(confirmText()).not.toContain("Who is in it")
	})

	test("a castFromLorebook genre with no switch field is always on once a book is chosen", async () => {
		const opts = {
			appletShape: { lorebook: "optional", castFromLorebook: {} },
			lorebooks: [BOOK]
		}
		await render(request({ lorebookId: 7 }), opts)
		expect(confirmText()).toContain("Who is in it: the world's own people")
	})

	test("the Lorebook line says which rules a book on Freeform plays with; a book with rules of its own, none", async () => {
		const FREEFORM = "core:ruleset/freeform@1"
		const VIS = "core:ruleset/vis-itineris@1"
		const rules = {
			choices: [
				{
					id: FREEFORM,
					name: "Freeform",
					subtitle: "",
					recommended: false
				},
				{
					id: VIS,
					name: "Vis Itineris",
					subtitle: "",
					recommended: true
				}
			],
			only: false,
			defaultId: FREEFORM,
			rigour: { options: ["prose"], default: "prose" }
		}
		const opts = {
			appletShape: { lorebook: "optional" },
			lorebooks: [
				{ id: 7, name: "Porto Alto", primaryRuleset: FREEFORM },
				{ id: 8, name: "Drowned Coast", primaryRuleset: VIS }
			],
			rules
		}
		await render(request({ lorebookId: 7 }), opts)
		expect(confirmText()).toContain("Lorebook: Porto Alto with Freeform")
		unmount(app!)
		app = null
		listeners.clear()
		document.body.innerHTML = ""
		await render(request({ lorebookId: 8 }), opts)
		expect(confirmText()).toContain("Lorebook: Drowned Coast")
		expect(confirmText()).not.toContain("Drowned Coast with")
	})

	test("Start makes the persona first, then the session — and only for the matching reply", async () => {
		await render(request(), preselecting)
		startButton().click()
		await settle()
		expect(asked("characters:create")).toHaveLength(1)
		expect(asked("characters:create")[0].params).toEqual({
			character: { name: "Mia", description: "A pilot.", isPersona: true }
		})
		expect(asked("sessions:create")).toHaveLength(0)

		// Another tab's create, or another name: not ours.
		feed("characters:create", {
			character: { id: 40, name: "Someone", isPersona: true }
		})
		feed("characters:create", {
			character: { id: 41, name: "Mia", isPersona: false }
		})
		await settle()
		expect(asked("sessions:create")).toHaveLength(0)

		feed("characters:create", {
			character: { id: 42, name: "Mia", isPersona: true }
		})
		await settle()
		expect(asked("sessions:create")).toHaveLength(1)
		expect(asked("sessions:create")[0].params.personaIds).toEqual([42])
		expect(asked("sessions:create")[0].params.fromApplet).toEqual({
			pluginId: "acme.cards"
		})
		expect(
			JSON.stringify(asked("sessions:create")[0].params)
		).not.toContain("A pilot.")
		expect(asked("characters:create")).toHaveLength(1)
	})

	test("a refused session create keeps the made persona; Start again reuses it", async () => {
		await render(request(), preselecting)
		startButton().click()
		await settle()
		feed("characters:create", {
			character: { id: 42, name: "Mia", isPersona: true }
		})
		await settle()
		feed("sessions:create:error", { error: "No." })
		await settle()
		expect(toastError).toHaveBeenCalledWith({
			id: "notify:socket:sessions:create:error",
			title: "Could not start the session",
			description:
				"No. Your persona Mia was made and is kept; Start again plays as it."
		})
		expect(confirmText()).toContain("Playing as Mia")
		expect(confirmText()).not.toContain("(new)")
		startButton().click()
		await settle()
		expect(asked("sessions:create")).toHaveLength(2)
		expect(asked("sessions:create")[1].params.personaIds).toEqual([42])
		expect(asked("characters:create")).toHaveLength(1)
	})

	test("Change… then an existing persona drops the draft: Start sends the session directly", async () => {
		await render(request(), {
			...preselecting,
			characters: [DEFAULT_PERSONA, WREN]
		})
		const change = [...host.querySelectorAll("button")].find((b) =>
			b.textContent?.includes("Change…")
		)!
		change.click()
		await settle()
		const row = host.querySelector('ul[aria-label="Who you play as"]')!
		expect(row.textContent).toContain("Mia")
		expect(row.textContent?.replace(/\s+/g, " ")).toContain(
			"New, from the game"
		)

		host.querySelector<HTMLButtonElement>(
			'button[aria-label="Change who you play as"]'
		)!.click()
		await settle()
		feed("characters:list", { characterList: [DEFAULT_PERSONA, WREN] })
		await settle()
		const dialog = document.querySelector<HTMLElement>(
			'[role="dialog"][data-state="open"]'
		)!
		;[...dialog.querySelectorAll("button")]
			.find((b) => b.textContent?.includes("Wren"))!
			.click()
		await settle()

		const list = host.querySelector('ul[aria-label="Who you play as"]')!
		expect(list.textContent).toContain("Wren")
		expect(list.textContent).not.toContain("Mia")
		const start = [
			...host.querySelectorAll<HTMLButtonElement>("button")
		].find((b) => b.textContent?.trim() === "Start")!
		start.click()
		await settle()
		expect(asked("characters:create")).toHaveLength(0)
		expect(asked("sessions:create")).toHaveLength(1)
		expect(asked("sessions:create")[0].params.personaIds).toEqual([6])
	})

	test("a refused persona create says so inline and Start can be pressed again", async () => {
		await render(request(), preselecting)
		startButton().click()
		await settle()
		feed("characters:create:error", { error: "Name taken." })
		await settle()
		const alert = host.querySelector('[role="alert"]')
		expect(alert?.textContent?.replace(/\s+/g, " ").trim()).toBe(
			"Could not make your persona: Name taken."
		)
		expect(confirmText()).toContain("Playing as Mia (new)")
		expect(asked("sessions:create")).toHaveLength(0)
		startButton().click()
		await settle()
		expect(asked("characters:create")).toHaveLength(2)
	})

	test("the Name input is called <name> in <book> while the draft is held", async () => {
		await render(request({ lorebookId: 7 }), {
			appletShape: { lorebook: "optional" },
			lorebooks: [BOOK]
		})
		const change = [...host.querySelectorAll("button")].find((b) =>
			b.textContent?.includes("Change…")
		)!
		change.click()
		await settle()
		const name = host.querySelector<HTMLInputElement>(
			"#start-session-name"
		)!
		expect(name.placeholder).toBe("Mia in Porto Alto")
	})
})
