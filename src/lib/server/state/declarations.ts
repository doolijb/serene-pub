/**
 * The authored half of the vocabulary: `attribute_declarations` and
 * `attribute_sheets` as a **source** the SDK registry is loaded from (R1).
 *
 * ## One registry, two sources
 *
 * `getAttributeSlot` stays the only door. A person authoring a slot writes a
 * row; this module loads that row into the registry at boot and again on every
 * write (`defineStoredAttributeSlot`), and validation consults nothing else. A
 * table a validator read directly would be a second answer to "what is this
 * slot", and the two would disagree the first time a boot failed halfway.
 *
 * ## The last-seen record (R4)
 *
 * Every declaration the registry holds — core's and every plugin's — is
 * mirrored back into the same tables with `origin` saying which, and
 * `last_seen_at` saying when this build last saw it. Three things need that:
 * a panel greying `acme.rp:slot/tension@1` after the plugin is uninstalled and
 * still wanting its label, an export that has to carry the declaration beside
 * the values, and `owner_sheets`, whose foreign key cannot point at a registry
 * that lives in memory.
 *
 * ⚠ A last-seen row is **never consulted for validation while the live
 * declaration exists**. It is display and export, and nothing else.
 *
 * ## The slug is the data key, and the author owns the namespace (R2)
 *
 * A person's slot is `<username>:slot/<name>@1`. The username is **frozen into
 * the id at authoring** — renaming the account never touches it, because the id
 * is what every stored value is filed under for the life of the card carrying
 * it. `core` and every installed plugin id are reserved, so a user whose name
 * happens to match a package cannot author a slot the next install silently
 * redefines underneath their values.
 *
 * ## Retire, then purge — never delete (R3)
 *
 * Only a stored slot can be retired, and retiring is not deleting: nothing new
 * is written, everything already written stays, the panels grey it with its
 * last label and the ledger keeps every row. A hard delete is a **separate,
 * explicit** purge afterwards that shows the counts first — because what is
 * being deleted is somebody's play, not a definition.
 */

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	attributeSheetDisplayFindings,
	attributeSheets as sdkAttributeSheets,
	attributeSlotDisplayFindings,
	attributeSlots as sdkAttributeSlots,
	defineStoredAttributeSheet,
	defineStoredAttributeSlot,
	getAttributeSheet,
	getAttributeSlot,
	isReservedAttributeOwner,
	reserveAttributeOwner,
	retireAttributeSheet,
	retireAttributeSlot,
	reviveAttributeSheet,
	reviveAttributeSlot,
	slotOwner,
	type AttributeSheetDecl,
	type AttributeSheetProps,
	type AttributeSlotDecl,
	type AttributeSlotProps,
	type SheetId,
	type SlotId
} from "@serene-pub/sdk"
import {
	assertBookOwner,
	assertSessionOwner,
	holdOwner,
	StateRefusal
} from "$lib/server/state/write"
import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import {
	checkDerivationGraph,
	isSessionScoped
} from "$lib/server/state/resolve"
import { checkExpression } from "$lib/server/state/expressions"
import type { StateOwner } from "$lib/server/state/owners"

/** Which source a row came through. Three here where the SDK has two — see the header. */
export type DeclarationOrigin = "stored" | "code" | "plugin"

// ── Names and ids ───────────────────────────────────────────────────────────

/**
 * A username as an owner segment: `Jody Doolittle` → `jody-doolittle`.
 *
 * Lowercased and hyphenated to the id grammar, because the id has to be
 * addressable in a spec, a template and a URL. Frozen at authoring: this is
 * called once, when the slot is created, and never again.
 *
 * ⚠ A **dot survives**, and that is not cosmetic: a plugin id is usually
 * dotted (`acme.rp`), the grammar allows a dot, and a mapping that turned one
 * into a hyphen would let a user called `acme.rp` author under `acme-rp` — a
 * namespace the reservation check would not recognise and the next install
 * would not collide with, which is exactly the collision reservation exists to
 * stop.
 */
export const ownerSegmentFor = (username: string): string =>
	(username ?? "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9.-]+/g, "-")
		.replace(/[.-]{2,}/g, "-")
		.replace(/^[.-]+|[.-]+$/g, "")

/** `hit points` → `hit-points`. The slug a value is filed under, forever. */
export const nameSlugFor = (name: string): string =>
	(name ?? "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")

/**
 * The id a person's new slot gets.
 *
 * ⚠ Called at creation and nowhere else. A rename changes the label, which is
 * what people read; the id is what the data is keyed by, and moving it would
 * orphan every value already filed under it.
 */
export function slotIdFor(
	username: string,
	name: string,
	version = 1
): SlotId {
	const owner = assertAuthorable(ownerSegmentFor(username))
	const slug = nameSlugFor(name)
	if (!slug)
		throw new StateRefusal(
			"a slot needs a name with a letter or a number in it — the name becomes " +
				"the key every value is filed under, and there is no key in an empty one."
		)
	return `${owner}:slot/${slug}@${version}`
}

/** The same, for a sheet. One grammar, one reserved-owner rule (§SDK sheets.ts). */
export function sheetIdFor(
	username: string,
	name: string,
	version = 1
): SheetId {
	const owner = assertAuthorable(ownerSegmentFor(username))
	const slug = nameSlugFor(name)
	if (!slug)
		throw new StateRefusal(
			"a sheet needs a name with a letter or a number in it."
		)
	return `${owner}:sheet/${slug}@${version}`
}

function assertAuthorable(segment: string): string {
	if (!segment)
		throw new StateRefusal(
			"that account name has no letters or numbers in it, so there is no " +
				"namespace to author under. Set a display name first."
		)
	if (isReservedAttributeOwner(segment))
		throw new StateRefusal(
			`'${segment}' is a reserved namespace: 'core' and every installed ` +
				`extension own theirs. A slot authored under one would be redefined the ` +
				`next time that package loaded, and the values filed under it would ` +
				`quietly change meaning.`
		)
	return segment
}

// ── Loading the registry ────────────────────────────────────────────────────

export interface DeclarationLoadReport {
	/** Stored rows put into the registry. */
	slotsLoaded: number
	sheetsLoaded: number
	/** Stored rows this build could not accept, with the reason. */
	refused: { id: string; reason: string }[]
	/** Code/plugin declarations mirrored back as last-seen rows. */
	slotsSeen: number
	sheetsSeen: number
	/** Namespaces reserved because something is installed under them. */
	reserved: string[]
}

/**
 * Bring the SDK registry in line with this install's rows, and the rows in line
 * with this build's code.
 *
 * ⚠ **Ordering matters three times.** Plugin ids are reserved *first*, so a
 * stored slug that collides with an installed package is refused rather than
 * loaded; stored rows go in *before* anything reads a slot, because a session
 * resolving its vocabulary against a half-loaded registry would silently drop
 * whatever had not arrived; and the last-seen mirror runs *last*, when the
 * registry is complete.
 *
 * Nothing here can fail the boot. A stored row this build refuses costs that
 * one declaration — the values stay exactly where they are and read as opaque
 * data — and the report says which, because a local-first app that will not
 * start is worse than one missing a bar.
 */
export async function loadStoredDeclarations(
	db: Db
): Promise<DeclarationLoadReport> {
	const report: DeclarationLoadReport = {
		slotsLoaded: 0,
		sheetsLoaded: 0,
		refused: [],
		slotsSeen: 0,
		sheetsSeen: 0,
		reserved: []
	}

	report.reserved = await reserveInstalledOwners(db)

	const slotRows = await db
		.select()
		.from(schema.attributeDeclarations)
		.where(eq(schema.attributeDeclarations.origin, "stored"))
		.orderBy(asc(schema.attributeDeclarations.id))
	for (const row of slotRows) {
		try {
			defineStoredAttributeSlot(
				row.id,
				row.props as unknown as AttributeSlotProps,
				{ userId: row.userId ?? 0 }
			)
			// Defined first and retired second, deliberately: a retired slot is
			// still a declaration — its values resolve and its label is what
			// panels grey — so it has to be IN the registry to be retired at all.
			if (row.retiredAt) retireAttributeSlot(row.id)
			report.slotsLoaded++
		} catch (e) {
			report.refused.push({ id: row.id, reason: (e as Error).message })
		}
	}

	// Sheets after slots, always: a sheet naming a slot nothing declares is
	// refused at declaration (`checkSheetDeclaration`), so the slots have to be
	// in the registry first.
	const sheetRows = await db
		.select()
		.from(schema.attributeSheets)
		.where(eq(schema.attributeSheets.origin, "stored"))
		.orderBy(asc(schema.attributeSheets.id))
	for (const row of sheetRows) {
		try {
			defineStoredAttributeSheet(
				row.id,
				row.props as unknown as AttributeSheetProps,
				{ userId: row.userId ?? 0 }
			)
			if (row.retiredAt) retireAttributeSheet(row.id)
			report.sheetsLoaded++
		} catch (e) {
			report.refused.push({ id: row.id, reason: (e as Error).message })
		}
	}

	const seen = await recordLastSeen(db)
	report.slotsSeen = seen.slots
	report.sheetsSeen = seen.sheets
	return report
}

/**
 * Reserve `core` and every installed extension's namespace.
 *
 * Every *installed* one, not every enabled one: a disabled plugin is still
 * installed, and a user slug claiming its namespace would break the moment
 * somebody turned it back on. `bootstrapPlugins` reserves again as it loads,
 * which is idempotent and is the case where a plugin is installed while the
 * app is running.
 */
export async function reserveInstalledOwners(db: Db): Promise<string[]> {
	reserveAttributeOwner("core")
	const taken = ["core"]
	try {
		const rows = await db
			.select({ pluginId: schema.plugins.pluginId })
			.from(schema.plugins)
		for (const row of rows)
			if (row.pluginId) {
				reserveAttributeOwner(row.pluginId)
				taken.push(row.pluginId)
			}
	} catch (e) {
		// A install whose plugin table is not there yet still has to boot.
		console.warn(
			"[state] could not read installed extensions to reserve their " +
				"namespaces:",
			e
		)
	}
	return taken
}

/**
 * Mirror every code and plugin declaration back into the tables as a last-seen
 * row (R4).
 *
 * The props are stored **verbatim**, because the row's whole job is to be able
 * to say what the declaration was after the code that declared it is gone.
 * `origin` is `code` for core's and `plugin` for anybody else's, which is the
 * distinction the SDK's two-value origin cannot make and the one a stale row
 * has to answer ("the uninstalled extension").
 */
export async function recordLastSeen(
	db: Db
): Promise<{ slots: number; sheets: number }> {
	const now = new Date()
	const originOf = (id: string): DeclarationOrigin =>
		slotOwner(id) === "core" ? "code" : "plugin"

	let slots = 0
	for (const decl of sdkAttributeSlots()) {
		if (decl.origin !== "code") continue
		const { id, origin: _o, ...props } = decl
		await db
			.insert(schema.attributeDeclarations)
			.values({
				id,
				origin: originOf(id),
				props: props as unknown as Record<string, unknown>,
				lastSeenAt: now
			})
			.onConflictDoUpdate({
				target: schema.attributeDeclarations.id,
				set: {
					origin: originOf(id),
					props: props as unknown as Record<string, unknown>,
					lastSeenAt: now,
					updatedAt: now
				},
				// A stored row is somebody's, and a code declaration under the
				// same id is refused by the registry long before this — so the
				// guard is belt and braces against a row written by an older
				// build with looser rules.
				setWhere: sql`${schema.attributeDeclarations.origin} <> 'stored'`
			})
		slots++
	}

	let sheets = 0
	for (const decl of sdkAttributeSheets()) {
		if (decl.origin !== "code") continue
		const { id, origin: _o, ...props } = decl
		await db
			.insert(schema.attributeSheets)
			.values({
				id,
				origin: originOf(id),
				props: props as unknown as Record<string, unknown>,
				lastSeenAt: now
			})
			.onConflictDoUpdate({
				target: schema.attributeSheets.id,
				set: {
					origin: originOf(id),
					props: props as unknown as Record<string, unknown>,
					lastSeenAt: now,
					updatedAt: now
				},
				setWhere: sql`${schema.attributeSheets.origin} <> 'stored'`
			})
		sheets++
	}
	return { slots, sheets }
}

// ── Authoring a slot ────────────────────────────────────────────────────────

/**
 * Write a new authored slot, and load it into the registry in the same call.
 *
 * Write-through, and that is the whole shape of R1: the row and the registry
 * entry are made together, so there is never a moment where validation would
 * consult one and a panel the other. If the registry refuses it, no row is
 * written.
 */
export async function declareSlot(
	db: Db,
	userId: number,
	id: SlotId,
	props: AttributeSlotProps
): Promise<AttributeSlotDecl> {
	if (getAttributeSlot(id))
		throw new StateRefusal(
			`'${id}' is already declared here. Give this one a different name, or ` +
				`edit the one that has the name.`
		)
	checkAuthoredProps(id, props)
	const decl = defineStoredAttributeSlot(id, props, { userId })
	await db.insert(schema.attributeDeclarations).values({
		id,
		userId,
		origin: "stored",
		props: props as unknown as Record<string, unknown>,
		lastSeenAt: new Date()
	})
	return decl
}

/**
 * Replace an authored slot's props.
 *
 * A replace and not a merge, for the reason the SDK's `register` gives: the row
 * **is** the declaration and there is one author, so an edited row re-loading
 * is that person finishing a sentence rather than a second party arriving.
 *
 * ⚠ The id never moves. Renaming the label is a copyedit; a different id is a
 * different slot, and the values stay with the id they were filed under.
 */
export async function updateSlot(
	db: Db,
	id: SlotId,
	props: AttributeSlotProps
): Promise<AttributeSlotDecl> {
	const row = await storedSlotRow(db, id, "edit")
	checkAuthoredProps(id, props)
	const decl = defineStoredAttributeSlot(id, props, {
		userId: row.userId ?? 0
	})
	// Re-retired after the replace: `defineStoredAttributeSlot` builds a fresh
	// frozen declaration, so a slot that was retired before the edit would come
	// back live without this.
	const next = row.retiredAt ? retireAttributeSlot(id) : decl
	await db
		.update(schema.attributeDeclarations)
		.set({
			props: props as unknown as Record<string, unknown>,
			lastSeenAt: new Date()
		})
		.where(eq(schema.attributeDeclarations.id, id))
	return next
}

/** Everything an authored declaration must satisfy before it is worth storing values against. */
function checkAuthoredProps(id: SlotId, props: AttributeSlotProps): void {
	// The display text (R-20; U5i): the write door is the gate — a reload
	// tolerates a stored row, so a blank label is refused here or nowhere.
	const display = attributeSlotDisplayFindings(id, props)
	if (display.length) throw new StateRefusal(display.join("; "))
	const lines: { what: string; expr: string }[] = []
	if (props.derive) lines.push({ what: "the derivation", expr: props.derive })
	for (const [i, rule] of (props.rules ?? []).entries()) {
		if (rule.when) lines.push({ what: `rule ${i + 1}'s condition`, expr: rule.when })
		const op = rule.set ?? rule.add ?? rule.remove
		if (op) lines.push({ what: `rule ${i + 1}'s value`, expr: op })
	}
	for (const line of lines) {
		const complaint = checkExpression(line.expr)
		if (complaint)
			throw new StateRefusal(
				`${id}: ${line.what} will not parse — ${complaint}`
			)
	}
	// The cycle check runs against the registry AS IT WOULD BE, which is the
	// only version of it that can answer "does this new expression close a
	// loop". Refused here rather than at read, because here is where the person
	// who wrote it is standing.
	const others = sdkAttributeSlots().filter((d) => d.id !== id)
	const cycle = checkDerivationGraph([
		...others,
		{ ...props, id, origin: "stored" } as AttributeSlotDecl
	])
	if (cycle) throw new StateRefusal(cycle)
}

/**
 * Retire an authored slot: nothing new is written to it, everything already
 * written stays.
 *
 * Refused for a slot a **code sheet** names (R3): a genre that declares "a
 * session of this shape has Health" would be left naming a slot nobody may
 * write, which is a session that cannot be played rather than a tidied
 * vocabulary.
 */
export async function retireSlot(
	db: Db,
	id: SlotId
): Promise<AttributeSlotDecl> {
	await storedSlotRow(db, id, "retire")
	const naming = sdkAttributeSheets().filter(
		(sheet) =>
			sheet.origin === "code" && sheet.slots.some((s) => s.id === id)
	)
	if (naming.length)
		throw new StateRefusal(
			`'${id}' is named by ${naming.length === 1 ? "the sheet" : "the sheets"} ` +
				`${naming.map((s) => s.id).join(", ")}, which ${
					naming.length === 1 ? "is" : "are"
				} declared in code. Retiring it would leave that bundle naming a slot ` +
				`nobody may write. Take it off the sheet first — or, if the sheet is a ` +
				`package's, that package's.`
		)
	const decl = retireAttributeSlot(id)
	await db
		.update(schema.attributeDeclarations)
		.set({ retiredAt: new Date() })
		.where(eq(schema.attributeDeclarations.id, id))
	return decl
}

/** Undo a retirement. Nothing about the stored values changed either way. */
export async function reviveSlot(
	db: Db,
	id: SlotId
): Promise<AttributeSlotDecl> {
	await storedSlotRow(db, id, "revive")
	const decl = reviveAttributeSlot(id)
	await db
		.update(schema.attributeDeclarations)
		.set({ retiredAt: null })
		.where(eq(schema.attributeDeclarations.id, id))
	return decl
}

/** What a hard delete would take with it — shown BEFORE anything is deleted. */
export interface SlotFootprint {
	/** Cast members (cards, bindings and seats) holding a value for it. */
	characters: number
	/** Worlds and sessions — and their places — holding one. */
	worlds: number
	/** Rows: every value ever written, which is what the ledger and the charts read. */
	values: number
}

/**
 * How much play is filed under this slot.
 *
 * Read on its own so a person sees the counts before they decide, which is the
 * whole difference between a purge and a delete: what is being removed is
 * somebody's play, not a definition.
 */
export async function slotFootprint(
	db: Db,
	id: SlotId
): Promise<SlotFootprint> {
	const rows = await db
		.select({
			ownerKind: schema.attributeValues.ownerKind,
			ownerId: schema.attributeValues.ownerId
		})
		.from(schema.attributeValues)
		.where(eq(schema.attributeValues.slotId, id))
	const characters = new Set<string>()
	const worlds = new Set<string>()
	for (const row of rows)
		// A place (phase 4) is part of its world, never a character.
		(row.ownerKind === "lorebook" ||
		row.ownerKind === "session" ||
		row.ownerKind === "location" ||
		row.ownerKind === "session_location"
			? worlds
			: characters
		).add(`${row.ownerKind}:${row.ownerId}`)
	return { characters: characters.size, worlds: worlds.size, values: rows.length }
}

/**
 * Delete every value and configuration filed under a retired slot, and the
 * declaration with them.
 *
 * ⚠ **Explicit, separate, and only after retirement** (R3). Retiring is
 * reversible and loses nothing; this is neither. Refusing it for a live slot is
 * what makes "retire" the safe verb it is meant to be — there is no single
 * action anywhere in the product that destroys a season of play.
 */
export async function purgeSlotValues(
	db: Db,
	id: SlotId
): Promise<SlotFootprint> {
	const row = await storedSlotRow(db, id, "delete")
	if (!row.retiredAt)
		throw new StateRefusal(
			`'${id}' is still live, so there is nothing to purge yet. Retire it first ` +
				`— retiring stops new writes and keeps every row, and it is the step ` +
				`that can be undone. Deleting is the one that cannot.`
		)
	const counts = await slotFootprint(db, id)
	await db
		.delete(schema.attributeValues)
		.where(eq(schema.attributeValues.slotId, id))
	await db
		.delete(schema.attributeConfigs)
		.where(eq(schema.attributeConfigs.slotId, id))
	await db
		.delete(schema.attributeDeclarations)
		.where(eq(schema.attributeDeclarations.id, id))
	return counts
}

/** The row retire, revive, edit and delete are allowed to touch — a stored one, and only that. */
async function storedSlotRow(db: Db, id: SlotId, verb: string) {
	const [row] = await db
		.select()
		.from(schema.attributeDeclarations)
		.where(eq(schema.attributeDeclarations.id, id))
		.limit(1)
	if (!row)
		throw new StateRefusal(
			`cannot ${verb} '${id}': nothing is declared under that id here.`
		)
	if (row.origin !== "stored")
		throw new StateRefusal(
			`'${id}' is declared in code, and code declarations are never ${verb}d by ` +
				`hand. A core or extension slot arrives and leaves with the package that ` +
				`declares it: uninstall or upgrade that, and every value stays exactly ` +
				`where it is.`
		)
	return row
}

// ── Authoring a sheet ───────────────────────────────────────────────────────

/** The display text (R-20; U5i): the write door is the gate, as for a slot. */
function checkAuthoredSheetProps(id: SheetId, props: AttributeSheetProps): void {
	const display = attributeSheetDisplayFindings(id, props)
	if (display.length) throw new StateRefusal(display.join("; "))
}

export async function declareSheet(
	db: Db,
	userId: number,
	id: SheetId,
	props: AttributeSheetProps
): Promise<AttributeSheetDecl> {
	if (getAttributeSheet(id))
		throw new StateRefusal(
			`'${id}' is already declared here. Give this one a different name, or ` +
				`edit the one that has the name.`
		)
	checkAuthoredSheetProps(id, props)
	const decl = defineStoredAttributeSheet(id, props, { userId })
	await db.insert(schema.attributeSheets).values({
		id,
		userId,
		origin: "stored",
		props: props as unknown as Record<string, unknown>,
		lastSeenAt: new Date()
	})
	return decl
}

export async function updateSheet(
	db: Db,
	id: SheetId,
	props: AttributeSheetProps
): Promise<AttributeSheetDecl> {
	const row = await storedSheetRow(db, id, "edit")
	checkAuthoredSheetProps(id, props)
	const decl = defineStoredAttributeSheet(id, props, {
		userId: row.userId ?? 0
	})
	const next = row.retiredAt ? retireAttributeSheet(id) : decl
	await db
		.update(schema.attributeSheets)
		.set({
			props: props as unknown as Record<string, unknown>,
			lastSeenAt: new Date()
		})
		.where(eq(schema.attributeSheets.id, id))
	return next
}

/** Retire an authored sheet: offered nowhere new, kept everywhere it already is. */
export async function retireSheet(
	db: Db,
	id: SheetId
): Promise<AttributeSheetDecl> {
	await storedSheetRow(db, id, "retire")
	const decl = retireAttributeSheet(id)
	await db
		.update(schema.attributeSheets)
		.set({ retiredAt: new Date() })
		.where(eq(schema.attributeSheets.id, id))
	return decl
}

export async function reviveSheet(
	db: Db,
	id: SheetId
): Promise<AttributeSheetDecl> {
	await storedSheetRow(db, id, "revive")
	const decl = reviveAttributeSheet(id)
	await db
		.update(schema.attributeSheets)
		.set({ retiredAt: null })
		.where(eq(schema.attributeSheets.id, id))
	return decl
}

async function storedSheetRow(db: Db, id: SheetId, verb: string) {
	const [row] = await db
		.select()
		.from(schema.attributeSheets)
		.where(eq(schema.attributeSheets.id, id))
		.limit(1)
	if (!row)
		throw new StateRefusal(
			`cannot ${verb} '${id}': no sheet is declared under that id here.`
		)
	if (row.origin !== "stored")
		throw new StateRefusal(
			`'${id}' is declared in code, and code declarations are never ${verb}d by ` +
				`hand. Uninstall or upgrade the package that declares it; every value ` +
				`stays where it is either way.`
		)
	return row
}

// ── Which sheets an owner has ───────────────────────────────────────────────

/**
 * The sheets one owner has, in order.
 *
 * A sheet id nothing declares is still returned — as its id, with no
 * declaration — because a bundle whose package is gone is exactly what the
 * last-seen record exists to be able to name.
 */
export async function ownerSheets(
	db: Db,
	owner: StateOwner,
	sessionId?: number
): Promise<{ sheetId: string; position: number; decl?: AttributeSheetDecl }[]> {
	const rows = await db
		.select({
			sheetId: schema.ownerSheets.sheetId,
			sessionId: schema.ownerSheets.sessionId,
			position: schema.ownerSheets.position
		})
		.from(schema.ownerSheets)
		.where(
			and(
				eq(schema.ownerSheets.ownerKind, owner.kind),
				eq(schema.ownerSheets.ownerId, owner.id),
				isSessionScoped(owner.kind)
					? eq(schema.ownerSheets.sessionId, sessionId ?? -1)
					: isNull(schema.ownerSheets.sessionId)
			)
		)
		.orderBy(asc(schema.ownerSheets.position), asc(schema.ownerSheets.id))
	return rows.map((row) => ({
		sheetId: row.sheetId,
		position: row.position,
		decl: getAttributeSheet(row.sheetId)
	}))
}

/**
 * Say exactly which sheets an owner has, in this order.
 *
 * A whole-set write rather than add/remove, because the **order** is content
 * (SDK `sheets.ts`): it is what a panel draws, what the state block renders and
 * what rules run in, so "which ones and in what order" is one decision and has
 * to be one write.
 *
 * **Who says** (plan A6), `by`: a person (`userId`), or a run for a session
 * (`userId` null, `sessionId` set), which writes as the session's own user
 * and only on what that session reaches — as a stat write through it
 * (`assertSessionOwner`): its own book, that book's members and places, a
 * card of its user. The owner's writer is the one the stat writes answer
 * to — a book's own sheets, its members' and its places' are the book
 * owner's, a card's its
 * owner's — except that a session's (its own, a seat's, a place's in it) are
 * the session owner's, since which sheets a session has is what it tracks
 * (`state:setAttributePicks` is the owner's too). The owner is read again in
 * the write's transaction (`holdOwner`), so a delete landing after the check
 * refuses the write rather than leaving sheets for nobody.
 *
 * ⚠ Every id must already have a row in `attribute_sheets` — the foreign key
 * says so, and the last-seen mirror is what makes that true for a genre's code
 * sheet as much as for an authored one.
 */
export async function setOwnerSheets(
	db: Db,
	owner: StateOwner,
	sheetIds: readonly string[],
	by: { userId: number | null; sessionId?: number }
): Promise<void> {
	const scoped = isSessionScoped(owner.kind)
	const sessionId = by.sessionId
	if (scoped && typeof sessionId !== "number")
		throw new StateRefusal(
			`a ${owner.kind} owner is inside a session, so which session has to be ` +
				`said: its owner id is a character's, and without the session the same ` +
				`sheets would be true of that character everywhere at once.`
		)
	await assertSheetsWriter(db, owner, by)
	const wanted = [...new Set(sheetIds)]
	if (wanted.length) {
		const known = await db
			.select({ id: schema.attributeSheets.id })
			.from(schema.attributeSheets)
			.where(inArray(schema.attributeSheets.id, wanted))
		const have = new Set(known.map((r) => r.id))
		const missing = wanted.filter((id) => !have.has(id))
		if (missing.length)
			throw new StateRefusal(
				`this pub has no record of ${missing.join(", ")}. A sheet has to be ` +
					`declared — by a genre, an extension, or by somebody here — before an ` +
					`owner can have it.`
			)
	}
	await db.transaction(async (tx) => {
		await holdOwner(tx, owner)
		await tx
			.delete(schema.ownerSheets)
			.where(
				and(
					eq(schema.ownerSheets.ownerKind, owner.kind),
					eq(schema.ownerSheets.ownerId, owner.id),
					scoped
						? eq(schema.ownerSheets.sessionId, sessionId!)
						: isNull(schema.ownerSheets.sessionId)
				)
			)
		if (!wanted.length) return
		await tx.insert(schema.ownerSheets).values(
			wanted.map((sheetId, position) => ({
				ownerKind: owner.kind,
				ownerId: owner.id,
				sessionId: scoped ? sessionId! : null,
				sheetId,
				position
			}))
		)
	})
}

/** Refuses anyone but `owner`'s writer (see `setOwnerSheets`), and an owner that is not there. */
async function assertSheetsWriter(
	db: Db,
	owner: StateOwner,
	by: { userId: number | null; sessionId?: number }
): Promise<void> {
	const [session] =
		typeof by.sessionId === "number"
			? await db
					.select({ userId: schema.sessions.userId })
					.from(schema.sessions)
					.where(eq(schema.sessions.id, by.sessionId))
					.limit(1)
			: []
	const writer = by.userId ?? session?.userId ?? null
	if (writer == null)
		throw new StateRefusal(
			"nobody is named to change these sheets: a person, or the session a run is for."
		)
	if (isSessionScoped(owner.kind)) {
		if (!session || session.userId !== writer)
			throw new StateRefusal("only the session's owner can change which sheets it has.")
		// Of this session: itself, one of its seats, a place it sees.
		await assertSessionOwner(db, by.sessionId!, owner, writer)
		return
	}
	// A run reaches what its session does, as a stat write through it: the
	// session's own book, a member or a place of it, a card of its user.
	if (by.userId == null) {
		await assertSessionOwner(db, by.sessionId!, owner, null)
		return
	}
	if (owner.kind === "card") {
		const [card] = await db
			.select({ userId: schema.characters.userId })
			.from(schema.characters)
			.where(eq(schema.characters.id, owner.id))
			.limit(1)
		if (!card) throw new StateRefusal("that character no longer exists.")
		if (card.userId !== writer)
			throw new StateRefusal(
				"that is not a card of yours. A card's sheets are changed by whoever owns it."
			)
		return
	}
	let lorebookId: number | undefined
	if (owner.kind === "lorebook") lorebookId = owner.id
	else if (owner.kind === "cast_member") {
		const [member] = await db
			.select({ lorebookId: schema.lorebookBindings.lorebookId })
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, owner.id))
			.limit(1)
		if (!member) throw new StateRefusal("that cast member no longer exists.")
		lorebookId = member.lorebookId
	} else if (owner.kind === "location") {
		const [place] = await db
			.select({
				lorebookId: schema.lorebookEntries.lorebookId,
				typeId: schema.lorebookEntries.typeId
			})
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, owner.id))
			.limit(1)
		if (!place || place.typeId !== LOCATION_TYPE_ID)
			throw new StateRefusal("that place no longer exists.")
		lorebookId = place.lorebookId
	}
	if (lorebookId === undefined)
		throw new StateRefusal(`'${String(owner.kind)}' is not an owner kind.`)
	await assertBookOwner(db, lorebookId, writer)
}

export { StateRefusal }
