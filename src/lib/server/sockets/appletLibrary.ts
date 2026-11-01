/**
 * 🚧 (M2c) The applet library doors — characters and lorebooks. Each is the
 * server half of an applet frame's request (`library-characters`,
 * `update-character`, `library-lorebooks`) and follows `userAnnex.ts`: the
 * params carry `pluginId` + `requestId`, the reply is
 * `{ pluginId, result, requestId }` on the same event, a refusal is
 * `<event>:error { error, pluginId, requestId }`.
 *
 * A plugin's authority is the INTERSECTION of its granted applet permission
 * (`openAppletDoor`, opened FIRST), its ownership (a write reaches only a row
 * carrying THIS plugin's provided mark) and the acting person's own rights
 * (`personMay`, asked of every row returned or touched). The person is the
 * socket's signed-in user, never a param.
 */
import { and, desc, eq, ilike, inArray, isNull, lt, or } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { mediaIdUrl } from "$lib/server/media"
import { MediaVariant } from "$lib/shared/constants/MediaVisibility"
import { openAppletDoor, libraryGrantRefusal, type AppletDoor } from "$lib/server/plugins/appletDoor"
import { personMay } from "$lib/server/auth/actingPerson"
import { markedCharacter } from "$lib/server/plugins/providedMarks"
import { sharedLorebookIdsFor } from "$lib/server/utils/shares"
import { applyStrokesToCard } from "$lib/server/characters/strokes"
import { syncLorebookBindingsForCharacter } from "$lib/server/utils/characterBindingSync"
import { autoEnqueueCharacter } from "$lib/server/embedding/vectorizationQueue"
import { askerOf, refusable } from "./refusable"

type Emit = (event: string, data: any) => void
type Request<K extends keyof import("@serene-pub/sdk").WidgetRequests> =
	import("@serene-pub/sdk").WidgetRequests[K]

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100
const NOT_OURS = "That character was not made by this extension, so it cannot change it."
/** The card fields `update-character` may write; the strings it may carry. */
const WRITABLE = ["name", "nickname", "description", "personality", "scenario", "firstMessage"] as const

/** Params common to a paged read, judged. Throws a sentence. */
function pageOf(p: any): { q: string | null; limit: number; cursor: number | null } {
	if (p.q !== undefined && typeof p.q !== "string") throw new Error("'q' is text.")
	let limit = DEFAULT_LIMIT
	if (p.limit !== undefined) {
		if (!Number.isInteger(p.limit) || p.limit < 1) throw new Error("'limit' is a whole number of one or more.")
		limit = Math.min(p.limit, MAX_LIMIT)
	}
	let cursor: number | null = null
	if (p.cursor !== undefined) {
		const n = typeof p.cursor === "string" && /^\d+$/.test(p.cursor) ? Number(p.cursor) : NaN
		if (!Number.isSafeInteger(n)) throw new Error("That cursor is not one this list gave.")
		cursor = n
	}
	const q = typeof p.q === "string" && p.q.trim() ? p.q.trim() : null
	return { q, limit, cursor }
}

/** `%`/`_`/`\` in a search are text, not wildcards. */
const containsPattern = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`

type CharacterRow = {
	id: number
	name: string
	isPersona: boolean
	avatarMediaId: number | null
}
const toCharacterV1 = (r: CharacterRow): Request<"library-characters">["result"]["rows"][number] => ({
	id: r.id,
	name: r.name,
	isPersona: r.isPersona,
	avatarUrl: r.avatarMediaId ? mediaIdUrl(r.avatarMediaId, MediaVariant.THUMB) : null
})
const CHARACTER_COLUMNS = {
	id: schema.characters.id,
	name: schema.characters.name,
	isPersona: schema.characters.isPersona,
	avatarMediaId: schema.characters.avatarMediaId
}

/** Open the door and judge the library grant: the first line of every handler. */
async function openDoor(
	socket: any,
	params: any,
	what: "characters" | "lorebooks",
	need: "read" | "write"
): Promise<AppletDoor> {
	const door = await openAppletDoor(db as unknown as Db, socket.user?.id, params?.pluginId)
	const refusal = libraryGrantRefusal(door, what, need)
	if (refusal) throw new Error(refusal)
	return door
}

const echo = (raw: unknown) => ({
	...askerOf(raw),
	pluginId: (raw as { pluginId?: unknown } | undefined)?.pluginId
})

/* ── appletApi:libraryCharacters ─────────────────────────────────────────── */

export async function runLibraryCharacters(
	door: AppletDoor,
	p: Request<"library-characters">["params"]
): Promise<Request<"library-characters">["result"]> {
	const { q, limit, cursor } = pageOf(p)
	const rows = await db
		.select(CHARACTER_COLUMNS)
		.from(schema.characters)
		.where(
			and(
				eq(schema.characters.userId, door.person.userId),
				eq(schema.characters.isDeleted, false),
				q ? ilike(schema.characters.name, containsPattern(q)) : undefined,
				cursor != null ? lt(schema.characters.id, cursor) : undefined
			)
		)
		.orderBy(desc(schema.characters.id))
		.limit(limit + 1)
	const page = rows.slice(0, limit)
	const out: ReturnType<typeof toCharacterV1>[] = []
	for (const r of page) {
		const may = await personMay(db as unknown as Db, door.person, "read", { kind: "character", id: r.id })
		if (may.ok) out.push(toCharacterV1(r))
	}
	return {
		rows: out,
		...(rows.length > limit ? { nextCursor: String(page[page.length - 1].id) } : {})
	}
}

export const pluginsLibraryCharacters: Handler<any, any> = refusable(
	"appletApi:libraryCharacters",
	async (socket, params, emitToUser) => {
		const door = await openDoor(socket, params, "characters", "read")
		const result = await runLibraryCharacters(door, params)
		const response = { pluginId: door.pluginId, result, ...askerOf(params) }
		emitToUser("appletApi:libraryCharacters", response)
		return response
	},
	"The person's characters could not be reached.",
	undefined,
	echo
)

/* ── appletApi:updateCharacter ───────────────────────────────────────────── */

export async function runUpdateCharacter(
	door: AppletDoor,
	p: Request<"update-character">["params"],
	emitToUser?: Emit
): Promise<Request<"update-character">["result"]> {
	const allowed = new Set<string>(["characterId", "pluginId", "requestId", ...WRITABLE])
	for (const k of Object.keys(p)) {
		if (!allowed.has(k)) throw new Error(`'${k}' is not a field an extension may change on a character.`)
	}
	const id = p.characterId
	if (!Number.isSafeInteger(id)) throw new Error("That request names no character.")
	const set: Record<string, string | null> = {}
	for (const f of WRITABLE) {
		const v = (p as Record<string, unknown>)[f]
		if (v === undefined) continue
		if (f === "nickname" ? v !== null && typeof v !== "string" : typeof v !== "string")
			throw new Error(`'${f}' is ${f === "nickname" ? "text or null" : "text"}.`)
		if (f === "name" && !(v as string).trim()) throw new Error("A character needs a name.")
		set[f] = v as string | null
	}
	if (!Object.keys(set).length) throw new Error("That request changes nothing.")

	const [stored] = await db
		.select({
			id: schema.characters.id,
			uuid: schema.characters.uuid,
			name: schema.characters.name,
			description: schema.characters.description,
			extensions: schema.characters.extensions
		})
		.from(schema.characters)
		.where(and(eq(schema.characters.id, id), eq(schema.characters.isDeleted, false)))
		.limit(1)
	const may = await personMay(db as unknown as Db, door.person, "write", { kind: "character", id })
	if (!stored || !may.ok) throw new Error(may.ok ? "Character not found." : may.reason)
	// Ownership: the mark names THIS plugin AND is genuinely this row's (a
	// duplicate carries the mark with a stale uuid and reads as no plugin's).
	const mark = markedCharacter(stored.extensions, stored.uuid)
	if (!mark || mark.plugin !== door.pluginId) throw new Error(NOT_OURS)

	const movesEmbeddedText =
		(typeof set.name === "string" && set.name !== stored.name) ||
		(typeof set.description === "string" && set.description !== stored.description)
	// The same strokes rule `characters:update` applies to a save that writes prose.
	const write = applyStrokesToCard(set as any)
	const [updated] = await db
		.update(schema.characters)
		.set({
			...write,
			updatedAt: new Date(),
			...(movesEmbeddedText
				? { embedding: null, embeddingModel: null, embeddingSourceHash: null, vectorizedAt: null }
				: {})
		})
		.where(and(eq(schema.characters.id, id), eq(schema.characters.userId, door.person.userId)))
		.returning(CHARACTER_COLUMNS)
	if (!updated) throw new Error("Character not found.")

	await syncLorebookBindingsForCharacter(id)
	autoEnqueueCharacter(id, set.name ?? stored.name).catch(console.error)
	if (emitToUser) {
		// The pushes `characters:update` sends: the refreshed list, then the card.
		const { buildCharactersList } = await import("./characters")
		const row = await db.query.characters.findFirst({
			where: (c, { eq }) => eq(c.id, id),
			with: { avatarMedia: { columns: { uuid: true, rev: true, frame: true } } }
		})
		await emitToUser("characters:list", () => buildCharactersList(door.person.userId))
		if (row) emitToUser("characters:update", { character: row })
	}
	return toCharacterV1(updated)
}

export const pluginsUpdateCharacter: Handler<any, any> = refusable(
	"appletApi:updateCharacter",
	async (socket, params, emitToUser) => {
		const door = await openDoor(socket, params, "characters", "write")
		const result = await runUpdateCharacter(door, params, emitToUser)
		const response = { pluginId: door.pluginId, result, ...askerOf(params) }
		emitToUser("appletApi:updateCharacter", response)
		return response
	},
	"The extension's character could not be changed.",
	undefined,
	echo
)

/* ── appletApi:libraryLorebooks ──────────────────────────────────────────── */

export async function runLibraryLorebooks(
	door: AppletDoor,
	p: Request<"library-lorebooks">["params"]
): Promise<Request<"library-lorebooks">["result"]> {
	const { q, limit, cursor } = pageOf(p)
	const userId = door.person.userId
	// The set `lorebooks:list` shows: the person's own books and the books
	// shared with them — never a session's own notes, never another's kit.
	const sharedIds = await sharedLorebookIdsFor(db as unknown as Db, userId)
	const rows = await db
		.select({ id: schema.lorebooks.id, name: schema.lorebooks.name })
		.from(schema.lorebooks)
		.where(
			and(
				isNull(schema.lorebooks.sessionId),
				sharedIds.length
					? or(
							eq(schema.lorebooks.userId, userId),
							and(inArray(schema.lorebooks.id, sharedIds), eq(schema.lorebooks.kind, "book"))
						)
					: eq(schema.lorebooks.userId, userId),
				q ? ilike(schema.lorebooks.name, containsPattern(q)) : undefined,
				cursor != null ? lt(schema.lorebooks.id, cursor) : undefined
			)
		)
		.orderBy(desc(schema.lorebooks.id))
		.limit(limit + 1)
	const page = rows.slice(0, limit)
	const out: Request<"library-lorebooks">["result"]["rows"] = []
	for (const r of page) {
		const thing = { kind: "lorebook", id: r.id } as const
		if (!(await personMay(db as unknown as Db, door.person, "read", thing)).ok) continue
		const canEdit = (await personMay(db as unknown as Db, door.person, "write", thing)).ok
		out.push({ id: r.id, name: r.name, canEdit })
	}
	return {
		rows: out,
		...(rows.length > limit ? { nextCursor: String(page[page.length - 1].id) } : {})
	}
}

export const pluginsLibraryLorebooks: Handler<any, any> = refusable(
	"appletApi:libraryLorebooks",
	async (socket, params, emitToUser) => {
		const door = await openDoor(socket, params, "lorebooks", "read")
		const result = await runLibraryLorebooks(door, params)
		const response = { pluginId: door.pluginId, result, ...askerOf(params) }
		emitToUser("appletApi:libraryLorebooks", response)
		return response
	},
	"The person's lorebooks could not be reached.",
	undefined,
	echo
)

export function registerAppletLibraryHandlers(
	socket: any,
	emitToUser: Emit,
	register: (socket: any, handler: Handler<any, any>, emitToUser: Emit) => void
) {
	register(socket, pluginsLibraryCharacters, emitToUser)
	register(socket, pluginsUpdateCharacter, emitToUser)
	register(socket, pluginsLibraryLorebooks, emitToUser)
}
