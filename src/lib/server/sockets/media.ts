/**
 * Media management (28, resplit by 0182) — the handlers behind the Media panel.
 *
 * Everything here is scoped to the calling user's own blobs. That is the whole
 * authorisation story and it is deliberately narrower than `canViewMedia`:
 * *viewing* an image can be inherited from a shared character, but *managing*
 * one — deleting it, changing its visibility, re-cutting its thumbnail,
 * reclaiming its disk — is only ever the owner's to do.
 *
 * This is also the ONE place a variant query belongs. Every other reader loads
 * the `files` row it already holds a pointer to and builds a URL; the question
 * asked here is literally "what is on disk", and only `variants` can answer it.
 *
 * The destructive decisions are NOT here. `cull.ts` prices what may go and
 * `cullVariant` refuses per call — it will not take a file's last surviving
 * representation, and will not take the display target with nowhere to
 * re-point. That is what lets "cull derived forms" and "cull originals" be two
 * buttons pressed in either order. These handlers loop over what cull.ts priced
 * and report what it refused; they never re-decide it, and a guard here would
 * only make the panel polite about a rule it cannot enforce.
 */
import { db } from "$lib/server/db"
import { and, eq, desc, asc, inArray, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { Handler } from "$lib/shared/events"
import {
	bumpFileRev,
	cullableDerived,
	cullableOriginals,
	cullVariant,
	deleteFile,
	displayDerivable,
	ensureVariant,
	getMedia,
	getVariant,
	listVariants,
	toClientMedia,
	type FileRow,
	type VariantRow
} from "$lib/server/media"
import {
	MediaFidelity,
	MediaVariant,
	MediaVisibility
} from "$lib/shared/constants/MediaVisibility"
import { frameProblem, framesEqual } from "$lib/shared/media/frame"
import { CULL_ORIGINALS_CONFIRM } from "$lib/shared/constants/MediaCleanup"

/**
 * Resolve the display name of whatever each row is grouped under, in three
 * queries rather than one per row. The panel groups and sorts by this, so it
 * cannot be left to the client to look up — the client has no reason to be
 * holding every character in memory just to label an image.
 *
 * Every branch answers the SAME question: does the parent this file names still
 * exist? A null name means it does not, and the panel reads that as "orphaned —
 * safe to reclaim". Sessions used to be hardcoded to null here, which made
 * every image a live session had ever generated advertise itself as reclaimable
 * — the exact opposite of the truth, and pointed at files that are in someone's
 * chat history right now.
 */
async function attachmentLabels(rows: FileRow[]) {
	const charIds = [
		...new Set(rows.map((r) => r.characterId).filter(Boolean))
	] as number[]
	const personaIds = [
		...new Set(rows.map((r) => r.personaId).filter(Boolean))
	] as number[]
	const sessionIds = [
		...new Set(rows.map((r) => r.sessionId).filter(Boolean))
	] as number[]

	const characters = charIds.length
		? await db.query.characters.findMany({
				where: inArray(schema.characters.id, charIds),
				columns: { id: true, name: true, nickname: true }
			})
		: []
	const personas = personaIds.length
		? await db.query.personas.findMany({
				where: inArray(schema.personas.id, personaIds),
				columns: { id: true, name: true }
			})
		: []
	const sessions = sessionIds.length
		? await db.query.sessions.findMany({
				where: inArray(schema.sessions.id, sessionIds),
				columns: { id: true, name: true }
			})
		: []

	const charName = new Map(
		characters.map((c) => [c.id, c.nickname || c.name])
	)
	const personaName = new Map(personas.map((p) => [p.id, p.name]))
	// The ROW, not its name: `sessions.name` is optional, so an unnamed live
	// session has a null name and a deleted one has no row — and collapsing
	// those two into one null is what made this bug. The placeholder matches
	// the one the vectorization queue already shows for the same reason.
	const sessionName = new Map(
		sessions.map((s) => [s.id, s.name || `Session #${s.id}`])
	)

	return (row: FileRow) => {
		if (row.characterId)
			return {
				type: "character" as const,
				id: row.characterId,
				// A deleted parent leaves the id behind by design (28 §2), so
				// this is the label an orphan gets — and it is the thing that
				// makes orphans visible to the user at all.
				name: charName.get(row.characterId) ?? null
			}
		if (row.personaId)
			return {
				type: "persona" as const,
				id: row.personaId,
				name: personaName.get(row.personaId) ?? null
			}
		if (row.sessionId)
			return {
				type: "session" as const,
				id: row.sessionId,
				name: sessionName.get(row.sessionId) ?? null
			}
		return null
	}
}

/**
 * How many DISTINCT messages render each file — ONE query for the whole panel,
 * never one per row.
 *
 * **Why this exists.** A message part addresses a file by id
 * (`data.assetId`) and `deleteFile` clears nothing that points at a file, so
 * deleting a file a message shows leaves that message rendering a broken
 * image. Every other pointer the panel can break is cleared on delete; this one
 * cannot be, so it has to be *shown* instead.
 *
 * **Both shapes are counted**, because both render:
 *  - `core:image` / `core:file` parts, whose `data.assetId` is the file id —
 *    written by the runtime host's media parts and attach-image/attach-file.
 *  - `{ kind: "image", assetId }` blocks inside a part's block tree — the SDK's
 *    public block vocabulary (20 §6), which a plugin can emit and
 *    `MessageBlocksView` draws. Blocks nest through `group` up to depth 3, so
 *    the walk is recursive rather than a single `->'blocks'` probe.
 *
 * NOT scoped to the caller's sessions. The file is theirs either way, and a
 * warning that undercounts is worse than one that reads across a boundary that
 * — sessions being single-owner — is not crossable in practice.
 */
async function messageReferenceCounts(): Promise<Map<number, number>> {
	// Only parts that can carry a reference at all, so what comes back is the
	// referencing set rather than every part in the instance. `data is not
	// null` leads the predicate because the overwhelming majority of parts are
	// markdown with no data at all, and it spares them the json calls.
	const rows = await db
		.select({
			messageId: schema.messageParts.messageId,
			type: schema.messageParts.type,
			assetId: sql<
				string | null
			>`${schema.messageParts.data}->>'assetId'`,
			blocks: sql<unknown>`case when json_typeof(${schema.messageParts.data}->'blocks') = 'array' then ${schema.messageParts.data}->'blocks' else null end`
		})
		.from(schema.messageParts)
		.where(
			sql`${schema.messageParts.data} is not null
			    and (${schema.messageParts.data}->>'assetId' is not null
			         or json_typeof(${schema.messageParts.data}->'blocks') = 'array')`
		)

	// Sets, not a running total: two parts of one message can name the same
	// file, and "2 messages" would then be a lie about a single message.
	const messagesByFile = new Map<number, Set<number>>()
	const note = (assetId: unknown, messageId: number) => {
		const id =
			typeof assetId === "number"
				? assetId
				: typeof assetId === "string"
					? Number(assetId)
					: NaN
		if (!Number.isInteger(id)) return
		const seen = messagesByFile.get(id)
		if (seen) seen.add(messageId)
		else messagesByFile.set(id, new Set([messageId]))
	}

	const walkBlocks = (blocks: unknown, messageId: number, depth = 0) => {
		if (!Array.isArray(blocks) || depth > 8) return
		for (const block of blocks) {
			if (!block || typeof block !== "object") continue
			const b = block as Record<string, unknown>
			if (b.kind === "image") note(b.assetId, messageId)
			// `group` nests; the depth cap is a cycle guard, not the renderer's
			// depth-3 limit — an over-deep tree the renderer would not draw is
			// still a reference we would rather over-report than miss.
			if (Array.isArray(b.blocks))
				walkBlocks(b.blocks, messageId, depth + 1)
		}
	}

	for (const row of rows) {
		// The type gate matches the RENDERER, not the column: `MessagePartsView`
		// only draws `data.assetId` for these two types, so a plugin part that
		// happens to carry an `assetId` of its own is not a reference this
		// delete would break, and counting it would overstate the damage.
		if (
			row.assetId != null &&
			(row.type === "core:image" || row.type === "core:file")
		)
			note(row.assetId, row.messageId)
		// The driver hands back a parsed value for a json column; a string is
		// tolerated because that is driver-dependent, not contractual.
		const blocks =
			typeof row.blocks === "string" ? safeParse(row.blocks) : row.blocks
		walkBlocks(blocks, row.messageId)
	}

	return new Map(
		[...messagesByFile].map(([fileId, seen]) => [fileId, seen.size])
	)
}

function safeParse(raw: string): unknown {
	try {
		return JSON.parse(raw)
	} catch {
		return null
	}
}

/** Every file this user owns, paired with its stored representations. The
 *  cleanup actions decide per FILE ("is there anything to fall back on?") but
 *  act per VARIANT, so both halves have to be in hand. */
async function ownedFilesWithVariants(
	userId: number
): Promise<{ file: FileRow; variants: VariantRow[] }[]> {
	const files = await db
		.select()
		.from(schema.files)
		.where(eq(schema.files.userId, userId))
		.orderBy(asc(schema.files.id))
	const byFile = await listVariants(
		db,
		files.map((f) => f.id)
	)
	return files.map((file) => ({ file, variants: byFile.get(file.id) ?? [] }))
}

/** Whether the derived-form cache is on. Defaults to the column's own default
 *  when there is no settings row yet — previewing a cleanup is no reason to
 *  create one as a side effect. */
async function derivedCacheEnabled(userId: number): Promise<boolean> {
	const [row] = await db
		.select({ enabled: schema.userSettings.derivedMediaCacheEnabled })
		.from(schema.userSettings)
		.where(eq(schema.userSettings.userId, userId))
		.limit(1)
	return row?.enabled ?? true
}

/**
 * Fold per-call refusals into the counts cull.ts already grouped, largest group
 * first.
 *
 * Two sources on purpose: `cullableOriginals` explains what it would not even
 * offer, and `cullVariant` explains what it refused when asked. Both answer
 * "why did it skip 400 of my photos", and both are prose written where the
 * decision was made rather than a slug this file re-interprets.
 */
function mergeSkipped(
	groups: { files: number; reason: string }[],
	refusals: string[]
): { files: number; reason: string }[] {
	const counts = new Map<string, number>()
	for (const g of groups)
		counts.set(g.reason, (counts.get(g.reason) ?? 0) + g.files)
	for (const reason of refusals)
		counts.set(reason, (counts.get(reason) ?? 0) + 1)
	return [...counts]
		.map(([reason, files]) => ({ files, reason }))
		.sort((a, b) => b.files - a.files)
}

export const mediaList: Handler<
	Sockets.Media.List.Params,
	Sockets.Media.List.Response
> = {
	event: "media:list",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		const sort = params?.sort ?? "newest"
		// There is no derivative filter any more, and no id space to filter: a
		// variant row carries no provenance at all, so a query for a user's
		// files can never return one. That absence is what replaced the old
		// `variant IS NULL` condition.
		const orderBy =
			sort === "oldest"
				? [asc(schema.files.createdAt), asc(schema.files.id)]
				: sort === "name"
					? [asc(schema.files.filename), asc(schema.files.id)]
					: [desc(schema.files.createdAt), desc(schema.files.id)]

		const filters = [eq(schema.files.userId, userId)]
		if (params?.kind) filters.push(eq(schema.files.kind, params.kind))

		const rows = await db
			.select()
			.from(schema.files)
			.where(and(...filters))
			.orderBy(...orderBy)

		// One batched variant query for the whole page — correct HERE and only
		// here, because this panel's subject is disk rather than rendering.
		const byFile = await listVariants(
			db,
			rows.map((r) => r.id)
		)
		const label = await attachmentLabels(rows)
		// One more batched query, on the same principle as the labels above: a
		// derived fact the panel cannot work out for itself, resolved for the
		// whole page at once. Deliberately NOT a per-row lookup — this list is
		// already unbounded and re-runs after every mutation.
		const refs = await messageReferenceCounts()

		const media: Sockets.ManagedMedia[] = rows.map((row) => {
			const variants = byFile.get(row.id) ?? []
			const attachedTo = label(row)
			return {
				...toClientMedia(row),
				createdAt:
					row.createdAt instanceof Date
						? row.createdAt.toISOString()
						: String(row.createdAt),
				// Summed from the rows already loaded rather than through
				// `storedBytesByFile`, which would be a second pass over the
				// same data and could disagree with the list beside it.
				storedBytes: variants.reduce((sum, v) => sum + v.bytes, 0),
				// Field by field, never a spread: `path` lives on this row and
				// nowhere else, so spreading one is the only way a payload
				// could still leak the data-dir layout.
				variants: variants.map((v) => ({
					variant: v.variant,
					mime: v.mime,
					bytes: v.bytes,
					isOriginal: v.isOriginal,
					cache: v.cache,
					fidelity: v.fidelity,
					isDisplay: v.id === row.displayVariantId
				})),
				attachedTo,
				// Named a parent that is gone — the only state the panel may
				// read as "safe to reclaim". A file with no parent at all is a
				// user-level upload and is emphatically not one.
				orphaned: attachedTo !== null && attachedTo.name === null,
				messageRefs: refs.get(row.id) ?? 0
			}
		})

		// Size order is over STORED bytes, not display bytes. Once one file has
		// three rows, "what showing it costs" and "what storing it costs" are
		// different questions, and someone sorting by size in a panel with a
		// cleanup section in it is asking the second. The sum only exists after
		// the variant query above, so it is ordered here rather than in SQL.
		if (sort === "largest" || sort === "smallest") {
			const dir = sort === "largest" ? -1 : 1
			media.sort(
				(a, b) => dir * (a.storedBytes - b.storedBytes) || a.id - b.id
			)
		}

		const res: Sockets.Media.List.Response = {
			media,
			totalBytes: media.reduce((sum, m) => sum + m.storedBytes, 0)
		}
		emitToUser("media:list", res)
		return res
	}
}

/**
 * Announce that a file's bytes changed while its id stayed put.
 *
 * A bump writes nothing to the character, persona or message wearing the file,
 * so no entity event fires and every open view keeps the `<img src>` it already
 * rendered — which a browser answers from its own cache. The uuid travels with
 * the token so a view holding only `avatarMediaId` can build the bustable URL
 * from this alone.
 *
 * Emitted after the write, never before: the token on the wire has to be the
 * one the route will serve.
 */
async function announceChanged(
	fileId: number,
	emitToUser: (event: string, data: any) => void
) {
	const row = await getMedia(db, fileId)
	if (!row) return
	emitToUser("media:changed", {
		id: row.id,
		uuid: row.uuid,
		rev: row.rev,
		frame: row.frame ?? null
	} satisfies Sockets.Media.Changed.Response)
}

export const mediaRegenerateThumbnail: Handler<
	Sockets.Media.RegenerateThumbnail.Params,
	Sockets.Media.RegenerateThumbnail.Response
> = {
	event: "media:regenerateThumbnail",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const row = await getMedia(db, params.mediaId)
		if (!row || row.userId !== userId) throw new Error("Image not found.")

		// Drop the existing row first — `ensureVariant` returns what is already
		// stored, which is what makes it safe on a serving path and useless as
		// a "redo this" button on its own.
		const existing = await getVariant(db, row.id, MediaVariant.THUMB)
		if (existing) {
			const outcome = await cullVariant(db, existing.id)
			if (!outcome.ok) {
				throw new Error(
					`The thumbnail could not be replaced: ${outcome.reason}.`
				)
			}
		}

		const thumb = await ensureVariant(db, row, MediaVariant.THUMB)

		// Bumped unconditionally, including when no thumb row existed before.
		// The general rule is that deriving something new does not bump, but it
		// does not apply here: `?v=thumb` on a file with no thumb row still
		// SERVES something — the display form, immutable for a year — so a
		// browser can be holding bytes at this exact URL either way, and only a
		// different URL string dislodges them.
		await bumpFileRev(db, row.id)
		await announceChanged(row.id, emitToUser)

		const res: Sockets.Media.RegenerateThumbnail.Response = {
			mediaId: row.id,
			// True only when a thumb row is now stored. It is legitimately
			// false when the source is already at or under the target size,
			// when the derived-form cache is switched off, and when the encode
			// failed — all three are "the display form serves", not an error
			// the user needs to act on.
			regenerated: thumb?.variant === MediaVariant.THUMB && !!thumb.row
		}
		emitToUser("media:regenerateThumbnail", res)
		await mediaList.handler(socket, {}, emitToUser)
		return res
	}
}

export const mediaSetFrame: Handler<
	Sockets.Media.SetFrame.Params,
	Sockets.Media.SetFrame.Response
> = {
	event: "media:setFrame",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const row = await getMedia(db, params.mediaId)
		if (!row || row.userId !== userId) throw new Error("Image not found.")

		const frame = params.frame ?? null
		// Refused, never clamped. A frame that does not fit means the caller
		// measured a different image, and quietly moving it would store a crop
		// nobody chose.
		if (frame) {
			const problem = frameProblem(frame, row.width, row.height)
			if (problem) throw new Error(problem)
		}

		// Nothing changed, so nothing is re-cut and no URL is invalidated.
		// Re-saving the same crop must not cost every open view its cached
		// pixels.
		if (framesEqual(row.frame, frame)) {
			const same: Sockets.Media.SetFrame.Response = {
				media: toClientMedia(row)
			}
			emitToUser("media:setFrame", same)
			return same
		}

		await db
			.update(schema.files)
			.set({ frame })
			.where(eq(schema.files.id, row.id))

		// The stored thumbnail is the OLD crop, and `ensureVariant` returns
		// what is stored — so it has to go, or the new frame never reaches a
		// pixel.
		const existing = await getVariant(db, row.id, MediaVariant.THUMB)
		if (existing) {
			const outcome = await cullVariant(db, existing.id)
			if (!outcome.ok) {
				throw new Error(
					`The crop could not be applied: ${outcome.reason}.`
				)
			}
		}

		// Bumped whether or not a thumb row existed: `?v=thumb` on a file with
		// no thumb row still SERVES something — the display form, immutable for
		// a year — so a browser can be holding bytes at this exact URL either
		// way, and only a different URL string dislodges them.
		await bumpFileRev(db, row.id)
		await announceChanged(row.id, emitToUser)

		const updated = (await getMedia(db, row.id)) ?? row
		const res: Sockets.Media.SetFrame.Response = {
			media: toClientMedia(updated)
		}
		emitToUser("media:setFrame", res)
		return res
	}
}

export const mediaSetVisibility: Handler<
	Sockets.Media.SetVisibility.Params,
	Sockets.Media.SetVisibility.Response
> = {
	event: "media:setVisibility",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const row = await getMedia(db, params.mediaId)
		if (!row || row.userId !== userId) throw new Error("Image not found.")
		if (
			params.visibility !== MediaVisibility.SCOPED &&
			params.visibility !== MediaVisibility.PRIVATE
		) {
			throw new Error("Unknown visibility.")
		}

		// One statement, one row. This used to be two, because a derivative
		// carried its own copy of `visibility` that had to be kept in step —
		// and an out-of-step copy is the kind of thing that later reads as a
		// permissions bug. There is no per-variant copy left to drift, which is
		// one of the bug classes the split removes rather than fixes.
		await db
			.update(schema.files)
			.set({ visibility: params.visibility })
			.where(eq(schema.files.id, row.id))

		const res: Sockets.Media.SetVisibility.Response = {
			mediaId: row.id,
			visibility: params.visibility
		}
		emitToUser("media:setVisibility", res)
		await mediaList.handler(socket, {}, emitToUser)
		return res
	}
}

/**
 * Delete a file outright.
 *
 * **The policy on message-referenced media: confirm, then delete, and leave the
 * parts standing.** Chosen over refusing and over rewriting the parts, because
 * it is the only one of the three this codebase can honour:
 *
 *  - *Refusing* would make any image a session ever produced permanently
 *    undeletable, in the one panel whose entire purpose is reclaiming disk. The
 *    only way out would be deleting the conversation, which is a far larger
 *    loss than the one being avoided.
 *  - *Cleaning the parts* would make this handler a second writer of message
 *    state, and the message store is the single writer by design (see the
 *    `messages` docblock). Worse, it cannot be done safely: removing the only
 *    part of a step leaves `active_revisions` naming a revision with no parts —
 *    the map invariant the store's own tests pin as a bug, not a state to
 *    tolerate. Rewriting the part instead of removing it renders as a collapsed
 *    JSON blob titled `core:image`, which is worse than a broken image and is
 *    still the media panel editing someone's transcript.
 *  - *Confirm and leave the reference dangling* is what 28 §2 already rules for
 *    every pointer with no FK behind it — see `deleteFile`'s own docblock. The
 *    avatar pointers stopped being such a pointer in 0109 and now null
 *    themselves, but a file id inside a message part is JSON no constraint can
 *    reach, so it renders as a missing image and is tolerated on purpose. The
 *    message, its text and its place in the transcript all survive.
 *
 * So the fix is not to change what delete does, but to stop it happening
 * unaware: a referenced file needs `confirmMessageRefs`, and the refusal names
 * the count.
 */
export const mediaDelete: Handler<
	Sockets.Media.Delete.Params,
	Sockets.Media.Delete.Response
> = {
	event: "media:delete",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const row = await getMedia(db, params.mediaId)
		if (!row || row.userId !== userId) throw new Error("Image not found.")

		// Re-counted here rather than trusted from the client: the panel's
		// number is as old as its last `media:list`, and a session generating
		// into the same file in the meantime is exactly the case the gate is
		// for. The count in the refusal is therefore the true one.
		const messageRefs = (await messageReferenceCounts()).get(row.id) ?? 0
		if (messageRefs > 0 && params?.confirmMessageRefs !== true) {
			const plural = messageRefs === 1 ? "message" : "messages"
			throw new Error(
				`This file is shown in ${messageRefs} ${plural}. Deleting it leaves ` +
					`${messageRefs === 1 ? "that message" : "those messages"} with a broken ` +
					`image — confirm to delete it anyway.`
			)
		}

		// No cull invariant applies: the file is going away entirely, and
		// `deleteFile` is the only thing allowed to leave a file with no
		// representations because it takes the file row with them.
		await deleteFile(db, row.id)

		// The character and persona avatar pointers used to be cleared by hand
		// right here. 0109 made them real foreign keys, `ON DELETE SET NULL`,
		// so `deleteFile` above already nulled them — the database did it, in
		// the same statement, for every pointer rather than the two this
		// handler happened to know about. Re-running the UPDATEs would match
		// nothing.
		//
		// `backgroundMediaId` is NOT one of them and still needs clearing by
		// hand: it lives on `user_settings` and has no FK, so nothing else
		// clears it. Give it the same treatment and this block goes away too.
		await db
			.update(schema.userSettings)
			.set({ backgroundMediaId: null })
			.where(eq(schema.userSettings.backgroundMediaId, row.id))

		const res: Sockets.Media.Delete.Response = {
			mediaId: row.id,
			messageRefs
		}
		emitToUser("media:delete", res)
		await mediaList.handler(socket, {}, emitToUser)
		return res
	}
}

/**
 * What the two cull actions would do, priced before anyone commits.
 *
 * Cheap on purpose: existing variant rows only, nothing derived. So it
 * UNDERCOUNTS what culling originals can reclaim — a file whose web-safe copy
 * has never been made cannot be priced without doing the encode, and the encode
 * is the expensive half. What an admin sees here is a floor, and the UI says so.
 */
export const mediaCleanupPreview: Handler<
	Sockets.Media.CleanupPreview.Params,
	Sockets.Media.CleanupPreview.Response
> = {
	event: "media:cleanupPreview",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const derived = await cullableDerived(userId)
		const originals = await cullableOriginals(userId)

		const res: Sockets.Media.CleanupPreview.Response = {
			// Mapped rather than spread: both of these carry the row ids the
			// action needs, and a client has no business holding them.
			derived: {
				files: derived.files,
				variants: derived.variants,
				bytes: derived.bytes
			},
			originals: { files: originals.files, bytes: originals.bytes },
			skipped: mergeSkipped(originals.skipped, []),
			derivedCacheEnabled: await derivedCacheEnabled(userId)
		}
		emitToUser("media:cleanupPreview", res)
		return res
	}
}

/**
 * The safe action, and the default one: every re-derivable representation goes.
 *
 * It cannot touch a display form or an original even by accident — both are
 * `cache: false` — and a refusal is counted rather than thrown, so one
 * pathological file cannot stop an admin reclaiming the rest.
 */
export const mediaCullDerived: Handler<
	Sockets.Media.CullDerived.Params,
	Sockets.Media.CullDerived.Response
> = {
	event: "media:cullDerived",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		// The priced set, so the action cannot act on a different set than the
		// preview showed.
		const cullable = await cullableDerived(userId)

		let variants = 0
		let bytes = 0
		for (const variantId of cullable.variantIds) {
			const outcome = await cullVariant(db, variantId)
			if (!outcome.ok) continue
			variants++
			bytes += outcome.freedBytes
		}

		const res: Sockets.Media.CullDerived.Response = { variants, bytes }
		emitToUser("media:cullDerived", res)
		await mediaList.handler(socket, {}, emitToUser)
		return res
	}
}

/**
 * The separate, louder, irreversible action: the uploaded bytes themselves go,
 * leaving a web-safe copy behind to serve.
 *
 * Three phases, and the order is the point.
 *
 *  1. Derive a display form for every file that has none. The invariant needs
 *     one to exist before an original may go, and deriving it is the other safe
 *     answer to a single-representation file besides refusing. This is the
 *     expensive phase — on a library of photographs it encodes a lossless WebP
 *     per file and mostly throws it away, because `deriveDisplay` declines to
 *     keep one that is no smaller than the web-safe original it came from. That
 *     cost is the honest price of finding out whether anything can be
 *     reclaimed, and it is only paid on the explicit destructive action.
 *  2. Price, once, over the state phase 1 left. `cullableOriginals` owns the
 *     eligibility rule — including that a bigger copy is never an improvement.
 *  3. Cull, and report whatever refusals come back.
 */
export const mediaCullOriginals: Handler<
	Sockets.Media.CullOriginals.Params,
	Sockets.Media.CullOriginals.Response
> = {
	event: "media:cullOriginals",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		// Trimmed, because a pasted phrase carries whitespace, but otherwise
		// exact: the gate is that the admin read the warning.
		if ((params?.confirm ?? "").trim() !== CULL_ORIGINALS_CONFIRM) {
			throw new Error(
				`Type ${CULL_ORIGINALS_CONFIRM} to confirm — this cannot be undone.`
			)
		}

		let addedBytes = 0
		for (const { file, variants } of await ownedFilesWithVariants(userId)) {
			if (!variants.some((v) => v.isOriginal)) continue
			// Both of these only skip work that would be wasted; neither is a
			// decision about what may go. A file that already has a
			// full-fidelity alternative needs no derivation, and one no codec
			// can convert would only fail.
			if (
				variants.some(
					(v) => !v.isOriginal && v.fidelity === MediaFidelity.FULL
				)
			)
				continue
			if (!displayDerivable(file).ok) continue

			const display = await ensureVariant(db, file, MediaVariant.DISPLAY)
			// A web-safe original IS its own display form, so `ensureVariant`
			// hands that same row back and nothing was written. There is still
			// nothing to fall back on, and phase 2 will say so.
			if (display?.row && !display.row.isOriginal)
				addedBytes += display.row.bytes
		}

		const priced = await cullableOriginals(userId)
		// Which file each priced row belongs to, read once: `cullVariant`
		// reports THAT the pointer moved, and the announcement needs to name
		// the file whose bare URL now serves different bytes.
		const fileOfVariant = new Map<number, number>()
		if (priced.variantIds.length) {
			for (const v of await db
				.select({
					id: schema.variants.id,
					fileId: schema.variants.fileId
				})
				.from(schema.variants)
				.where(inArray(schema.variants.id, priced.variantIds))) {
				fileOfVariant.set(v.id, v.fileId)
			}
		}
		const refusals: string[] = []
		const repointedFiles = new Set<number>()
		let files = 0
		let freedBytes = 0
		for (const variantId of priced.variantIds) {
			// Re-pointing `display_variant_id` and bumping `rev` happen inside,
			// because only the cull knows the bare URL's bytes just changed.
			const outcome = await cullVariant(db, variantId)
			if (!outcome.ok) {
				refusals.push(outcome.reason)
				continue
			}
			files++
			freedBytes += outcome.freedBytes
			if (outcome.repointed) {
				const fileId = fileOfVariant.get(variantId)
				if (fileId != null) repointedFiles.add(fileId)
			}
		}
		for (const fileId of repointedFiles) {
			await announceChanged(fileId, emitToUser)
		}

		const res: Sockets.Media.CullOriginals.Response = {
			files,
			freedBytes,
			// Reported because "reclaimed 4GB" is a lie if 1GB went straight
			// back on disk deriving the copies that made the cull safe.
			addedBytes,
			skipped: mergeSkipped(priced.skipped, refusals)
		}
		emitToUser("media:cullOriginals", res)
		await mediaList.handler(socket, {}, emitToUser)
		return res
	}
}

/**
 * Turn the derived-form cache off entirely.
 *
 * Lives here rather than in `userSettings.ts` because it is part of this
 * panel's story. Upserted rather than updated: a user who has never opened
 * settings has no row, and a plain UPDATE would report success while changing
 * nothing.
 */
export const mediaSetCachePolicy: Handler<
	Sockets.Media.SetCachePolicy.Params,
	Sockets.Media.SetCachePolicy.Response
> = {
	event: "media:setCachePolicy",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const enabled = !!params?.derivedCacheEnabled

		await db
			.insert(schema.userSettings)
			.values({ userId, derivedMediaCacheEnabled: enabled })
			.onConflictDoUpdate({
				target: schema.userSettings.userId,
				set: { derivedMediaCacheEnabled: enabled }
			})

		const res: Sockets.Media.SetCachePolicy.Response = {
			derivedCacheEnabled: enabled
		}
		emitToUser("media:setCachePolicy", res)
		return res
	}
}

export function registerMediaHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, mediaList, emitToUser)
	register(socket, mediaRegenerateThumbnail, emitToUser)
	register(socket, mediaSetFrame, emitToUser)
	register(socket, mediaSetVisibility, emitToUser)
	register(socket, mediaDelete, emitToUser)
	register(socket, mediaCleanupPreview, emitToUser)
	register(socket, mediaCullDerived, emitToUser)
	register(socket, mediaCullOriginals, emitToUser)
	register(socket, mediaSetCachePolicy, emitToUser)
}
