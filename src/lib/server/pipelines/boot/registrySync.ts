/**
 * Boot-time definition registry sync (02 §5, U2).
 *
 * Node definitions are declared in code and **materialized as rows**, so that every
 * pin in every spec is joinable and — the part that actually matters — so core
 * can decide whether a plugin fits this release **without executing it** (F6,
 * 13 §10c).
 *
 * ## A slug is an indirection (ruling 2026-09-10)
 *
 * `core:query/vector-search@1` names a *pointer*, not a declaration. The
 * `pipeline_definition_registry` row for that slug carries whichever declaration it
 * currently resolves to, and `pipeline_definition_declarations` keeps every
 * declaration it has ever resolved to, keyed by content hash. Publishing a
 * changed declaration writes the new one into the archive if its hash is
 * unseen, then moves the pointer. Nothing is rewritten and nothing is deleted.
 *
 * ## Why publishing is safe to do unattended
 *
 * Two answers are unavailable to a sync that finds a changed declaration under a
 * slug it already holds. **Republishing in place** rewrites the meaning of every
 * pin: a spec that named `@1` keeps compiling and starts behaving differently.
 * **Ignoring it** leaves the rows describing a build that is not the one
 * running, so install-time validation checks plugins against a registry
 * describing something else and reports drift that is core's.
 *
 * Content addressing is the third answer, and it is available because the
 * superseded declaration stays: nothing that named it is orphaned, the new one
 * is published so the rows describe this build, and the slug says which is
 * current so no reader has to guess. **A stored hash always resolves to what it
 * named** — structural, rather than a rule anything has to enforce.
 *
 * ⚠ **A pin is still `id@version`, and a version bump is still the honest answer
 * to a breaking change.** Content addressing removes the boot failure, not the
 * judgement: moving a port under `@1` still changes what every spec pinning `@1`
 * does. What it buys is that a *corrected* declaration — a widened range, a
 * declared port that was always supplied — reaches an install without a
 * migration, which is the case that was costing one every time.
 */

import { eq, and, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { parseActionIdentity } from "$lib/shared/actions/identity"
import {
	snapshotRegistry,
	definitionContract,
	definitionContractHash,
	i18nText,
	isEventId,
	parseTemplateId,
	templateSeedProblems,
	type I18n,
	type RegistryEntry,
	type Descriptor,
	type ScriptKindDecl,
	type TemplateSeed
} from "@serene-pub/sdk"
import { poolKeyFor } from "$lib/shared/pipelines/poolKey"
import { notCoreRow } from "$lib/server/plugins/frameHost"
import { objectLayoutSeedsFor } from "$lib/server/pipelines/entities/objectVariableLayouts"

export interface SyncResult {
	inserted: string[]
	updated: string[]
	unchanged: string[]
	/**
	 * Slugs whose pointer moved to a declaration this install had not seen.
	 *
	 * Its own list rather than folded into `updated`, because the two are
	 * different events: `updated` is display text refreshed on the declaration
	 * the slug already resolved to, and this is the slug resolving to a
	 * different declaration. Only the second is worth a line in the boot log.
	 */
	republished: string[]
	/**
	 * Slugs this owner published before and does not publish now (plans/29
	 * R-2): their rows are marked `status: 'removed'` with `removed_at`,
	 * never deleted — a stored spec still pins them, and the boot reconcile
	 * turns each such pin into a notice. Written only by a `complete` sync;
	 * a partial one (a test re-declaring one entry) removes nothing.
	 */
	removed: string[]
	/**
	 * Why a `complete` sync withdrew nothing after all: the descriptor list it
	 * was handed is empty, or holds fewer than half the rows this owner has
	 * standing — a cleared registry mid-reload, a catalog that failed to load
	 * — and culling every row on that evidence is the one thing the
	 * reverse-diff must never do. Absent when the diff ran.
	 */
	reverseDiffSkipped?: string
	/**
	 * Rows an administrator marked `deprecated` whose slug the build does not
	 * publish. Left as they are — `deprecated` is the administrator's word and
	 * the reverse-diff never overwrites it — and named here so the boot log can
	 * say so once.
	 */
	deprecatedUnpublished: string[]
}

/**
 * What is hashed, as an object — the definition's **contract** (plans/31 V6).
 *
 * The SDK composes it: `definitionContract` takes every field of
 * `DESCRIPTOR_CONTRACT_KEYS` and nothing else, strips display text
 * (`DESCRIPTOR_DISPLAY_KEYS`) inside the slots, points, shapes and entry
 * shape, leaves the substrate's `settings` slot out by name (`authoredSlots`),
 * and reads a boolean flag as `true` or absent. The same function digests a
 * `Descriptor` when it is re-declared and a `RegistryEntry` here, so the two
 * answers to *is this the same definition?* are one answer by construction —
 * `registryHashes.test.ts` holds this file's hash to the SDK's for every
 * shipped definition. The policy half (`RegistryEntry.policy`, `i18n`,
 * `public`) never reaches the material; the sync refreshes it in place.
 *
 * Split out from the digest because the archive stores it: a
 * `pipeline_definition_declarations` row keeps **exactly what was hashed**
 * beside the hash, so re-digesting the stored material has to reproduce the
 * stored string. Returning the material from the function that composes it
 * for the digest is what makes that true by construction rather than by two
 * lists agreeing.
 */
export function definitionContentMaterial(
	entry: RegistryEntry
): Record<string, unknown> {
	return definitionContract(entry) as unknown as Record<string, unknown>
}

/** The content hash of a definition — the SDK's `definitionContractHash` over a row's entry. */
export function definitionContentHash(entry: RegistryEntry): string {
	return definitionContractHash(entry)
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

/**
 * The columns a registry row projects from a declaration.
 *
 * Shared by the insert and by the pointer move, because the two write the same
 * thing: a row that carries whichever declaration the slug resolves to now. A
 * pointer move that refreshed only some of these would leave the row a mixture
 * of two declarations, which is the one state neither the hash nor a reader can
 * detect.
 *
 * `definition_id`, `version`, `owner_plugin_id` and `transport` are deliberately
 * absent: they identify the slug and who owns it, not what it declares, and a
 * declaration cannot change them.
 */
function projectedColumns(entry: RegistryEntry, release: string) {
	return {
		kind: entry.kind,
		ports: entry.ports,
		// The declarations verbatim. A UI that has to render a form for a
		// plugin's parameters reads this row; it never loads the plugin.
		slots: entry.slots ?? {},
		i18n: (entry.i18n as any) ?? null,
		effects: entry.effects ?? null,
		optional: entry.optional ?? false,
		semantics: entry.semantics ?? null,
		scriptPoints: (entry.scriptPoints as any) ?? null,
		sessionShape: (entry.sessionShape as any) ?? null,
		// Entry types only. The contract in one column, the declared
		// schema in the column that already exists for a schema — which
		// is what the constraint and index projection will read, by
		// name, without knowing anything about entries.
		entryShape: (entry.entryShape as any) ?? null,
		configSchema: (entry.configSchema as any) ?? null,
		causesEvent: entry.causesEvent ?? null,
		causesEventFrom: entry.causesEventFrom ?? null,
		payloads: entry.payloads ?? null,
		isPublic: entry.public ?? false,
		// The contract flags and declarations beside `optional` (plans/31
		// V6): each is in the hash, and a row that could not carry one could
		// not reproduce its own pointer (`rowToEntry`).
		declaresRandomness: entry.declaresRandomness ?? false,
		earlyExit: entry.earlyExit ?? false,
		liveRow: entry.liveRow ?? false,
		review: entry.review ? { fields: [...entry.review.fields] } : null,
		media: (entry.media as any) ?? null,
		connectionKind: entry.shape ?? null,
		// The policy half, whole — outside the hash, refreshed in place.
		policy: (entry.policy as any) ?? null,
		// The declaration's own status, and only that half of the column:
		// `provisional` is the policy's word (R-2), `live` is every bound
		// one. `deprecated` is an administrator's word and is never written
		// from here — `statusFor` keeps it; `removed` is the reverse-diff's.
		status: entry.policy?.provisional ? "provisional" : "live",
		removedAt: null,
		release
	}
}

/**
 * The status a row takes from its declaration, keeping what a person set.
 *
 * `live` and `provisional` are read off the declaration and move with it;
 * `removed` means the slug is published again and comes back. `deprecated` is
 * the one value no declaration carries, so a row wearing it keeps it — the
 * sync republishes the declaration under it without touching the word.
 */
function statusFor(
	entry: RegistryEntry,
	current: string
): "live" | "provisional" | "deprecated" {
	if (current === "deprecated") return "deprecated"
	return entry.policy?.provisional ? "provisional" : "live"
}

/**
 * Put a declaration in the archive, if its hash is not there already.
 *
 * The insert is conditional on the hash rather than unconditional-with-a-unique
 * violation, because a violation aborts the surrounding statement and this runs
 * inside a boot that must not fail over an audit trail.
 */
async function archiveDeclaration(
	db: Db,
	entry: RegistryEntry,
	hash: string,
	release: string,
	source: "declared" | "adopted"
): Promise<boolean> {
	const [seen] = await db
		.select({ id: schema.pipelineDefinitionDeclarations.id })
		.from(schema.pipelineDefinitionDeclarations)
		.where(
			and(
				eq(schema.pipelineDefinitionDeclarations.definitionId, entry.id),
				eq(schema.pipelineDefinitionDeclarations.version, entry.version),
				eq(schema.pipelineDefinitionDeclarations.contentHash, hash)
			)
		)
		.limit(1)
	if (seen) return false

	await db.insert(schema.pipelineDefinitionDeclarations).values({
		definitionId: entry.id,
		version: entry.version,
		kind: entry.kind,
		contentHash: hash,
		material: definitionContentMaterial(entry) as Record<string, any>,
		entry: entry as unknown as Record<string, any>,
		release,
		source
	})
	return true
}

/**
 * Take whatever a registry row currently resolves to into the archive.
 *
 * The migration path, and the reason 0119 seeds no rows: the hash is a digest of
 * a stripped declaration, which SQL cannot compute — but the row already carries
 * the hash it was published under, and `readDefinitionRegistry` reconstructs the
 * declaration from the row losslessly (the round trip is pinned by
 * `registrySync.int.test.ts`). So the first boot after the migration adopts each
 * existing row from the row itself.
 *
 * ⚠ **An adopted row keeps the hash the registry row carried; it is never
 * recomputed here.** That string is what anything pinning this declaration would
 * have named, and recomputing it under a build whose material has since
 * changed — the contract allowlist of plans/31 V6 is the largest such change —
 * would archive the declaration under a hash nothing ever used, which is the
 * one thing an archive must not do. The material archived beside a hash
 * older than the build's is therefore the row as this build reads it, and it
 * re-hashes to the row's hash only when the two builds agree on the material.
 */
async function adoptCurrent(db: Db, row: any, release: string): Promise<void> {
	if (!row.contentHash) return
	await archiveDeclaration(
		db,
		rowToEntry(row),
		row.contentHash,
		row.release ?? release,
		"adopted"
	)
}

/** Whether this process has said the reverse-diff guard's line — once is enough. */
let warnedReverseDiffSkip = false

/**
 * Project descriptors into rows.
 *
 * Idempotent by construction: same code, same rows, no writes on the second
 * run. That property is what lets this run unconditionally at boot instead of
 * behind a "have we migrated yet" flag, which is a flag that eventually lies.
 */
export async function syncDefinitionRegistry(
	db: Db,
	// Script types ride the same sync (18 §2). `snapshotRegistry` branches on
	// the id, so everything below this line is unaware there are two kinds of
	// declaration — which is the property that keeps publishing one rule.
	descriptors: Array<Descriptor | ScriptKindDecl>,
	opts: {
		release: string
		ownerPluginId?: number
		/**
		 * `descriptors` is everything this owner publishes, so a row of this
		 * owner whose slug is absent from it is marked `removed` (the
		 * reverse-diff, plans/29 R-2). The boot passes it; a partial sync — a
		 * test re-declaring one entry, an entry-type-only seed — leaves it
		 * off and withdraws nothing.
		 */
		complete?: boolean
	} = { release: "dev" }
): Promise<SyncResult> {
	const entries = snapshotRegistry(descriptors, { release: opts.release })
	const result: SyncResult = {
		inserted: [],
		updated: [],
		unchanged: [],
		republished: [],
		removed: [],
		deprecatedUnpublished: []
	}

	for (const entry of entries) {
		const hash = definitionContentHash(entry)
		const pin = `${entry.id}@${entry.version}`

		const [row] = await db
			.select()
			.from(schema.pipelineDefinitionRegistry)
			.where(
				and(
					eq(schema.pipelineDefinitionRegistry.definitionId, entry.id),
					eq(schema.pipelineDefinitionRegistry.version, entry.version)
				)
			)
			.limit(1)

		if (!row) {
			await archiveDeclaration(db, entry, hash, opts.release, "declared")
			await db.insert(schema.pipelineDefinitionRegistry).values({
				definitionId: entry.id,
				version: entry.version,
				ownerPluginId: opts.ownerPluginId ?? null,
				// Core's own types run in-process; anything a plugin owns does
				// not, ever. An extension hook inside Serene Pub's process cannot
				// be stopped, so a runaway loop takes the application down rather
				// than one node (13 §7h). Written from ownership rather than from
				// the plugin's own claim, so a manifest cannot ask for otherwise.
				transport: opts.ownerPluginId != null ? "process" : "node",
				...projectedColumns(entry, opts.release),
				contentHash: hash
			})
			result.inserted.push(pin)
			continue
		}

		// Before anything can move the pointer, whatever it points at now goes
		// into the archive. On an install upgrading past 0119 this is the only
		// moment the pre-archive declaration is still reachable.
		await adoptCurrent(db, row, opts.release)

		if (row.contentHash !== hash) {
			/**
			 * The pointer moves.
			 *
			 * Both halves matter and neither is optional: the archive keeps the
			 * declaration the slug is moving *off*, so a hash that named it
			 * still resolves, and the row takes the whole new projection, so no
			 * reader sees a mixture of two declarations.
			 *
			 * ⚠ `contentHash` is set in the same statement as the columns it
			 * describes. Split across two writes, a failure between them would
			 * leave a row whose hash disagrees with its own content — a lie the
			 * next boot would read as a further pointer move and archive under
			 * a hash of a declaration nobody wrote.
			 */
			await archiveDeclaration(db, entry, hash, opts.release, "declared")
			await db
				.update(schema.pipelineDefinitionRegistry)
				.set({
					...projectedColumns(entry, opts.release),
					status: statusFor(entry, row.status),
					contentHash: hash
				})
				.where(eq(schema.pipelineDefinitionRegistry.id, row.id))
			result.republished.push(pin)
			continue
		}

		// Same contract — but the *display* text may still have moved:
		// labels and descriptions are stripped from the hash precisely so
		// they can change without a version bump, and that promise is only
		// kept if the row picks them up here. The stored slots are what a
		// form renders from (F6), so a description authored after 1.0.0
		// shipped must reach installs whose rows predate it.
		const slotsChanged =
			JSON.stringify(sortDeep(row.slots ?? {})) !==
			JSON.stringify(sortDeep(entry.slots ?? {}))
		// `optional` *is* hashed, so a declaration cannot change it without
		// changing the hash and moving the pointer. What can go stale
		// is the column itself: it was added long after the property, so
		// every row written before then carries the default rather than the
		// truth. Healing it here rather than backfilling in the migration
		// means the fix needs no hardcoded list of which types declare it.
		const optionalChanged = !!row.optional !== !!entry.optional
		// `payloads` (R33) is hashed, but its column arrived after the hash
		// learned it (0155): a row written in between carries NULL under the
		// right hash. Healed here on the same footing as `optional`.
		const payloadsChanged =
			JSON.stringify(row.payloads ?? null) !== JSON.stringify(entry.payloads ?? null)
		// The name, on the same footing as `slots` and for the same reason:
		// stripped from the hash so it can change without a version bump,
		// which is a promise only kept if the row picks it up here. It was
		// not projected at all until 0.6, so every existing row carries
		// NULL and every reader that wanted a name invented one from the
		// type id — healed here rather than backfilled, so the fix needs no
		// hardcoded list of which types declare one.
		const i18nChanged =
			JSON.stringify(row.i18n ?? null) !==
			JSON.stringify((entry.i18n as any) ?? null)
		// Point labels are display text on the same footing as slot
		// descriptions: stripped from the hash, so kept fresh here.
		const pointsChanged =
			JSON.stringify(sortDeep(row.scriptPoints ?? null)) !==
			JSON.stringify(sortDeep((entry.scriptPoints as any) ?? null))
		// An entry type's `fields` are a declared schema on exactly the
		// same footing as `slots`: hashed apart from their display text, so
		// a relabelled field must reach installs whose rows predate the
		// rewording, or the form renders the old words forever. The
		// contract half (`entry_shape`) needs no such healing — it is
		// hashed whole, so it cannot move without moving the pointer.
		const configSchemaChanged =
			JSON.stringify(sortDeep(row.configSchema ?? null)) !==
			JSON.stringify(sortDeep((entry.configSchema as any) ?? null))
		// The policy half (plans/31 V6) is outside the hash on purpose — a
		// flipped `provisional`, a moved timeout, a changed gate default must
		// reach every install without a pointer move — so it is refreshed
		// here, on the same footing as the display text.
		const policyChanged =
			JSON.stringify(sortDeep(row.policy ?? null)) !==
			JSON.stringify(sortDeep((entry.policy as any) ?? null))
		// The status derives from the policy's `provisional`, so it moves
		// with the line above; a slug that was `removed` and is published
		// again comes back through here too.
		const status = statusFor(entry, row.status)
		const statusChanged = row.status !== status
		if (
			configSchemaChanged ||
			slotsChanged ||
			optionalChanged ||
			payloadsChanged ||
			i18nChanged ||
			pointsChanged ||
			policyChanged ||
			statusChanged ||
			row.release !== opts.release
		) {
			await db
				.update(schema.pipelineDefinitionRegistry)
				.set({
					release: opts.release,
					...(statusChanged ? { status, removedAt: null } : {}),
					...(policyChanged
						? { policy: (entry.policy as any) ?? null }
						: {}),
					...(optionalChanged
						? { optional: entry.optional ?? false }
						: {}),
					...(payloadsChanged ? { payloads: entry.payloads ?? null } : {}),
					...(slotsChanged ? { slots: entry.slots ?? {} } : {}),
					...(configSchemaChanged
						? {
								configSchema:
									(entry.configSchema as any) ?? null
							}
						: {}),
					...(i18nChanged
						? { i18n: (entry.i18n as any) ?? null }
						: {}),
					...(pointsChanged
						? {
								scriptPoints:
									(entry.scriptPoints as any) ?? null
							}
						: {})
				})
				.where(eq(schema.pipelineDefinitionRegistry.id, row.id))
			if (slotsChanged || configSchemaChanged) {
				result.updated.push(pin)
				continue
			}
		}
		result.unchanged.push(pin)
	}

	if (opts.complete) {
		/**
		 * The reverse-diff (plans/29 R-2): a row of this owner whose slug the
		 * current build does not publish is marked, never deleted.
		 *
		 * Marked, because a stored spec may still pin it — `pipeline_nodes`
		 * names the slug, and deleting the row would turn a legible notice
		 * ("this node's definition is gone") into an unknown-type error at
		 * load. The archive keeps every declaration the slug ever resolved
		 * to, so a receipt naming its hash still resolves. `removed_at` is
		 * first-seen: a row already marked keeps its date. The same precedent
		 * `syncPluginPresets` sets for a withdrawn preset.
		 */
		const owner = opts.ownerPluginId ?? null
		const published = new Set(entries.map((e) => `${e.id}@${e.version}`))
		const rows = await db
			.select({
				id: schema.pipelineDefinitionRegistry.id,
				definitionId: schema.pipelineDefinitionRegistry.definitionId,
				version: schema.pipelineDefinitionRegistry.version,
				status: schema.pipelineDefinitionRegistry.status
			})
			.from(schema.pipelineDefinitionRegistry)
			.where(
				owner === null
					? isNull(schema.pipelineDefinitionRegistry.ownerPluginId)
					: eq(schema.pipelineDefinitionRegistry.ownerPluginId, owner)
			)
		/**
		 * The guard (U6 review, finding 3). A cull is judged against what the
		 * build declares, and "declares nothing" is never a build — it is a
		 * registry read before the contracts loaded, a hot reload that
		 * re-evaluated half a module. Withdrawing every row on that evidence
		 * would strip an install of its whole vocabulary at once, so the
		 * diff runs only when the declared set is at least half of what this
		 * owner has standing (`removed` rows excepted: they are the diff's
		 * own past answers). Said once per process and reported on the
		 * result; the next boot, with the contracts loaded, withdraws what
		 * this one left.
		 */
		const standing = rows.filter((r) => r.status !== "removed").length
		if (entries.length === 0 || entries.length * 2 < standing) {
			result.reverseDiffSkipped =
				`the sync was handed ${entries.length} declaration(s) against ${standing} ` +
				`standing row(s) for this owner — too few to be a build; the reverse-diff ` +
				`withdrew nothing`
			if (!warnedReverseDiffSkip) {
				warnedReverseDiffSkip = true
				console.warn(`[pipelines] ${result.reverseDiffSkipped}`)
			}
			return result
		}
		const now = new Date()
		for (const row of rows) {
			const pin = `${row.definitionId}@${row.version}`
			if (published.has(pin) || row.status === "removed") continue
			// The administrator's word survives the code's (U6 review,
			// finding 6): a deprecated row whose slug is gone stays
			// `deprecated`, and is named so the boot log can say so.
			if (row.status === "deprecated") {
				result.deprecatedUnpublished.push(pin)
				continue
			}
			await db
				.update(schema.pipelineDefinitionRegistry)
				.set({ status: "removed", removedAt: now })
				.where(eq(schema.pipelineDefinitionRegistry.id, row.id))
			result.removed.push(pin)
		}
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
export async function readDefinitionRegistry(db: Db): Promise<RegistryEntry[]> {
	const rows = await db.select().from(schema.pipelineDefinitionRegistry)
	return rows.map(rowToEntry)
}

/**
 * One registry row, back as the declaration it was projected from.
 *
 * Its own function because two callers need it and they need it to agree:
 * `readDefinitionRegistry` hands it to install validation, and `adoptCurrent` hands it
 * to the archive. If the second reconstructed a declaration the first would not,
 * an adopted row's material would describe something no reader ever saw.
 */
function rowToEntry(r: any): RegistryEntry {
	return {
		id: r.definitionId,
		version: r.version,
		kind: r.kind,
		ports: r.ports,
		slots: r.slots ?? {},
		effects: r.effects ?? undefined,
		optional: r.optional || undefined,
		// Read back so a round trip through the table is lossless. It is
		// hashed, so a reader that dropped it would compute a different hash
		// from the same row and every script type would look conflicted.
		semantics: r.semantics ?? undefined,
		// Hashed too (18 §4e) — same lossless-round-trip obligation.
		scriptPoints: r.scriptPoints ?? undefined,
		// Hashed too (19 §1) — same obligation again.
		sessionShape: r.sessionShape ?? undefined,
		// And again for the two an entry type carries. A hashed field the
		// reader drops makes the same row hash differently depending on which
		// direction it was travelling, which is what the round-trip test in
		// `registrySync.int.test.ts` exists to catch.
		entryShape: r.entryShape ?? undefined,
		configSchema: r.configSchema ?? undefined,
		i18n: r.i18n ?? undefined,
		causesEvent: r.causesEvent ?? undefined,
		causesEventFrom: r.causesEventFrom ?? undefined,
		payloads: r.payloads ?? undefined,
		// ⚠ `|| undefined`, matching `optional` two lines up, and for a reason
		// the round-trip test found rather than reasoned about: the column is
		// `NOT NULL DEFAULT false`, so a type that never declared `public`
		// comes back as `false` where the projection had `undefined`.
		// `JSON.stringify` keeps `false` and drops `undefined`, so the same row
		// hashed differently depending on which direction it was travelling.
		public: r.isPublic || undefined,
		// The contract flags and declarations beside `optional` (plans/31
		// V6), read back on the same terms: a flag is `true` or absent.
		declaresRandomness: r.declaresRandomness || undefined,
		earlyExit: r.earlyExit || undefined,
		liveRow: r.liveRow || undefined,
		review: r.review ?? undefined,
		media: r.media ?? undefined,
		shape: r.connectionKind ?? undefined,
		// The policy half, whole. `provisional` lives inside it and the
		// `status` column derives from it — the row's `status` is read by
		// nothing here, because a person's `deprecated` is not a policy the
		// declaration made.
		policy: r.policy ?? undefined,
		owner: r.ownerPluginId ? String(r.ownerPluginId) : undefined,
		release: r.release ?? undefined
	}
}

/* ------------------------------------------------------------------ *
 * Plugin-declared session presets
 * ------------------------------------------------------------------ */

/**
 * What one sync of the plugin presets did.
 *
 * Three lists rather than counts, because every entry is something an
 * administrator may need to go and look at: a preset appeared, or one stopped
 * being offered, or one came back.
 */
export interface PluginPresetSyncReport {
	projected: string[]
	withdrawn: string[]
	restored: string[]
	/**
	 * Presets whose manifest keyed a binding by something that is not an
	 * event id — skipped and reported, never written. `announce.build()`
	 * refuses such a key at packaging.
	 */
	skippedBindingKeys: string[]
	/**
	 * Presets whose manifest included an action by something that is not an
	 * identity (`<spec slug>#<key>`) — dropped and reported, never written.
	 * `preset()` refuses such an entry at packaging.
	 */
	bareIncludedKeys: string[]
	/**
	 * `<preset seed key> <event>` for each binding whose declared config slug
	 * resolved to no row of the package's on that binding's spec — landed
	 * without a config, so the spec's shipped default applies.
	 */
	unresolvedConfigs: string[]
	/**
	 * Rows under a declared seed key that are somebody's — not immutable, and
	 * not equal to what ships — so the sync leaves their content alone.
	 */
	kept: string[]
}

/** `plugin:<plugin id>:<declared slug>` — the idempotence key, never a row id. */
const presetSeedKey = (pluginId: string, slug: string) =>
	`plugin:${pluginId}:${slug}`

/**
 * `plugin:<plugin id>:<spec id>#<config slug>` — a shipped config's seed key.
 *
 * The spec is part of the identity because a config slug is unique **per
 * spec**, not per package: the SDK's `configFindings` refuses a duplicate
 * `spec#slug` and nothing else, and `PresetBinding.config` is "a config slug
 * of that spec". Keyed by slug alone, two specs shipping `…-default` shared one
 * key and the second install moved the first's row onto its own spec. The
 * `spec#slug` spelling is the SDK's own for the same pair.
 *
 * Here rather than in `plugins/install.ts`, which writes the rows, because
 * `syncPluginPresets` resolves a binding's config through it and install
 * already imports this module.
 */
export const pluginConfigSeedKey = (
	pluginId: string,
	specId: string,
	slug: string
) => `plugin:${pluginId}:${specId}#${slug}`

/** ⏳ The key install wrote before the spec joined it; read only to adopt a row. */
export const legacyPluginConfigSeedKey = (pluginId: string, slug: string) =>
	`plugin:${pluginId}:${slug}`

/**
 * Project every enabled plugin's `preset()` declarations into `session_presets`.
 *
 * ## The gap this closes
 *
 * A package announces genres, pipelines, configs and **presets** (24 §10), and
 * the preset is the one a person actually picks: it is what binds each of a
 * genre's event slots to a pipeline. Nothing projected them, so a package could
 * ship a complete, coverage-checked preset and an administrator would find
 * nothing to enable — the pipelines were there and the thing that makes them
 * usable together was not.
 *
 * ## Disabled on arrival
 *
 * A preset is what a **non-admin** is offered, and which presets an instance
 * offers is the instance owner's decision. So a projected preset arrives
 * `enabled: false` unless the declaration asks otherwise, and an administrator
 * switches it on — the same shape as a declared permission, announced by the
 * package and granted by the instance.
 *
 * `enabled` is never written again after the insert. It is the administrator's
 * column, and an upgrade that reset it would silently re-approve something
 * somebody had turned off, or un-approve something they had turned on.
 *
 * ## Withdrawal marks, it never deletes
 *
 * Disabling or uninstalling a plugin sets `withdrawn_at` on its presets. A
 * session names its preset, so deleting the row would leave live sessions
 * pointing at nothing the moment an extension was switched off — and switching
 * an extension off is a reversible, everyday act. Re-enabling clears the mark
 * and the administrator's `enabled` decision is exactly where they left it.
 *
 * ## A binding's config is resolved to the row install wrote
 *
 * A declared binding's `config` is a **config slug of that binding's spec**;
 * the column holds a `pipeline_configs.id`, an instance fact. Install projects
 * each shipped config under {@link pluginConfigSeedKey} (package, spec, slug),
 * so the binding resolves by that key — and only to a row on the binding's own
 * spec. A slug that resolves to nothing (the config was refused at install, or
 * the package never shipped it) lands without a config, the spec's shipped
 * default applies, and it is reported in `unresolvedConfigs`: a preset silently
 * pointing at the wrong row would be worse than one pointing at the default.
 *
 * ## Shipped rows are immutable; a person's row is never rewritten
 *
 * The posture a plugin's shipped configs and core's presets take. The row a
 * declaration projects is `is_immutable`, and a sync re-forces it, so a new
 * shipped binding reaches every preset nobody edited. A row under the seed key
 * that is not immutable is somebody's: the sync restores it from withdrawal
 * and writes nothing else, reported in `kept`. A person changes a shipped
 * preset by duplicating it, and the copy has no seed key.
 */
export async function syncPluginPresets(
	db: Db
): Promise<PluginPresetSyncReport> {
	const report: PluginPresetSyncReport = {
		projected: [],
		withdrawn: [],
		restored: [],
		skippedBindingKeys: [],
		bareIncludedKeys: [],
		unresolvedConfigs: [],
		kept: []
	}

	const plugins = await db.select().from(schema.plugins).where(notCoreRow())
	const declared = new Map<
		string,
		{ ownerId: number; pluginId: string; decl: Record<string, any> }
	>()
	for (const p of plugins as any[]) {
		if (!p.enabled) continue
		const presets = (p.manifest as any)?.presets
		if (!Array.isArray(presets)) continue
		for (const decl of presets) {
			// A declaration missing either of these cannot make a row: the genre
			// is NOT NULL and the slug is the identity. Skipped rather than
			// defaulted, because inventing one would produce a preset nobody
			// declared under a key nothing can update.
			if (
				!decl ||
				typeof decl.slug !== "string" ||
				typeof decl.genre !== "string"
			)
				continue
			declared.set(presetSeedKey(p.pluginId, decl.slug), {
				ownerId: p.id,
				pluginId: p.pluginId,
				decl
			})
		}
	}

	const rows = await db.select().from(schema.sessionPresets)
	const bySeedKey = new Map(
		(rows as any[]).filter((r) => r.seedKey).map((r) => [r.seedKey, r])
	)
	// A shipped config's id, by seed key and only on the spec it was read
	// for — the key already names the spec, and the join says the row still
	// belongs to it.
	const configIdFor = async (
		pluginId: string,
		specSlug: string,
		slug: string
	): Promise<number | null> => {
		const [row] = await db
			.select({ id: schema.pipelineConfigs.id })
			.from(schema.pipelineConfigs)
			.innerJoin(
				schema.pipelineSpecs,
				eq(schema.pipelineSpecs.id, schema.pipelineConfigs.specId)
			)
			.where(
				and(
					eq(
						schema.pipelineConfigs.seedKey,
						pluginConfigSeedKey(pluginId, specSlug, slug)
					),
					eq(schema.pipelineSpecs.slug, specSlug)
				)
			)
			.limit(1)
		return row?.id ?? null
	}

	for (const [seedKey, { ownerId, pluginId, decl }] of declared) {
		const bindings: Record<string, { spec: string; config?: number }> = {}
		for (const [key, b] of Object.entries(decl.bindings ?? {})) {
			if (!b || typeof (b as any).spec !== "string") continue
			// Keyed by event id; `announce.build()` refuses anything else at
			// packaging, so a manifest carrying one is skipped and reported.
			if (!isEventId(key)) {
				if (!report.skippedBindingKeys.includes(seedKey)) {
					report.skippedBindingKeys.push(seedKey)
					console.warn(
						`[pipelines] preset ${seedKey} binds '${key}', which is not an event id; ` +
							`skipped — repackage the plugin against the current SDK`
					)
				}
				continue
			}
			const event = key
			const specSlug = (b as any).spec as string
			const configSlug = (b as any).config
			let config: number | null = null
			if (typeof configSlug === "string" && configSlug) {
				config = await configIdFor(pluginId, specSlug, configSlug)
				if (config == null) {
					report.unresolvedConfigs.push(`${seedKey} ${event}`)
					console.warn(
						`[pipelines] preset ${seedKey} binds '${event}' with config '${configSlug}', ` +
							`which is not installed for '${specSlug}'; bound without one — the ` +
							`spec's shipped default applies`
					)
				}
			}
			bindings[event] =
				config == null ? { spec: specSlug } : { spec: specSlug, config }
		}

		// The included set is stored by identity (W-A); `preset()` refuses
		// anything else at packaging, so an entry that is not one is dropped
		// and reported once per preset, never written.
		let includedActions: string[] | null = null
		if (Array.isArray(decl.actions?.include)) {
			const entries = (decl.actions.include as unknown[]).map(String)
			const bare = entries.filter((k) => !parseActionIdentity(k))
			includedActions = [...new Set(entries.filter((k) => parseActionIdentity(k)))]
			if (bare.length && !report.bareIncludedKeys.includes(seedKey)) {
				report.bareIncludedKeys.push(seedKey)
				console.warn(
					`[pipelines] preset ${seedKey} includes ${bare.map((k) => `'${k}'`).join(", ")}, ` +
						`which ${bare.length === 1 ? "is not an identity" : "are not identities"}; dropped — ` +
						`repackage the plugin naming each action by identity ('<spec slug>#<key>')`
				)
			}
		}

		const projected = {
			// The row's columns are text: the declaration's display text
			// resolved to `en` through the SDK's one resolver (R-20), exactly
			// as the catalogue's `seedOf` projects core's presets. The label is
			// required at the package's `build()`, so the slug is a fallback the
			// gate makes unreachable.
			name: i18nText(decl.label as I18n | undefined) ?? decl.slug,
			description: i18nText(decl.description as I18n | undefined) ?? null,
			genreId: decl.genre as string,
			bindings,
			includedActions,
			defaults: (decl.defaults as Record<string, unknown>) ?? null,
			ownerPluginId: ownerId
		}

		const existing = bySeedKey.get(seedKey)
		if (!existing) {
			await db.insert(schema.sessionPresets).values({
				seedKey,
				...projected,
				enabled: decl.enabled === true,
				// Shipped, so selectable and copyable but never edited in
				// place — the posture core's presets and a plugin's shipped
				// configs take. A person's change goes to a duplicate.
				isImmutable: true
			})
			report.projected.push(seedKey)
			continue
		}
		// A row under this key that a plugin does not own is not this sync's to
		// write. It can only happen if somebody created one by hand at the same
		// seed key, and taking it over would silently replace their preset.
		if (existing.ownerPluginId !== ownerId) continue

		if (existing.withdrawnAt) report.restored.push(seedKey)

		// Whose content it is — the shipped-config rule (`plugins/install.ts`).
		// An immutable row is the shipped row, and re-forcing it is how an
		// update ships a new binding. A row that is NOT immutable has been made
		// somebody's: its bindings, name and curation are theirs, and neither a
		// re-sync nor an update writes them again (the defect: every sync
		// rewrote `bindings`, so an administrator's rebinding lasted until the
		// next boot). ⏳ Rows projected before shipped presets were immutable
		// are all mutable; one still equal to the projection is untouched and
		// adopted as shipped. At boot the manifest is the one last synced, so
		// "equal" is "still what we last shipped"; a row that differs is kept,
		// which only costs an untouched row an update it could not be told
		// apart from an edit.
		if (!existing.isImmutable) {
			const untouched = (
				[
					"name",
					"description",
					"genreId",
					"bindings",
					"includedActions",
					"defaults"
				] as const
			).every(
				(k) =>
					JSON.stringify(sortDeep(existing[k] ?? null)) ===
					JSON.stringify(sortDeep((projected as any)[k] ?? null))
			)
			if (!untouched) {
				report.kept.push(seedKey)
				if (existing.withdrawnAt)
					await db
						.update(schema.sessionPresets)
						.set({ withdrawnAt: null })
						.where(eq(schema.sessionPresets.id, existing.id))
				continue
			}
		}
		await db
			.update(schema.sessionPresets)
			.set({ ...projected, isImmutable: true, withdrawnAt: null })
			.where(eq(schema.sessionPresets.id, existing.id))
	}

	for (const row of rows as any[]) {
		if (row.ownerPluginId == null || row.withdrawnAt) continue
		if (declared.has(row.seedKey)) continue
		await db
			.update(schema.sessionPresets)
			.set({ withdrawnAt: new Date() })
			.where(eq(schema.sessionPresets.id, row.id))
		report.withdrawn.push(row.seedKey)
	}

	return report
}

/* ------------------------------------------------------------------ *
 * Plugin templates (R19)
 * ------------------------------------------------------------------ */

/**
 * What one pass over every enabled plugin's `templates` did.
 *
 * The same three lists a preset sync reports, for the same reason — each entry
 * is something an administrator may want to look at — plus `refused`, which a
 * preset sync has no equivalent of because a preset's identity is the only
 * thing that can collide. A template row also has to fit a POOL: two packages
 * may legitimately both ship a prompt called "Terse" for the same node, and the
 * pool's unique name index is what says so.
 */
export interface PluginTemplateSyncReport {
	projected: string[]
	withdrawn: string[]
	restored: string[]
	/** `<template id>: <reason>` — declarations this instance would not write. */
	refused: string[]
}

/** The three tables a declared template may land in, one per slot kind. */
type PluginTemplateKind = "prompts" | "template" | "variables"

/** The name segment of a template id, as `<slug>` spells it. */
const TEMPLATE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Every template row a manifest declares, in **one** vocabulary (R5, D-6).
 *
 * Two fields say it. `templates` is the full {@link TemplateSeed} shape: an
 * owner-namespaced template id, a kind, and a body that may be a prompt's
 * fields or a template's source. `prompts` is D-1's narrower `PromptDecl` —
 * `{ nodeType, slot, slug, label, fields }`, which is a prompts row and nothing
 * else — and it is the field the packager writes from a `defineExtension`, so
 * a package authored today says its prompts there.
 *
 * Translated rather than projected separately, because the projection below
 * also **withdraws**: it marks every plugin-owned row it did not just see, so a
 * second writer into `pipeline_prompts` would have its rows withdrawn on this
 * sync's next pass. One list in, one table out, one withdrawal.
 *
 * The id a `PromptDecl` gets is `<plugin>:template/<slug>@1`. `@1` because a
 * `PromptDecl` has no major to carry: the shape declares a slug and the pin is
 * what a template id adds, so every prompt declared this way is the first major
 * of its name and a package that needs a second one declares it in `templates`.
 */
export function declaredTemplateSeeds(
	manifest: unknown,
	pluginId: string
): TemplateSeed[] {
	const m = manifest && typeof manifest === "object" ? (manifest as any) : undefined
	const out: TemplateSeed[] = Array.isArray(m?.templates) ? [...m.templates] : []
	for (const decl of Array.isArray(m?.prompts) ? m.prompts : []) {
		if (!decl || typeof decl !== "object") continue
		const slug = typeof decl.slug === "string" ? decl.slug : ""
		// A slug outside the name grammar produces an id `templateSeedProblems`
		// refuses anyway; minted here so the refusal names the id the author
		// would have to fix rather than an id this function invented.
		if (!slug || !TEMPLATE_NAME.test(slug)) continue
		out.push({
			id: `${pluginId}:template/${slug}@1`,
			kind: "prompts",
			nodeDefinitionId: decl.nodeType,
			slot: decl.slot,
			label: i18nText(decl.label as I18n) ?? slug,
			body: decl.fields
		} as TemplateSeed)
	}
	// Last, so a layout the package ships for a variable always wins: every
	// OBJECT variable the manifest declares and lays out nowhere gets an
	// automatic "JSON" layout (owner ruling 2026-09-27; see
	// `objectVariableLayouts.ts`). Read here so the projection below writes,
	// refreshes and withdraws it exactly like a declared one.
	out.push(...(objectLayoutSeedsFor(m, pluginId, out) as TemplateSeed[]))
	return out
}

/** The row fields one declaration projects to, per kind. */
function projectionOf(
	kind: PluginTemplateKind,
	t: TemplateSeed,
	ownerId: number
): Record<string, unknown> {
	const name = t.label ?? parseTemplateId(t.id)!.name
	if (kind === "prompts")
		return {
			nodeDefinitionId: poolKeyFor(t.nodeDefinitionId!),
			slot: t.slot!,
			name,
			fields: t.body as Record<string, string>,
			// A shipped row belongs to no pipeline of this instance's —
			// `created_for_spec_id` is grouping in the picker and would
			// need a local spec id, which a manifest cannot carry.
			createdForSpecId: null,
			ownerPluginId: ownerId
		}
	if (kind === "template")
		return {
			nodeDefinitionId: poolKeyFor(t.nodeDefinitionId!),
			engine: t.engine!,
			name,
			source: t.body as string,
			createdForSpecId: null,
			ownerPluginId: ownerId
		}
	return {
		variableId: t.variableId!,
		engine: t.engine!,
		name,
		source: t.body as string,
		ownerPluginId: ownerId
	}
}

function tableFor(kind: PluginTemplateKind) {
	return kind === "prompts"
		? schema.pipelinePrompts
		: kind === "template"
			? schema.pipelineContextTemplates
			: schema.pipelineVariableTemplates
}

/**
 * Write one template seed as its package's row: insert it, or refresh and
 * un-withdraw the row this package already owns under that id. A row under the
 * id that another owner holds is refused, never taken. Returns what happened.
 */
async function writeTemplateSeed(
	db: Db,
	id: string,
	kind: PluginTemplateKind,
	seed: TemplateSeed,
	ownerId: number
): Promise<"projected" | "restored" | "present" | { refused: string }> {
	const table = tableFor(kind)
	const [existing] = (await db
		.select()
		.from(table)
		.where(eq(table.templateId, id))
		.limit(1)) as any[]

	// A row under this id that a plugin does not own is not this sync's to
	// write. `template_id` is unique across the table, so this is the only
	// way one package's row could quietly become another's.
	if (existing && existing.ownerPluginId !== ownerId)
		return {
			refused: `a row already holds that id and this package does not own it`
		}

	const values = projectionOf(kind, seed, ownerId)
	try {
		if (!existing) {
			await db
				.insert(table as any)
				.values({ ...values, templateId: id, isImmutable: true })
			return "projected"
		}
		await db
			.update(table as any)
			.set({ ...values, withdrawnAt: null, updatedAt: new Date() })
			.where(eq(table.id, existing.id))
		return existing.withdrawnAt ? "restored" : "present"
	} catch (e) {
		// Almost always the pool's unique name index: two packages shipping
		// "Terse" for one node, or one package shipping it twice. Refused
		// per declaration rather than thrown, because a sync that throws
		// costs every OTHER package its templates for one package's clash.
		return { refused: e instanceof Error ? e.message : String(e) }
	}
}

/**
 * Project one package's AUTOMATIC object layouts now — at install, the moment
 * its variables are registered (owner ruling 2026-09-27), rather than waiting
 * for the next template sync. The same seeds `declaredTemplateSeeds` hands
 * that sync, written by the same writer, so the two can never disagree and a
 * later sync refreshes rather than duplicates. Returns a sentence per refusal.
 */
export async function projectObjectVariableLayouts(
	db: Db,
	manifest: unknown,
	pluginId: string,
	ownerId: number
): Promise<string[]> {
	const refused: string[] = []
	for (const seed of declaredTemplateSeeds(manifest, pluginId)) {
		if (!(seed as { automatic?: boolean }).automatic) continue
		const problems = templateSeedProblems(seed, pluginId)
		if (problems.length) {
			refused.push(`layout '${seed.id}': ${problems.join(" ")}`)
			continue
		}
		const out = await writeTemplateSeed(db, seed.id, "variables", seed, ownerId)
		if (typeof out === "object") refused.push(`layout '${seed.id}': ${out.refused}`)
	}
	return refused
}

/**
 * Project every enabled plugin's `templates` declarations into rows (R19).
 *
 * ## The gap this closes
 *
 * An extension could ship `pipelines` and had no way to ship a template row one
 * of them references. Its spec's shipped configuration would therefore start on
 * whatever core's pool heuristics resolved — core's own prompt, written for
 * core's own pipeline — or on nothing at all for a node core knows nothing
 * about. The prose an author wrote their pipeline around had nowhere to live.
 *
 * ## Same shape as `syncPluginPresets`, one table over
 *
 * Projected from the manifest on enable and at boot; **immutable**, so it is
 * selectable and copyable and never edited in place; and **withdrawn rather
 * than deleted** when the plugin goes. A pipeline's stored configuration holds
 * the row's integer id, so deleting the row would leave that configuration
 * pointing at nothing the moment somebody switched an extension off — and
 * switching an extension off is a reversible, everyday act. That is the same
 * argument `session_presets` makes, one step removed: a preset is named by a
 * session, a template by a configuration.
 *
 * It differs from a preset in one place, and deliberately: a projected template
 * is **not** disabled on arrival. `enabled` on a preset is the instance owner's
 * decision about what non-admins are offered; a template row is offered to an
 * administrator in a picker beside every other row and is selected by nothing
 * until one of them selects it. There is nothing to approve.
 *
 * ## Validated here, not trusted from the manifest
 *
 * `defineExtension` refuses a malformed declaration while the author is writing
 * it, and that is advisory: install stores the manifest verbatim, so the rule
 * has to be applied again where the row is written. `templateSeedProblems` is
 * the one statement of it, exported by the SDK so the two answers cannot drift.
 */
export async function syncPluginTemplates(
	db: Db
): Promise<PluginTemplateSyncReport> {
	const report: PluginTemplateSyncReport = {
		projected: [],
		withdrawn: [],
		restored: [],
		refused: []
	}

	const refuse = (id: string, why: string) => {
		report.refused.push(`${id}: ${why}`)
		console.warn(`[pipelines] plugin template ${id} was refused: ${why}`)
	}

	const plugins = await db.select().from(schema.plugins).where(notCoreRow())
	const declared = new Map<
		string,
		{ ownerId: number; kind: PluginTemplateKind; seed: TemplateSeed }
	>()
	for (const p of plugins as any[]) {
		// A disabled package's declared rows are withdrawn — but its automatic
		// object layouts are not: they follow its VARIABLES, which stay
		// registered while the package is installed (`pluginVariables.ts`),
		// and a picker already hides a disabled package's rows (R67).
		const templates = declaredTemplateSeeds(p.manifest, p.pluginId).filter(
			(t) => p.enabled || (t as { automatic?: boolean }).automatic
		)
		if (!templates.length) continue
		for (const raw of templates) {
			const seed = raw as TemplateSeed
			if (!seed || typeof seed.id !== "string") continue
			const problems = templateSeedProblems(seed, p.pluginId)
			if (problems.length) {
				refuse(seed.id, problems.join(" "))
				continue
			}
			// Two packages under one id cannot both be right, and taking the
			// second would make which one wins depend on install order.
			const prior = declared.get(seed.id)
			if (prior && prior.ownerId !== p.id) {
				refuse(
					seed.id,
					`another installed package already declares it, and an id carries its owner`
				)
				continue
			}
			declared.set(seed.id, {
				ownerId: p.id,
				kind: seed.kind as PluginTemplateKind,
				seed
			})
		}
	}

	for (const [id, { ownerId, kind, seed }] of declared) {
		const out = await writeTemplateSeed(db, id, kind, seed, ownerId)
		if (typeof out === "object") refuse(id, out.refused)
		else if (out === "projected") report.projected.push(id)
		else if (out === "restored") report.restored.push(id)
	}

	// Withdrawal marks, it never deletes — see the header.
	for (const kind of ["prompts", "template", "variables"] as const) {
		const table = tableFor(kind)
		const rows = (await db.select().from(table)) as any[]
		for (const row of rows) {
			if (row.ownerPluginId == null || row.withdrawnAt) continue
			if (declared.has(row.templateId)) continue
			await db
				.update(table as any)
				.set({ withdrawnAt: new Date() })
				.where(eq(table.id, row.id))
			report.withdrawn.push(row.templateId)
		}
	}

	return report
}
