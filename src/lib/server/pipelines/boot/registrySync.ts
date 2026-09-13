/**
 * Boot-time type registry sync (02 §5, U2).
 *
 * Node types are declared in code and **materialized as rows**, so that every
 * pin in every spec is joinable and — the part that actually matters — so core
 * can decide whether a plugin fits this release **without executing it** (F6,
 * 13 §10c).
 *
 * ## A slug is an indirection (ruling 2026-09-10)
 *
 * `core:query/vector-search@1` names a *pointer*, not a declaration. The
 * `pipeline_type_registry` row for that slug carries whichever declaration it
 * currently resolves to, and `pipeline_type_declarations` keeps every
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

import { eq, and } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	snapshotRegistry,
	declarationMaterial,
	DESCRIPTOR_DISPLAY_KEYS,
	type RegistryEntry,
	type Descriptor,
	type ScriptTypeDecl
} from "@serene-pub/sdk"

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
 *
 * ## ⚠ That last paragraph was a promise this file did not keep
 *
 * It stripped `i18n` and `description` and nothing else, while a parameter's
 * display text is not spelled `i18n` at all: `settings.ts` calls **`label`** the
 * canonical key for a field or a member band and `i18n` its deprecated alias. So
 * translating "Top K" into German *was* a type version bump — the exact edit the
 * comment above says is free. Under the freeze that was not a warning but a
 * stop; under content addressing it is a pointer move nobody asked for, which is
 * quieter and still wrong: a slug would resolve to a new declaration because
 * somebody translated a label.
 *
 * The SDK's own registries had already answered this. `refuseUnlessIdentical`
 * takes a `DisplayKeys` set, and the descriptor registry passes
 * `DESCRIPTOR_DISPLAY_KEYS` — `['label']` — so re-declaring a descriptor with a
 * renamed parameter is a no-op *there* while moving the pointer *here*. Two
 * answers to one question, from two functions, disagreeing on the most common
 * edit there is.
 *
 * So the strip is now the SDK's, called with the SDK's own list rather than a
 * copy of it. `declarationMaterial` differs from what stood here in one further
 * way, deliberately kept: a function value canonicalizes to its source text
 * instead of being dropped by `JSON.stringify`. No node type reaches it — a
 * `SlotDecl`, an `EntryShape` and a `SettingsSchema` are data — but if one ever
 * carries a predicate, hashing it is the correct answer and silently ignoring it
 * is not.
 *
 * Widening a display list re-hashes every type that carries the word, which is
 * why this lands with migration 0113 and not on its own.
 */
const stripDisplay = (v: unknown): unknown =>
	declarationMaterial(v, DESCRIPTOR_DISPLAY_KEYS)

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
 * What is hashed, as an object.
 *
 * Split out from the digest because the archive stores it: a
 * `pipeline_type_declarations` row keeps **exactly what was hashed** beside the
 * hash, so re-digesting the stored material has to reproduce the stored string.
 * Returning the material from the same function that composes it for the digest
 * is what makes that true by construction rather than by two lists agreeing.
 */
export function typeContentMaterial(
	entry: RegistryEntry
): Record<string, unknown> {
	return {
		kind: entry.kind,
		ports: entry.ports,
		slots: stripDisplay(entry.slots),
		effects: entry.effects,
		causesEvent: entry.causesEvent,
		public: entry.public,
		/**
		 * Hashed because flipping it is exactly the change the hash exists to
		 * make visible: the ports do not move, every spec pinning the version
		 * keeps compiling, and the run quietly stops failing (or starts failing)
		 * when the node errors. That is a behaviour change wearing a compatible
		 * signature, and a hash that ignored it would let the slug's pointer sit
		 * still while the meaning moved.
		 *
		 * A type that leaves it unset is unaffected — `JSON.stringify` drops
		 * undefined keys, so only a type that actually declares it hashes
		 * differently.
		 *
		 * `toggleable`, `declaresRandomness` and `earlyExit` are arguably in the
		 * same category and are *not* hashed today. Left alone rather than
		 * widened in passing: each deserves its own ruling, and changing them
		 * would re-hash types this branch has no reason to touch.
		 */
		optional: entry.optional,
		/**
		 * Hashed for the same reason `optional` is. Flipping a script type from
		 * `transform` to `verdict` moves no port and keeps every attachment
		 * compiling, while turning "each link rewrites the text" into "the
		 * earliest answer wins" — a behaviour change wearing a compatible
		 * signature — the change the hash exists to make visible.
		 *
		 * `undefined` on node types, and `JSON.stringify` drops undefined keys,
		 * so no node type's hash moves by this being here.
		 */
		semantics: entry.semantics,
		/**
		 * Hashed on the S3 argument, one construct over (18 §4e): a point
		 * appearing or vanishing changes what an untouched spec's configuration
		 * can reach — the panel offers a chain option per point, and the broker
		 * refuses undeclared names. Keys are contract; the sort strips their
		 * `i18n`/`description` like everywhere else. Undefined on types that
		 * declare none, so nothing else re-hashes.
		 */
		scriptPoints: entry.scriptPoints,
		/**
		 * The session-shape contract (19 §1), hashed for the reason the doc
		 * states in the `optional` register: widening `characters.max` changes
		 * what existing sessions legally contain while every pin keeps
		 * compiling. Display inside it is stripped by the sort like
		 * everywhere; undefined on every non-mode type, so nothing else
		 * re-hashes.
		 */
		sessionShape: entry.sessionShape,
		/**
		 * The entry-row contract, hashed whole (Part 1).
		 *
		 * Field roles decide where a row competes for budget, how its siblings sort,
		 * who may see it and where it renders — so moving one changes what an
		 * untouched install does while every pin keeps resolving, which is the
		 * shape of silent change this rule exists to stop. The consequence is
		 * intended and stated in the SDK: **changing a field role forces `@N+1`.**
		 *
		 * Stripped like everything else, so a label inside it stays free to
		 * change; `undefined` on every non-entry type, so nothing else
		 * re-hashes.
		 */
		entryShape: stripDisplay(entry.entryShape),
		/**
		 * The declared schema of an entry's type-specific half.
		 *
		 * Hashed because the constraint projection makes it unavoidable: this
		 * schema *becomes* a database CHECK, so a schema change is a constraint
		 * change, and the version bump is what drops the old constraint and
		 * adds the new one. Display text inside it is stripped, which is what
		 * keeps copyediting a field's label off the version.
		 *
		 * The column has existed and been NULL since the table was created;
		 * `undefined` for every type that declares nothing, so no existing hash
		 * moves by this being here.
		 */
		configSchema: stripDisplay(entry.configSchema)
	}
}

function hashMaterial(material: unknown): string {
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

/** A stable hash of everything about a type that a spec can depend on. */
export function typeContentHash(entry: RegistryEntry): string {
	return hashMaterial(typeContentMaterial(entry))
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
 * `type_id`, `version`, `owner_plugin_id` and `transport` are deliberately
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
		isPublic: entry.public ?? false,
		release
	}
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
		.select({ id: schema.pipelineTypeDeclarations.id })
		.from(schema.pipelineTypeDeclarations)
		.where(
			and(
				eq(schema.pipelineTypeDeclarations.typeId, entry.id),
				eq(schema.pipelineTypeDeclarations.version, entry.version),
				eq(schema.pipelineTypeDeclarations.contentHash, hash)
			)
		)
		.limit(1)
	if (seen) return false

	await db.insert(schema.pipelineTypeDeclarations).values({
		typeId: entry.id,
		version: entry.version,
		kind: entry.kind,
		contentHash: hash,
		material: typeContentMaterial(entry) as Record<string, any>,
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
 * the hash it was published under, and `readTypeRegistry` reconstructs the
 * declaration from the row losslessly (the round trip is pinned by
 * `registrySync.int.test.ts`). So the first boot after the migration adopts each
 * existing row from the row itself.
 *
 * ⚠ **An adopted row keeps the hash the registry row carried; it is never
 * recomputed here.** That string is what anything pinning this declaration would
 * have named, and recomputing it under a build whose strip has since widened
 * would archive the declaration under a hash nothing ever used — which is the
 * one thing an archive must not do.
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

/**
 * Project descriptors into rows.
 *
 * Idempotent by construction: same code, same rows, no writes on the second
 * run. That property is what lets this run unconditionally at boot instead of
 * behind a "have we migrated yet" flag, which is a flag that eventually lies.
 */
export async function syncTypeRegistry(
	db: Db,
	// Script types ride the same sync (18 §2). `snapshotRegistry` branches on
	// the id, so everything below this line is unaware there are two kinds of
	// declaration — which is the property that keeps publishing one rule.
	descriptors: Array<Descriptor | ScriptTypeDecl>,
	opts: { release: string; ownerPluginId?: number } = { release: "dev" }
): Promise<SyncResult> {
	const entries = snapshotRegistry(descriptors, { release: opts.release })
	const result: SyncResult = {
		inserted: [],
		updated: [],
		unchanged: [],
		republished: []
	}

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
			await archiveDeclaration(db, entry, hash, opts.release, "declared")
			await db.insert(schema.pipelineTypeRegistry).values({
				typeId: entry.id,
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
				.update(schema.pipelineTypeRegistry)
				.set({
					...projectedColumns(entry, opts.release),
					contentHash: hash
				})
				.where(eq(schema.pipelineTypeRegistry.id, row.id))
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
		if (
			configSchemaChanged ||
			slotsChanged ||
			optionalChanged ||
			i18nChanged ||
			pointsChanged ||
			row.release !== opts.release
		) {
			await db
				.update(schema.pipelineTypeRegistry)
				.set({
					release: opts.release,
					...(optionalChanged
						? { optional: entry.optional ?? false }
						: {}),
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
				.where(eq(schema.pipelineTypeRegistry.id, row.id))
			if (slotsChanged || configSchemaChanged) {
				result.updated.push(pin)
				continue
			}
		}
		result.unchanged.push(pin)
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
	return rows.map(rowToEntry)
}

/**
 * One registry row, back as the declaration it was projected from.
 *
 * Its own function because two callers need it and they need it to agree:
 * `readTypeRegistry` hands it to install validation, and `adoptCurrent` hands it
 * to the archive. If the second reconstructed a declaration the first would not,
 * an adopted row's material would describe something no reader ever saw.
 */
function rowToEntry(r: any): RegistryEntry {
	return {
		id: r.typeId,
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
		// ⚠ `|| undefined`, matching `optional` two lines up, and for a reason
		// the round-trip test found rather than reasoned about: the column is
		// `NOT NULL DEFAULT false`, so a type that never declared `public`
		// comes back as `false` where the projection had `undefined`.
		// `JSON.stringify` keeps `false` and drops `undefined`, so the same row
		// hashed differently depending on which direction it was travelling.
		public: r.isPublic || undefined,
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
}

/** `plugin:<plugin id>:<declared slug>` — the idempotence key, never a row id. */
const presetSeedKey = (pluginId: string, slug: string) =>
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
 * ## What is deliberately dropped
 *
 * A declared binding's `config` is a **config slug** in the package's own
 * namespace; the column holds a `pipeline_configs.id`, which is an instance
 * fact. There is no projection of plugin configs to resolve it against, so the
 * binding lands without one and the spec's shipped default applies —
 * `CORE_PRESET_SEEDS` states the same rule for core's own presets. A preset that
 * silently pointed at the wrong config row would be worse than one that points
 * at the default.
 */
export async function syncPluginPresets(
	db: Db
): Promise<PluginPresetSyncReport> {
	const report: PluginPresetSyncReport = {
		projected: [],
		withdrawn: [],
		restored: []
	}

	const plugins = await db.select().from(schema.plugins)
	const declared = new Map<
		string,
		{ ownerId: number; decl: Record<string, any> }
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
				decl
			})
		}
	}

	const rows = await db.select().from(schema.sessionPresets)
	const bySeedKey = new Map(
		(rows as any[]).filter((r) => r.seedKey).map((r) => [r.seedKey, r])
	)

	for (const [seedKey, { ownerId, decl }] of declared) {
		const bindings: Record<string, { spec: string }> = {}
		for (const [event, b] of Object.entries(decl.bindings ?? {}))
			if (b && typeof (b as any).spec === "string")
				bindings[event] = { spec: (b as any).spec }

		const projected = {
			name: typeof decl.label === "string" ? decl.label : decl.slug,
			description:
				typeof decl.description === "string" ? decl.description : null,
			genreId: decl.genre as string,
			bindings,
			includedActions: Array.isArray(decl.actions?.include)
				? (decl.actions.include as string[])
				: null,
			defaults: (decl.defaults as Record<string, unknown>) ?? null,
			ownerPluginId: ownerId
		}

		const existing = bySeedKey.get(seedKey)
		if (!existing) {
			await db.insert(schema.sessionPresets).values({
				seedKey,
				...projected,
				enabled: decl.enabled === true
			})
			report.projected.push(seedKey)
			continue
		}
		// A row under this key that a plugin does not own is not this sync's to
		// write. It can only happen if somebody created one by hand at the same
		// seed key, and taking it over would silently replace their preset.
		if (existing.ownerPluginId !== ownerId) continue

		if (existing.withdrawnAt) report.restored.push(seedKey)
		await db
			.update(schema.sessionPresets)
			.set({ ...projected, withdrawnAt: null })
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
