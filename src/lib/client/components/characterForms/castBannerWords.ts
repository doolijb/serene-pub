/**
 * The words of the card editor's cast banner (plans/PLAN-cast-retold-fields-2026-10-13.md).
 *
 * A card is a starter; a cast member is that card inside one lorebook, and a
 * member may retell some of the card's fields in their own words. The banner
 * on the edit form says how many members the card represents and which of them
 * retell parts of it. Pure, so the counting and the plurals are tested apart
 * from the form.
 */

/** A card field a cast member may tell in their own words (NOMENCLATURE §8 *retold*). */
export type CastBannerRetoldField =
	| "description"
	| "personality"
	| "scenario"
	| "firstMessage"
	| "alternateGreetings"
	| "exampleDialogues"
	| "face"

/** One row of `lorebooks:bindingsForCharacter`'s `members`. */
export interface CastBannerMember {
	lorebookId: number
	lorebookName: string
	castId: number
	retold: CastBannerRetoldField[]
}

/** The field names as a reader sees them, lower case for use mid-sentence. */
export const RETOLD_FIELD_WORDS: Record<CastBannerRetoldField, string> = {
	description: "description",
	personality: "personality",
	scenario: "scenario",
	firstMessage: "first message",
	alternateGreetings: "alternate greetings",
	exampleDialogues: "example dialogues",
	face: "face"
}

/** Display order: the card form's own order, the face last. */
const FIELD_ORDER: CastBannerRetoldField[] = [
	"description",
	"personality",
	"scenario",
	"firstMessage",
	"alternateGreetings",
	"exampleDialogues",
	"face"
]

function plural(n: number, one: string, many: string): string {
	return `${n} ${n === 1 ? one : many}`
}

/** "description, face" — known fields only, in form order, deduplicated. */
export function retoldFieldList(fields: readonly string[]): string {
	const set = new Set(fields)
	return FIELD_ORDER.filter((f) => set.has(f))
		.map((f) => RETOLD_FIELD_WORDS[f])
		.join(", ")
}

export interface CastBannerWords {
	/** "Represents 2 cast members in 2 lorebooks." */
	represents: string
	/**
	 * "1 of them retells parts of this card: description, face." — null when
	 * no member retells anything.
	 */
	retells: string | null
}

/** The banner's sentences, or null when the card represents no cast member. */
export function castBannerWords(
	members: readonly CastBannerMember[] | null | undefined
): CastBannerWords | null {
	if (!members || members.length === 0) return null
	const books = new Set(members.map((m) => m.lorebookId)).size
	const represents = `Represents ${plural(members.length, "cast member", "cast members")} in ${plural(books, "lorebook", "lorebooks")}.`
	const retelling = members.filter((m) => retoldFieldList(m.retold) !== "")
	if (retelling.length === 0) return { represents, retells: null }
	const fields = retoldFieldList(retelling.flatMap((m) => m.retold))
	const who =
		members.length === 1
			? "It retells"
			: `${retelling.length} of them ${retelling.length === 1 ? "retells" : "retell"}`
	return { represents, retells: `${who} parts of this card: ${fields}.` }
}
