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
import { and, eq, desc, asc, inArray } from "drizzle-orm"
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
import { CULL_ORIGINALS_CONFIRM } from "$lib/shared/constants/MediaCleanup"

/**
 * Resolve the display name of whatever each row is grouped under, in two
 * queries rather than one per row. The panel groups and sorts by this, so it
 * cannot be left to the client to look up — the client has no reason to be
 * holding every character in memory just to label an image.
 */
async function attachmentLabels(rows: FileRow[]) {
	const charIds = [
		...new Set(rows.map((r) => r.characterId).filter(Boolean))
	] as number[]
	const personaIds = [
		...new Set(rows.map((r) => r.personaId).filter(Boolean))
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

	const charName = new Map(
		characters.map((c) => [c.id, c.nickname || c.name])
	)
	const personaName = new Map(personas.map((p) => [p.id, p.name]))

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
			return { type: "session" as const, id: row.sessionId, name: null }
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

		const media: Sockets.ManagedMedia[] = rows.map((row) => {
			const variants = byFile.get(row.id) ?? []
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
				attachedTo: label(row)
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

export const mediaDelete: Handler<
	Sockets.Media.Delete.Params,
	Sockets.Media.Delete.Response
> = {
	event: "media:delete",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const row = await getMedia(db, params.mediaId)
		if (!row || row.userId !== userId) throw new Error("Image not found.")

		// No cull invariant applies: the file is going away entirely, and
		// `deleteFile` is the only thing allowed to leave a file with no
		// representations because it takes the file row with them.
		await deleteFile(db, row.id)

		// Clear the pointers we can see. A dangling pointer is tolerated by
		// design elsewhere, but leaving one we could have cleared would show
		// up immediately as a broken avatar.
		await db
			.update(schema.characters)
			.set({ avatarMediaId: null })
			.where(eq(schema.characters.avatarMediaId, row.id))
		await db
			.update(schema.personas)
			.set({ avatarMediaId: null })
			.where(eq(schema.personas.avatarMediaId, row.id))
		await db
			.update(schema.userSettings)
			.set({ backgroundMediaId: null })
			.where(eq(schema.userSettings.backgroundMediaId, row.id))

		const res: Sockets.Media.Delete.Response = { mediaId: row.id }
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
		const refusals: string[] = []
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
	register(socket, mediaSetVisibility, emitToUser)
	register(socket, mediaDelete, emitToUser)
	register(socket, mediaCleanupPreview, emitToUser)
	register(socket, mediaCullDerived, emitToUser)
	register(socket, mediaCullOriginals, emitToUser)
	register(socket, mediaSetCachePolicy, emitToUser)
}
