/**
 * The pure mapping between a cast version and the member form's column names:
 * `memberColumnsOfVersion` (version → columns) and `castChangesOfMemberEdit`
 * (an edit → the version changes it means).
 */
import { describe, expect, it } from "vitest"
import {
	castChangesOfMemberEdit,
	memberColumnsOfVersion,
	splitExampleDialogues,
	type MemberColumnsOfVersion
} from "./retold"
import {
	emptyCharacterProfile,
	type CharacterProfileField,
	type CharacterProfileV1
} from "$lib/shared/characters/profile"

type VersionArg = Parameters<typeof memberColumnsOfVersion>[0]

/** A cast version that follows `follows` and holds `own` for the rest. */
const version = (
	own: Partial<CharacterProfileV1> = {},
	follows: CharacterProfileField[] = [],
	node: Partial<Pick<VersionArg, "nodeState" | "nodeVisibility">> = {}
): VersionArg => ({
	...emptyCharacterProfile(),
	...own,
	follows,
	nodeState: null,
	nodeVisibility: null,
	...node
})

/** The card the member follows: solo greetings, one group-only. */
const card = (over: Partial<CharacterProfileV1> = {}): CharacterProfileV1 => ({
	...emptyCharacterProfile(),
	name: "Ada",
	description: "A mathematician.",
	greetings: [
		{ text: "Hello." },
		{ text: "Hi again." },
		{ text: "Welcome all.", groupOnly: true }
	],
	...over
})

/** Every field a carded member follows. */
const FOLLOWING: CharacterProfileField[] = [
	"name",
	"nickname",
	"description",
	"personality",
	"scenario",
	"greetings",
	"exampleDialogues",
	"faceMediaId",
	"timbre",
	"postHistoryInstructions",
	"creatorNotes",
	"likeness"
]

const edit = (
	base: MemberColumnsOfVersion,
	over: Partial<MemberColumnsOfVersion>,
	opts: { card: CharacterProfileV1 | null; characterId?: number | null }
) => {
	const characterId = opts.characterId === undefined ? 7 : opts.characterId
	return castChangesOfMemberEdit(
		{ ...base, characterId },
		{ ...base, ...over, characterId },
		opts.card
	)
}

describe("memberColumnsOfVersion", () => {
	it("a carded member that follows everything has no retold flags and no own names", () => {
		const cols = memberColumnsOfVersion(version({}, FOLLOWING), {
			carded: true
		})
		expect(cols.retold).toEqual({})
		expect(cols.ownName).toBeNull()
		expect(cols.ownNickname).toBeNull()
		expect(cols.name).toBeNull()
	})

	it("a field is retold exactly when its profile field is not followed", () => {
		const cols = memberColumnsOfVersion(
			version(
				{
					description: "Her own",
					greetings: [{ text: "Mine." }, { text: "Mine too." }],
					faceMediaId: 12
				},
				FOLLOWING.filter(
					(f) =>
						f !== "description" &&
						f !== "greetings" &&
						f !== "faceMediaId"
				)
			),
			{ carded: true }
		)
		expect(cols.retold).toEqual({
			description: true,
			firstMessage: true,
			alternateGreetings: true,
			face: true
		})
		expect(cols.description).toBe("Her own")
		expect(cols.firstMessage).toBe("Mine.")
		expect(cols.alternateGreetings).toEqual(["Mine too."])
		expect(cols.faceMediaId).toBe(12)
	})

	it("keeps a followed field's own column (toggling off hides, never discards)", () => {
		const cols = memberColumnsOfVersion(
			version({ description: "Kept words" }, FOLLOWING),
			{ carded: true }
		)
		expect(cols.description).toBe("Kept words")
		expect(cols.retold.description).toBeUndefined()
	})

	it("joins example dialogues so splitExampleDialogues gives them back; none is null", () => {
		const dialogues = ["A: hi\nB: hey", "A: bye"]
		const cols = memberColumnsOfVersion(
			version({ exampleDialogues: dialogues }),
			{ carded: false }
		)
		expect(cols.exampleDialogues).toBe(
			"<START>\nA: hi\nB: hey\n\n<START>\nA: bye"
		)
		expect(splitExampleDialogues(cols.exampleDialogues)).toEqual(dialogues)
		expect(
			memberColumnsOfVersion(version({}), { carded: false })
				.exampleDialogues
		).toBeNull()
	})

	it("an own nickname of null is the empty string (no nickname in this book)", () => {
		const names = (
			nickname: string | null,
			follows: CharacterProfileField[]
		) =>
			memberColumnsOfVersion(
				version({ name: "Ada Own", nickname }, follows),
				{ carded: true }
			)
		expect(names(null, ["description"]).ownNickname).toBe("")
		expect(names("Ads", ["description"]).ownNickname).toBe("Ads")
		expect(names("Ads", ["nickname"]).ownNickname).toBeNull()
		expect(names(null, ["description"]).ownName).toBe("Ada Own")
		expect(names(null, ["name"]).ownName).toBeNull()
	})

	it("a card-less version is simply its own: no flags, no own names, its name", () => {
		const cols = memberColumnsOfVersion(
			version({
				name: "The innkeeper",
				description: "Round and kind.",
				aliases: ["Maren"],
				summary: "Keeps the inn."
			}),
			{ carded: false }
		)
		expect(cols.retold).toEqual({})
		expect(cols.ownName).toBeNull()
		expect(cols.ownNickname).toBeNull()
		expect(cols.name).toBe("The innkeeper")
		expect(cols.description).toBe("Round and kind.")
		expect(cols.aliases).toEqual(["Maren"])
		expect(cols.summary).toBe("Keeps the inn.")
	})

	it("node state and visibility default to active and normal", () => {
		expect(
			memberColumnsOfVersion(version(), { carded: false })
		).toMatchObject({ nodeState: "active", nodeVisibility: "normal" })
		expect(
			memberColumnsOfVersion(
				version({}, [], {
					nodeState: "deceased",
					nodeVisibility: "hidden"
				}),
				{ carded: false }
			)
		).toMatchObject({ nodeState: "deceased", nodeVisibility: "hidden" })
	})
})

describe("castChangesOfMemberEdit", () => {
	const following = memberColumnsOfVersion(version({}, FOLLOWING), {
		carded: true
	})

	it("round trip: a version's columns, sent back unchanged, change nothing", () => {
		for (const v of [
			version({}, FOLLOWING),
			version(
				{
					name: "Own",
					nickname: null,
					description: "Mine",
					greetings: [
						{ text: "Hi" },
						{ text: "Group", groupOnly: true }
					]
				},
				[
					"personality",
					"scenario",
					"exampleDialogues",
					"faceMediaId",
					"timbre"
				]
			)
		]) {
			const cols = memberColumnsOfVersion(v, { carded: true })
			expect(edit(cols, {}, { card: card() })).toBeNull()
		}
		const cardless = memberColumnsOfVersion(
			version({ name: "Bit part", description: "x" }),
			{ carded: false }
		)
		expect(edit(cardless, {}, { card: null, characterId: null })).toBeNull()
	})

	it("retelling a field writes the member's text", () => {
		expect(
			edit(
				following,
				{ retold: { description: true }, description: "Her own" },
				{ card: card() }
			)
		).toEqual({ description: "Her own" })
	})

	it("turning retold.description off makes the field follow again", () => {
		const own = memberColumnsOfVersion(
			version(
				{ description: "Her own" },
				FOLLOWING.filter((f) => f !== "description")
			),
			{ carded: true }
		)
		expect(own.retold.description).toBe(true)
		expect(edit(own, { retold: {} }, { card: card() })).toEqual({
			description: { follow: true }
		})
	})

	it("never emits a field nobody touched (group-only greetings stay)", () => {
		const own = memberColumnsOfVersion(
			version(
				{
					description: "Mine",
					greetings: [
						{ text: "Hi" },
						{ text: "Group", groupOnly: true }
					]
				},
				FOLLOWING.filter(
					(f) => f !== "description" && f !== "greetings"
				)
			),
			{ carded: true }
		)
		const changes = edit(
			own,
			{ description: "Mine, edited" },
			{ card: card() }
		)
		expect(changes).toEqual({ description: "Mine, edited" })
		expect(changes).not.toHaveProperty("greetings")
	})

	it("an own empty nickname is written as no nickname; clearing the own nickname follows the card", () => {
		expect(edit(following, { ownNickname: "" }, { card: card() })).toEqual({
			nickname: null
		})
		const withNickname = memberColumnsOfVersion(
			version(
				{ nickname: "Ads" },
				FOLLOWING.filter((f) => f !== "nickname")
			),
			{ carded: true }
		)
		expect(withNickname.ownNickname).toBe("Ads")
		expect(
			edit(withNickname, { ownNickname: null }, { card: card() })
		).toEqual({ nickname: { follow: true } })
	})

	it("an own name is written, and removing it follows the card", () => {
		expect(
			edit(following, { ownName: "Countess Ada" }, { card: card() })
		).toEqual({ name: "Countess Ada" })
		const named = memberColumnsOfVersion(
			version(
				{ name: "Countess Ada" },
				FOLLOWING.filter((f) => f !== "name")
			),
			{ carded: true }
		)
		expect(edit(named, { ownName: null }, { card: card() })).toEqual({
			name: { follow: true }
		})
	})

	it("mixed greetings: only the opener retold = the member's opener + the card's other solo greetings", () => {
		expect(
			edit(
				following,
				{ retold: { firstMessage: true }, firstMessage: "My hello." },
				{ card: card() }
			)
		).toEqual({ greetings: [{ text: "My hello." }, { text: "Hi again." }] })
		// Only the alternates retold: the card's opener + the member's list.
		expect(
			edit(
				following,
				{
					retold: { alternateGreetings: true },
					alternateGreetings: ["Mine one", "Mine two"]
				},
				{ card: card() }
			)
		).toEqual({
			greetings: [
				{ text: "Hello." },
				{ text: "Mine one" },
				{ text: "Mine two" }
			]
		})
	})

	it("both greeting halves retold are the member's whole list; neither retold follows", () => {
		const both = edit(
			following,
			{
				retold: { firstMessage: true, alternateGreetings: true },
				firstMessage: "Mine",
				alternateGreetings: ["Alt"]
			},
			{ card: card() }
		)
		expect(both).toEqual({ greetings: [{ text: "Mine" }, { text: "Alt" }] })
		const own = memberColumnsOfVersion(
			version(
				{ greetings: [{ text: "Mine" }] },
				FOLLOWING.filter((f) => f !== "greetings")
			),
			{ carded: true }
		)
		expect(edit(own, { retold: {} }, { card: card() })).toEqual({
			greetings: { follow: true }
		})
	})

	it("example dialogues and the face follow the same rule", () => {
		expect(
			edit(
				following,
				{
					retold: { exampleDialogues: true, face: true },
					exampleDialogues: "<START>\nA: hi",
					faceMediaId: 44
				},
				{ card: card() }
			)
		).toEqual({ exampleDialogues: ["A: hi"], faceMediaId: 44 })
		// A face flag with no picture still follows the card's.
		expect(
			edit(following, { retold: { face: true } }, { card: card() })
		).toEqual({ faceMediaId: { follow: true } })
	})

	it("a card-less member's edit writes its name, text and aliases as its own", () => {
		const cardless = memberColumnsOfVersion(
			version({ name: "Bit part", description: "x" }),
			{ carded: false }
		)
		expect(
			edit(
				cardless,
				{ name: "Bit player", description: "y", aliases: ["BP"] },
				{ card: null, characterId: null }
			)
		).toEqual({ name: "Bit player", description: "y", aliases: ["BP"] })
	})

	it("node state and visibility are node changes, only when they differ", () => {
		expect(
			edit(following, { nodeState: "deceased" }, { card: card() })
		).toEqual({ nodeState: "deceased" })
		expect(
			edit(
				following,
				{ nodeVisibility: "hidden", summary: "A line." },
				{ card: card() }
			)
		).toEqual({ nodeVisibility: "hidden", summary: "A line." })
	})
})

describe("group-only greetings (B5)", () => {
	const withGroup = version({
		name: "Own",
		greetings: [
			{ text: "Hi" },
			{ text: "Again" },
			{ text: "Everyone.", groupOnly: true }
		]
	})

	it("memberColumnsOfVersion holds the version's group-only greetings apart", () => {
		const cols = memberColumnsOfVersion(withGroup, { carded: false })
		expect(cols.firstMessage).toBe("Hi")
		expect(cols.alternateGreetings).toEqual(["Again"])
		expect(cols.groupOnlyGreetings).toEqual(["Everyone."])
		expect(
			memberColumnsOfVersion(version({}, FOLLOWING), { carded: true })
				.groupOnlyGreetings
		).toEqual([])
	})

	it("a card-less member's edited group-only greetings are a greetings change keeping the rest", () => {
		const cols = memberColumnsOfVersion(withGroup, { carded: false })
		expect(
			edit(
				cols,
				{ groupOnlyGreetings: ["Gather round."] },
				{ card: null, characterId: null }
			)
		).toEqual({
			greetings: [
				{ text: "Hi" },
				{ text: "Again" },
				{ text: "Gather round.", groupOnly: true }
			]
		})
	})

	it("a member that retells both greeting fields keeps its group-only list; an unchanged one changes nothing", () => {
		const both = memberColumnsOfVersion(
			version(
				{
					greetings: [
						{ text: "Mine" },
						{ text: "Too", groupOnly: true }
					]
				},
				["name", "nickname"]
			),
			{ carded: true }
		)
		expect(both.retold).toMatchObject({
			firstMessage: true,
			alternateGreetings: true
		})
		expect(edit(both, {}, { card: card() })).toBeNull()
		expect(
			edit(both, { groupOnlyGreetings: ["Three"] }, { card: card() })
		).toEqual({
			greetings: [{ text: "Mine" }, { text: "Three", groupOnly: true }]
		})
	})

	it("a member that follows the card's greetings follows them still", () => {
		expect(
			edit(
				memberColumnsOfVersion(version({}, FOLLOWING), {
					carded: true
				}),
				{ groupOnlyGreetings: ["Mine"] },
				{ card: card() }
			)
		).toEqual({ greetings: { follow: true } })
	})
})

describe("post-history instructions, creator notes, likeness", () => {
	const THREE = [
		"postHistoryInstructions",
		"creatorNotes",
		"likeness"
	] as const
	const FOLLOWING_ALL_BUT = FOLLOWING.filter(
		(f) => !(THREE as readonly string[]).includes(f)
	)
	const OWN = { postHistoryInstructions: "Stay in voice." }

	it("memberColumnsOfVersion: retold exactly when not followed; the value is kept while followed", () => {
		const followed = memberColumnsOfVersion(version(OWN, FOLLOWING), {
			carded: true
		})
		for (const f of THREE) expect(followed.retold[f]).toBeUndefined()
		expect(followed.postHistoryInstructions).toBe("Stay in voice.")
		const own = memberColumnsOfVersion(version(OWN, FOLLOWING_ALL_BUT), {
			carded: true
		})
		for (const f of THREE) expect(own.retold[f]).toBe(true)
		const cardless = memberColumnsOfVersion(version(OWN), { carded: false })
		expect(cardless.retold).toEqual({})
		expect(cardless.postHistoryInstructions).toBe("Stay in voice.")
	})

	it("castChangesOfMemberEdit: a flag off follows; a flag on (or a changed value) writes the own value", () => {
		const own = memberColumnsOfVersion(version(OWN, FOLLOWING_ALL_BUT), {
			carded: true
		})
		expect(
			edit(
				own,
				{ retold: { ...own.retold, postHistoryInstructions: false } },
				{ card: card() }
			)
		).toEqual({ postHistoryInstructions: { follow: true } })
		const followed = memberColumnsOfVersion(version(OWN, FOLLOWING), {
			carded: true
		})
		expect(
			edit(
				followed,
				{
					retold: {
						...followed.retold,
						postHistoryInstructions: true
					}
				},
				{ card: card() }
			)
		).toEqual({ postHistoryInstructions: "Stay in voice." })
		expect(
			edit(
				followed,
				{
					retold: { ...followed.retold, likeness: true },
					likeness: { prompt: "red coat" }
				},
				{ card: card() }
			)
		).toEqual({ likeness: { prompt: "red coat" } })
		expect(edit(own, {}, { card: card() })).toBeNull()
		expect(edit(followed, {}, { card: card() })).toBeNull()
	})

	it("a card-less edit writes the value", () => {
		const bare = memberColumnsOfVersion(version({ name: "Bo" }), {
			carded: false
		})
		expect(
			edit(
				bare,
				{ creatorNotes: { text: "n", variants: {} } },
				{ card: null, characterId: null }
			)
		).toEqual({ creatorNotes: { text: "n", variants: {} } })
	})
})
