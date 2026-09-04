/**
 * Reclaiming disk (0182) — the one place in the media module that can destroy
 * user data, so the invariants live in the code rather than in the UI.
 *
 * Three risk classes, and which of them is NOT cache matters:
 *
 *  - the DISPLAY form — `cache` FALSE, whether it is a converted WebP or the
 *    original itself. It is the default client-side representation of the file,
 *    not a cache entry, and the derived-form sweep must never touch it.
 *  - the ORIGINAL — `cache` false, cullable only by the explicit destructive
 *    action, and IRREPLACEABLE once gone. A request for it afterwards falls
 *    back to the display form rather than 404ing.
 *  - derived forms — `cache` TRUE. Freely cullable, always re-derivable.
 *
 * **Why the invariants are here and not in the panel.** "Cull derived forms"
 * and "cull originals" are two buttons and an admin may press them in either
 * order; a UI-only guard that reasons about one screenful cannot hold across
 * that. Checked per call, the order stops mattering — and lazy derivation is
 * what makes the general form necessary rather than a nicety, because a freshly
 * uploaded file that has never been requested has exactly ONE representation
 * and it is both the original and the display target.
 */
import { and, eq, inArray, sql } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import {
	MediaFidelity,
	type MediaVariantName
} from "$lib/shared/constants/MediaVisibility"
import type { FileRow, VariantRow } from "./index"
import {
	displayDerivable,
	removeVariant,
	setDisplayPointer,
	variantsFor
} from "./variants"

type Db = typeof db

export type CullOutcome =
	| {
			ok: true
			variant: MediaVariantName
			freedBytes: number
			/** True when this was the display target and the pointer moved to
			 *  another full-fidelity row — which bumped `rev`, because the bare
			 *  URL's bytes changed. */
			repointed: boolean
		}
	| { ok: false; reason: string }

/**
 * Remove ONE stored representation, refusing rather than throwing when it is
 * not safe — a sweep over thousands of rows has to be able to report and carry
 * on.
 *
 * Takes a `db` handle because a request-path caller (the management panel) has
 * one; the whole-library helpers below are sweeps and use the singleton, the
 * same way `backfill.ts` does.
 */
export async function cullVariant(
	db: Db,
	variantId: number
): Promise<CullOutcome> {
	const [row] = await db
		.select()
		.from(schema.variants)
		.where(eq(schema.variants.id, variantId))
		.limit(1)
	if (!row) return { ok: false, reason: "that representation is already gone" }

	const [file] = await db
		.select()
		.from(schema.files)
		.where(eq(schema.files.id, row.fileId))
		.limit(1)
	if (!file) {
		return {
			ok: false,
			reason: "its file row is missing, so nothing can vouch for what else exists"
		}
	}

	const siblings = await variantsFor(db, row.fileId)

	// ---- Precondition 1: NEVER the last surviving representation.
	// This is what makes "cull derived, then cull originals" safe in either
	// order: each call sees the state the previous one left.
	if (siblings.length <= 1) {
		return {
			ok: false,
			reason: "it is the only stored copy of this file — culling it would leave nothing to serve"
		}
	}

	// ---- Precondition 2: culling the display target needs somewhere to
	// re-point. On a never-requested file the original IS the display target, so
	// this and precondition 1 are what make "refuse, rather than silently
	// destroy" true for a fresh upload.
	let repointed = false
	if (file.displayVariantId === row.id) {
		const candidates = siblings
			.filter(
				(s) => s.id !== row.id && s.fidelity === MediaFidelity.FULL
			)
			.sort((a, b) => a.bytes - b.bytes)
		const replacement = candidates[0]
		if (!replacement) {
			return {
				ok: false,
				reason: "it is this file's display form and there is no other full-fidelity copy to serve instead"
			}
		}
		await setDisplayPointer(db, file, replacement)
		repointed = true
	}

	await removeVariant(db, row)
	return {
		ok: true,
		variant: row.variant as MediaVariantName,
		freedBytes: row.bytes,
		repointed
	}
}

export interface DerivedCullable {
	files: number
	variants: number
	bytes: number
	/** The rows themselves, so the action does not have to re-run the scan and
	 *  risk acting on a different set than the one it priced. */
	variantIds: number[]
}

/** Every freely re-derivable row this user owns — the safe action, priced. */
export async function cullableDerived(
	userId: number
): Promise<DerivedCullable> {
	const rows = await db
		.select({
			id: schema.variants.id,
			fileId: schema.variants.fileId,
			bytes: schema.variants.bytes
		})
		.from(schema.variants)
		.innerJoin(schema.files, eq(schema.variants.fileId, schema.files.id))
		.where(
			and(
				eq(schema.files.userId, userId),
				eq(schema.variants.cache, true)
			)
		)
	return {
		files: new Set(rows.map((r) => r.fileId)).size,
		variants: rows.length,
		bytes: rows.reduce((sum, r) => sum + r.bytes, 0),
		variantIds: rows.map((r) => r.id)
	}
}

export interface OriginalCullable {
	files: number
	bytes: number
	/** The original rows that may go, paired with the file they belong to. */
	variantIds: number[]
	/** Counted with the reason rather than culled, so "why did it skip 400 of
	 *  my photos" is an answerable question. */
	skipped: { files: number; reason: string }[]
}

const SKIP_WOULD_GROW =
	"the only other full-fidelity copy is larger — culling would free the smaller file and keep the bigger one"
const SKIP_NO_DISPLAY =
	"no display form has been derived yet — one has to exist before the original may go"

/**
 * Originals that can be culled, and the ones that cannot with the reason.
 *
 * Eligibility is deliberately narrow: the file must already have a NON-original
 * full-fidelity variant that is NOT LARGER than the original. A JPEG photograph
 * never qualifies, and that is the correct answer rather than a gap — its
 * lossless WebP is bigger, so culling would free the small file and keep the
 * big one, which is the opposite of what an admin means by "reclaim space".
 */
export async function cullableOriginals(
	userId: number
): Promise<OriginalCullable> {
	const rows = await db
		.select({ file: schema.files, variant: schema.variants })
		.from(schema.files)
		.innerJoin(schema.variants, eq(schema.variants.fileId, schema.files.id))
		.where(eq(schema.files.userId, userId))

	const byFile = new Map<number, { file: FileRow; variants: VariantRow[] }>()
	for (const { file, variant } of rows) {
		const entry = byFile.get(file.id)
		if (entry) entry.variants.push(variant)
		else byFile.set(file.id, { file, variants: [variant] })
	}

	const variantIds: number[] = []
	let bytes = 0
	const skipReasons = new Map<string, number>()
	const skip = (reason: string) =>
		skipReasons.set(reason, (skipReasons.get(reason) ?? 0) + 1)

	for (const { file, variants } of byFile.values()) {
		const original = variants.find((v) => v.isOriginal)
		if (!original) continue // already culled; nothing owed for this file

		const alternatives = variants
			.filter(
				(v) =>
					v.id !== original.id && v.fidelity === MediaFidelity.FULL
			)
			.sort((a, b) => a.bytes - b.bytes)
		const best = alternatives[0]
		if (!best) {
			const derivable = displayDerivable(file)
			skip(derivable.ok ? SKIP_NO_DISPLAY : derivable.reason)
			continue
		}
		if (best.bytes > original.bytes) {
			skip(SKIP_WOULD_GROW)
			continue
		}
		variantIds.push(original.id)
		bytes += original.bytes
	}

	return {
		files: variantIds.length,
		bytes,
		variantIds,
		skipped: [...skipReasons].map(([reason, files]) => ({ files, reason }))
	}
}

/**
 * Bytes on disk across EVERY representation, per file.
 *
 * `files.display_bytes` is what SHOWING a file costs; this is what STORING it
 * costs, and once one file has three rows they are different questions. The
 * management panel needs both and must not conflate them.
 */
export async function storedBytesByFile(
	fileIds: number[]
): Promise<Map<number, number>> {
	const out = new Map<number, number>()
	if (!fileIds.length) return out
	const rows = await db
		.select({
			fileId: schema.variants.fileId,
			bytes: sql<number>`COALESCE(SUM(${schema.variants.bytes}), 0)::int`
		})
		.from(schema.variants)
		.where(inArray(schema.variants.fileId, fileIds))
		.groupBy(schema.variants.fileId)
	for (const row of rows) out.set(row.fileId, Number(row.bytes))
	return out
}
