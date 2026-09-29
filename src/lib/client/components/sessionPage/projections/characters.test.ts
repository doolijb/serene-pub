/**
 * `characters.v1` (R76) off the session payload: cast over card, every URL
 * resolved as the native portraits resolve it, the VIEWER's personas marked
 * (R77), the sprite-set switch offered exactly where the server allows it,
 * and the page's own pins matched to the member they picture.
 */
import { describe, expect, test } from "vitest"
import {
	projectCharacters,
	type CharacterCard,
	type CharactersSource,
	type CharactersSourceSession
} from "./characters"

const U = (n: number) => `00000000-0000-4000-8000-00000000000${n}`
const media = (n: number, rev = 1) => ({ uuid: U(n), rev })
const full = (n: number, rev = 1) => `/media/${U(n)}?r=${rev}`
const thumb = (n: number, rev = 1) => `/media/${U(n)}?v=thumb&r=${rev}`

/** Ada: two sprite sets, the first the card's own; owned by user 20. */
const ada: CharacterCard = {
	id: 3,
	userId: 20,
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
/** Bo: no sprites, no avatar, owned by the session's owner. */
const bo: CharacterCard = { id: 4, userId: 10, name: "Bo", nickname: "" }
/** Two personas of user 30 (a guest), one of user 10 (the owner). */
const kit: CharacterCard = { id: 8, userId: 10, name: "Kit", avatarMedia: media(5) }
const wren: CharacterCard = { id: 9, userId: 30, name: "Wren", nickname: "Wee", avatarMedia: media(6) }
const moss: CharacterCard = { id: 11, userId: 30, name: "Moss" }

const session = (over: Partial<CharactersSourceSession> = {}): CharactersSourceSession => ({
	userId: 10,
	sessionCharacters: [
		{ isActive: true, removedAt: null, position: 1, character: bo },
		{ isActive: true, removedAt: null, position: 0, character: ada }
	],
	sessionPersonas: [
		{ removedAt: null, position: 0, persona: kit },
		{ removedAt: null, position: 1, persona: wren },
		{ removedAt: null, position: 2, persona: moss }
	],
	spriteSetOverrides: {},
	sessionMessages: [{ id: 10, characterId: 3, metadata: { sprite: { set: "Casual", label: "happy" } } }],
	...over
})

const source = (over: Partial<CharactersSource> = {}): CharactersSource => ({
	session: session(),
	viewerUserId: 10,
	sceneImages: { left: null, right: null },
	...over
})

const member = (out: ReturnType<typeof projectCharacters>, id: number) =>
	out.members.find((m) => m.characterId === id)!

describe("projectCharacters", () => {
	test("the characters by seat, then the personas, each the card as the session shows it", () => {
		const out = projectCharacters(source())
		expect(out.members.map((m) => m.ref)).toEqual([
			"character:3",
			"character:4",
			"character:8",
			"character:9",
			"character:11"
		])
		expect(member(out, 3)).toEqual({
			ref: "character:3",
			characterId: 3,
			isPersona: false,
			mine: false,
			name: "Ada",
			face: full(1),
			sprite: full(3),
			spriteSets: ["Casual", "Armor"],
			spriteSet: "Casual",
			spriteSetOverride: null,
			canChangeSpriteSet: true
		})
		expect(member(out, 4)).toMatchObject({ name: "Bo", face: null, sprite: null, spriteSets: [], spriteSet: null })
		expect(member(out, 9)).toMatchObject({ isPersona: true, name: "Wee", face: full(6) })
	})

	test("cast over card: the session's sprite-set pick wins, and the current sprite is drawn from it", () => {
		const out = projectCharacters(source({ session: session({ spriteSetOverrides: { 3: "Armor" } }) }))
		// The newest line's label (happy) in the picked set, falling back to
		// that set's neutral — the native portraits' `spriteSrc` order.
		expect(member(out, 3)).toMatchObject({ spriteSet: "Armor", spriteSetOverride: "Armor", sprite: full(4, 2) })
	})

	test("the current sprite is the newest visible line's; with no line, the set's neutral", () => {
		const hiddenNewer = session({
			sessionMessages: [
				{ id: 10, characterId: 3, metadata: { sprite: { set: "Casual", label: "happy" } } },
				{ id: 12, characterId: 3, isHidden: true, metadata: { sprite: { set: "Casual", label: "neutral" } } }
			]
		})
		expect(member(projectCharacters(source({ session: hiddenNewer })), 3).sprite).toBe(full(3))
		expect(member(projectCharacters(source({ session: session({ sessionMessages: [] }) })), 3).sprite).toBe(full(2))
	})

	test("mine is the persona the VIEWER is voicing — never merely the first one listed", () => {
		const mine = (over: Partial<CharactersSource>) =>
			projectCharacters(source(over)).members.filter((m) => m.mine).map((m) => m.characterId)
		// The viewer owns 9 and 11: the one they voice is theirs, and only that one.
		expect(mine({ viewerUserId: 30, voicedPersonaId: 11 })).toEqual([11])
		expect(mine({ viewerUserId: 30, voicedPersonaId: 9 })).toEqual([9])
		// No pick yet: the viewer's first, as the composer has it.
		expect(mine({ viewerUserId: 30 })).toEqual([9])
		// Someone else's persona is never the viewer's, whatever the pick says.
		expect(mine({ viewerUserId: 30, voicedPersonaId: 8 })).toEqual([9])
		const asGuest = projectCharacters(source({ viewerUserId: 30 }))
		expect(member(asGuest, 8).mine).toBe(false)
		const asOwner = projectCharacters(source({ viewerUserId: 10 }))
		expect(asOwner.members.filter((m) => m.mine).map((m) => m.characterId)).toEqual([8])
		// A character is never "mine", even on a card the viewer owns.
		expect(member(asOwner, 4).mine).toBe(false)
		expect(projectCharacters(source({ viewerUserId: null })).members.some((m) => m.mine)).toBe(false)
	})

	test("canChangeSpriteSet is the server's rule: the session's owner or the card's, for a seated character only", () => {
		const offered = (viewerUserId: number | null) =>
			projectCharacters(source({ viewerUserId }))
				.members.filter((m) => m.canChangeSpriteSet)
				.map((m) => m.characterId)
		// The session's owner: every seated character, no persona (a persona is voiced, not seated).
		expect(offered(10)).toEqual([3, 4])
		// A guest who owns Ada's card: Ada alone.
		expect(offered(20)).toEqual([3])
		// A guest who owns nothing seated, and nobody in particular.
		expect(offered(30)).toEqual([])
		expect(offered(null)).toEqual([])
	})

	test("a pin is matched to its member by face — the full avatar or the Scene images tab's thumbnail", () => {
		const out = projectCharacters(
			source({ sceneImages: { left: thumb(1), right: full(6) } })
		)
		expect(out.sceneImages).toEqual({
			left: { src: thumb(1), ref: "character:3" },
			right: { src: full(6), ref: "character:9" }
		})
	})

	test("a pin from a gallery pictures nobody, and an empty side is null", () => {
		const out = projectCharacters(source({ sceneImages: { left: "/media/77", right: null } }))
		expect(out.sceneImages).toEqual({ left: { src: "/media/77", ref: null }, right: null })
	})

	test("leaves out who has left: inactive or removed characters, removed personas, empty seats; each member once", () => {
		const out = projectCharacters(
			source({
				session: session({
					sessionCharacters: [
						{ isActive: false, removedAt: null, position: 0, character: ada },
						{ isActive: true, removedAt: "2026-09-01", position: 1, character: bo },
						{ isActive: true, removedAt: null, position: 2, character: null },
						{ isActive: true, removedAt: null, position: 3, character: kit }
					],
					sessionPersonas: [
						{ removedAt: null, position: 0, persona: kit },
						{ removedAt: "2026-09-02", position: 1, persona: wren }
					]
				})
			})
		)
		expect(out.members.map((m) => [m.characterId, m.isPersona])).toEqual([[8, false]])
	})

	test("missing data: no session is nobody, with the page's pins still shown", () => {
		expect(projectCharacters(source({ session: null, sceneImages: { left: full(1), right: null } }))).toEqual({
			members: [],
			sceneImages: { left: { src: full(1), ref: null }, right: null }
		})
		const bare = projectCharacters(source({ session: { sessionCharacters: [{ character: { id: 5 } }] } }))
		expect(bare.members).toEqual([
			{
				ref: "character:5",
				characterId: 5,
				isPersona: false,
				mine: false,
				name: "",
				face: null,
				sprite: null,
				spriteSets: [],
				spriteSet: null,
				spriteSetOverride: null,
				canChangeSpriteSet: false
			}
		])
	})

	test("is detached: a widget cannot reach into the payload", () => {
		const s = session()
		const out = projectCharacters(source({ session: s }))
		member(out, 3).spriteSets.push("Stolen")
		expect(ada.spriteSets!.map((x) => x.name)).toEqual(["Casual", "Armor"])
	})
})
