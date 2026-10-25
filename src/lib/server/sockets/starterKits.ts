/**
 * 🚧 **Starter lorebooks** on the wire (PLAN-lorebook-kinds §B): the list anyone
 * signed in starts from, and the three admin verbs — save a book as a kit,
 * clone any kit, delete an admin kit. Starting from a kit is not here: it is
 * `lorebooks:create` / `sessions:create`'s `starterKit` param.
 *
 * Editing an admin kit is the ordinary lorebook sockets on its row (its
 * owner passes `findOwnedBook`); other admins clone it.
 */

import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, eq, isNull } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { refusable } from "./refusable"
import { relistLorebooks } from "./lorebooks"
import { assertOwnedBook } from "$lib/server/utils/ownedBook"
import { duplicateLorebookRows } from "$lib/server/utils/lorebookDuplicate"
import { purgeLorebook } from "$lib/server/lorebooks/tableRegistry"
import {
	afterKitCopy,
	bookFromKit,
	kitCardId,
	kitRefOfCardId,
	resolveKit,
	STARTER_KIT_KIND,
	STARTER_KIT_SENTENCES,
	starterKitCards,
	type KitCopy
} from "$lib/server/lorebooks/starterKits"

type Emit = (event: string, data: any) => void

const assertAdmin = (socket: any) => {
	if (!socket.user?.isAdmin) throw new Error(STARTER_KIT_SENTENCES.adminOnly)
}

const ownerNameOf = (socket: any): string =>
	socket.user?.displayName || socket.user?.username || ""

/** The asker's kit card, read back after a save or a clone. */
async function cardOf(
	userId: number,
	lorebookId: number
): Promise<Sockets.StarterKits.Card> {
	const id = kitCardId({ lorebookId })
	const card = (await starterKitCards(db as unknown as Db, userId)).find(
		(c) => c.id === id
	)
	if (!card) throw new Error("The starter lorebook could not be read back.")
	return card
}

/** After a kit row is made or removed: the kit list and the asker's shelf, lazily. */
async function relistKits(socket: any, emitToUser: Emit) {
	const userId = socket.user!.id
	await emitToUser("starterKits:list", async () => ({
		kits: await starterKitCards(db as unknown as Db, userId)
	}))
	await relistLorebooks(socket, emitToUser)
}

/** A copy's after-commit work, then the asker's character list when cards came with it. */
async function finishCopy(socket: any, emitToUser: Emit, copy: KitCopy) {
	const userId = socket.user!.id
	await afterKitCopy(copy, userId, ownerNameOf(socket))
	if (copy.cards.length) {
		const { buildCharactersList } = await import("./characters")
		await emitToUser("characters:list", () => buildCharactersList(userId))
	}
}

/** `starterKits:list` — every kit anyone signed in may start from. */
export const starterKitsListHandler: Handler<
	Sockets.StarterKits.List.Params,
	Sockets.StarterKits.List.Response
> = refusable(
	"starterKits:list",
	async (socket, _params, emitToUser) => {
		const res: Sockets.StarterKits.List.Response = {
			kits: await starterKitCards(db as unknown as Db, socket.user!.id)
		}
		emitToUser("starterKits:list", res)
		return res
	},
	"The starter lorebooks could not be listed."
)

/**
 * `starterKits:saveFromBook` — admins: a snapshot of one of their own
 * lorebooks as a new admin kit. Later edits to the book never reach it.
 */
export const starterKitsSaveFromBookHandler: Handler<
	Sockets.StarterKits.SaveFromBook.Params,
	Sockets.StarterKits.SaveFromBook.Response
> = refusable(
	"starterKits:saveFromBook",
	async (socket, params, emitToUser) => {
		assertAdmin(socket)
		const userId = socket.user!.id
		const book = await assertOwnedBook(
			db as unknown as Db,
			userId,
			params?.lorebookId
		).catch(() => {
			throw new Error(STARTER_KIT_SENTENCES.saveOwnBook)
		})
		const [row] = await db
			.select({
				kind: schema.lorebooks.kind,
				sessionId: schema.lorebooks.sessionId
			})
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, book.id))
		if (
			!row ||
			row.sessionId != null ||
			row.kind !== "book" ||
			book.userId !== userId
		)
			throw new Error(STARTER_KIT_SENTENCES.saveOwnBook)
		const name =
			(typeof params.name === "string" && params.name.trim()) || book.name
		const { id } = await db.transaction(async (tx) => {
			const copy = await duplicateLorebookRows(tx, book.id, userId, name)
			await tx
				.update(schema.lorebooks)
				.set({ kind: STARTER_KIT_KIND })
				.where(eq(schema.lorebooks.id, copy.id))
			return copy
		})
		await finishCopy(socket, emitToUser, {
			lorebookId: id,
			cards: [],
			coverFrom: book.id
		})
		const res: Sockets.StarterKits.SaveFromBook.Response = {
			kit: await cardOf(userId, id)
		}
		emitToUser("starterKits:saveFromBook", res)
		await relistKits(socket, emitToUser)
		return res
	},
	"The lorebook could not be saved as a starter lorebook."
)

/**
 * `starterKits:clone` — admins: a new admin kit from any kit, shipped or an
 * admin's. A kit another admin owns gives its cast's cards to the clone's
 * owner as copies.
 */
export const starterKitsCloneHandler: Handler<
	Sockets.StarterKits.Clone.Params,
	Sockets.StarterKits.Clone.Response
> = refusable(
	"starterKits:clone",
	async (socket, params, emitToUser) => {
		assertAdmin(socket)
		const userId = socket.user!.id
		const kit = await resolveKit(
			db as unknown as Db,
			kitRefOfCardId(params?.id)
		)
		const name =
			(typeof params.name === "string" && params.name.trim()) ||
			`${kit.name} (copy)`
		const copy = await db.transaction((tx) =>
			bookFromKit(tx, kit, { userId, name, kind: STARTER_KIT_KIND })
		)
		await finishCopy(socket, emitToUser, copy)
		const res: Sockets.StarterKits.Clone.Response = {
			kit: await cardOf(userId, copy.lorebookId)
		}
		emitToUser("starterKits:clone", res)
		await relistKits(socket, emitToUser)
		return res
	},
	"The starter lorebook could not be cloned."
)

/**
 * `starterKits:delete` — admins: remove an admin kit, whoever made it (a kit
 * is the pub's). Books already made from it keep everything they copied.
 */
export const starterKitsDeleteHandler: Handler<
	Sockets.StarterKits.Delete.Params,
	Sockets.StarterKits.Delete.Response
> = refusable(
	"starterKits:delete",
	async (socket, params, emitToUser) => {
		assertAdmin(socket)
		const lorebookId = params?.lorebookId
		if (!Number.isSafeInteger(lorebookId))
			throw new Error(STARTER_KIT_SENTENCES.shippedKeep)
		const kitRow = and(
			eq(schema.lorebooks.id, lorebookId),
			eq(schema.lorebooks.kind, STARTER_KIT_KIND),
			isNull(schema.lorebooks.sessionId)
		)
		const deleted = await db.transaction(async (tx) => {
			const [row] = await tx
				.select({ id: schema.lorebooks.id })
				.from(schema.lorebooks)
				.where(kitRow)
			if (!row) return false
			await purgeLorebook(tx, row.id)
			await tx.delete(schema.lorebooks).where(kitRow)
			return true
		})
		if (!deleted) throw new Error(STARTER_KIT_SENTENCES.unknown)
		const res: Sockets.StarterKits.Delete.Response = {
			lorebookId,
			id: kitCardId({ lorebookId })
		}
		emitToUser("starterKits:delete", res)
		await relistKits(socket, emitToUser)
		return res
	},
	"The starter lorebook could not be deleted."
)

export function registerStarterKitHandlers(
	socket: any,
	emitToUser: Emit,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: Emit
	) => void
) {
	register(socket, starterKitsListHandler, emitToUser)
	register(socket, starterKitsSaveFromBookHandler, emitToUser)
	register(socket, starterKitsCloneHandler, emitToUser)
	register(socket, starterKitsDeleteHandler, emitToUser)
}
