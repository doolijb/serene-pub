/**
 * Boot-time type registry sync (02 §5, U2).
 *
 * Node types are declared in code and **materialized as rows**, so that every
 * pin in every spec is joinable and — the part that actually matters — so core
 * can decide whether a plugin fits this release **without executing it** (F6,
 * 13 §10c).
 *
 * The rule that makes the sync trustworthy is what it does on a conflict.
 * A type id and version that already exists but whose content has changed is
 * **raised, never published and never ignored**:
 *
 *   · publishing it silently rewrites the meaning of a pin. Every spec that
 *     pinned `@1` keeps compiling and starts behaving differently, which is the
 *     exact failure pinning exists to prevent.
 *   · ignoring it leaves the rows disagreeing with the code, so install-time
 *     validation starts checking plugins against a registry that no longer
 *     describes this build — and reports drift that is actually core's.
 *
 * Both are silent. Raising is loud, happens at boot, and names the type.
 */

import { eq, and } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	snapshotRegistry,
	type RegistryEntry,
	type Descriptor
} from "@serene-pub/sdk"

type Db = { insert: any; select: any; update: any }

export class TypeRegistryConflictError extends Error {}

export interface SyncResult {
	inserted: string[]
	updated: string[]
	unchanged: string[]
}

/**
 * A stable hash of everything about a type that a spec can depend on.
 *
 * Deliberately excludes i18n: renaming a node's display label is not a change
 * to its contract, and treating it as one would make every translation update
 * a version bump.
 *
 * ## Slot declarations count, their labels do not
 *
 * The row now stores the whole `SlotDecl` rather than a list of slot names, so
 * that a form can be generated from rows (see `RegistryEntry.slots`). That makes
 * a question the name list never raised: is changing a parameter's default, or
 * its range, or its enum options, a change to the type's contract?
 *
 * It is. A spec that did not override `topK` gets the declared default, so moving
 * that default changes what an untouched spec does — which is precisely the
 * silent behaviour change pinning exists to prevent. Ranges and enums are the
 * same argument one step removed: they decide which stored values are still
 * legal.
 *
 * The `i18n` inside a declaration is excluded for the same reason it is excluded
 * at the type level, and it has to be stripped *recursively* — a param label sits
 * two levels down, and hashing it would make translating "Top K" into German a
 * type version bump.
 */
const stripI18n = (v: unknown): unknown => {
	if (Array.isArray(v)) return v.map(stripI18n)
	if (v && typeof v === "object")
		return Object.fromEntries(
			Object.entries(v as Record<string, unknown>)
				.filter(([k]) => k !== "i18n")
				.map(([k, val]) => [k, stripI18n(val)])
		)
	return v
}

const sortDeep = (v: unknown): unknown => {
	if (Array.isArray(v)) return v.map(sortDeep)
	if (v && typeof v === "object")
		return Object.fromEntries(
			Object.entries(v as Record<string, unknown>)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([k, val]) => [k, sortDeep(val)])
		)
	return v
}

export function typeContentHash(entry: RegistryEntry): string {
	const material = {
		kind: entry.kind,
		ports: entry.ports,
		slots: stripI18n(entry.slots),
		effects: entry.effects,
		causesEvent: entry.causesEvent,
		public: entry.public
	}
	// Stable key order, recursively. An earlier version passed a sorted key
	// array as JSON.stringify's replacer, which filters keys at *every* level —
	// so `ports` serialized as `{}` and every port change hashed identically.
	// The conflict test is what caught it, which is the argument for testing the
	// guard rather than trusting it.
	const s = JSON.stringify(sortDeep(material))
	let h1 = 0xdeadbeef
	let h2 = 0x41c6ce57
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i)
		h1 = Math.imul(h1 ^ c, 2654435761)
		h2 = Math.imul(h2 ^ c, 1597334677)
	}
	h1 =
		Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
		Math.imul(h2 ^ (h2 >>> 13), 3266489909)
	h2 =
		Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
		Math.imul(h1 ^ (h1 >>> 13), 3266489909)
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)
}

/**
 * Project descriptors into rows.
 *
 * Idempotent by construction: same code, same rows, no writes on the second
 * run. That property is what lets this run unconditionally at boot instead of
 * behind a "have we migrated yet" flag, which is a flag that eventually lies.
 */
export async function syncTypeRegistry(
	db: Db,
	descriptors: Descriptor[],
	opts: { release: string; ownerPluginId?: number } = { release: "dev" }
): Promise<SyncResult> {
	const entries = snapshotRegistry(descriptors, { release: opts.release })
	const result: SyncResult = { inserted: [], updated: [], unchanged: [] }

	for (const entry of entries) {
		const hash = typeContentHash(entry)
		const pin = `${entry.id}@${entry.version}`

		const [row] = await db
			.select()
			.from(schema.pipelineTypeRegistry)
			.where(
				and(
					eq(schema.pipelineTypeRegistry.typeId, entry.id),
					eq(schema.pipelineTypeRegistry.version, entry.version)
				)
			)
			.limit(1)

		if (!row) {
			await db.insert(schema.pipelineTypeRegistry).values({
				typeId: entry.id,
				version: entry.version,
				kind: entry.kind,
				ownerPluginId: opts.ownerPluginId ?? null,
				// Core's own types run in-process; anything a plugin owns does
				// not, ever. An extension hook inside Serene Pub's process cannot
				// be stopped, so a runaway loop takes the application down rather
				// than one node (13 §7h). Written from ownership rather than from
				// the plugin's own claim, so a manifest cannot ask for otherwise.
				transport: opts.ownerPluginId != null ? "process" : "node",
				ports: entry.ports,
				// The declarations verbatim. A UI that has to render a form for a
				// plugin's parameters reads this row; it never loads the plugin.
				slots: entry.slots ?? {},
				effects: entry.effects ?? null,
				causesEvent: entry.causesEvent ?? null,
				isPublic: entry.public ?? false,
				release: opts.release,
				contentHash: hash
			})
			result.inserted.push(pin)
			continue
		}

		if (row.contentHash === hash) {
			// Only the release stamp moves, so a drift diagnostic can say which
			// build a row was last confirmed against.
			if (row.release !== opts.release)
				await db
					.update(schema.pipelineTypeRegistry)
					.set({ release: opts.release })
					.where(eq(schema.pipelineTypeRegistry.id, row.id))
			result.unchanged.push(pin)
			continue
		}

		throw new TypeRegistryConflictError(
			`${pin} already exists with different content (row ${row.contentHash}, code ${hash}). ` +
				`A published type version is frozen: every spec that pinned it would keep compiling ` +
				`and start behaving differently. Publish ${entry.id}@${entry.version + 1} instead, and ` +
				`leave @${entry.version} in place for the specs already pinning it (02 §3).`
		)
	}

	return result
}

/**
 * Read the registry back in the shape `checkInstall` wants.
 *
 * The point of the round trip is that install-time validation reads **rows**,
 * not the in-process descriptor map. A plugin is validated against what this
 * instance actually has, which is not always what this build declares — an
 * older type version left in place for the specs still pinning it is exactly
 * the case that would otherwise be invisible.
 */
export async function readTypeRegistry(db: Db): Promise<RegistryEntry[]> {
	const rows = await db.select().from(schema.pipelineTypeRegistry)
	return rows.map((r: any) => ({
		id: r.typeId,
		version: r.version,
		kind: r.kind,
		ports: r.ports,
		slots: r.slots ?? {},
		effects: r.effects ?? undefined,
		causesEvent: r.causesEvent ?? undefined,
		public: r.isPublic,
		owner: r.ownerPluginId ? String(r.ownerPluginId) : undefined,
		release: r.release ?? undefined
	}))
}
