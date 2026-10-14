/**
 * The card dowry on this install (DESIGN-card-strokes §B.5, §B.6) — the
 * host half of `@serene-pub/sdk`'s `CardDowry`.
 *
 * `buildCardDowry` reads one card's sheets and card-layer stat rows, and
 * embeds every non-core declaration they name — from the live registry, or
 * from the last-seen record when the package that declared it is gone (R4).
 * Core is referenced by id and hash, never embedded.
 *
 * `importCardDowry` hands the SDK's pure planner (`planDowryImport`) a view
 * of this install and writes what it decides, in ONE transaction on `tx`:
 * declarations (register / re-own / rename through `declareSlot` /
 * `declareSheet`, opaque as a last-seen row), then the card's sheets, then
 * its rows on the card layer. The original id of a re-owned or renamed copy
 * is kept in its props as `importedFrom` — the SDK's stored-declaration
 * validator tolerates the key and `dowryDeclarationHash` ignores it, so the
 * copy still hashes as what it came from and a repeat import finds it.
 *
 * ⚠ Nothing here fails a card import. A dowry over its limits, or one whose
 * write the database refuses, is skipped with a summary line; the card stays.
 */

import { and, asc, eq, inArray, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	DOWRY_LIMITS,
	dowryDeclarationHash,
	getAttributeSheet,
	getAttributeSlot,
	isReservedAttributeOwner,
	planDowryImport,
	slotOwner,
	slotSlug,
	validateDowry,
	type AttributeSheetProps,
	type AttributeSlotProps,
	type CardDowry,
	type DowryDeclaration,
	type DowryDeclarationKind,
	type DowryLocalView,
	type DowryRef,
	type DowryRow
} from "@serene-pub/sdk"
import {
	declareSheet,
	declareSlot,
	ownerSegmentFor,
	setOwnerSheets
} from "$lib/server/state/declarations"

export { DOWRY_LIMITS }

/** Registry-held fields — never part of the props a dowry carries. */
const REGISTRY_FIELDS = ["id", "origin", "authorUserId", "retired"] as const

function propsOf(decl: Record<string, unknown>): Record<string, unknown> {
	const out = { ...decl }
	for (const key of REGISTRY_FIELDS) delete out[key]
	return out
}

const kindOf = (id: string): DowryDeclarationKind | undefined => {
	const m = /:(slot|sheet)\//.exec(id)
	return m ? (m[1] as DowryDeclarationKind) : undefined
}

async function installedPluginIds(db: Db): Promise<Set<string>> {
	try {
		const rows = await db
			.select({ pluginId: schema.plugins.pluginId })
			.from(schema.plugins)
		return new Set(rows.map((r) => r.pluginId).filter(Boolean))
	} catch {
		return new Set()
	}
}

type DeclRow = { id: string; origin: string; props: Record<string, unknown> }

async function lastSeenRows(
	db: Db,
	kind: DowryDeclarationKind,
	ids: string[]
): Promise<Map<string, DeclRow>> {
	if (!ids.length) return new Map()
	const table =
		kind === "slot" ? schema.attributeDeclarations : schema.attributeSheets
	const rows = await db
		.select({ id: table.id, origin: table.origin, props: table.props })
		.from(table)
		.where(inArray(table.id, ids))
	return new Map(rows.map((r) => [r.id, r as DeclRow]))
}

// ── Export ──────────────────────────────────────────────────────────────────

/**
 * One card's dowry, or null when it has no sheets and no card-layer rows.
 * Validated before it is returned: a dowry this install would refuse on the
 * way back in is never written into a file.
 */
export async function buildCardDowry(
	db: Db,
	characterId: number
): Promise<CardDowry | null> {
	const sheetRows = await db
		.select({ sheetId: schema.ownerSheets.sheetId })
		.from(schema.ownerSheets)
		.where(
			and(
				eq(schema.ownerSheets.ownerKind, "card"),
				eq(schema.ownerSheets.ownerId, characterId),
				isNull(schema.ownerSheets.sessionId)
			)
		)
		.orderBy(asc(schema.ownerSheets.position), asc(schema.ownerSheets.id))
	const sheets = sheetRows.map((r) => r.sheetId)

	const rows: DowryRow[] = []
	for (const [table, source] of [
		["config", schema.attributeConfigs],
		["value", schema.attributeValues]
	] as const) {
		const found: any[] = await db
			.select()
			.from(source)
			.where(
				and(
					eq(source.ownerKind, "card"),
					eq(source.ownerId, characterId),
					isNull(source.sessionId),
					isNull(source.branchId)
				)
			)
			.orderBy(asc(source.id))
		for (const row of found)
			rows.push({
				slotId: row.slotId,
				...(table === "config"
					? { config: row.config ?? {} }
					: { value: row.value }),
				...(row.updatedBy && row.updatedBy !== "user"
					? { updatedBy: row.updatedBy }
					: {}),
				...(row.note ? { note: row.note } : {})
			})
	}
	if (!sheets.length && !rows.length) return null

	const plugins = await installedPluginIds(db)

	// Every id the dowry names: its sheets, the slots those sheets list, the
	// slots its rows are filed under.
	const sheetIds = new Set<string>(sheets)
	const slotIds = new Set<string>(rows.map((r) => r.slotId))
	const sheetSeen = await lastSeenRows(db, "sheet", [...sheetIds])
	const sheetDecl = (id: string) =>
		(getAttributeSheet(id) as Record<string, unknown> | undefined) ??
		sheetSeen.get(id)?.props
	for (const id of sheetIds) {
		const decl = sheetDecl(id)
		for (const entry of (decl?.slots as { id?: string }[] | undefined) ?? [])
			if (typeof entry?.id === "string") slotIds.add(entry.id)
	}
	const slotSeen = await lastSeenRows(db, "slot", [...slotIds])

	const declarations: CardDowry["declarations"] = { slots: [], sheets: [] }
	const refs: DowryRef[] = []
	const embed = (
		kind: DowryDeclarationKind,
		id: string,
		live: Record<string, unknown> | undefined,
		seen: DeclRow | undefined
	) => {
		const source = live ?? seen?.props
		if (!source) return
		const props = propsOf(source) as unknown as AttributeSlotProps &
			AttributeSheetProps
		const hash = dowryDeclarationHash(kind, props)
		const owner = slotOwner(id)
		if (owner === "core") return void refs.push({ id, hash })
		// A non-core code declaration is a plugin's; so is a last-seen row
		// that says so, and anything filed under an installed plugin's name.
		const isPlugin =
			plugins.has(owner) ||
			seen?.origin === "plugin" ||
			live?.origin === "code"
		const decl: DowryDeclaration<any> = {
			id,
			hash,
			props,
			origin: isPlugin ? "plugin" : "stored"
		}
		if (kind === "slot") declarations.slots.push(decl)
		else declarations.sheets.push(decl)
	}
	for (const id of slotIds)
		embed(
			"slot",
			id,
			getAttributeSlot(id) as Record<string, unknown> | undefined,
			slotSeen.get(id)
		)
	for (const id of sheetIds)
		embed(
			"sheet",
			id,
			getAttributeSheet(id) as Record<string, unknown> | undefined,
			sheetSeen.get(id)
		)

	const dowry: CardDowry = { format: 1, sheets, rows, declarations, refs }
	const findings = validateDowry(dowry)
	if (findings.length) {
		console.warn(
			`[dowry] card ${characterId}'s stats do not make a valid dowry and are left out of the export: ` +
				findings
					.slice(0, 3)
					.map((f) => `${f.path}: ${f.message}`)
					.join("; ")
		)
		return null
	}
	return dowry
}

// ── Import ──────────────────────────────────────────────────────────────────

export interface CardDowryImporter {
	userId: number
	/** The importer's owner segment; read from the account when absent. */
	ownerSegment?: string
}

export interface CardDowryImportResult {
	/** True when anything was written. */
	applied: boolean
	summary: string[]
}

/**
 * This install as `planDowryImport` reads it: the live registry first, the
 * last-seen record for what is not live, and every stored copy an earlier
 * import made, by (name, hash), in the importer's own namespace.
 */
async function localViewFor(
	db: Db,
	dowry: CardDowry,
	ownerSegment: string
): Promise<DowryLocalView> {
	const plugins = await installedPluginIds(db)
	const ids = (kind: DowryDeclarationKind) => {
		const set = new Set<string>()
		const decls =
			kind === "slot" ? dowry.declarations.slots : dowry.declarations.sheets
		for (const d of decls) set.add(d.id)
		for (const r of dowry.refs) if (kindOf(r.id) === kind) set.add(r.id)
		return [...set]
	}
	const seen = {
		slot: await lastSeenRows(db, "slot", ids("slot")),
		sheet: await lastSeenRows(db, "sheet", ids("sheet"))
	}
	// Every declaration in the importer's namespace, hashed — the candidates
	// for "this card was imported before" and for a rename's free suffix.
	const mine = { slot: new Map<string, string>(), sheet: new Map<string, string>() }
	for (const kind of ["slot", "sheet"] as const) {
		const table =
			kind === "slot" ? schema.attributeDeclarations : schema.attributeSheets
		const rows = await db
			.select({ id: table.id, props: table.props })
			.from(table)
			.where(eq(table.origin, "stored"))
		for (const row of rows) {
			if (slotOwner(row.id) !== ownerSegment) continue
			const live =
				kind === "slot" ? getAttributeSlot(row.id) : getAttributeSheet(row.id)
			const props = propsOf(
				(live as Record<string, unknown> | undefined) ?? row.props
			)
			mine[kind].set(row.id, dowryDeclarationHash(kind, props as any))
		}
	}
	const held = (kind: DowryDeclarationKind, id: string) => {
		const live = kind === "slot" ? getAttributeSlot(id) : getAttributeSheet(id)
		if (live)
			return {
				hash: dowryDeclarationHash(kind, propsOf(live as any) as any),
				origin: live.origin
			}
		const row = seen[kind].get(id)
		if (row)
			return {
				hash: dowryDeclarationHash(kind, propsOf(row.props) as any),
				origin: row.origin === "stored" ? ("stored" as const) : ("code" as const)
			}
		const own = mine[kind].get(id)
		return own ? { hash: own, origin: "stored" as const } : undefined
	}
	return {
		slot: (id) => held("slot", id),
		sheet: (id) => held("sheet", id),
		isReservedOwner: (segment) =>
			segment === "core" || isReservedAttributeOwner(segment) || plugins.has(segment),
		installedPlugin: (segment) => plugins.has(segment),
		existingByNameAndHash: (kind, name, hash) => {
			for (const [id, h] of mine[kind]) {
				if (h !== hash) continue
				const slug = slotSlug(id)
				if (slug === name || new RegExp(`^${name}-\\d+$`).test(slug)) return id
			}
			return undefined
		}
	}
}

/**
 * Bring a card's dowry onto the card `characterId`, for `importer`.
 *
 * `replace` (an overwrite import) clears the card's own sheets and card-layer
 * rows first; a new card has none. Never throws: a refused dowry is a summary
 * line and nothing written.
 */
export async function importCardDowry(
	db: Db,
	characterId: number,
	dowry: unknown,
	importer: CardDowryImporter,
	opts: { replace?: boolean } = {}
): Promise<CardDowryImportResult> {
	if (dowry === undefined || dowry === null) return { applied: false, summary: [] }
	const findings = validateDowry(dowry)
	if (findings.length)
		return {
			applied: false,
			summary: [
				`The card's stats were not imported: ${findings[0].path} — ${findings[0].message}${findings.length > 1 ? ` (and ${findings.length - 1} more)` : ""}.`
			]
		}
	const card = dowry as CardDowry
	try {
		let ownerSegment = importer.ownerSegment
		if (!ownerSegment) {
			const [user] = await db
				.select({ username: schema.users.username })
				.from(schema.users)
				.where(eq(schema.users.id, importer.userId))
				.limit(1)
			ownerSegment = ownerSegmentFor(user?.username ?? "")
		}
		const view = await localViewFor(db, card, ownerSegment)
		const plan = planDowryImport(card, view, { ownerSegment })
		const owner = { kind: "card" as const, id: characterId }

		await db.transaction(async (tx) => {
			const now = new Date()
			for (const d of plan.declarations.slots) {
				if (d.action === "register" || d.action === "reown" || d.action === "rename") {
					const props = {
						...(d.props as object),
						...("from" in d ? { importedFrom: d.from } : {})
					} as AttributeSlotProps
					await declareSlot(tx, importer.userId, d.id, props)
				} else if (d.action === "opaque") {
					await tx
						.insert(schema.attributeDeclarations)
						.values({
							id: d.id,
							origin: "plugin",
							props: d.props as unknown as Record<string, unknown>,
							lastSeenAt: now
						})
						.onConflictDoNothing({ target: schema.attributeDeclarations.id })
				}
			}
			for (const d of plan.declarations.sheets) {
				if (d.action === "register" || d.action === "reown" || d.action === "rename") {
					const props = {
						...(d.props as object),
						...("from" in d ? { importedFrom: d.from } : {})
					} as AttributeSheetProps
					await declareSheet(tx, importer.userId, d.id, props)
				} else if (d.action === "opaque") {
					await tx
						.insert(schema.attributeSheets)
						.values({
							id: d.id,
							origin: "plugin",
							props: d.props as unknown as Record<string, unknown>,
							lastSeenAt: now
						})
						.onConflictDoNothing({ target: schema.attributeSheets.id })
				}
			}

			if (opts.replace) {
				for (const source of [schema.attributeConfigs, schema.attributeValues])
					await tx
						.delete(source)
						.where(
							and(
								eq(source.ownerKind, "card"),
								eq(source.ownerId, characterId),
								isNull(source.sessionId)
							)
						)
			}
			// A sheet only core or an uninstalled package declared, and no
			// last-seen row of, cannot be pointed at (owner_sheets' key): left out.
			let sheetIds = plan.sheets as string[]
			if (sheetIds.length) {
				const known = await tx
					.select({ id: schema.attributeSheets.id })
					.from(schema.attributeSheets)
					.where(inArray(schema.attributeSheets.id, sheetIds))
				const have = new Set(known.map((r) => r.id))
				const missing = sheetIds.filter((id) => !have.has(id))
				if (missing.length) {
					plan.summary.push(
						`${missing.length} of the card's stat sheets ${missing.length === 1 ? "is" : "are"} not on this install and ${missing.length === 1 ? "was" : "were"} left off.`
					)
					sheetIds = sheetIds.filter((id) => have.has(id))
				}
			}
			if (sheetIds.length || opts.replace)
				await setOwnerSheets(tx, owner, sheetIds, { userId: importer.userId })

			const configs = plan.rows.filter((r) => r.config !== undefined)
			const values = plan.rows.filter((r) => r.value !== undefined)
			const base = (r: DowryRow) => ({
				ownerKind: "card",
				ownerId: characterId,
				slotId: r.slotId,
				sessionId: null,
				updatedBy: typeof r.updatedBy === "string" && r.updatedBy ? r.updatedBy : "user",
				note: typeof r.note === "string" ? r.note : null
			})
			const CHUNK = 500
			for (let i = 0; i < configs.length; i += CHUNK)
				await tx.insert(schema.attributeConfigs).values(
					configs.slice(i, i + CHUNK).map((r) => ({ ...base(r), config: r.config ?? {} }))
				)
			for (let i = 0; i < values.length; i += CHUNK)
				await tx.insert(schema.attributeValues).values(
					values.slice(i, i + CHUNK).map((r) => ({ ...base(r), value: r.value! }))
				)
		})
		return { applied: true, summary: plan.summary }
	} catch (e) {
		const reason = e instanceof Error ? e.message : String(e)
		console.warn(`[dowry] card ${characterId}'s stats were not imported: ${reason}`)
		return {
			applied: false,
			summary: [`The card's stats were not imported: ${reason}`]
		}
	}
}
