/**
 * `characters.v1` (R76) off the session payload: cast over card, every URL
 * resolved as the native portraits resolve it, the VIEWER's personas marked
 * (R77), the sprite-set switch offered exactly where the server allows it,
 * and the page's own pins matched to the member they picture.
 */
import { describe, expect, test } from "vitest"
import { avatarSrc } from "$lib/client/utils/media"
import {
	castNameOf,
	messagesAsOf,
	projectCharacters,
	speakerOf,
	seatCardAsShown,
	seatCardsAsShown,
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
			canChangeSpriteSet: true,
			lastSpokeAt: null,
			benched: false
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

	test("W6: lastSpokeAt is the newest visible line's time — a character's by characterId, a persona's by personaId", () => {
		const at = (iso: string) => Date.parse(iso)
		const out = projectCharacters(
			source({
				session: session({
					sessionMessages: [
						{ id: 10, characterId: 3, createdAt: "2026-10-01T10:00:00.000Z" },
						{ id: 11, personaId: 8, createdAt: "2026-10-01T10:01:00.000Z" },
						{ id: 12, characterId: 3, createdAt: "2026-10-01T10:02:00.000Z" },
						// A hidden line is not speaking; neither is one with no time.
						{ id: 13, characterId: 3, isHidden: true, createdAt: "2026-10-01T10:09:00.000Z" },
						{ id: 14, characterId: 4, createdAt: null },
						{ id: 15, personaId: 9, createdAt: at("2026-10-01T10:03:00.000Z") }
					]
				})
			})
		)
		expect(out.members.map((m) => [m.characterId, m.lastSpokeAt])).toEqual([
			[3, at("2026-10-01T10:02:00.000Z")],
			[4, null],
			[8, at("2026-10-01T10:01:00.000Z")],
			[9, at("2026-10-01T10:03:00.000Z")],
			[11, null]
		])
		// No count rides the payload: galleryCount is left out (absent = not known).
		expect(out.members.every((m) => !("galleryCount" in m))).toBe(true)
	})

	test("W6: a benched character is listed, marked benched — a removed one still is not", () => {
		const out = projectCharacters(
			source({
				session: session({
					sessionCharacters: [
						{ isActive: false, removedAt: null, position: 0, character: ada },
						{ isActive: true, removedAt: null, position: 1, character: bo }
					]
				})
			})
		)
		expect(out.members.filter((m) => !m.isPersona).map((m) => [m.characterId, m.benched])).toEqual([
			[3, true],
			[4, false]
		])
		// A persona seat with no bench column reads as in play.
		expect(out.members.filter((m) => m.isPersona).every((m) => m.benched === false)).toBe(true)
	})

	test("a benched player seat is listed, marked benched (owner 2026-11-10)", () => {
		const out = projectCharacters(
			source({
				session: session({
					sessionPersonas: [
						{ isActive: false, removedAt: null, position: 0, persona: kit },
						{ isActive: true, removedAt: null, position: 1, persona: wren }
					]
				})
			})
		)
		expect(out.members.filter((m) => m.isPersona).map((m) => [m.characterId, m.benched])).toEqual([
			[kit.id, true],
			[wren.id, false]
		])
	})

	test("leaves out who has left: removed characters, removed personas, empty seats; each member once (a benched one stays)", () => {
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
		expect(out.members.map((m) => [m.characterId, m.isPersona, m.benched])).toEqual([
			[3, false, true],
			[8, false, false]
		])
	})

	test("missing data: no session is nobody, with the page's pins still shown", () => {
		expect(projectCharacters(source({ session: null, sceneImages: { left: full(1), right: null } }))).toEqual({
			members: [],
			speakerRef: null,
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
				canChangeSpriteSet: false,
				lastSpokeAt: null,
				benched: false
			}
		])
	})

	test("without castFaces every face is the card's", () => {
		const bare = projectCharacters(source({ session: session({ castFaces: undefined }) }))
		const none = projectCharacters(source({ session: session({ castFaces: null }) }))
		const empty = projectCharacters(source({ session: session({ castFaces: {} }) }))
		expect(member(bare, 3).face).toBe(full(1))
		expect(member(bare, 4).face).toBeNull()
		expect(none).toEqual(bare)
		expect(empty).toEqual(bare)
	})

	test("a castFaces entry makes the member's retold face the face", () => {
		const out = projectCharacters(
			source({ session: session({ castFaces: { 3: 501, 4: 502, 9: 503 } }) })
		)
		expect(member(out, 3).face).toBe("/media/501")
		// A card with no avatar of its own gains the cast's face.
		expect(member(out, 4).face).toBe("/media/502")
		// A persona's seat reads its cast member too (s27 S2c).
		expect(member(out, 9).face).toBe("/media/503")
		// The sprite is untouched by a retold face.
		expect(member(out, 3).sprite).toBe(full(3))
	})

	test("a pin matches the retold face, full or thumbnail, and still the card's", () => {
		const retold = session({ castFaces: { 3: 501 } })
		expect(
			projectCharacters(
				source({ session: retold, sceneImages: { left: "/media/501", right: "/media/501?v=thumb" } })
			).sceneImages
		).toEqual({
			left: { src: "/media/501", ref: "character:3" },
			right: { src: "/media/501?v=thumb", ref: "character:3" }
		})
		expect(
			projectCharacters(source({ session: retold, sceneImages: { left: full(1), right: thumb(1) } }))
				.sceneImages
		).toEqual({
			left: { src: full(1), ref: "character:3" },
			right: { src: thumb(1), ref: "character:3" }
		})
	})

	test("is detached: a widget cannot reach into the payload", () => {
		const s = session()
		const out = projectCharacters(source({ session: s }))
		member(out, 3).spriteSets.push("Stolen")
		expect(ada.spriteSets!.map((x) => x.name)).toEqual(["Casual", "Armor"])
	})
})

describe("castNames (§0-D)", () => {
	test("absent, null or {} read the card's, unchanged", () => {
		const bare = projectCharacters(source({ session: session() }))
		expect(member(bare, 3).name).toBe("Ada")
		for (const castNames of [null, {}]) {
			const out = projectCharacters(source({ session: session({ castNames }) }))
			expect(out).toEqual(bare)
		}
	})

	test("a seat shows the cast member's own name, a persona's seat as a character's", () => {
		const out = projectCharacters(
			source({
				session: session({
					castNames: {
						3: { ownName: "Adel", ownNickname: "" },
						4: { ownName: null, ownNickname: "Bobo" },
						9: { ownName: "Nope", ownNickname: null }
					}
				})
			})
		)
		expect(member(out, 3).name).toBe("Adel")
		expect(member(out, 4).name).toBe("Bobo")
		// The card's nickname stands unless the member gives one (★L-3b).
		expect(member(out, 9).name).toBe("Wee")
	})

	test("a persona's seat name wins over its cast member's name (★pT-1); without a member name the card's stands", () => {
		const seats = [
			{ removedAt: null, position: 0, persona: kit, seatName: "Captain" },
			{ removedAt: null, position: 1, persona: wren, seatName: "Lady W" }
		]
		const out = projectCharacters(
			source({
				session: session({
					sessionPersonas: seats,
					castNames: { 8: { ownName: "Kitty", ownNickname: "" } }
				})
			})
		)
		expect(member(out, 8).name).toBe("Captain")
		// No member name for Wren: the widgets read as before.
		expect(member(out, 9).name).toBe("Wee")
	})

	test("castNameOf falls back as resolveCharacterName does", () => {
		expect(castNameOf(session(), 3, ada, "x")).toBe("Ada")
		expect(
			castNameOf(session({ castNames: { 3: { ownName: "Adel", ownNickname: "" } } }), 3, ada)
		).toBe("Adel")
	})
})

describe("the seat's cast member (s27 S2)", () => {
	const memberSets = [
		{
			name: "Member",
			isDefault: true,
			sprites: [{ label: "neutral", position: 0, file: media(7) }]
		}
	]

	test("a member's own name and face are the seat's name and face", () => {
		const out = projectCharacters(
			source({
				session: session({
					castNames: { 3: { ownName: "Adel", ownNickname: "" } },
					castFaces: { 3: 21 }
				})
			})
		)
		expect(member(out, 3).name).toBe("Adel")
		expect(member(out, 3).face).toBe(avatarSrc({ avatarMediaId: 21 }, { full: true }))
		// The card's own face does not win over the member's.
		expect(member(out, 3).face).not.toBe(full(1))
	})

	test("a member's own sprite sets are the seat's sets, default and sprite", () => {
		const out = projectCharacters(
			source({ session: session({ sessionMessages: [], castSpriteSets: { 3: memberSets } }) })
		)
		expect(member(out, 3)).toMatchObject({
			spriteSets: ["Member"],
			spriteSet: "Member",
			sprite: full(7)
		})
		// Another seat keeps what it had.
		expect(member(out, 4)).toMatchObject({ spriteSets: [], spriteSet: null })
	})

	test("a member with none of its own reads exactly as the card", () => {
		expect(projectCharacters(source({ session: session({ castSpriteSets: {} }) }))).toEqual(
			projectCharacters(source())
		)
	})

	test("seatCardAsShown: the same object when nothing of the member's applies", () => {
		expect(seatCardAsShown(session(), ada)).toBe(ada)
		expect(seatCardAsShown(session({ castNames: {}, castFaces: {}, castSpriteSets: {} }), ada)).toBe(ada)
		expect(seatCardAsShown(null, ada)).toBe(ada)
		// Own names that restate nothing of the card's own are still the member's.
		expect(seatCardAsShown(session({ castNames: { 3: { ownName: "Adel", ownNickname: null } } }), ada)).not.toBe(ada)
	})

	test("seatCardAsShown: name, face (over the card's media row) and sets, the card untouched", () => {
		const shown = seatCardAsShown(
			session({
				castNames: { 3: { ownName: "Adel", ownNickname: "" } },
				castFaces: { 3: 21 },
				castSpriteSets: { 3: memberSets }
			}),
			ada
		)
		expect(shown).toMatchObject({ id: 3, name: "Adel", nickname: null, avatarMediaId: 21, avatarMedia: null })
		expect(avatarSrc(shown, { full: true })).toBe(avatarSrc({ avatarMediaId: 21 }, { full: true }))
		expect(shown.spriteSets).toEqual(memberSets)
		expect(ada).toMatchObject({ name: "Adeline", nickname: "Ada", avatarMedia: media(1) })
		expect(ada.spriteSets!.map((x) => x.name)).toEqual(["Casual", "Armor"])
	})

	test("seatCardsAsShown: the character seats' cards in payload order, personas left out", () => {
		const cards = seatCardsAsShown(session({ castNames: { 3: { ownName: "Adel", ownNickname: "" } } }))
		expect(cards.map((c) => c.id)).toEqual([4, 3])
		expect(cards[0]).toBe(bo)
		expect(cards[1].name).toBe("Adel")
	})
})

describe("a persona seat reads its cast member like every seat (s27 S2c, ★pT-1)", () => {
	test("its names, face and sprite sets are the member's, keyed by the persona's card id", () => {
		const set = [{ name: "Cloak", isDefault: true, sprites: [{ label: "neutral", position: 0, file: media(7) }] }]
		const out = projectCharacters(
			source({
				session: session({
					castNames: { 9: { ownName: "Wrenna", ownNickname: "" } },
					castFaces: { 9: 503 },
					castSpriteSets: { 9: set }
				})
			})
		)
		expect(member(out, 9)).toMatchObject({
			isPersona: true,
			name: "Wrenna",
			face: "/media/503",
			spriteSets: ["Cloak"],
			spriteSet: "Cloak"
		})
		// The sprite-set pick stays a character's.
		expect(member(out, 9)).toMatchObject({ spriteSetOverride: null, canChangeSpriteSet: false })
		// Another persona, with nothing in the maps, is as before.
		expect(member(out, 8)).toMatchObject({ name: "Kit", face: full(5) })
	})

	test("a pin of the member's face pictures the persona's seat", () => {
		const out = projectCharacters(
			source({ session: session({ castFaces: { 9: 503 } }), sceneImages: { left: "/media/503", right: null } })
		)
		expect(out.sceneImages.left).toEqual({ src: "/media/503", ref: "character:9" })
	})

	test("a persona with nothing in the maps reads exactly as before", () => {
		const bare = projectCharacters(source())
		const mapsList: Partial<CharactersSourceSession>[] = [
			{ castNames: {}, castFaces: {} },
			{ castNames: { 3: { ownName: "Adel", ownNickname: "" } } }
		]
		for (const maps of mapsList) {
			const out = projectCharacters(source({ session: session(maps) }))
			expect(member(out, 9)).toEqual(member(bare, 9))
			expect(member(out, 11)).toEqual(member(bare, 11))
		}
		expect(member(bare, 9)).toMatchObject({ name: "Wee", face: full(6) })
	})
})

describe("seat identity (s27 S3)", () => {
	test("today's payload: refs are character:<card id>, castMemberId is the seat's when it has the key, no cardId", () => {
		const out = projectCharacters(
			source({
				session: session({
					sessionCharacters: [
						{ isActive: true, removedAt: null, position: 0, characterId: 3, castMemberId: 50, character: ada },
						{ isActive: true, removedAt: null, position: 1, characterId: 4, castMemberId: null, character: bo }
					],
					sessionPersonas: [{ removedAt: null, position: 0, personaId: 8, castMemberId: 60, persona: kit }]
				}),
				sceneImages: { left: full(1), right: null }
			})
		)
		expect(out.members.map((m) => m.ref)).toEqual(["character:3", "character:4", "character:8"])
		expect(out.members.map((m) => m.castMemberId)).toEqual([50, null, 60])
		expect(out.members.some((m) => "cardId" in m)).toBe(false)
		expect(out.sceneImages.left).toEqual({ src: full(1), ref: "character:3" })
		// A fixture seat with no seat fields keeps the plain member shape.
		expect("castMemberId" in member(projectCharacters(source()), 3)).toBe(false)
	})

	test("S4 payload: refs, member ids and pins name the right person where card 7 and member 7 collide", () => {
		const ivy: CharacterCard = { id: 7, userId: 10, name: "Ivy", avatarMedia: media(1) }
		const joss: CharacterCard = { id: 31, userId: 10, name: "Joss", avatarMedia: media(2) }
		const tess: CharacterCard = { id: 12, userId: 30, name: "Tess", avatarMedia: media(3) }
		const out = projectCharacters(
			source({
				session: session({
					sessionCharacters: [
						// Card 7 is member 31's; card 31 is member 7's.
						{ id: 1, isActive: true, removedAt: null, position: 0, characterId: 7, castMemberId: 31, ref: "seated-member:31", cardId: 7, character: ivy },
						{ id: 2, isActive: true, removedAt: null, position: 1, characterId: 31, castMemberId: 7, ref: "seated-member:7", cardId: 31, character: joss }
					],
					sessionPersonas: [
						{ id: 9, removedAt: null, position: 0, personaId: 12, castMemberId: 40, ref: "player-seat:9", cardId: 12, persona: tess }
					]
				}),
				sceneImages: { left: full(2), right: full(3) }
			})
		)
		expect(out.members.map((m) => [m.ref, m.castMemberId, m.cardId, m.characterId])).toEqual([
			["seated-member:31", 31, 7, 7],
			["seated-member:7", 7, 31, 31],
			["player-seat:9", 40, 12, 12]
		])
		expect(out.sceneImages).toEqual({
			left: { src: full(2), ref: "seated-member:7" },
			right: { src: full(3), ref: "player-seat:9" }
		})
	})
})

describe("the stage as of the shown line", () => {
	const t = (iso: string) => Date.parse(iso)
	const log = [
		{ id: 10, characterId: 3, createdAt: "2026-10-01T10:00:00.000Z", metadata: { sprite: { set: "Casual", label: "neutral" } } },
		{ id: 11, characterId: 4, createdAt: "2026-10-01T10:01:00.000Z" },
		{ id: 12, characterId: 3, createdAt: "2026-10-01T10:02:00.000Z", metadata: { sprite: { set: "Casual", label: "happy" } } },
		{ id: 13, personaId: 9, createdAt: "2026-10-01T10:03:00.000Z" }
	]
	const stage = (over: Partial<CharactersSource> = {}) =>
		projectCharacters(source({ session: session({ sessionMessages: log }), ...over }))

	test("messagesAsOf cuts by message id, and returns the same array when no cut applies", () => {
		expect(messagesAsOf(log, 11).map((m) => m.id)).toEqual([10, 11])
		expect(messagesAsOf(log, null)).toBe(log)
		expect(messagesAsOf(log, undefined)).toBe(log)
		expect(messagesAsOf(log, 99)).toBe(log)
		expect(messagesAsOf(log, 5)).toBe(log)
	})

	test("sprites and last spoke follow the cut", () => {
		const whole = stage()
		const cut = stage({ shownMessageId: 11 })
		expect(member(cut, 3).lastSpokeAt).toBe(t("2026-10-01T10:00:00.000Z"))
		expect(member(whole, 3).lastSpokeAt).toBe(t("2026-10-01T10:02:00.000Z"))
		expect(member(cut, 4).lastSpokeAt).toBe(t("2026-10-01T10:01:00.000Z"))
		expect(member(cut, 9).lastSpokeAt).toBeNull()
		expect(member(whole, 9).lastSpokeAt).toBe(t("2026-10-01T10:03:00.000Z"))
		// Ada's face on line 10 is "neutral", on line 12 "happy".
		expect(member(cut, 3).sprite).toBe(full(2))
		expect(member(whole, 3).sprite).toBe(full(3))
	})

	test("a shown line outside the window is ignored: today's output, speaker apart", () => {
		expect(stage({ shownMessageId: 99 })).toEqual(stage())
		expect(stage({ shownMessageId: 5 })).toEqual(stage())
	})

	test("no shown line: the same members and pins as before; speakerRef is the newest visible line's writer", () => {
		const out = stage()
		expect(out.speakerRef).toBe("character:9")
		const { speakerRef: _, ...rest } = out
		expect(rest).toEqual({ members: out.members, sceneImages: out.sceneImages })
	})

	test("speakerRef names the shown line's writer; a persona line names the persona's ref", () => {
		expect(stage({ shownMessageId: 12 }).speakerRef).toBe("character:3")
		expect(stage({ shownMessageId: 11 }).speakerRef).toBe("character:4")
		expect(stage({ shownMessageId: 13 }).speakerRef).toBe("character:9")
	})

	test("hidden lines: skipped for the newest, but the shown line's writer is the speaker even when hidden", () => {
		const hidden = [
			{ id: 10, characterId: 3 },
			{ id: 11, characterId: 4, isHidden: true }
		]
		const out = (shown?: number) =>
			projectCharacters(
				source({ session: session({ sessionMessages: hidden }), shownMessageId: shown })
			)
		expect(out().speakerRef).toBe("character:3")
		expect(out(11).speakerRef).toBe("character:4")
		// A hidden later line by the shown speaker moves nothing else.
		expect(speakerOf(hidden)).toBe(3)
		expect(speakerOf(hidden, 11)).toBe(4)
	})

	test("narration, a person with no persona and a card not seated give null", () => {
		const speaker = (messages: CharactersSourceSession["sessionMessages"], shown?: number) =>
			projectCharacters(
				source({ session: session({ sessionMessages: messages }), shownMessageId: shown })
			).speakerRef
		expect(speaker([{ id: 1 }])).toBeNull()
		expect(speaker([])).toBeNull()
		expect(speaker([{ id: 1, characterId: 3 }, { id: 2 }])).toBeNull()
		expect(speaker([{ id: 1, characterId: 77 }])).toBeNull()
		expect(speaker([{ id: 1, characterId: 3 }, { id: 2 }], 1)).toBe("character:3")
	})

	test("a precomputed speakerId is used as given", () => {
		expect(stage({ speakerId: 4 }).speakerRef).toBe("character:4")
		expect(stage({ speakerId: null }).speakerRef).toBeNull()
	})
})
