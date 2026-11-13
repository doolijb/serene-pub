/**
 * 🚧 `character-images` (PLAN-core-widgets W6): core's Scene Portraits pages
 * a session member's **gallery** — what its chooser shows, and where a
 * **chosen image**'s own `src` is found — through the page's
 * `characters:listGallery`, the read the character panel's gallery tab
 * makes (`listCharacterGallery`: the owner's images, sprites left out).
 * A member with a card is named by `characterId`; a card-less member by its
 * `castMemberId`, read through `readMemberGallery`.
 * Core's widgets, or a plugin's widget granted `characters` (the askers
 * table, `./askers.ts`).
 *
 * The page answers only for a member of the cast it projects
 * (`characters.v1`, a benched one included): a widget asks about the
 * session's people, never any character by id. Exactly one of the two ids. The server's read is the
 * gallery tab's and gates nothing more today.
 *
 * Each image is named by its file's `uuid` — the stable public address
 * shared by every variant, what a chosen image stores — and drawn by its
 * display `url`. The socket answers the whole gallery at once; the page
 * cuts it into pages here, the cursor an offset it gave out itself.
 */
import type { SessionCharactersV1, WidgetRequests } from "@serene-pub/sdk"

type Params = WidgetRequests["character-images"]["params"]
type Result = WidgetRequests["character-images"]["result"]

/** How many images one page holds. */
export const CHARACTER_IMAGES_PAGE = 24

/** The page's read: one character's gallery (`characters:listGallery`), settled on ITS reply. */
export type CharacterGalleryRead = (
	characterId: number
) => Promise<readonly Pick<Sockets.Media, "uuid" | "url" | "kind">[]>

/** The page's read: one cast member's gallery (`characters:listGallery { castMemberId }`). */
export type MemberGalleryRead = (
	castMemberId: number
) => Promise<readonly Pick<Sockets.Media, "uuid" | "url" | "kind">[]>

export interface CharacterImagesDeps {
	/** The cast the page projects — who may be asked about. */
	characters(): SessionCharactersV1 | undefined
	readCharacterGallery: CharacterGalleryRead
	readMemberGallery?: MemberGalleryRead
}

/** The offset a cursor this page gave out stands for; refuses anything else. */
function offsetOf(cursor: unknown): number {
	if (cursor === undefined) return 0
	if (typeof cursor === "string" && /^[1-9]\d*$/.test(cursor))
		return Number(cursor)
	throw new Error("that cursor is not one this page gave out")
}

/**
 * Answer one `character-images`: a page of the member's gallery, its images
 * only, each `{ ref, src }`. Rejects, in words, for a character not in this
 * session or a cursor the page never gave.
 */
export async function answerCharacterImages(
	p: Params,
	d: CharacterImagesDeps
): Promise<Result> {
	const { characterId, castMemberId } = (p ?? {}) as Partial<Params>
	const hasCard = characterId != null
	const hasMember = castMemberId != null
	if (hasCard === hasMember)
		throw new Error("Name a character or a cast member, not both.")
	const id = hasCard ? characterId : castMemberId
	if (typeof id !== "number" || !Number.isInteger(id))
		throw new Error(
			hasCard
				? "character-images names a character by its id"
				: "character-images names a cast member by its id"
		)
	const offset = offsetOf(p.cursor)
	const cast = d.characters()
	if (!cast) throw new Error("the session's cast has not arrived yet")
	let rows: readonly Pick<Sockets.Media, "uuid" | "url" | "kind">[]
	if (hasCard) {
		if (!cast.members.some((m) => m.cardId === id || m.characterId === id))
			throw new Error("that character is not in this session")
		rows = await d.readCharacterGallery(id)
	} else {
		if (!cast.members.some((m) => m.castMemberId === id))
			throw new Error("that cast member is not in this session")
		if (!d.readMemberGallery)
			throw new Error("that cast member's images could not be read")
		rows = await d.readMemberGallery(id)
	}
	const gallery = rows.filter((m) => !m.kind || m.kind === "image")
	const end = offset + CHARACTER_IMAGES_PAGE
	return {
		images: gallery
			.slice(offset, end)
			.map((m) => ({ ref: m.uuid, src: m.url })),
		...(end < gallery.length ? { nextCursor: String(end) } : {})
	}
}
