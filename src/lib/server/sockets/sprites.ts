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
 *
 * 🚧 Each handler also takes `{ castMemberId }` instead of `{ characterId }`
 * for a cast member's own sets (`cast/memberAccess.ts`: whoever may read the
 * member's book reads; whoever may edit it writes). Its replies and errors
 * carry `castMemberId` and no `characterId`. The generation events
 * (fill, re-express) take either owner too; a member's run needs the same
 * edit right as its other writes.
 */

import { db } from "$lib/server/db"
import { and, eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { Handler } from "$lib/shared/events"
import {
	canEditCastMember,
	canReadCastMember
} from "$lib/server/cast/memberAccess"
import { CAST_MEMBER_NOT_FOUND } from "$lib/server/characters/cardFromMember"
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
import { memberAsRead } from "$lib/server/cast/memberAsRead"
import { memberDrawsOwnSprites } from "$lib/server/sprites/choices"
import {
	STANDARD_SPRITE_LABELS,
	normalizeSpriteName,
	type SpriteSetView
} from "$lib/shared/sprites"
import { canActOnMessage } from "$lib/server/messages/permissions"
import { runSpriteAction } from "$lib/server/pipelines/runtime/builtins"

/**
 * Whose sprites a request names: a card (`characterId`) or a cast member's own
 * (`castMemberId`) — exactly one. The reply and the error carry the same key,
 * and only that key, so the form that asked can tell its own.
 */
type OwnerKey = { characterId: number } | { castMemberId: number }
type OwnerParams = { characterId?: number; castMemberId?: number }

const BOTH_OR_NEITHER = "Name a character or a cast member, not both."
const MEMBER_SPRITES_READ_ONLY =
	"Only someone who can edit this cast member's lorebook can change its sprites."

/** The one key `params` names; refuses both or neither. */
function ownerKeyOf(params: OwnerParams): OwnerKey {
	const card = params.characterId != null
	const member = params.castMemberId != null
	if (card === member) throw new Error(BOTH_OR_NEITHER)
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

async function buildSpriteList(
	owner: OwnerKey
): Promise<Sockets.Characters.ListSprites.Response> {
	const sets = await listSpriteSets(db, owner)
	if ("characterId" in owner) return { ...owner, sets }
	const fromCard = await cardSpritesDrawingMember(owner.castMemberId)
	return { ...owner, sets, ...(fromCard ? { fromCard } : {}) }
}

/**
 * 🚧 The sprite sets of the card that draws a cast member, when the member has
 * no sprites with pictures of its own: the active card as read, else the
 * member's linked card when the active one has no sets (the rule
 * `spriteChoicesFor` follows). Only the sets, nothing else of the card.
 */
async function cardSpritesDrawingMember(
	castMemberId: number
): Promise<{ characterId: number; sets: SpriteSetView[] } | null> {
	if (await memberDrawsOwnSprites(db, castMemberId)) return null
	const asRead = await memberAsRead(db, castMemberId, {})
	if (!asRead) return null
	const candidates = [asRead.activeCardId, asRead.linkedCardId].filter(
		(id, i, all): id is number => id != null && all.indexOf(id) === i
	)
	for (const characterId of candidates) {
		const sets = await listSpriteSets(db, { characterId })
		if (sets.some((set) => set.sprites.some((sprite) => sprite.media)))
			return { characterId, sets }
	}
	return null
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

/** Refuse unless the asker may see the owner's sprites (card or member). */
async function requireReadable(
	user: { id: number; isAdmin?: boolean | null },
	owner: OwnerKey
) {
	if ("castMemberId" in owner) {
		if (
			!(await canReadCastMember(db, owner.castMemberId, user.id, {
				isAdmin: !!user.isAdmin
			}))
		)
			throw new Error(CAST_MEMBER_NOT_FOUND)
		return
	}
	if (!(await canSeeCharacter(user.id, owner.characterId)))
		throw new Error("Character not found or access denied")
}

/**
 * Refuse unless the asker may change the owner's sprites; answers whose files
 * they are. A card: its owner. A member: whoever may edit its book — the
 * files are the book owner's (`addSprite` stamps the book as provenance).
 */
async function requireWritable(
	user: { id: number; isAdmin?: boolean | null },
	owner: OwnerKey
): Promise<{ bookOwnerId: number }> {
	if ("characterId" in owner) {
		await requireOwned(user.id, owner.characterId)
		return { bookOwnerId: user.id }
	}
	const member = await canEditCastMember(db, owner.castMemberId, user.id)
	if (member) return { bookOwnerId: member.bookOwnerId }
	await requireReadable(user, owner)
	throw new Error(MEMBER_SPRITES_READ_ONLY)
}

/**
 * Refuse unless the asker may run a generation on the owner's sprites. A card:
 * its owner or an admin (`mayFillSprites`). A member: whoever may edit its book.
 */
async function requireGenerating(
	user: { id: number; isAdmin?: boolean | null },
	owner: OwnerKey
) {
	if ("castMemberId" in owner) {
		await requireWritable(user, owner)
		return
	}
	const { mayFillSprites } = await import("$lib/server/sprites/attach")
	if (!(await mayFillSprites(db, user.id, owner.characterId)))
		throw new Error("Only the card's owner or an admin can fill its sprites.")
}

/** What a write's `change` is handed: who asked, whose sprites, whose files. */
interface SpriteWriteContext {
	userId: number
	owner: OwnerKey
	/** Who the new files belong to: the card's owner, or the member's book's. */
	fileOwnerId: number
}

/**
 * A write handler: access, the change, then the whole list as the reply.
 * The error twin carries the owner's key so the panel that asked hears it.
 */
function spriteWrite<P extends OwnerParams, R>(
	event: string,
	change: (ctx: SpriteWriteContext, params: P) => Promise<Partial<R> | void>,
	fallbackError: string
): Handler<P, R> {
	return {
		event,
		handler: async (socket, params, emitToUser) => {
			try {
				const userId = socket.user!.id
				const owner = ownerKeyOf(params)
				const { bookOwnerId } = await requireWritable(socket.user!, owner)
				const extra =
					(await change({ userId, owner, fileOwnerId: bookOwnerId }, params)) ??
					{}
				const res = {
					...(await buildSpriteList(owner)),
					...extra
				} as R
				emitToUser(event, res)
				return res
			} catch (error: any) {
				emitToUser(`${event}:error`, {
					error: error?.message || fallbackError,
					...errorKeyOf(params)
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
			const owner = ownerKeyOf(params)
			await requireReadable(socket.user!, owner)
			const res = await buildSpriteList(owner)
			emitToUser("characters:listSprites", res)
			return res
		} catch (error: any) {
			emitToUser("characters:listSprites:error", {
				error: error?.message || "Failed to list sprites.",
				...errorKeyOf(params)
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
	async ({ owner }, p) => {
		await createSpriteSet(db, owner, p.name)
	},
	"Failed to create the sprite set."
)

export const charactersUpdateSpriteSet = spriteWrite<
	Sockets.Characters.UpdateSpriteSet.Params,
	Sockets.Characters.UpdateSpriteSet.Response
>(
	"characters:updateSpriteSet",
	async ({ owner }, p) => {
		if (p.name !== undefined) {
			await renameSpriteSet(db, owner, p.setId, p.name)
		}
		if (p.makeDefault) await setDefaultSpriteSet(db, owner, p.setId)
	},
	"Failed to update the sprite set."
)

export const charactersDeleteSpriteSet = spriteWrite<
	Sockets.Characters.DeleteSpriteSet.Params,
	Sockets.Characters.DeleteSpriteSet.Response
>(
	"characters:deleteSpriteSet",
	async ({ owner }, p) => {
		await deleteSpriteSet(db, owner, p.setId)
	},
	"Failed to delete the sprite set."
)

export const charactersUploadSprite = spriteWrite<
	Sockets.Characters.UploadSprite.Params,
	Sockets.Characters.UploadSprite.Response
>(
	"characters:uploadSprite",
	async ({ owner, fileOwnerId }, p) => {
		await addSprite(db, {
			userId: fileOwnerId,
			...owner,
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
	async ({ owner }, p) => ({
		added: await addEmptySprites(
			db,
			owner,
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
	async ({ owner }, p) => {
		if (p.setId !== undefined) {
			await moveSprite(db, owner, p.spriteId, p.setId)
		}
		if (p.label !== undefined) {
			await relabelSprite(db, owner, p.spriteId, p.label)
		}
	},
	"Failed to update the sprite."
)

export const charactersDeleteSprite = spriteWrite<
	Sockets.Characters.DeleteSprite.Params,
	Sockets.Characters.DeleteSprite.Response
>(
	"characters:deleteSprite",
	async ({ owner }, p) => {
		await deleteSprite(db, owner, p.spriteId)
	},
	"Failed to delete the sprite."
)

export const charactersReorderSprites = spriteWrite<
	Sockets.Characters.ReorderSprites.Params,
	Sockets.Characters.ReorderSprites.Response
>(
	"characters:reorderSprites",
	async ({ owner }, p) => {
		await reorderSpriteVariants(
			db,
			owner,
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
			// A character seat holding this card, live or departed (as before S2).
			// `seatOf` prefers any live seat, so a card that also holds a live
			// player seat would resolve to that one; ask for the character seat.
			const [seat] = await db
				.select({ castMemberId: schema.sessionCharacters.castMemberId })
				.from(schema.sessionCharacters)
				.where(
					and(
						eq(schema.sessionCharacters.sessionId, session.id),
						eq(schema.sessionCharacters.characterId, character.id)
					)
				)
				.orderBy(sql`${schema.sessionCharacters.removedAt} IS NOT NULL`)
				.limit(1)
			if (!seat) return reply({ error: "That character isn't in this session." })
			const set = normalizeSpriteName(params.set) || null
			if (set) {
				// One rule with the picker (`spriteChoicesFor`): the member's own sets
				// count once one has an image; else the card's.
				const { spriteLabelsForMembers } = await import("$lib/server/sprites")
				const own =
					seat.castMemberId != null
						? (await spriteLabelsForMembers(db, [seat.castMemberId])).get(seat.castMemberId)
						: undefined
				if (own && own.sets.size > 0) {
					if (![...own.sets.keys()].some((name) => normalizeSpriteName(name) === set))
						return reply({ error: `There is no sprite set named "${set}".` })
				} else {
					const { findSpriteSetByName } = await import("$lib/server/sprites")
					if (!(await findSpriteSetByName(db, character.id, set)))
						return reply({ error: `There is no sprite set named "${set}".` })
				}
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
			const res = {
				...errorKeyOf(params),
				text: params.text,
				pick: null,
				...extra
			} as Sockets.Characters.TestSprite.Response
			emitToUser("characters:testSprite", res)
			return res
		}
		try {
			const owner = ownerKeyOf(params)
			// A card's refusal keeps its sentence as it was (with its full stop).
			if (
				"characterId" in owner &&
				!(await canSeeCharacter(socket.user!.id, owner.characterId))
			)
				return reply({
					reason: "Character not found or access denied."
				})
			await requireReadable(socket.user!, owner)
			const sets = await listSpriteSets(db, owner)
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

/**
 * 🚧 **Fill empty sprites** — the form's preview (DESIGN-image-generation
 * §6.3, §4.7; I5): which labels it would draw, the cost line, and what the
 * picture step would say before the run. The card's owner or an admin; the
 * pair and its price are named for an admin only.
 */
export const charactersPreviewSpriteFill: Handler<
	Sockets.Characters.PreviewSpriteFill.Params,
	Sockets.Characters.PreviewSpriteFill.Response
> = {
	event: "characters:previewSpriteFill",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const owner = ownerKeyOf(params)
			await requireGenerating(socket.user!, owner)
			const { previewSpriteFill } = await import(
				"$lib/server/sprites/fillAction"
			)
			const res = await previewSpriteFill(db, {
				...owner,
				setId: params.setId,
				labels: params.labels,
				userId,
				isAdmin: !!socket.user!.isAdmin
			})
			emitToUser("characters:previewSpriteFill", res)
			return res
		} catch (error: any) {
			emitToUser("characters:previewSpriteFill:error", {
				error: error?.message || "Could not prepare the fill.",
				...errorKeyOf(params)
			})
			throw error
		}
	}
}

/**
 * 🚧 Start a fill: `core:spec/sprite-set-fill` as a card action, in the
 * background. Acks at once with the run id; the run reports on
 * `characters:spriteFill` and, when it ends, re-sends the card's sprite
 * list so every open Sprites tab shows the new pictures. Stop is the
 * ordinary `pipelines:cancelRun` with that id.
 */
export const charactersFillSprites: Handler<
	Sockets.Characters.FillSprites.Params,
	Sockets.Characters.FillSprites.Response
> = {
	event: "characters:fillSprites",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const owner = ownerKeyOf(params)
			await requireGenerating(socket.user!, owner)
			const { v4: uuidv4 } = await import("uuid")
			const runId =
				typeof params.runId === "string" && params.runId ? params.runId : uuidv4()
			const runRegistry = await import("$lib/server/pipelines/runtime/runRegistry")
			const { SPRITE_SET_FILL_SPEC_ID } = await import("@serene-pub/core-catalog")
			const { runSpriteFill } = await import("$lib/server/sprites/fillAction")
			const handle = runRegistry.start({
				runId,
				userId,
				specId: SPRITE_SET_FILL_SPEC_ID,
				kind: "action"
			})
			void runSpriteFill(db, {
				...owner,
				setId: params.setId,
				labels: params.labels,
				userId,
				runId,
				signal: handle.controller.signal,
				cancelSignal: () => runRegistry.cancellation(handle),
				report: (p) => emitToUser("characters:spriteFill", p)
			}).finally(async () => {
				runRegistry.finish(runId)
				try {
					emitToUser("characters:listSprites", await buildSpriteList(owner))
				} catch {
					// The list is a courtesy refresh; the tab re-asks on open.
				}
			})
			const res = { ...owner, runId }
			emitToUser("characters:fillSprites", res)
			return res
		} catch (error: any) {
			emitToUser("characters:fillSprites:error", {
				error: error?.message || "The fill did not start.",
				...errorKeyOf(params)
			})
			throw error
		}
	}
}

/**
 * 🚧 **Re-express from neutral** (DESIGN-image-generation §6.3): redraw the
 * set's neutral sprite as another label with the Sprites loadout's pair,
 * when that pair's sheet says `expressions` (NovelAI). The card's owner or
 * an admin. The new picture is filed by `placeSpriteFile` (an empty sprite
 * first, else a variant) and raises `core:event/sprites-attached@1` for
 * plugin listeners, with the same payload the outlet's write carries.
 */
export const charactersExpressSprite: Handler<
	Sockets.Characters.ExpressSprite.Params,
	Sockets.Characters.ExpressSprite.Response
> = {
	event: "characters:expressSprite",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const owner = ownerKeyOf(params)
			// A member's refusal says read-only or not-found; a card's is the rule's own.
			if ("castMemberId" in owner) await requireWritable(socket.user!, owner)
			const { reexpressSprite } = await import("$lib/server/sprites/reexpress")
			const result = await reexpressSprite(db, {
				...owner,
				setId: params.setId,
				label: params.label,
				userId,
				isAdmin: !!socket.user!.isAdmin
			})
			const added = result.attached[0]
			if (added) {
				try {
					const { pluginEvents } = await import("$lib/server/plugins/eventHost")
					const { getManager } = await import("$lib/server/plugins")
					await pluginEvents().notify(
						getManager(),
						"core:event/sprites-attached@1",
						{
							event: "core:event/sprites-attached@1",
							characterId: "characterId" in owner ? owner.characterId : null,
							castMemberId: "castMemberId" in owner ? owner.castMemberId : null,
							setId: result.setId,
							setName: result.setName,
							attached: result.attached.map(({ label, spriteId }) => ({
								label,
								spriteId
							})),
							missing: result.missing,
							at: Date.now()
						},
						{ user: String(userId) }
					)
				} catch (err) {
					console.warn("[sprites] sprites-attached fan-out failed:", err)
				}
			}
			const res: Sockets.Characters.ExpressSprite.Response = {
				...(await buildSpriteList(owner)),
				...(added ? { spriteId: added.spriteId, label: added.label } : {})
			}
			emitToUser("characters:expressSprite", res)
			return res
		} catch (error: any) {
			emitToUser("characters:expressSprite:error", {
				error: error?.message || "The sprite was not redrawn.",
				...errorKeyOf(params)
			})
			throw error
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
	register(socket, charactersPreviewSpriteFill, emitToUser)
	register(socket, charactersFillSprites, emitToUser)
	register(socket, charactersExpressSprite, emitToUser)
}
