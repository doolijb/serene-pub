/**
 * 🚧 `cardState:*` — a character card's own stats, read and written with no
 * session (plans/DESIGN-card-strokes-and-dowry-2026-10-11 §B.4): the
 * character form's **Stats** tab picks the card's sheets, sets its starting
 * values and limits, and authors a stored slot or sheet under the author's
 * own namespace.
 *
 * The rules are `state/cardState.ts`'s (what the card carries, how a change
 * set lands) and `state/declarations.ts`'s (ids, reserved owners, the
 * registry write-through); this file is the door, as `lorebookState.ts` is
 * for a place: the card's owner or "Character not found." (the rule
 * `characters:update` keeps), a refusal in the state layer's own sentence —
 * every failure answered by `refusable()` with the `requestId` echoed — and a
 * reply that is the fresh read rather than a patch.
 *
 * ⚠ Not `state:*`. That family reads what a value IS in one session; this one
 * reads what the CARD says, which every session seating the character
 * inherits beneath its own layer.
 *
 * A write (`set`, `setSheets`) pushes `cardState:changed` to the owner's tabs
 * and tells every session seating the character that its state moved
 * (`state:changed`, gated per session): its vocabulary and the values it
 * inherits are re-read at once (§B.3 — a seat's card sheets join the session
 * vocabulary).
 */

import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import type {
	AttributeSheetDecl,
	AttributeSheetProps,
	AttributeSlotDecl,
	AttributeSlotProps
} from "@serene-pub/sdk"
import type { Handler } from "$lib/shared/events"
import { i18nTextIn } from "$lib/shared/i18n/i18nText"
import {
	applyCardChanges,
	assertCardOwner,
	cardAvailable,
	cardStateFor,
	sessionsSeating,
	type CardState,
	type CardStateChange
} from "$lib/server/state/cardState"
import {
	declareSheet,
	declareSlot,
	setOwnerSheets,
	sheetIdFor,
	slotIdFor,
	updateSheet,
	updateSlot
} from "$lib/server/state/declarations"
import { StateRefusal } from "$lib/server/state/write"
import { getAttributeSlot, sheetSlotAppliesTo } from "@serene-pub/sdk"
import { describeSlot } from "./state"
import { broadcastToSessionUsers } from "./utils/broadcastHelpers"
import { refusable } from "./refusable"

type Reply = Sockets.CardState.Get.Response
type AvailableSlot = Sockets.CardState.AvailableSlot
type AvailableSheet = Sockets.CardState.AvailableSheet

const requestIdOf = (raw: unknown): string | undefined =>
	typeof raw === "string" && raw.length <= 128 ? raw : undefined

/** The ids a refusal carries back: the card, when one was named, and the caller's `requestId`. */
function aboutRequest(raw: unknown): { characterId?: number; requestId?: string } {
	const params = raw as { characterId?: unknown; requestId?: unknown } | undefined
	const characterId = Number(params?.characterId)
	const requestId = requestIdOf(params?.requestId)
	return {
		...(Number.isInteger(characterId) ? { characterId } : {}),
		...(requestId !== undefined ? { requestId } : {})
	}
}

/** The caller's `requestId` alone — for the declaration verbs, which name no card. */
function askerOf(raw: unknown): { requestId?: string } {
	const requestId = requestIdOf((raw as { requestId?: unknown } | undefined)?.requestId)
	return requestId !== undefined ? { requestId } : {}
}

/**
 * A refusal from the state layer or the SDK registry is a sentence a person
 * wrote; it is passed through. The state layer's start lower-case, to follow
 * a subject; a refusal on its own does not.
 */
const stateRefusal = (e: unknown): string | undefined =>
	e instanceof StateRefusal ? capitalized(e.message) : undefined

const capitalized = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s)

/** The card the call names, owned by the caller; else the card reads as missing. */
async function scoped(socket: any, params: { characterId?: unknown } | undefined): Promise<number> {
	const characterId = Number(params?.characterId)
	await assertCardOwner(db, characterId, socket.user?.id)
	return characterId
}

const originOf = (decl: { id: string; origin: string }): Sockets.CardState.Origin =>
	decl.origin === "stored" ? "stored" : decl.id.startsWith("core:") ? "code" : "plugin"

/** Whether the caller may edit a declaration: its author, or an administrator; never a code one. */
const editableBy = (socket: any, decl: { origin: string; authorUserId?: number | string }): boolean =>
	decl.origin === "stored" &&
	(!!socket.user?.isAdmin || (decl.authorUserId != null && Number(decl.authorUserId) === socket.user?.id))

export function slotRow(socket: any, decl: AttributeSlotDecl): AvailableSlot {
	const description = i18nTextIn(decl.description)
	return {
		id: decl.id,
		label: i18nTextIn(decl.label) ?? decl.id,
		...(description ? { description } : {}),
		type: decl.type,
		origin: originOf(decl),
		retired: !!decl.retired,
		appliesTo: [...decl.appliesTo],
		editable: editableBy(socket, decl)
	}
}

export function sheetRow(socket: any, decl: AttributeSheetDecl): AvailableSheet {
	const description = i18nTextIn(decl.description)
	return {
		id: decl.id,
		label: i18nTextIn(decl.label) ?? decl.id,
		...(description ? { description } : {}),
		origin: originOf(decl),
		retired: !!decl.retired,
		slotIds: decl.slots
			.filter((entry) => {
				const slot = getAttributeSlot(entry.id)
				return !!slot && sheetSlotAppliesTo(entry, slot).includes("cast")
			})
			.map((entry) => entry.id),
		editable: editableBy(socket, decl)
	}
}

/** A card's stats, as the wire carries them. */
function replyOf(socket: any, state: CardState, requestId?: string): Reply {
	const available = cardAvailable()
	return {
		characterId: state.characterId,
		sheets: state.sheets,
		vocabulary: state.vocabulary.map((entry) =>
			describeSlot(entry.decl, entry.sheetId !== undefined ? { sheetId: entry.sheetId } : undefined)
		),
		values: state.values,
		configs: state.configs as Record<string, Record<string, unknown>>,
		ownConfigs: state.ownConfigs as Record<string, Record<string, unknown>>,
		defaults: state.defaults,
		available: {
			sheets: available.sheets.map((s) => sheetRow(socket, s)),
			slots: available.slots.map((s) => slotRow(socket, s))
		},
		...(requestId !== undefined ? { requestId } : {})
	}
}

/**
 * The write landed and its reply could not be read. Not "could not be saved":
 * the card holds it (its sessions are told), and a retry would write it twice.
 */
const SAVED_BUT_UNREAD =
	"The stats were saved, but this character's stats could not be read back. Reopen the character to see them."

/**
 * After a write: the owner's other surfaces hear `cardState:changed`, and
 * every session seating the character re-reads its state — its vocabulary
 * takes the card's sheets (§B.3), its values inherit the card's. Gated per
 * session; a failure here is logged, never a refusal of a write that landed.
 */
async function tellOthers(
	socket: any,
	characterId: number,
	emitToUser: (event: string, data: any) => void,
	event: string
): Promise<void> {
	try {
		emitToUser("cardState:changed", { characterId } satisfies Sockets.CardState.Changed.Response)
		for (const sessionId of await sessionsSeating(db, characterId))
			await broadcastToSessionUsers(socket.io, sessionId, "state:changed", {
				sessionId
			} satisfies Sockets.State.Changed.Response)
	} catch (e) {
		console.error(`${event}: telling the character's sessions failed:`, e)
	}
}

/** Read back after a write; a failed read is the saved-but-unread answer, after the others are told. */
async function readBack(
	socket: any,
	characterId: number,
	emitToUser: (event: string, data: any) => void,
	event: string,
	requestId: string | undefined
): Promise<Reply> {
	let state: CardState
	try {
		state = await cardStateFor(db, characterId)
	} catch (e) {
		await tellOthers(socket, characterId, emitToUser, event)
		throw new Error(SAVED_BUT_UNREAD, { cause: e })
	}
	const res = replyOf(socket, state, requestId)
	emitToUser(event, res)
	await tellOthers(socket, characterId, emitToUser, event)
	return res
}

export const cardStateGet: Handler<Sockets.CardState.Get.Params, Reply> = refusable(
	"cardState:get",
	async (socket, params: Sockets.CardState.Get.Params, emitToUser) => {
		const characterId = await scoped(socket, params)
		const res = replyOf(socket, await cardStateFor(db, characterId), requestIdOf(params?.requestId))
		emitToUser("cardState:get", res)
		return res
	},
	"This character's stats could not be read.",
	stateRefusal,
	aboutRequest
)

export const cardStateSet: Handler<Sockets.CardState.Set.Params, Reply> = refusable(
	"cardState:set",
	async (socket, params: Sockets.CardState.Set.Params, emitToUser) => {
		const characterId = await scoped(socket, params)
		await applyCardChanges(db, {
			characterId,
			userId: socket.user!.id,
			changes: (params?.changes ?? []) as CardStateChange[]
		})
		return readBack(socket, characterId, emitToUser, "cardState:set", requestIdOf(params?.requestId))
	},
	"The stats could not be saved.",
	stateRefusal,
	aboutRequest
)

export const cardStateSetSheets: Handler<Sockets.CardState.SetSheets.Params, Reply> = refusable(
	"cardState:setSheets",
	async (socket, params: Sockets.CardState.SetSheets.Params, emitToUser) => {
		const characterId = await scoped(socket, params)
		const sheetIds = params?.sheetIds
		if (!Array.isArray(sheetIds) || sheetIds.some((id) => typeof id !== "string" || !id))
			throw new StateRefusal("Name the sheets as a list of sheet ids.")
		await setOwnerSheets(db, { kind: "card", id: characterId }, sheetIds, {
			userId: socket.user!.id
		})
		return readBack(socket, characterId, emitToUser, "cardState:setSheets", requestIdOf(params?.requestId))
	},
	"The sheets could not be saved.",
	stateRefusal,
	aboutRequest
)

/** The username the caller authors under, read from the account (the id freezes it). */
async function usernameOf(socket: any): Promise<string> {
	const [user] = await db
		.select({ username: schema.users.username })
		.from(schema.users)
		.where(eq(schema.users.id, socket.user!.id))
		.limit(1)
	return user?.username ?? socket.user?.username ?? ""
}

const assertProps = (props: unknown): void => {
	if (!props || typeof props !== "object" || Array.isArray(props))
		throw new StateRefusal("Describe the declaration: its label, its type, and what it applies to.")
}

const assertName = (name: unknown): string => {
	if (typeof name !== "string" || !name.trim()) throw new StateRefusal("Give it a name.")
	return name
}

/** An authored declaration may be edited by its author or an administrator, and nobody else. */
async function assertAuthor(
	socket: any,
	table: typeof schema.attributeDeclarations | typeof schema.attributeSheets,
	id: unknown,
	what: "slot" | "sheet"
): Promise<string> {
	if (typeof id !== "string" || !id) throw new StateRefusal(`Name the ${what} to edit.`)
	const [row] = await db
		.select({ userId: table.userId, origin: table.origin })
		.from(table)
		.where(eq(table.id, id))
		.limit(1)
	// A missing or code row is refused by `updateSlot`/`updateSheet` in its own sentence.
	if (row && row.origin === "stored" && row.userId !== socket.user!.id && !socket.user?.isAdmin)
		throw new StateRefusal(
			`That ${what} is someone else's. A declaration is edited by whoever authored it.`
		)
	return id
}

export const cardStateDeclareSlot: Handler<Sockets.CardState.DeclareSlot.Params, Sockets.CardState.DeclareSlot.Response> =
	refusable(
		"cardState:declareSlot",
		async (socket, params: Sockets.CardState.DeclareSlot.Params, emitToUser) => {
			const name = assertName(params?.name)
			assertProps(params?.props)
			const id = slotIdFor(await usernameOf(socket), name)
			const decl = await declareSlot(db, socket.user!.id, id, params.props as AttributeSlotProps)
			const requestId = requestIdOf(params?.requestId)
			const res = { ...slotRow(socket, decl), ...(requestId !== undefined ? { requestId } : {}) }
			emitToUser("cardState:declareSlot", res)
			return res
		},
		"The slot could not be declared.",
		stateRefusal,
		askerOf
	)

export const cardStateUpdateSlot: Handler<Sockets.CardState.UpdateSlot.Params, Sockets.CardState.UpdateSlot.Response> =
	refusable(
		"cardState:updateSlot",
		async (socket, params: Sockets.CardState.UpdateSlot.Params, emitToUser) => {
			const id = await assertAuthor(socket, schema.attributeDeclarations, params?.id, "slot")
			assertProps(params?.props)
			const decl = await updateSlot(db, id as AttributeSlotDecl["id"], params.props as AttributeSlotProps)
			const requestId = requestIdOf(params?.requestId)
			const res = { ...slotRow(socket, decl), ...(requestId !== undefined ? { requestId } : {}) }
			emitToUser("cardState:updateSlot", res)
			return res
		},
		"The slot could not be saved.",
		stateRefusal,
		askerOf
	)

export const cardStateDeclareSheet: Handler<
	Sockets.CardState.DeclareSheet.Params,
	Sockets.CardState.DeclareSheet.Response
> = refusable(
	"cardState:declareSheet",
	async (socket, params: Sockets.CardState.DeclareSheet.Params, emitToUser) => {
		const name = assertName(params?.name)
		assertProps(params?.props)
		const id = sheetIdFor(await usernameOf(socket), name)
		const decl = await declareSheet(db, socket.user!.id, id, params.props as AttributeSheetProps)
		const requestId = requestIdOf(params?.requestId)
		const res = { ...sheetRow(socket, decl), ...(requestId !== undefined ? { requestId } : {}) }
		emitToUser("cardState:declareSheet", res)
		return res
	},
	"The sheet could not be declared.",
	stateRefusal,
	askerOf
)

export const cardStateUpdateSheet: Handler<
	Sockets.CardState.UpdateSheet.Params,
	Sockets.CardState.UpdateSheet.Response
> = refusable(
	"cardState:updateSheet",
	async (socket, params: Sockets.CardState.UpdateSheet.Params, emitToUser) => {
		const id = await assertAuthor(socket, schema.attributeSheets, params?.id, "sheet")
		assertProps(params?.props)
		const decl = await updateSheet(db, id as AttributeSheetDecl["id"], params.props as AttributeSheetProps)
		const requestId = requestIdOf(params?.requestId)
		const res = { ...sheetRow(socket, decl), ...(requestId !== undefined ? { requestId } : {}) }
		emitToUser("cardState:updateSheet", res)
		return res
	},
	"The sheet could not be saved.",
	stateRefusal,
	askerOf
)

export function registerCardStateHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, cardStateGet, emitToUser)
	register(socket, cardStateSet, emitToUser)
	register(socket, cardStateSetSheets, emitToUser)
	register(socket, cardStateDeclareSlot, emitToUser)
	register(socket, cardStateUpdateSlot, emitToUser)
	register(socket, cardStateDeclareSheet, emitToUser)
	register(socket, cardStateUpdateSheet, emitToUser)
}
