/**
 * 🚧 (M2e, ★M2e-1) **Provided primers**: every primer that holds something
 * (`shippedKits()`) is imported at boot as an immutable `starter_kit` lorebook
 * row, so the Starter lorebook list reads rows the way it reads a plugin's
 * provided books. One mechanism, three sources (core, a plugin, an admin).
 *
 * The row is an ordinary lorebook of book kind `starter_kit`, owned by the
 * first live admin, written by `writePrimerInto` (so a start from the row
 * equals a start from the catalogue), and marked
 * `extra_json.provided = { plugin, slug, version, sha256, uuid, entries }` with
 * `plugin` = the primer id's owner (`core` for core's) and `slug` = the primer
 * id (`providedMarks.ts`). The mark's `disabled` has one writer,
 * `setProvidedBookDisabled`; this file only carries it through an upgrade.
 *
 * ## Key and verbs (idempotent)
 *  · no row carries the mark → import it, as the first live admin;
 *  · same content hash → nothing (the version is moved up when the app's is newer);
 *  · a changed content hash → a diff over entries, places and leads, exactly
 *    `providedBooks.ts upgrade()`: an untouched changed entry is rewritten, one
 *    new upstream is added, one a person edited is kept, one gone upstream is
 *    left. Upgrades land while the row is disabled.
 *
 * ⚠ Not diffed on an upgrade: the cast, ties, exits, calendar,
 * clock, the row's name, description and Rules. They are written at the import.
 *
 * A plugin's primer would ride this same path: `shippedKits()` lists every
 * registered primer, and the owner is the id's owner. Plugins declare none
 * today.
 */
import { and, asc, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { hashCanonicalJson } from "$lib/server/utils/contentHash"
import { nextPosition } from "$lib/server/utils/lorebookEntries"
import { i18nText, type PrimerDecl } from "@serene-pub/sdk"
import {
	primerItemRow,
	primerItems,
	primerOwnerOf,
	primerRowOf,
	shippedKits,
	STARTER_KIT_KIND,
	writePrimerInto
} from "$lib/server/lorebooks/starterKits"
import {
	compareVersions,
	markedBook,
	type ProvidedBookMark,
	type ProvidedEntryMark
} from "./providedMarks"
import { CONTENT_COLUMNS, rowHashOf, saveMark, serial } from "./providedBooks"

export interface ProvidedPrimerReport {
	imported: string[]
	upgraded: string[]
	problems: string[]
}

/** The app's own version; `__APP_VERSION__` is a Vite define that does not exist under vitest. */
function appVersionOf(): string {
	// @ts-ignore
	return typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0"
}

/** The hash of what a primer ships: its name, description, Rules and content. */
const primerShaOf = (p: PrimerDecl): string =>
	hashCanonicalJson({
		name: p.name,
		description: p.description,
		ruleset: p.ruleset,
		content: p.content
	})

/** The first live admin: the person the rows are imported as (and whom a disk install enables a plugin as). */
export async function firstLiveAdmin(db: Db): Promise<number | null> {
	const [u] = await db
		.select({ id: schema.users.id })
		.from(schema.users)
		.where(
			and(
				eq(schema.users.isAdmin, true),
				eq(schema.users.isDeleted, false)
			)
		)
		.orderBy(asc(schema.users.id))
		.limit(1)
	return u?.id ?? null
}

/**
 * Import or upgrade every primer as its row. Best-effort: a problem is in the
 * report (and logged), never thrown. Serialised (`serial("core", …)`) with
 * itself. `opts.version` is the app version the marks are stamped with (the
 * running build's by default).
 */
export function syncProvidedPrimers(
	db: Db,
	opts: { version?: string } = {}
): Promise<ProvidedPrimerReport> {
	return serial("core", async () => {
		const report: ProvidedPrimerReport = {
			imported: [],
			upgraded: [],
			problems: []
		}
		const version = opts.version ?? appVersionOf()
		try {
			const admin = await firstLiveAdmin(db)
			for (const primer of shippedKits()) {
				try {
					const found = await primerRowOf(db, primer.id)
					if (!found) {
						if (admin == null) {
							report.problems.push(
								`${primer.id}: no administrator to import as`
							)
							continue
						}
						await importPrimer(db, primer, admin, version)
						report.imported.push(primer.id)
					} else if (
						await upgradePrimer(
							db,
							primer,
							found.row,
							found.mark,
							version
						)
					)
						report.upgraded.push(primer.id)
				} catch (e) {
					const msg = `${primer.id}: ${e instanceof Error ? e.message : String(e)}`
					report.problems.push(msg)
					console.warn(`[plugins] provided primer ${msg}`)
				}
			}
		} catch (e) {
			report.problems.push(String(e))
			console.warn("[plugins] provided primers failed:", e)
		}
		return report
	})
}

/** Import one primer as a row and its mark, in one transaction; then queue it for search. */
async function importPrimer(
	db: Db,
	primer: PrimerDecl,
	adminId: number,
	version: string
): Promise<void> {
	const owner = primerOwnerOf(primer.id)
	const book = await db.transaction(async (tx) => {
		const [book] = await tx
			.insert(schema.lorebooks)
			.values({
				name: i18nText(primer.name) ?? primer.id,
				description: i18nText(primer.description) ?? "",
				userId: adminId,
				kind: STARTER_KIT_KIND,
				sessionId: null,
				primaryRuleset: primer.ruleset
			})
			.returning()
		const written = await writePrimerInto(tx as unknown as Db, {
			lorebookId: book.id,
			userId: adminId,
			primer
		})
		const ids = Object.values(written.entryIds)
		const rows = ids.length
			? await tx
					.select()
					.from(schema.lorebookEntries)
					.where(inArray(schema.lorebookEntries.id, ids))
			: []
		const byId = new Map(rows.map((r) => [r.id, r]))
		const entries: Record<string, ProvidedEntryMark> = {}
		for (const item of primerItems(primer.content)) {
			const landed = byId.get(written.entryIds[item.key])
			if (landed)
				entries[item.key] = {
					id: landed.id,
					hash: rowHashOf(landed),
					up: hashCanonicalJson(item)
				}
		}
		await tx
			.update(schema.lorebooks)
			.set({
				extraJson: {
					...((book.extraJson ?? {}) as object),
					provided: {
						plugin: owner,
						slug: primer.id,
						version,
						sha256: primerShaOf(primer),
						uuid: book.uuid,
						entries
					} satisfies ProvidedBookMark
				}
			})
			.where(eq(schema.lorebooks.id, book.id))
		return book
	})
	try {
		const { queueImportedBook } = await import(
			"$lib/server/sockets/lorebooks"
		)
		queueImportedBook(book.id, book.name)
	} catch (e) {
		console.error("A provided primer was not queued for search:", e)
	}
}

/** A changed primer on a row already here: a diff, as `providedBooks.ts upgrade()`. True when anything was written. */
async function upgradePrimer(
	db: Db,
	primer: PrimerDecl,
	book: typeof schema.lorebooks.$inferSelect,
	mark: ProvidedBookMark,
	version: string
): Promise<boolean> {
	if (compareVersions(version, mark.version) < 0) return false // a newer build wrote it
	const sha256 = primerShaOf(primer)
	if (mark.sha256 === sha256) {
		// A new build, the same primer: just move the version.
		if (mark.version === version) return false
		await saveMark(db, book, { ...mark, version })
		return false
	}
	const items = primerItems(primer.content)
	let written = 0
	await db.transaction(async (tx) => {
		const [fresh] = await tx
			.select({
				extraJson: schema.lorebooks.extraJson,
				uuid: schema.lorebooks.uuid
			})
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, book.id))
		// The mark as it stands now: `disabled` has one writer and may have moved.
		const current =
			(fresh && markedBook(fresh.extraJson, fresh.uuid)) ?? mark
		const live = new Map(
			(
				await tx
					.select()
					.from(schema.lorebookEntries)
					.where(eq(schema.lorebookEntries.lorebookId, book.id))
			).map((r) => [r.id, r])
		)
		const next: Record<string, ProvidedEntryMark> = { ...current.entries }
		for (const item of items) {
			const up = hashCanonicalJson(item)
			const known = current.entries[item.key]
			if (!known) {
				const [created] = await tx
					.insert(schema.lorebookEntries)
					.values(
						primerItemRow(
							item,
							book.id,
							await nextPosition(
								tx as unknown as Db,
								book.id,
								item.typeId.replace(/@\d+$/, "")
							)
						)
					)
					.returning()
				next[item.key] = {
					id: created.id,
					hash: rowHashOf(created),
					up
				}
				written++
				continue
			}
			const row = live.get(known.id)
			if (!row) continue // the person deleted it: theirs to decide
			if (rowHashOf(row) !== known.hash) continue // the person edited it: the person wins
			if (known.up === up) continue
			const values = primerItemRow(item, book.id, row.position) as Record<
				string,
				unknown
			>
			const set: Record<string, unknown> = {}
			for (const c of CONTENT_COLUMNS)
				if (values[c] !== undefined) set[c] = values[c]
			const [updated] = await tx
				.update(schema.lorebookEntries)
				.set(set as never)
				.where(eq(schema.lorebookEntries.id, known.id))
				.returning()
			next[item.key] = { id: known.id, hash: rowHashOf(updated), up }
			written++
		}
		await tx
			.update(schema.lorebooks)
			.set({
				extraJson: {
					...((fresh?.extraJson ?? {}) as object),
					provided: { ...current, version, sha256, entries: next }
				}
			})
			.where(eq(schema.lorebooks.id, book.id))
	})
	if (written) {
		try {
			const { queueImportedBook } = await import(
				"$lib/server/sockets/lorebooks"
			)
			queueImportedBook(book.id, book.name)
		} catch (e) {
			console.error("A provided primer was not queued for search:", e)
		}
	}
	return true
}
