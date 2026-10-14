/**
 * 🚧 `session-images` (DESIGN-image-generation §16 follow-up D3, 2026-10-12):
 * core's Backdrop widget's chooser, section *From this session* — a page of
 * the pictures generated in this session, so a Scene the Backdrop did not
 * place can still become the backdrop.
 *
 * The Album's own data path, through the request: one page of the session's
 * lines as the `messages` request reads them (`answerMessages`, every
 * channel, the page's own window), then the Album's `generated` source over
 * those lines (`albumItems`), newest first. Each picture is named by its
 * file's id (`data.assetId` — a line's picture part carries no uuid), which
 * `set-backdrop` takes as it takes a uuid, and drawn by its thumbnail. The
 * cursor is the `messages` page's own, passed through; a page of lines with
 * no generated picture answers no images and still a next page.
 */
import type { WidgetRequests } from "@serene-pub/sdk"
import { albumItems, albumSrc } from "@serene-pub/core-catalog/album"
import { answerMessages, type MessagesDeps } from "./messages"

type Params = WidgetRequests["session-images"]["params"]
type Result = WidgetRequests["session-images"]["result"]

/** Answer one `session-images`: a page of the session's generated pictures. */
export async function answerSessionImages(
	params: Params | undefined,
	deps: MessagesDeps
): Promise<Result> {
	const cursor = (params as Partial<Params> | undefined)?.cursor
	if (cursor !== undefined && (typeof cursor !== "string" || !/^\d+$/.test(cursor)))
		throw new Error("that cursor is not one this page gave out")
	// No asker: every channel, as the Album's empty `channel` reads them.
	const page = await answerMessages(cursor !== undefined ? { cursor } : {}, deps)
	const items = albumItems(page.rows, { source: "generated", channel: "" })
	return {
		images: items.map((i) => ({
			ref: String(i.assetId),
			src: albumSrc(i.assetId, "thumb"),
			...(i.caption ? { caption: i.caption } : {})
		})),
		...(page.nextCursor ? { nextCursor: page.nextCursor } : {})
	}
}
