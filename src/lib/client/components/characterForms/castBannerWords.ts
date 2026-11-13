/**
 * The words of the card editor's cast line (plans/PLAN-cast-retold-fields-2026-10-13.md;
 * one muted line under the name since polish parity L5, 2026-10-24 — it was a
 * banner card over the form).
 *
 * A card is a starter; a cast member is that card inside one lorebook, and a
 * member may retell some of the card's fields in their own words. The line
 * on the edit form leads with the lorebooks ("In 2 lorebooks:", each name a
 * link); how many members it represents, which of them retell parts of it and
 * what a card is ride the line's title. Pure, so the counting and the plurals
 * are tested apart from the form.
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
	| "postHistoryInstructions"
	| "creatorNotes"
	| "likeness"

/** One row of `lorebooks:bindingsForCharacter`'s `members`. */
export interface CastBannerMember {
	lorebookId: number
	lorebookName: string
	castId: number
	retold: CastBannerRetoldField[]
	/** The fields this member still reads from the card (editing the card changes them). */
	followsCard: CastBannerRetoldField[]
	/** The name the member is shown by in its lorebook. */
	memberName: string
	/** The card version the member reads from; null when it follows none. */
	cardVersion?: { id: number; number: number; label: string | null } | null
	/** The card's current version; null when the card has none. */
	cardCurrentVersion?: {
		id: number
		number: number
		label: string | null
	} | null
	/** The member reads from an older card version than the card's current one. */
	behindCard?: boolean
}

/** The field names as a reader sees them, lower case for use mid-sentence. */
export const RETOLD_FIELD_WORDS: Record<CastBannerRetoldField, string> = {
	description: "description",
	personality: "personality",
	scenario: "scenario",
	firstMessage: "first message",
	alternateGreetings: "alternate greetings",
	exampleDialogues: "example dialogues",
	face: "face",
	postHistoryInstructions: "post-history instructions",
	creatorNotes: "creator notes",
	likeness: "likeness"
}

/** Display order: the card form's own order, the face last. */
const FIELD_ORDER: CastBannerRetoldField[] = [
	"description",
	"personality",
	"scenario",
	"firstMessage",
	"alternateGreetings",
	"exampleDialogues",
	"postHistoryInstructions",
	"creatorNotes",
	"likeness",
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

/** The line's title: what a card is beside its cast members. */
export const CAST_LINE_NOTE =
	"A card is where a character starts; what a story changes about them is kept on their cast member."

export interface CastBannerWords {
	/** "In 2 lorebooks:" — the line's visible lead, before the books' names. */
	lead: string
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
	const lead = `In ${plural(books, "lorebook", "lorebooks")}:`
	const represents = `Represents ${plural(members.length, "cast member", "cast members")} in ${plural(books, "lorebook", "lorebooks")}.`
	const retelling = members.filter((m) => retoldFieldList(m.retold) !== "")
	if (retelling.length === 0) return { lead, represents, retells: null }
	const fields = retoldFieldList(retelling.flatMap((m) => m.retold))
	const who =
		members.length === 1
			? "It retells"
			: `${retelling.length} of them ${retelling.length === 1 ? "retells" : "retell"}`
	return {
		lead,
		represents,
		retells: `${who} parts of this card: ${fields}.`
	}
}

/** "a", "a and b", "a, b and c" — no Oxford comma. */
function joinWords(words: readonly string[]): string {
	if (words.length <= 1) return words.join("")
	return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`
}

/**
 * Fields in form order as words; the first message and the alternate
 * greetings, when both are listed, are said once as "greetings".
 */
function fieldWords(fields: ReadonlySet<CastBannerRetoldField>): string[] {
	const both = fields.has("firstMessage") && fields.has("alternateGreetings")
	const words: string[] = []
	for (const f of FIELD_ORDER) {
		if (!fields.has(f)) continue
		if (both && f === "alternateGreetings") continue
		words.push(
			both && f === "firstMessage" ? "greetings" : RETOLD_FIELD_WORDS[f]
		)
	}
	return words
}

/** The field words that are one singular thing: "their face is", not "their greetings is". */
const SINGULAR_FIELD_WORDS = new Set([
	"description",
	"personality",
	"scenario",
	"first message",
	"likeness",
	"face"
])

/**
 * One piece of the editing sentence: plain words, or a lorebook's name with
 * the member it stands for (a reader opens that member from it).
 */
export type CastEditPart =
	| string
	| { lorebookId: number; castId: number; lorebookName: string }

/** Neighbouring words made one string, so a sentence has no needless seams. */
function mergeWords(parts: readonly CastEditPart[]): CastEditPart[] {
	const out: CastEditPart[] = []
	for (const part of parts) {
		const last = out[out.length - 1]
		if (typeof part === "string" && typeof last === "string")
			out[out.length - 1] = last + part
		else out.push(part)
	}
	return out
}

/** `joinWords` over pieces: "a", "a and b", "a, b and c". */
function joinPieces(items: readonly CastEditPart[][]): CastEditPart[] {
	const out: CastEditPart[] = []
	items.forEach((item, i) => {
		if (i > 0) out.push(i === items.length - 1 ? " and " : ", ")
		out.push(...item)
	})
	return out
}

/**
 * The editing sentence under the cast line: which cast members editing this
 * card changes, and which of their parts are their own — as pieces, each
 * lorebook's name carrying its member. Only members that still read some
 * field from the card count; null when none do. Given the card version
 * being edited, only members that read from that version count (a member
 * whose reply carries no `cardVersion` still counts).
 */
export function castEditParts(
	members: readonly CastBannerMember[] | null | undefined,
	editedCardVersionId?: number
): CastEditPart[] | null {
	if (!members) return null
	const groups = new Map<
		string,
		{
			name: string
			follows: Set<CastBannerRetoldField>
			books: Map<number, { castId: number; lorebookName: string }>
		}
	>()
	for (const m of members) {
		if (
			editedCardVersionId !== undefined &&
			m.cardVersion !== undefined &&
			m.cardVersion?.id !== editedCardVersionId
		)
			continue
		if (m.followsCard.length === 0) continue
		const follows = new Set(
			FIELD_ORDER.filter((f) => m.followsCard.includes(f))
		)
		const key = `${m.memberName}\u0000${[...follows].join(",")}`
		let group = groups.get(key)
		if (!group) {
			group = { name: m.memberName, follows, books: new Map() }
			groups.set(key, group)
		}
		group.books.set(m.lorebookId, {
			castId: m.castId,
			lorebookName: m.lorebookName
		})
	}
	if (groups.size === 0) return null
	const sentences = [...groups.values()].map((g): CastEditPart[] => {
		const where: CastEditPart[] = [
			`${g.name} in `,
			...joinPieces(
				[...g.books].map(([lorebookId, b]) => [{ lorebookId, ...b }])
			)
		]
		if (g.follows.size === FIELD_ORDER.length) return where
		const followed = fieldWords(g.follows)
		const own = fieldWords(
			new Set(FIELD_ORDER.filter((f) => !g.follows.has(f)))
		)
		return [
			...where,
			` (their ${joinWords(followed)}; their ${joinWords(own)} ${own.length === 1 && SINGULAR_FIELD_WORDS.has(own[0]) ? "is" : "are"} their own there)`
		]
	})
	return mergeWords(["Editing this changes ", ...joinPieces(sentences), "."])
}

/**
 * The editing sentence as plain words — `castEditParts`, joined; the same
 * optional edited card version narrows it to members reading that version.
 */
export function castEditWords(
	members: readonly CastBannerMember[] | null | undefined,
	editedCardVersionId?: number
): string | null {
	const parts = castEditParts(members, editedCardVersionId)
	if (!parts) return null
	return parts
		.map((p) => (typeof p === "string" ? p : p.lorebookName))
		.join("")
}
