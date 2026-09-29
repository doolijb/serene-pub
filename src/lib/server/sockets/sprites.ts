/**
 * `characters:*Sprite*` — the Sprites tab's socket family (DESIGN-sprites §7).
 *
 * One shape for every handler: check access, do the one thing, answer with
 * the character's WHOLE sprite list. A panel never has to merge a delta, and a
 * second panel open on the same character hears the same list (the family is
 * SCOPED on `characterId`, which every reply and every error carries
 * top-level — see `SCOPED_EVENTS`).
 *
 * Reading needs only `canViewCharacter` (a session member sees the faces of
 * the cast they play beside); every write needs ownership of the card.
 */

import { db } from "$lib/server/db"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { Handler } from "$lib/shared/events"
import { canViewCharacter } from "$lib/server/utils/sessionAccess"
import {
	addEmptySprites,
	addSprite,
	createSpriteSet,
	deleteSprite,
	deleteSpriteSet,
	listSpriteSets,
	moveSprite,
	relabelSprite,
	renameSpriteSet,
	reorderSpriteVariants,
	setDefaultSpriteSet
} from "$lib/server/sprites"
import { STANDARD_SPRITE_LABELS, normalizeSpriteName } from "$lib/shared/sprites"
import { canActOnMessage } from "$lib/server/messages/permissions"
import { runSpriteAction } from "$lib/server/pipelines/runtime/builtins"

async function buildSpriteList(
	characterId: number
): Promise<Sockets.Characters.ListSprites.Response> {
	return { characterId, sets: await listSpriteSets(db, characterId) }
}

/**
 * May `userId` see this character's sprites: its owner, or a member of a
 * session it sits in. `canViewCharacter` answers only the second — like
 * `canViewMedia`, the owner is asked first.
 */
async function canSeeCharacter(userId: number, characterId: number) {
	const own = await db.query.characters.findFirst({
		where: and(
			eq(schema.characters.id, characterId),
			eq(schema.characters.userId, userId)
		),
		columns: { id: true }
	})
	return !!own || (await canViewCharacter(characterId, userId))
}

/** Refuse unless `userId` owns the character. */
async function requireOwned(userId: number, characterId: number) {
	const character = await db.query.characters.findFirst({
		where: and(
			eq(schema.characters.id, characterId),
			eq(schema.characters.userId, userId)
		),
		columns: { id: true }
	})
	if (!character) throw new Error("Character not found or access denied")
}

/**
 * A write handler: ownership, the change, then the whole list as the reply.
 * The error twin carries `characterId` so the scoped panel that asked hears it.
 */
function spriteWrite<P extends { characterId: number }, R>(
	event: string,
	change: (userId: number, params: P) => Promise<Partial<R> | void>,
	fallbackError: string
): Handler<P, R> {
	return {
		event,
		handler: async (socket, params, emitToUser) => {
			try {
				const userId = socket.user!.id
				await requireOwned(userId, params.characterId)
				const extra = (await change(userId, params)) ?? {}
				const res = {
					...(await buildSpriteList(params.characterId)),
					...extra
				} as R
				emitToUser(event, res)
				return res
			} catch (error: any) {
				emitToUser(`${event}:error`, {
					error: error?.message || fallbackError,
					characterId: params.characterId
				})
				throw error
			}
		}
	}
}

export const charactersListSprites: Handler<
	Sockets.Characters.ListSprites.Params,
	Sockets.Characters.ListSprites.Response
> = {
	event: "characters:listSprites",
	handler: async (socket, params, emitToUser) => {
		try {
			if (!(await canSeeCharacter(socket.user!.id, params.characterId))) {
				throw new Error("Character not found or access denied")
			}
			const res = await buildSpriteList(params.characterId)
			emitToUser("characters:listSprites", res)
			return res
		} catch (error: any) {
			emitToUser("characters:listSprites:error", {
				error: error?.message || "Failed to list sprites.",
				characterId: params.characterId
			})
			throw error
		}
	}
}

export const charactersCreateSpriteSet = spriteWrite<
	Sockets.Characters.CreateSpriteSet.Params,
	Sockets.Characters.CreateSpriteSet.Response
>(
	"characters:createSpriteSet",
	async (_userId, p) => {
		await createSpriteSet(db, p.characterId, p.name)
	},
	"Failed to create the sprite set."
)

export const charactersUpdateSpriteSet = spriteWrite<
	Sockets.Characters.UpdateSpriteSet.Params,
	Sockets.Characters.UpdateSpriteSet.Response
>(
	"characters:updateSpriteSet",
	async (_userId, p) => {
		if (p.name !== undefined) {
			await renameSpriteSet(db, p.characterId, p.setId, p.name)
		}
		if (p.makeDefault) await setDefaultSpriteSet(db, p.characterId, p.setId)
	},
	"Failed to update the sprite set."
)

export const charactersDeleteSpriteSet = spriteWrite<
	Sockets.Characters.DeleteSpriteSet.Params,
	Sockets.Characters.DeleteSpriteSet.Response
>(
	"characters:deleteSpriteSet",
	async (_userId, p) => {
		await deleteSpriteSet(db, p.characterId, p.setId)
	},
	"Failed to delete the sprite set."
)

export const charactersUploadSprite = spriteWrite<
	Sockets.Characters.UploadSprite.Params,
	Sockets.Characters.UploadSprite.Response
>(
	"characters:uploadSprite",
	async (userId, p) => {
		await addSprite(db, {
			userId,
			characterId: p.characterId,
			setId: p.setId,
			label: p.label,
			bytes: Buffer.from(p.imageFile as Uint8Array),
			filename: p.filename ?? null,
			source: "upload"
		})
	},
	"Failed to upload the sprite."
)

export const charactersAddStandardSprites = spriteWrite<
	Sockets.Characters.AddStandardSprites.Params,
	Sockets.Characters.AddStandardSprites.Response
>(
	"characters:addStandardSprites",
	async (_userId, p) => ({
		added: await addEmptySprites(
			db,
			p.characterId,
			p.setId,
			STANDARD_SPRITE_LABELS
		)
	}),
	"Failed to add the standard set."
)

export const charactersUpdateSprite = spriteWrite<
	Sockets.Characters.UpdateSprite.Params,
	Sockets.Characters.UpdateSprite.Response
>(
	"characters:updateSprite",
	async (_userId, p) => {
		if (p.setId !== undefined) {
			await moveSprite(db, p.characterId, p.spriteId, p.setId)
		}
		if (p.label !== undefined) {
			await relabelSprite(db, p.characterId, p.spriteId, p.label)
		}
	},
	"Failed to update the sprite."
)

export const charactersDeleteSprite = spriteWrite<
	Sockets.Characters.DeleteSprite.Params,
	Sockets.Characters.DeleteSprite.Response
>(
	"characters:deleteSprite",
	async (_userId, p) => {
		await deleteSprite(db, p.characterId, p.spriteId)
	},
	"Failed to delete the sprite."
)

export const charactersReorderSprites = spriteWrite<
	Sockets.Characters.ReorderSprites.Params,
	Sockets.Characters.ReorderSprites.Response
>(
	"characters:reorderSprites",
	async (_userId, p) => {
		await reorderSpriteVariants(
			db,
			p.characterId,
			p.setId,
			p.label,
			p.spriteIds
		)
	},
	"Failed to reorder the sprites."
)

/**
 * A person's pick of a line's sprite (DESIGN-sprites §6): the message menu's
 * **Change sprite**. The venue decides only what it alone can — the line is
 * a settled character line and this person may act on it (`canActOnMessage`,
 * the `item` rule, asked again by the host's commit). The write itself is
 * `core:spec/show-sprite`, so it is receipted and emits `sprite-shown`.
 */
export const sessionMessagesSetSprite: Handler<
	Sockets.SessionMessages.SetSprite.Params,
	Sockets.SessionMessages.SetSprite.Response
> = {
	event: "sessionMessages:setSprite",
	handler: async (socket, params, emitToUser) => {
		const fail = (error: string) => {
			const res: Sockets.SessionMessages.SetSprite.Response = { error }
			emitToUser("sessionMessages:setSprite", res)
			return res
		}
		try {
			const userId = socket.user!.id
			const message = await db.query.sessionMessages.findFirst({
				where: eq(schema.sessionMessages.id, params.id)
			})
			if (!message) return fail("Message not found.")
			if (message.isGenerating)
				return fail("This line is still being written — wait, or stop it first.")
			if (!message.characterId || message.isNarratorResponse)
				return fail("Only a character's lines show sprites.")
			if (!(await canActOnMessage(db, message.id, userId)))
				return fail("You can't change this line.")

			const set = normalizeSpriteName(params.sprite?.set)
			const label = normalizeSpriteName(params.sprite?.label)
			const sprite = params.sprite && set && label ? { set, label } : null

			const outcome = await runSpriteAction(db, {
				sessionId: message.sessionId,
				actor: userId,
				target: message.id,
				sprite,
				io: socket.io
			})
			if (!outcome.ok)
				return fail(outcome.error ?? "The sprite did not change.")
			const updated = await db.query.sessionMessages.findFirst({
				where: eq(schema.sessionMessages.id, message.id)
			})
			const res: Sockets.SessionMessages.SetSprite.Response = {
				sessionMessage: (updated ?? undefined) as any
			}
			emitToUser("sessionMessages:setSprite", res)
			return res
		} catch (error: any) {
			return fail(error?.message || "The sprite did not change.")
		}
	}
}

/**
 * **A session's sprite set** (DESIGN-sprites §2.3): show a seated character in another
 * of its card's sprite sets for this session only. The session owner, or the
 * character's owner, may; the set must be one of the card's (or null to clear).
 * Every member hears `sessions:spriteSetChanged`, so portraits redraw at once.
 */
export const sessionsSetSpriteSet: Handler<
	Sockets.Sessions.SetSpriteSet.Params,
	Sockets.Sessions.SetSpriteSet.Response
> = {
	event: "sessions:setSpriteSet",
	handler: async (socket, params, emitToUser) => {
		const reply = (extra: Partial<Sockets.Sessions.SetSpriteSet.Response>) => {
			const res: Sockets.Sessions.SetSpriteSet.Response = {
				sessionId: params.sessionId,
				characterId: params.characterId,
				set: null,
				...extra
			}
			emitToUser("sessions:setSpriteSet", res)
			return res
		}
		try {
			const userId = socket.user!.id
			const session = await db.query.sessions.findFirst({
				where: eq(schema.sessions.id, params.sessionId),
				columns: { id: true, userId: true }
			})
			const character = await db.query.characters.findFirst({
				where: eq(schema.characters.id, params.characterId),
				columns: { id: true, userId: true }
			})
			if (!session || !character) return reply({ error: "Not found." })
			if (session.userId !== userId && character.userId !== userId)
				return reply({ error: "Only the session's owner or the character's owner can change this." })
			const seated = await db.query.sessionCharacters.findFirst({
				where: and(
					eq(schema.sessionCharacters.sessionId, session.id),
					eq(schema.sessionCharacters.characterId, character.id)
				),
				columns: { characterId: true }
			})
			if (!seated) return reply({ error: "That character isn't in this session." })
			const set = normalizeSpriteName(params.set) || null
			if (set) {
				const { findSpriteSetByName } = await import("$lib/server/sprites")
				if (!(await findSpriteSetByName(db, character.id, set)))
					return reply({ error: `There is no sprite set named "${set}".` })
			}
			const { setSessionSpriteSet } = await import("$lib/server/sprites/choices")
			await setSessionSpriteSet(db, {
				sessionId: session.id,
				characterId: character.id,
				set,
				updatedBy: "user"
			})
			const res = reply({ set })
			const { broadcastToSessionUsers } = await import(
				"$lib/server/sockets/utils/broadcastHelpers"
			)
			await broadcastToSessionUsers(socket.io, session.id, "sessions:spriteSetChanged", res)
			return res
		} catch (error: any) {
			return reply({ error: error?.message || "The sprite set did not change." })
		}
	}
}

/**
 * The Sprites tab's test box (DESIGN-sprites §7): the default picker's choice
 * for a typed line, with no last sprite and no recency — what the line alone
 * says. Reading needs only `canViewCharacter`, like the list.
 */
export const charactersTestSprite: Handler<
	Sockets.Characters.TestSprite.Params,
	Sockets.Characters.TestSprite.Response
> = {
	event: "characters:testSprite",
	handler: async (socket, params, emitToUser) => {
		const reply = (extra: Partial<Sockets.Characters.TestSprite.Response>) => {
			const res: Sockets.Characters.TestSprite.Response = {
				characterId: params.characterId,
				text: params.text,
				pick: null,
				...extra
			}
			emitToUser("characters:testSprite", res)
			return res
		}
		try {
			if (!(await canSeeCharacter(socket.user!.id, params.characterId)))
				return reply({ reason: "Character not found or access denied." })
			const sets = await listSpriteSets(db, params.characterId)
			const set =
				sets.find((s) => s.id === params.setId) ??
				sets.find((s) => s.isDefault) ??
				sets[0]
			const labels = [
				...new Set((set?.sprites ?? []).filter((s) => s.media).map((s) => s.label))
			].sort()
			if (!set || labels.length === 0)
				return reply({ reason: "This set has no sprites with images yet." })
			const {
				getLoadedModelId,
				batchEmbed,
				getConfiguredEmbeddingTarget,
				loadConfiguredEmbeddingModel,
				isModelCached
			} = await import("$lib/server/embedding")
			const { spriteVectors } = await import("$lib/server/sprites/vectors")
			const { testerGate, LOAD_FAILED_REASON } = await import(
				"$lib/server/sprites/testerGate"
			)

			/**
			 * ⚠ **Enabled is not resident.** Gating on residency refuses
			 * whenever no model happens to be loaded, which on a machine with
			 * nothing pending to vectorize is always. The policy lives in `testerGate`; this gathers the
			 * three facts it decides between.
			 */
			let modelId = getLoadedModelId()
			const target = modelId ? null : await getConfiguredEmbeddingTarget()
			const gate = testerGate({
				loadedModelId: modelId,
				target,
				localCached:
					target?.mode === "local" && target.localModelName
						? await isModelCached(target.localModelName)
						: null
			})
			if (gate.kind === "refuse") return reply({ reason: gate.reason })
			if (gate.kind === "load") {
				await loadConfiguredEmbeddingModel()
				modelId = getLoadedModelId()
				if (!modelId) return reply({ reason: LOAD_FAILED_REASON })
			}

			const vectors = await spriteVectors(params.text, labels, { modelId, batchEmbed })
			const { pickSpriteBySimilarity } = await import("$lib/shared/sprites/pick")
			const pick = pickSpriteBySimilarity(
				{ set: set.name, labels, last: null },
				vectors.lineVector,
				vectors.labelVectors
			)
			return reply({
				pick,
				...(pick ? {} : { reason: "The line is too unlike every sprite label to choose one." })
			})
		} catch (error: any) {
			return reply({ reason: error?.message || "The test did not run." })
		}
	}
}

export function registerSpriteHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, charactersListSprites, emitToUser)
	register(socket, charactersCreateSpriteSet, emitToUser)
	register(socket, charactersUpdateSpriteSet, emitToUser)
	register(socket, charactersDeleteSpriteSet, emitToUser)
	register(socket, charactersUploadSprite, emitToUser)
	register(socket, charactersAddStandardSprites, emitToUser)
	register(socket, charactersUpdateSprite, emitToUser)
	register(socket, charactersDeleteSprite, emitToUser)
	register(socket, charactersReorderSprites, emitToUser)
	register(socket, sessionMessagesSetSprite, emitToUser)
	register(socket, sessionsSetSpriteSet, emitToUser)
	register(socket, charactersTestSprite, emitToUser)
}
