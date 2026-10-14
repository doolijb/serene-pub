/**
 * 🚧 `character-images` (PLAN-core-widgets W6): core's Scene Portraits pages
 * a session member's **gallery** — what its chooser shows, and where a
 * **chosen image**'s own `src` is found — through the page's
 * `characters:listGallery`, the read the character panel's gallery tab
 * makes (`listCharacterGallery`: the character's images, sprites left out).
 * Core's widgets, or a plugin's widget granted `characters` (the askers
 * table, `./askers.ts`).
 *
 * The page answers only for a member of the cast it projects
 * (`characters.v1`, a benched one included): a widget asks about the
 * session's people, never any character by id. The server's read is the
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

export interface CharacterImagesDeps {
	/** The cast the page projects — who may be asked about. */
	characters(): SessionCharactersV1 | undefined
	readCharacterGallery: CharacterGalleryRead
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
	const id = (p as Partial<Params> | undefined)?.characterId
	if (typeof id !== "number" || !Number.isInteger(id))
		throw new Error("character-images names a character by its id")
	const offset = offsetOf(p.cursor)
	const cast = d.characters()
	if (!cast) throw new Error("the session's cast has not arrived yet")
	if (!cast.members.some((m) => m.characterId === id))
		throw new Error("that character is not in this session")
	const gallery = (await d.readCharacterGallery(id)).filter(
		(m) => !m.kind || m.kind === "image"
	)
	const end = offset + CHARACTER_IMAGES_PAGE
	return {
		images: gallery
			.slice(offset, end)
			.map((m) => ({ ref: m.uuid, src: m.url })),
		...(end < gallery.length ? { nextCursor: String(end) } : {})
	}
}
