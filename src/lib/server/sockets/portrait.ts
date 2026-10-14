/**
 * 🚧 **Generate portrait** — the Gallery tab's socket family
 * (DESIGN-image-generation §6.2; I8), mirroring *Fill empty sprites*
 * (`sockets/sprites.ts`):
 *
 *  - `characters:previewPortrait` — the dialog's cost line and notices;
 *  - `characters:generatePortrait` — starts the run, acks at once with its
 *    id; the run reports on the pushed `characters:portrait` until `done`
 *    or `failed`, then re-sends the card's gallery so the new pictures
 *    appear as tiles;
 *  - `characters:setLikenessImage` — a gallery picture becomes the card's
 *    likeness image (the Likeness tab's pick, from a tile's menu).
 *
 * The card's owner or an admin may preview and generate; setting the
 * likeness image is the owner's, like every other edit of the card. Every
 * reply and error carries `characterId` top-level (SCOPED on it).
 *
 * A run that parks at review (Portrait reviews by default) needs nothing
 * here: the review card is addressed to the person, not to a session, and
 * the app-wide review modal shows it wherever they are.
 */

import { and, eq } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import type { Handler } from "$lib/shared/events"
import { listCharacterGallery } from "$lib/server/utils"
import { readLikeness, withLikeness } from "$lib/server/characters/likeness"

async function mayGenerate(userId: number, characterId: number) {
	const { mayFillSprites } = await import("$lib/server/sprites/attach")
	return mayFillSprites(db, userId, characterId)
}

export const charactersPreviewPortrait: Handler<
	Sockets.Characters.PreviewPortrait.Params,
	Sockets.Characters.PreviewPortrait.Response
> = {
	event: "characters:previewPortrait",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			if (!(await mayGenerate(userId, params.characterId)))
				throw new Error("Only the card's owner or an admin can generate its portrait.")
			const { previewPortrait } = await import("$lib/server/characters/portrait")
			const res = await previewPortrait(db, {
				characterId: params.characterId,
				count: params.count,
				style: params.style,
				userId,
				isAdmin: !!socket.user!.isAdmin
			})
			emitToUser("characters:previewPortrait", res)
			return res
		} catch (error: any) {
			emitToUser("characters:previewPortrait:error", {
				error: error?.message || "Could not prepare the portrait.",
				characterId: params.characterId
			})
			throw error
		}
	}
}

/**
 * Start a portrait: `core:spec/character-portrait` as a card action, in the
 * background. Stop is the ordinary `pipelines:cancelRun` with the run id.
 */
export const charactersGeneratePortrait: Handler<
	Sockets.Characters.GeneratePortrait.Params,
	Sockets.Characters.GeneratePortrait.Response
> = {
	event: "characters:generatePortrait",
	handler: async (socket, params, emitToUser) => {
		const characterId = params.characterId
		try {
			const userId = socket.user!.id
			if (!(await mayGenerate(userId, characterId)))
				throw new Error("Only the card's owner or an admin can generate its portrait.")
			const { v4: uuidv4 } = await import("uuid")
			const runId =
				typeof params.runId === "string" && params.runId ? params.runId : uuidv4()
			const runRegistry = await import("$lib/server/pipelines/runtime/runRegistry")
			const { CHARACTER_PORTRAIT_SPEC_ID } = await import("@serene-pub/core-catalog")
			const { runPortrait } = await import("$lib/server/characters/portrait")
			const handle = runRegistry.start({
				runId,
				userId,
				specId: CHARACTER_PORTRAIT_SPEC_ID,
				kind: "action"
			})
			void runPortrait(db, {
				characterId,
				count: params.count,
				style: params.style,
				userId,
				runId,
				signal: handle.controller.signal,
				cancelSignal: () => runRegistry.cancellation(handle),
				report: (p) => emitToUser("characters:portrait", p)
			}).finally(async () => {
				runRegistry.finish(runId)
				try {
					emitToUser("characters:listGallery", {
						characterId,
						images: await listCharacterGallery({ characterId, userId })
					})
				} catch {
					// A courtesy refresh; the tab re-asks on open.
				}
			})
			const res = { characterId, runId }
			emitToUser("characters:generatePortrait", res)
			return res
		} catch (error: any) {
			emitToUser("characters:generatePortrait:error", {
				error: error?.message || "The portrait did not start.",
				characterId
			})
			throw error
		}
	}
}

/**
 * A gallery picture becomes the card's **likeness image** — the same
 * stored pointer the Likeness tab saves (`extensions.serenepub.likeness.
 * imageMediaId`), the likeness prompt and negative kept. Owner only, and
 * only one of the card's own pictures, as `characters:setAvatar`.
 */
export const charactersSetLikenessImage: Handler<
	Sockets.Characters.SetLikenessImage.Params,
	Sockets.Characters.SetLikenessImage.Response
> = {
	event: "characters:setLikenessImage",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const character = await db.query.characters.findFirst({
				where: and(
					eq(schema.characters.id, params.characterId),
					eq(schema.characters.userId, userId)
				),
				columns: { id: true, extensions: true }
			})
			if (!character) throw new Error("Character not found or access denied")
			const file = await db.query.files.findFirst({
				where: and(
					eq(schema.files.id, params.mediaId),
					eq(schema.files.characterId, params.characterId)
				),
				columns: { id: true, kind: true }
			})
			if (!file || file.kind !== "image")
				throw new Error("That picture is not one of this character's.")
			const stored = readLikeness(character.extensions) ?? {}
			await db
				.update(schema.characters)
				.set({
					extensions: withLikeness(character.extensions, {
						...stored,
						imageMediaId: file.id
					}) as any
				})
				.where(
					and(
						eq(schema.characters.id, params.characterId),
						eq(schema.characters.userId, userId)
					)
				)
			const res = { characterId: params.characterId, imageMediaId: file.id }
			emitToUser("characters:setLikenessImage", res)
			return res
		} catch (error: any) {
			emitToUser("characters:setLikenessImage:error", {
				error: error?.message || "Could not set the likeness image.",
				characterId: params.characterId
			})
			throw error
		}
	}
}

export function registerPortraitHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, charactersPreviewPortrait, emitToUser)
	register(socket, charactersGeneratePortrait, emitToUser)
	register(socket, charactersSetLikenessImage, emitToUser)
}
