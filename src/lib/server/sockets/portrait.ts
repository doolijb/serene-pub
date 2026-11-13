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
 * 🚧 Preview and generate also take `{ castMemberId }` instead of
 * `{ characterId }` for a cast member's own gallery: whoever may edit the
 * member's lorebook (`cast/memberAccess.ts`). Its replies and errors carry
 * `castMemberId` and no `characterId`. Setting the likeness image stays
 * card-only.
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
import {
	ensureCardVersion,
	updateCardVersion
} from "$lib/server/characters/versions"
import { profileOf } from "$lib/shared/characters/profile"
import {
	canEditCastMember,
	canReadCastMember
} from "$lib/server/cast/memberAccess"
import { CAST_MEMBER_NOT_FOUND } from "$lib/server/characters/cardFromMember"
import { clientMediaFor } from "$lib/server/media"
import { spriteFileIds } from "$lib/server/sprites"

type OwnerKey = { characterId: number } | { castMemberId: number }
type OwnerParams = { characterId?: number; castMemberId?: number }

/** The one key `params` names; refuses both or neither. */
function ownerKeyOf(params: OwnerParams): OwnerKey {
	const card = params.characterId != null
	const member = params.castMemberId != null
	if (card === member) throw new Error("Name a character or a cast member, not both.")
	return card
		? { characterId: params.characterId as number }
		: { castMemberId: params.castMemberId as number }
}

/** The key an error twin carries: whichever id the request had. */
function errorKeyOf(params: OwnerParams): Partial<OwnerKey> {
	return params.castMemberId != null && params.characterId == null
		? { castMemberId: params.castMemberId }
		: { characterId: params.characterId }
}

/**
 * Refuse unless the asker may generate for the owner. A card: its owner or an
 * admin. A member: whoever may edit its book; one who may only read is told
 * what to do instead, one who may not even read is told it is not found.
 */
async function requireGenerating(
	user: { id: number; isAdmin?: boolean | null },
	owner: OwnerKey
) {
	if ("characterId" in owner) {
		const { mayFillSprites } = await import("$lib/server/sprites/attach")
		if (!(await mayFillSprites(db, user.id, owner.characterId)))
			throw new Error("Only the card's owner or an admin can generate its portrait.")
		return
	}
	if (await canEditCastMember(db, owner.castMemberId, user.id)) return
	if (
		!(await canReadCastMember(db, owner.castMemberId, user.id, {
			isAdmin: !!user.isAdmin
		}))
	)
		throw new Error(CAST_MEMBER_NOT_FOUND)
	throw new Error(
		"Only someone who can edit this cast member's lorebook can change its pictures."
	)
}

/** The gallery a run's end re-sends: the card's, or the member's own (as `listGallery` builds it). */
async function galleryOf(userId: number, owner: OwnerKey) {
	if ("characterId" in owner)
		return {
			characterId: owner.characterId,
			images: await listCharacterGallery({ characterId: owner.characterId, userId })
		}
	const sprites = await spriteFileIds(db, owner)
	const all = await clientMediaFor(db, owner)
	return {
		castMemberId: owner.castMemberId,
		images: sprites.size === 0 ? all : all.filter((m) => !sprites.has(m.id))
	}
}

export const charactersPreviewPortrait: Handler<
	Sockets.Characters.PreviewPortrait.Params,
	Sockets.Characters.PreviewPortrait.Response
> = {
	event: "characters:previewPortrait",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const owner = ownerKeyOf(params)
			await requireGenerating(socket.user!, owner)
			const { previewPortrait } = await import("$lib/server/characters/portrait")
			const res = await previewPortrait(db, {
				...owner,
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
				...errorKeyOf(params)
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
		try {
			const userId = socket.user!.id
			const owner = ownerKeyOf(params)
			await requireGenerating(socket.user!, owner)
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
				...owner,
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
					emitToUser("characters:listGallery", await galleryOf(userId, owner))
				} catch {
					// A courtesy refresh; the tab re-asks on open.
				}
			})
			const res = { ...owner, runId }
			emitToUser("characters:generatePortrait", res)
			return res
		} catch (error: any) {
			emitToUser("characters:generatePortrait:error", {
				error: error?.message || "The portrait did not start.",
				...errorKeyOf(params)
			})
			throw error
		}
	}
}

/**
 * A gallery picture becomes the card's **likeness image** — the same
 * stored pointer the Likeness tab saves (the `likeness` of the card's
 * current version, `imageMediaId`), the likeness prompt and negative kept. Owner only, and
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
				columns: { id: true }
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
			// The likeness lives on the card's current version.
			const version = await ensureCardVersion(db, character.id)
			if (!version)
				throw new Error("Character not found or access denied")
			const stored = profileOf(version).likeness ?? {}
			await updateCardVersion(db, version.id, {
				likeness: { ...stored, imageMediaId: file.id }
			})
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
