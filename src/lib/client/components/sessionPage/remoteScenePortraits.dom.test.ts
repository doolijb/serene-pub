/**
 * Parity (R21): core's REMOTE Scene Portraits — the built module
 * (`@serene-pub/core-catalog/components/scene-portraits.js`) mounted through
 * the SDK's component harness in core's box — draws what the native
 * `ScenePortraitsPanel` drew for the same session: the same faces, names,
 * images, sprite-set switch and menu, bar rows, pins and empty states.
 *
 * The native panel is deleted (R79, P3). While it existed this file mounted
 * both copies over one session and compared them (all seven cases passed);
 * `NATIVE_DREW` below is what the native panel drew for each case, recorded
 * verbatim from that run, so the remote is still held to it.
 *
 * The remote is handed what the page hands it: `characters.v1` from the
 * page's own projection (`projectCharacters`) and `session_state.v1` from
 * its (`projectSessionState`), over the very payload and store rows the
 * native widget read.
 *
 * Deliberate differences (R77), each asserted as such: the persona is the
 * VIEWER's (native took the first listed), and the sprite-set menu is offered
 * only where the viewer may switch (native offered it to everyone, and the
 * server refused).
 *
 * W6 (2026-10-11) retired the pinned source the native panel drew: who ×
 * picture × arrangement replace it, and a 0.6 instance on the pinned source
 * is a stage of chosen images, seeded once from this browser's pins
 * (`scenePinsSeed.ts`). The last block holds the remote to that.
 *
 * F2 (2026-10-11): a chooser tile WRITES — `set-chosen-image`, answered by
 * the page's own request table into the asking instance's settings — and the
 * face follows when the settings come back.
 */
import { describe, expect, test } from "vitest"
import { createRequire } from "node:module"
import { mountComponent } from "@serene-pub/cli/testing"
import type { SessionCharactersV1, SessionStateV1 } from "@serene-pub/sdk"
import {
	projectCharacters,
	type CharacterCard,
	type CharactersSourceSession
} from "./projections/characters"
import { projectSessionState } from "./projections/sessionState"
import { seedFromPins, seedPatch, takesPins } from "./scenePinsSeed"
import { effectiveWidgetSettings, type WidgetSettingsDecl } from "$lib/shared/widgets/settings"
import { CORE_WIDGETS } from "$lib/shared/widgets/types"
import { buildWidgetRequestAnswerer, type WidgetRequestDeps } from "./requests"
import { guardWidgetRequests } from "./requests/askers"
import {
	setWidgetSettingDecls,
	setWidgetSettingsWriter,
	setWidgetSettingValues,
	widgetSettingValues
} from "$lib/client/stores/widgetSettings.svelte"

/* ── one session, as the page holds it ─────────────────────────────────── */

const U = (n: number) => `00000000-0000-4000-8000-00000000000${n}`
const media = (n: number, rev = 1) => ({ uuid: U(n), rev })

const ada: CharacterCard = {
	id: 3,
	userId: 10,
	name: "Adeline",
	nickname: "Ada",
	avatarMedia: media(1),
	spriteSets: [
		{
			name: "Casual",
			isDefault: true,
			sprites: [
				{ label: "neutral", position: 0, file: media(2) },
				{ label: "happy", position: 0, file: media(3) }
			]
		},
		{ name: "Armor", isDefault: false, sprites: [{ label: "neutral", position: 0, file: media(4, 2) }] }
	]
}
const bo: CharacterCard = { id: 4, userId: 20, name: "Bo", nickname: "" }
const kit: CharacterCard = { id: 8, userId: 10, name: "Kit", avatarMedia: media(5) }
const wren: CharacterCard = { id: 9, userId: 30, name: "Wren", nickname: "Wee", avatarMedia: media(6) }

const payload = (over: Partial<CharactersSourceSession> = {}): CharactersSourceSession & { id: number } => ({
	id: 1,
	userId: 10,
	sessionCharacters: [
		{ isActive: true, removedAt: null, position: 0, character: ada },
		{ isActive: true, removedAt: null, position: 1, character: bo }
	],
	sessionPersonas: [
		{ removedAt: null, position: 0, persona: kit },
		{ removedAt: null, position: 1, persona: wren }
	],
	spriteSetOverrides: {},
	sessionMessages: [{ id: 10, characterId: 3, metadata: { sprite: { set: "Casual", label: "happy" } } }],
	...over
})

const HP = "core:slot/hp@1"
const MOOD = "core:slot/mood@1"
const slots: Sockets.State.SlotDescriptor[] = [
	{ slotId: HP, key: "hp", qualifiedKey: "hp", label: "HP", type: "integer", appliesTo: ["cast"] },
	{ slotId: MOOD, key: "mood", qualifiedKey: "mood", label: "Mood", type: "enum", appliesTo: ["cast"] }
] as Sockets.State.SlotDescriptor[]
const owners: Sockets.State.StateOwnerRow[] = [
	{ key: "ada", kind: "session_cast", id: 3, label: "Ada", configs: { [HP]: { min: 0, max: 20 }, [MOOD]: { of: ["wary"] } } }
]
const resolved = (hp: number) =>
	({ world: {}, cast: { ada: { id: 3, key: "ada", name: "Ada", hp, mood: "wary" } } }) as unknown as Sockets.State.ResolvedState

/** What the remote is posted: the page's projection of the same store. */
const stateSection = (hp: number): SessionStateV1 =>
	projectSessionState(
		{ sessionId: 1, loaded: true, readError: null, state: resolved(hp), slots, owners },
		1
	)

/* ── what each copy drew, in one shape ─────────────────────────────────── */

/** The remote's widget parts: its structure (STYLE-GUIDE §6.16, P3c). */
const part = (name: string) => `[data-widget-part~="scene-portraits.${name}"]`
const C = {
	face: part("face"),
	name: part("face-name"),
	blank: `${part("face-img")}[data-blank]`,
	trigger: part("set"),
	bars: part("bar"),
	empty: part("empty"),
	pin: part("pin")
}
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, " ").trim() ?? null

/** Everything a person sees and can press, minus the markup that carries it. */
function drawn(root: Element, c = C) {
	return {
		faces: [...root.querySelectorAll(c.face)].map((f) => ({
			member: f.getAttribute("data-scene-member"),
			name: text(f.querySelector(c.name)),
			img: f.querySelector("img")?.getAttribute("src") ?? null,
			alt: f.querySelector("img")?.getAttribute("alt") ?? null,
			blank: !!f.querySelector(c.blank),
			switch: f.querySelector(c.trigger)
				? { label: f.querySelector(c.trigger)!.getAttribute("aria-label"), text: text(f.querySelector(c.trigger)) }
				: null,
			bars: [...f.querySelectorAll(c.bars)].map((b) => b.getAttribute("aria-label"))
		})),
		pins: [...root.querySelectorAll(c.pin)].map((d) => ({
			img: d.querySelector("img")?.getAttribute("src") ?? null,
			alt: d.querySelector("img")?.getAttribute("alt") ?? null,
			clear: d.querySelector("button")?.getAttribute("aria-label") ?? null,
			bars: [...d.querySelectorAll(c.bars)].map((b) => b.getAttribute("aria-label")),
			text: d.querySelector("img") ? null : text(d)
		})),
		empty: text(root.querySelector(c.empty))
	}
}

/** The menu's items: each set, and whether it is the checked one. */
const menuOf = (view: { queryAll(s: string): Element[] }, member = "character:3") =>
	view
		.queryAll(`[data-scene-member="${member}"] [role="menuitemradio"]`)
		.map((b) => [text(b), b.getAttribute("aria-checked")])

interface Case {
	settings: Record<string, unknown>
	session?: CharactersSourceSession & { id: number }
	pins?: { left: string | null; right: string | null }
	viewerUserId?: number
	hp?: number
	/** What the page answers the widget's requests with (W6: `character-images`). */
	requests?: (kind: string, params: Record<string, unknown>) => unknown
}

/** The remote, as the page mounts it: the built module in core's box, posted the page's projections. */
async function remote(k: Case) {
	const session = k.session ?? payload()
	const characters: SessionCharactersV1 = projectCharacters({
		session,
		viewerUserId: k.viewerUserId ?? 10,
		voicedPersonaId: null,
		sceneImages: k.pins ?? { left: null, right: null }
	})
	return mountComponent({
		entry: BUILT,
		root: CORE_CATALOG,
		owner: "core",
		timeoutMs: 60_000,
		context: {
			session: { id: 1, name: "Parity" },
			settings: k.settings,
			viewer: { userId: k.viewerUserId ?? 10, isAdmin: false, isGuest: false },
			scoped: { characters, session_state: stateSection(k.hp ?? 14) }
		},
		requests: k.requests ?? (() => undefined)
	})
}

const require = createRequire(import.meta.url)
const BUILT = require.resolve("@serene-pub/core-catalog/components/scene-portraits.js")
const CORE_CATALOG = BUILT.replace(/\/dist\/components\/scene-portraits\.js$/, "")

/* ── what the native panel drew, recorded from the two-copy run ────────── */

const F = (n: number, rev = 1) => `/media/${U(n)}?r=${rev}`
const face = (member: string, name: string, img: string | null, over: Record<string, unknown> = {}) => ({
	member,
	name,
	img,
	alt: img ? name : null,
	blank: !img,
	switch: null as { label: string; text: string } | null,
	bars: [] as string[],
	...over
})
const NO_FACES = { faces: [], pins: [], empty: null }

const NATIVE_DREW = {
	scene: {
		faces: [
			face("character:3", "Ada", F(3), {
				switch: { label: "Change Ada's sprite set", text: "Sprite set" },
				bars: ["HP 14/20"]
			}),
			face("character:4", "Bo", null),
			face("persona:8", "Kit", F(5))
		],
		pins: [],
		empty: null
	},
	sceneMenu: [
		["Casual", "false"],
		["Armor", "false"],
		["As the story has it", "true"]
	],
	picked: {
		faces: [
			face("character:3", "Ada", F(4, 2), { switch: { label: "Change Ada's sprite set", text: "Armor" } }),
			face("character:4", "Bo", null)
		],
		pins: [],
		empty: null
	},
	pickedMenu: [
		["Casual", "false"],
		["Armor", "true"],
		["As the story has it", "false"]
	],
	noSprites: { faces: [face("character:3", "Ada", F(1)), face("character:4", "Bo", null)], pins: [], empty: null },
	sceneEmpty: {
		...NO_FACES,
		empty: "Nobody is in this scene yet. Add a character to the session and they show up here."
	},
	/** A guest (user 30): the switch for everyone, and the first persona listed — not theirs. */
	guest: {
		faces: [
			face("character:3", "Ada", F(3), { switch: { label: "Change Ada's sprite set", text: "Sprite set" } }),
			face("character:4", "Bo", null),
			face("persona:8", "Kit", F(5))
		],
		pins: [],
		empty: null
	}
}

describe("core's remote Scene Portraits draws what the native one drew", () => {
	test("scene: the cast, current sprites, the switch, its menu and the bars", { timeout: 120_000 }, async () => {
		const view = await remote({ settings: { source: "scene", bars: true, sprites: true, persona: true } })
		try {
			expect(view.refused).toEqual([])
			expect(drawn(view.root)).toEqual(NATIVE_DREW.scene)
			expect(menuOf(view)).toEqual(NATIVE_DREW.sceneMenu)
		} finally {
			await view.unmount()
		}
	})

	test("scene: a session's sprite-set pick — the switch's label, the checked item, the sprite", { timeout: 120_000 }, async () => {
		const view = await remote({ settings: { source: "scene" }, session: payload({ spriteSetOverrides: { 3: "Armor" } }) })
		try {
			expect(drawn(view.root)).toEqual(NATIVE_DREW.picked)
			expect(menuOf(view)).toEqual(NATIVE_DREW.pickedMenu)
		} finally {
			await view.unmount()
		}
	})

	test("scene: without sprites, faces and no switch", { timeout: 120_000 }, async () => {
		const view = await remote({ settings: { source: "scene", sprites: false } })
		try {
			expect(drawn(view.root)).toEqual(NATIVE_DREW.noSprites)
		} finally {
			await view.unmount()
		}
	})

	test("scene, empty: nobody seated yet", { timeout: 120_000 }, async () => {
		const view = await remote({
			settings: { source: "scene" },
			session: payload({ sessionCharacters: [], sessionPersonas: [], sessionMessages: [] })
		})
		try {
			expect(drawn(view.root)).toEqual(NATIVE_DREW.sceneEmpty)
		} finally {
			await view.unmount()
		}
	})

	test("R77, deliberate: a guest sees no switch it cannot use, and its OWN persona", { timeout: 120_000 }, async () => {
		const view = await remote({ settings: { source: "scene", persona: true }, viewerUserId: 30 })
		try {
			const drew = drawn(view.root)
			expect(NATIVE_DREW.guest.faces.map((f) => [f.member, !!f.switch])).toEqual([
				["character:3", true],
				["character:4", false],
				["persona:8", false]
			])
			// No switch (the server would refuse it), and the guest's own persona (Wee).
			expect(drew.faces.map((f) => [f.member, !!f.switch])).toEqual([
				["character:3", false],
				["character:4", false],
				["persona:9", false]
			])
			expect(drew.faces[2]).toEqual(face("persona:9", "Wee", F(6)))
			// Everything else is as the native drew it.
			expect(drew.faces.slice(0, 2)).toEqual(NATIVE_DREW.guest.faces.slice(0, 2).map((f) => ({ ...f, switch: null })))
		} finally {
			await view.unmount()
		}
	})
})

/* ── W6: who × picture × arrangement ─────────────────────────────────────── */

const at = (iso: string) => `2026-10-01T${iso}:00.000Z`
/** The session with lines: Bo spoke last, then Kit (the owner's persona), then Ada. */
const spoken = () =>
	payload({
		sessionMessages: [
			{ id: 10, characterId: 3, createdAt: at("10:00"), metadata: { sprite: { set: "Casual", label: "happy" } } },
			{ id: 11, personaId: 8, createdAt: at("10:01") },
			{ id: 12, characterId: 4, createdAt: at("10:02") }
		] as CharactersSourceSession["sessionMessages"]
	})
const members = (root: Element) => drawn(root).faces.map((f) => f.member)
const portraitsDecl = CORE_WIDGETS.find((w) => w.id === "scene-portraits")!
const decl: WidgetSettingsDecl = { id: "scene-portraits", title: portraitsDecl.title, settings: portraitsDecl.settings }
/** What the page posts: the instance's effective settings over its stored row. */
const effective = (stored: Record<string, unknown>) => effectiveWidgetSettings({ decl, stored })

describe("W6: who, which picture, and how they stand", () => {
	test("who: recent — whoever spoke last first, up to N, each ranked; the persona only when asked", { timeout: 120_000 }, async () => {
		const view = await remote({ settings: effective({ who: "recent", recentTurns: 2 }), session: spoken() })
		try {
			expect(members(view.root)).toEqual(["character:4", "character:3"])
			expect(view.queryAll(part("recent-rank")).map(text)).toEqual(["1", "2"])
		} finally {
			await view.unmount()
		}
		const withPersona = await remote({ settings: effective({ who: "recent", recentTurns: 2, persona: true }), session: spoken() })
		try {
			expect(members(withPersona.root)).toEqual(["character:4", "persona:8"])
		} finally {
			await withPersona.unmount()
		}
	})

	test("who: pick — the members named, in the order named; a stage draws the first two large", { timeout: 120_000 }, async () => {
		const view = await remote({ settings: effective({ who: "pick", pickMembers: ["Wee", "ada", "Bo"], arrangement: "stage" }) })
		try {
			expect(view.root.querySelector(part("root"))?.getAttribute("data-arrangement")).toBe("stage")
			expect(view.root.querySelector(part("stage"))).not.toBeNull()
			expect(members(view.root)).toEqual(["persona:9", "character:3"])
			// The picture is the sprite (the default), as everywhere else.
			expect(drawn(view.root).faces.map((f) => f.img)).toEqual([F(6), F(3)])
		} finally {
			await view.unmount()
		}
	})

	test("face: chosen — the chosen image found in the member's gallery; the avatar where none is chosen", { timeout: 120_000 }, async () => {
		const asked: unknown[] = []
		const view = await remote({
			settings: effective({ face: "chosen", chosenImages: [`character:3=${U(7)}`] }),
			requests: (kind, params) => {
				if (kind !== "character-images") return undefined
				asked.push(params)
				return { images: [{ ref: U(1), src: F(1) }, { ref: U(7), src: F(7) }] }
			}
		})
		try {
			await view.settle()
			const faces = drawn(view.root).faces
			expect(faces.map((f) => [f.member, f.img])).toEqual([
				["character:3", F(7)],
				["character:4", null]
			])
			expect(asked).toEqual([{ characterId: 3 }])
			// No sprite-set switch on a chosen face; ⋯ in its place.
			expect(faces.every((f) => f.switch === null)).toBe(true)
			expect(view.queryAll(part("choose")).map((b) => b.getAttribute("aria-label"))).toEqual([
				"Choose an image for Ada",
				"Choose an image for Bo"
			])
		} finally {
			await view.unmount()
		}
	})

	test("a benched character is not in the scene: never a face, whoever is shown", { timeout: 120_000 }, async () => {
		const benched = payload({
			sessionCharacters: [
				{ isActive: false, removedAt: null, position: 0, character: ada },
				{ isActive: true, removedAt: null, position: 1, character: bo }
			]
		})
		for (const settings of [{}, { who: "pick", pickMembers: ["Ada", "Bo"] }]) {
			const view = await remote({ settings: effective(settings), session: benched })
			try {
				expect(members(view.root)).toEqual(["character:4"])
			} finally {
				await view.unmount()
			}
		}
	})

	test("⏳ a 0.6 instance on the pinned source, with this browser's pins: a stage of the pinned members' chosen images", { timeout: 120_000 }, async () => {
		// The stored row and the pins, as 0.6 left them: Ada's avatar on the left, Bo's gallery image on the right.
		const stored = { source: "pinned", bars: true }
		const pins = { left: F(1), right: F(8) }
		expect(takesPins(stored)).toBe(true)
		const cast = projectCharacters({ session: payload(), viewerUserId: 10, voicedPersonaId: null, sceneImages: { left: null, right: null } })
		const seed = await seedFromPins(pins, cast.members, async (id) => (id === 4 ? [{ uuid: U(8) }] : [{ uuid: U(1) }]))
		const row = { ...stored, ...seedPatch(stored, seed) }
		const gallery: Record<number, { ref: string; src: string }[]> = {
			3: [{ ref: U(1), src: F(1) }],
			4: [{ ref: U(8), src: F(8) }]
		}
		const view = await remote({
			settings: effective(row),
			requests: (kind, params) => (kind === "character-images" ? { images: gallery[params.characterId as number] ?? [] } : undefined)
		})
		try {
			await view.settle()
			expect(view.root.querySelector(part("root"))?.getAttribute("data-arrangement")).toBe("stage")
			const faces = drawn(view.root).faces
			expect(faces.map((f) => [f.member, f.img])).toEqual([
				["character:3", F(1)],
				["character:4", F(8)]
			])
			// Ada's bars ride under her face, as they did under her pin.
			expect(faces[0]!.bars).toEqual(["HP 14/20"])
		} finally {
			await view.unmount()
		}
	})
})

describe("F2: the chooser writes the instance's chosen image", () => {
	test("a tile asks the page, which writes the ASKING instance's settings; the face follows; Use the avatar takes it away", { timeout: 120_000 }, async () => {
		const id = "scene-portraits#2"
		/** The stored row as the page holds it — a plain copy, as it is posted (the store's is reactive). */
		const stored = () => JSON.parse(JSON.stringify(widgetSettingValues(id))) as Record<string, unknown>
		const cast = projectCharacters({ session: payload(), viewerUserId: 10, voicedPersonaId: null, sceneImages: { left: null, right: null } })
		setWidgetSettingDecls({ [id]: { ...decl, id }, stats: { id: "stats", title: "Stats", settings: {} } })
		setWidgetSettingValues({ [id]: { face: "chosen" } })
		setWidgetSettingsWriter((next) => setWidgetSettingValues(next))
		// The page's own answerer, behind its askers guard, over the store.
		const answer = guardWidgetRequests(
			buildWidgetRequestAnswerer({
				characters: () => cast,
				readCharacterGallery: async () => [
					{ uuid: U(1), url: F(1), kind: "image" },
					{ uuid: U(7), url: F(7), kind: "image" }
				]
			} as unknown as WidgetRequestDeps)
		)
		const view = await remote({
			settings: effective(stored()),
			requests: (kind, params) => answer(kind as never, params as never, { widgetId: id, owner: "core" })
		})
		try {
			await view.settle()
			expect(drawn(view.root).faces[0]!.img).toBe(F(1))
			await view.click(view.queryAll(part("choose"))[0]!)
			await view.settle()
			const tiles = view.queryAll(part("chooser-tile"))
			expect(tiles.map((t) => t.getAttribute("aria-label"))).toEqual(["Show image 1 for Ada", "Show image 2 for Ada"])
			await view.click(tiles[1]!)
			await view.settle()
			// Written into THIS instance's own settings, and the chooser closed.
			expect(widgetSettingValues(id)).toEqual({ face: "chosen", chosenImages: [`character:3=${U(7)}`] })
			expect(view.query(part("chooser"))).toBeNull()
			// The page posts the instance's settings again: the face shows the choice.
			await view.push("settings", effective(stored()))
			await view.settle()
			expect(drawn(view.root).faces[0]!.img).toBe(F(7))
			// Use the avatar: the choice taken away, and the avatar back.
			await view.click(view.queryAll(part("choose"))[0]!)
			await view.settle()
			await view.click(part("chooser-clear"))
			await view.settle()
			expect(widgetSettingValues(id)).toEqual({ face: "chosen" })
			await view.push("settings", effective(stored()))
			await view.settle()
			expect(drawn(view.root).faces[0]!.img).toBe(F(1))
		} finally {
			await view.unmount()
			setWidgetSettingsWriter(null)
			setWidgetSettingDecls({})
			setWidgetSettingValues({})
		}
	})

	test("a refusal (a member not in the session) is the widget's own line; nothing is written", { timeout: 120_000 }, async () => {
		const id = "scene-portraits"
		const writes: unknown[] = []
		setWidgetSettingDecls({ [id]: decl })
		setWidgetSettingValues({ [id]: { face: "chosen" } })
		setWidgetSettingsWriter((next) => writes.push(next))
		// The page projects a cast without Ada: the widget offers her, the page refuses.
		const answer = buildWidgetRequestAnswerer({
			characters: () => ({ members: [], sceneImages: { left: null, right: null } }),
			readCharacterGallery: async () => []
		} as unknown as WidgetRequestDeps)
		const view = await remote({
			settings: effective({ face: "chosen" }),
			requests: (kind, params) =>
				kind === "character-images"
					? { images: [{ ref: U(7), src: F(7) }] }
					: answer(kind as never, params as never, { widgetId: id, owner: "core" })
		})
		try {
			await view.click(view.queryAll(part("choose"))[0]!)
			await view.settle()
			await view.click(view.queryAll(part("chooser-tile"))[0]!)
			await view.settle()
			expect(text(view.query(part("alert-text")))).toBe("that character is not in this session")
			expect(view.query(part("chooser"))).not.toBeNull()
			expect(writes).toEqual([])
		} finally {
			await view.unmount()
			setWidgetSettingsWriter(null)
			setWidgetSettingDecls({})
			setWidgetSettingValues({})
		}
	})
})
