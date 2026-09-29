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
		requests: () => undefined
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
	pinned: {
		faces: [],
		pins: [
			{ img: F(1), alt: "left scene portrait", clear: "Clear left portrait", bars: ["HP 14/20"], text: null },
			{ img: null, alt: null, clear: null, bars: [], text: "Empty" }
		],
		empty: null
	},
	pinnedEmpty: {
		...NO_FACES,
		empty: "No scene portraits set. Click a character's avatar in the chat to pin one here."
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

	test("pinned: the pins, a pinned member's bars, the clear buttons and the empty side", { timeout: 120_000 }, async () => {
		const view = await remote({ settings: { bars: true }, pins: { left: F(1), right: null } })
		try {
			expect(drawn(view.root)).toEqual(NATIVE_DREW.pinned)
		} finally {
			await view.unmount()
		}
	})

	test("pinned, empty: nothing pinned", { timeout: 120_000 }, async () => {
		const view = await remote({ settings: {} })
		try {
			expect(drawn(view.root)).toEqual(NATIVE_DREW.pinnedEmpty)
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
