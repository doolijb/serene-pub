/**
 * Installing a built plugin package into this instance (D-6).
 *
 * `plugins:install` takes a bundle and a manifest over the wire and stores
 * them; **nothing projected the manifest's declarations into the registries a
 * person actually meets**. A package could ship a genre, its pipelines, a
 * preset that binds them and the prose they read, and an administrator would
 * find a row in the plugin list and nothing else: no picker card, no spec to
 * run, no config to choose. This module is that projection, and the dev install
 * that exercises it from a folder on disk.
 *
 * ## What a projection is, per declaration
 *
 * - **genres** — a genre has no table. It IS its create pipeline's published
 *   version row: `input_genre`, `input_event = session-created`, and the
 *   declaration in the `genre` column (`sessionGenres.listSessionGenres`). So
 *   projecting a genre means saving that document with the declaration on it,
 *   and the only work here is supplying the declaration for a package whose
 *   author did not repeat it in `meta.genre`.
 * - **pipelines** — `saveDocument(…, { sourcePluginId, publish: true })`. The
 *   column existed and no caller had ever written it.
 * - **configs** — `pipeline_configs`, keyed `plugin:<id>:<spec>#<slug>` (a
 *   config slug is unique per spec, not per package), the key
 *   `syncPluginPresets` resolves a binding's config through. The table has no owner column and does
 *   not need one: a config over the package's OWN spec is owned transitively
 *   (`spec_id → pipeline_specs.source_plugin_id`) and dies with it, and a
 *   config over somebody else's spec — which is legitimate, and the one thing
 *   the packager puts in `requires` — is found and removed by the seed key.
 * - **prompts** — translated to the template-seed vocabulary and projected by
 *   `syncPluginTemplates`, which already owns `pipeline_prompts.owner_plugin_id`
 *   and the withdrawal marks. Projecting them here as well would have that sync
 *   withdraw them on its next pass.
 * - **presets** — `syncPluginPresets`, unchanged. It reads `manifest.presets`.
 * - **surfaces** — nothing to project: `frameHost.surfacesOf` reads the stored
 *   manifest. What install does is store the package's client FILES, which is
 *   what makes `frameSrc` resolve to something.
 *
 * The split is not arbitrary. Presets, prompts and layouts are **reconciled
 * from the manifest on every sync**, so they follow the enable switch and come
 * back after an instance was down. Specs and configs cannot be: the documents
 * do not live in the manifest, so there is nothing to reconcile them from once
 * the folder is gone. They are written at install and removed at uninstall.
 *
 * ## Uninstall removes what install wrote, **explicitly**
 *
 * `cullPluginProjection` deletes the package's configs by seed key and its
 * specs by `source_plugin_id`; everything under a spec (versions, nodes, edges,
 * its own configs and their values) goes with it by FK cascade. It is scoped by
 * the plugin's row id and by the seed-key prefix, so it can reach nothing the
 * install did not write. Prompts, presets and layouts are not touched here —
 * they are marked withdrawn by their own syncs once the plugin row is gone,
 * which is deliberate: a session names its preset, and deleting the row would
 * leave it pointing at nothing.
 */

import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { and, eq, inArray, isNotNull, isNull, like, ne, or } from "drizzle-orm"
import { i18nText } from "@serene-pub/sdk"
import type { I18n, SpecDocument } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import {
	assertInstallSlashNamesFree,
	saveDocument
} from "$lib/server/pipelines/boot/store"
import {
	legacyPluginConfigSeedKey,
	pluginConfigSeedKey,
	projectObjectVariableLayouts,
	syncDefinitionRegistry
} from "$lib/server/pipelines/boot/registrySync"
import {
	pluginDeclarationsOf,
	registerPluginDefinitions
} from "./pluginDefinitions"
import { registerPluginEvents } from "./pluginEvents"
import { registerPluginAnnex } from "./pluginAnnex"
import { registerPluginVariables } from "./pluginVariables"
import { storePluginFiles } from "./frameHost"
import {
	readPluginPackage,
	PLUGIN_BUILD_DIR,
	type PluginPackage,
	type PluginPackageManifest
} from "./pluginPackage"
import { missingRequirements, requirementsOf } from "./requirements"
import { upsertPlugin } from "./store"

/** The event a genre's one required member answers (24 §3). */
const SESSION_CREATED = "core:event/session-created@1"

/**
 * A projected config's storage identity — `plugin:<id>:<spec>#<slug>` — and the
 * only handle the cull has on a config over a spec this package does not own.
 * Defined beside `presetSeedKey` in `registrySync.ts`, whose preset sync
 * resolves a binding's config through it; re-exported for this module's readers.
 */
export { pluginConfigSeedKey }

export interface PluginProjectionReport {
	/** Spec slugs saved, in manifest order. */
	specs: string[]
	/** Genre ids whose declaration this install supplied to the create document. */
	genresDeclared: string[]
	/** Config seed keys written. */
	configs: string[]
	/**
	 * Node definition pins projected into `pipeline_definition_registry` under
	 * this package's ownership (D-6b).
	 */
	definitions: string[]
	/** Declarations refused, one sentence each. Never fatal: the rest still lands. */
	refused: string[]
}

export interface InstallPluginPackageReport extends PluginProjectionReport {
	pluginId: string
	/** Client files stored, and the paths refused as unservable. */
	files: { stored: number; refused: string[] }
	/**
	 * Said out loud rather than hidden, because it decides whether the
	 * package's handlers can run at all: a package built by a packager that
	 * writes no sandbox bundle installs its declarations and none of its code.
	 */
	warnings: string[]
	/**
	 * Whether the plugin was switched on before this install wrote its row —
	 * what tells the caller a running plugin was just switched off by it
	 * (a replaced bundle arrives disabled), and so owes it a `disable`.
	 */
	wasEnabled: boolean
}

/**
 * The bundle a package ships for the sandbox, if it ships one.
 *
 * `dist/plugin/bundle.js` is the one path this looks at, on purpose, not a
 * guess at a package's own `main`: an unbundled ESM entry would load in no
 * sandbox, and installing it as if it were a bundle would turn a missing
 * artifact into a runtime failure with no explanation. `serene-pub build`
 * writes exactly that path (D-6b), and refuses to build a package that
 * declares callables and cannot bundle them.
 *
 * Absent is still not fatal: a package built by an older CLI, or one that
 * declares no callables at all, installs its declarations — `warnings` says so
 * when there were handlers to run.
 */
async function readBundle(dir: string): Promise<string> {
	try {
		return await readFile(join(dir, PLUGIN_BUILD_DIR, "bundle.js"), "utf8")
	} catch {
		return ""
	}
}

/** The display name a spec row carries — the id's own name segment. */
const specDisplayName = (specId: string): string =>
	specId.split("/").pop() || specId

/**
 * The genre declaration the manifest carries, as the document's `genre` block.
 *
 * `listSessionGenres` reads name, description, family, shape, events and
 * envoys off the create spec's version row, and the row gets them from the
 * document. An author states them twice today (`genre()` and the spec's
 * `meta.genre`) and both showcase packages do; a package that states them once
 * would otherwise project a genre with no name, which renders a blank picker
 * card rather than failing. So the manifest's declaration is used where the
 * document has none — and never over one, because the author's own statement
 * on the document is the more specific of the two.
 */
function genreBlockFor(
	manifest: PluginPackageManifest,
	genreId: string
): Record<string, unknown> | undefined {
	const decl = (manifest.genres ?? []).find((g) => g?.id === genreId)
	if (!decl) return undefined
	const block: Record<string, unknown> = {}
	for (const key of ["name", "description", "family", "shape", "events", "envoys"])
		if (decl[key] !== undefined) block[key] = decl[key]
	return Object.keys(block).length ? block : undefined
}

/**
 * Hand the rows a previous install of this slug left behind to the row that
 * owns the slug now.
 *
 * `session_presets` and the three template tables store their owner as
 * `plugins.id` — an identity value, so uninstalling and installing again gives
 * the same package a **different** number. Their syncs compare that number and
 * skip a row they do not own, which is the right rule against a row somebody
 * made by hand and the wrong answer here: the withdrawn preset and prompt the
 * package itself left would never come back, and the withdrawal marks that
 * exist so a session keeps naming its preset would turn into a one-way door.
 *
 * Scoped by the slug the row's own natural key carries — `plugin:<slug>:…` on a
 * preset, `<slug>:template/…` on a template — so this can only reach rows this
 * package named after itself. The slug is plugin identity (ruled 2026-09-17)
 * and the integer is a cache of it; where they disagree, the slug is right.
 */
async function adoptPriorRows(
	db: Db,
	pluginId: string,
	ownerId: number
): Promise<void> {
	await db
		.update(schema.sessionPresets)
		.set({ ownerPluginId: ownerId })
		.where(
			and(
				like(schema.sessionPresets.seedKey, `plugin:${pluginId}:%`),
				isNotNull(schema.sessionPresets.ownerPluginId),
				ne(schema.sessionPresets.ownerPluginId, ownerId)
			)
		)
	for (const table of [
		schema.pipelinePrompts,
		schema.pipelineContextTemplates,
		schema.pipelineVariableTemplates
	])
		await db
			.update(table as any)
			.set({ ownerPluginId: ownerId })
			.where(
				and(
					like(table.templateId, `${pluginId}:template/%`),
					isNotNull(table.ownerPluginId),
					ne(table.ownerPluginId, ownerId)
				)
			)
}

/**
 * Project the package's node definitions into `pipeline_definition_registry`,
 * owned by this package (D-6b).
 *
 * The same sync core's own boot runs (`syncDefinitionRegistry`), over the
 * declarations the manifest carries — so a plugin's definition is published,
 * hashed, archived and reverse-diffed by exactly the rules core's are, and a
 * spec naming it resolves. `ownerPluginId` is what makes the row the package's:
 * the sync writes `transport: 'process'` from ownership rather than from any
 * claim the manifest makes, which is what routes the node to the sandbox.
 *
 * ## What it refuses, and why it is a query rather than a namespace rule
 *
 * A declaration whose pin already belongs to somebody else is refused and
 * reported: core's own rows (no owner) and another installed package's. The
 * namespace check in `pluginDeclarationsOf` should already make that
 * impossible; this is the check that does not depend on the package telling
 * the truth about its own slug. A row whose owner is a `plugins.id` that no
 * longer exists is this package's own from a previous install — an uninstall
 * that did not finish — and is adopted rather than refused.
 */
async function projectDefinitions(
	db: Db,
	pkg: PluginPackage,
	ownerId: number,
	report: PluginProjectionReport
): Promise<void> {
	const pluginId = pkg.manifest.slug
	const { declarations, refused } = pluginDeclarationsOf(
		pkg.manifest,
		pluginId
	)
	report.refused.push(...refused)
	if (!declarations.length) return

	const pins = declarations.map((d) => ({ d, ...splitPin(d.id) }))
	const rows = await db
		.select({
			definitionId: schema.pipelineDefinitionRegistry.definitionId,
			version: schema.pipelineDefinitionRegistry.version,
			ownerPluginId: schema.pipelineDefinitionRegistry.ownerPluginId
		})
		.from(schema.pipelineDefinitionRegistry)
		.where(
			inArray(
				schema.pipelineDefinitionRegistry.definitionId,
				pins.map((p) => p.id)
			)
		)
	const owners = new Set(
		(await db.select({ id: schema.plugins.id }).from(schema.plugins)).map(
			(p) => p.id
		)
	)
	const held = new Map(
		rows.map((r) => [`${r.definitionId}@${r.version}`, r.ownerPluginId])
	)

	const mine: typeof pins = []
	for (const p of pins) {
		const owner = held.get(`${p.id}@${p.version}`)
		const taken =
			held.has(`${p.id}@${p.version}`) &&
			owner !== ownerId &&
			(owner == null || owners.has(owner))
		if (taken)
			report.refused.push(
				`node definition '${p.d.id}': a definition under that pin is already ` +
					`published${owner == null ? " by this build" : " by another installed package"}. ` +
					`The declaration was not registered.`
			)
		else mine.push(p)
	}
	if (!mine.length) return

	const synced = await syncDefinitionRegistry(
		db,
		mine.map((p) => p.d),
		{
			// The package's own version is what published this declaration —
			// the same thing `release` means for core's build.
			release: pkg.manifest.version,
			ownerPluginId: ownerId,
			// Everything this package publishes, so a stored definition it does
			// not declare is marked `removed` rather than
			// left standing (the reverse-diff, plans/29 R-2).
			complete: true
		}
	)
	// Ownership, which the sync deliberately never writes on a row that already
	// exists — it identifies the slug rather than declaring anything. A row
	// this package left behind is claimed here, and a fresh one already has it.
	for (const p of mine)
		await db
			.update(schema.pipelineDefinitionRegistry)
			.set({ ownerPluginId: ownerId, transport: "process" })
			.where(
				and(
					eq(schema.pipelineDefinitionRegistry.definitionId, p.id),
					eq(schema.pipelineDefinitionRegistry.version, p.version)
				)
			)
	report.definitions.push(
		...synced.inserted,
		...synced.updated,
		...synced.republished,
		...synced.unchanged
	)

	// And in this process: the executor resolves a node's declaration through
	// the SDK's in-process registry, which holds only what this build imported
	// — see `pluginDefinitions.ts`. Without it the rows are right and the run
	// still halts on `unknown type` before the binding is reached.
	report.refused.push(
		...registerPluginDefinitions(mine.map((p) => p.d)).refused
	)
}

/** `ns:kind/name@2` → its bare id and version, the registry's two columns. */
function splitPin(pin: string): { id: string; version: number } {
	const at = /@(\d+)$/.exec(pin)
	return {
		id: pin.replace(/@\d+$/, ""),
		version: at ? Number(at[1]) : 1
	}
}

/**
 * Project a read package's declarations into this instance's registries.
 *
 * The plugin row must already exist — ownership is `plugins.id`, so there is
 * nothing to attribute a spec to before the install has made one.
 */
export async function projectPluginPackage(
	db: Db,
	pkg: PluginPackage
): Promise<PluginProjectionReport> {
	const report: PluginProjectionReport = {
		specs: [],
		genresDeclared: [],
		configs: [],
		definitions: [],
		refused: []
	}
	const pluginId = pkg.manifest.slug
	const [row] = await db
		.select({ id: schema.plugins.id })
		.from(schema.plugins)
		.where(eq(schema.plugins.pluginId, pluginId))
		.limit(1)
	if (!row)
		throw new Error(
			`cannot project '${pluginId}': it is not installed. The plugin row is what ` +
				`owns every row this writes.`
		)
	const ownerId = row.id
	await adoptPriorRows(db, pluginId, ownerId)

	// Its context variables before anything: a banded definition's
	// `register()` refuses a band whose variable this process does not hold,
	// and law T1 at the publish below types a band from its variable
	// (typed templates, 2026-09-27; `pluginVariables.ts`).
	report.refused.push(...registerPluginVariables(pkg.manifest, pluginId))
	// …and every OBJECT variable's automatic layout row with them (owner
	// ruling 2026-09-27: an object variable is never without a layout). The
	// template sync writes the same seeds on every pass; this is register time.
	report.refused.push(
		...(await projectObjectVariableLayouts(db, pkg.manifest, pluginId, ownerId))
	)
	// Definitions before the documents that place them: a node is declared
	// before a pipeline can name it, and a spec saved against a registry that
	// has not heard of its own package's node is a spec whose notice says so.
	await projectDefinitions(db, pkg, ownerId, report)
	// And its declared events, before a document that locks on or records
	// one is validated (E1b; `pluginEvents.ts`).
	report.refused.push(...registerPluginEvents(pkg.manifest, pkg.manifest.slug))
	// And its annex declaration, before a document writing the annex is
	// validated (ruling 2026-09-26; `pluginAnnex.ts`).
	report.refused.push(...registerPluginAnnex(pkg.manifest, pkg.manifest.slug))

	// The whole set publishes together, so a package that renames a slash name
	// between two of its own specs is not refused one spec at a time.
	const batch = new Set(pkg.documents.map((d) => d.id))

	for (const doc of pkg.documents) {
		const genreId = (doc as any).input?.genre
		const isCreate = (doc as any).input?.event === SESSION_CREATED && !!genreId
		let toSave: SpecDocument = doc
		if (isCreate && !(doc as any).genre) {
			const block = genreBlockFor(pkg.manifest, genreId)
			if (block) {
				toSave = { ...doc, genre: block } as SpecDocument
				report.genresDeclared.push(genreId)
			}
		}
		try {
			await saveDocument(db, toSave, {
				publish: true,
				name: specDisplayName(doc.id),
				sourcePluginId: ownerId,
				batch
			})
		} catch (e) {
			// Per document: one refused spec must not cost the package its
			// others, and the report names what did not land.
			report.refused.push(
				`pipeline '${doc.id}': ${e instanceof Error ? e.message : String(e)}`
			)
			continue
		}
		// `saveDocument` writes `source_plugin_id` only when it INSERTS the spec
		// row, so a package re-installed over a row that predates this path —
		// or over one a previous install left unattributed — would keep a NULL
		// owner and a run would carry none. Forced here, and only onto a row
		// **nobody else owns**: a row already attributed to another package is
		// left exactly as it is and reported, so "install can only take over a
		// spec nobody else owns" is a property of the query rather than of the
		// namespace check that precedes it.
		const [owned] = await db
			.update(schema.pipelineSpecs)
			.set({ sourcePluginId: ownerId })
			.where(
				and(
					eq(schema.pipelineSpecs.slug, doc.id),
					or(
						isNull(schema.pipelineSpecs.sourcePluginId),
						eq(schema.pipelineSpecs.sourcePluginId, ownerId)
					)
				)
			)
			.returning({ id: schema.pipelineSpecs.id })
		if (!owned) {
			report.refused.push(
				`pipeline '${doc.id}': a spec under that id is owned by another installed ` +
					`package. The document was saved; its ownership was not changed.`
			)
			continue
		}
		report.specs.push(doc.id)
	}

	if (report.specs.length) await assertInstallSlashNamesFree(db)

	// Configs. Written here rather than reconciled from the manifest on every
	// sync because a config's values address a spec's nodes, and a spec that
	// failed to save has no nodes to address.
	for (const decl of pkg.manifest.configs ?? []) {
		const specSlug = typeof decl?.spec === "string" ? decl.spec : ""
		const slug = typeof decl?.slug === "string" ? decl.slug : ""
		if (!specSlug || !slug) {
			report.refused.push(`config: an entry names no spec or no slug.`)
			continue
		}
		const [spec] = await db
			.select({ id: schema.pipelineSpecs.id })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, specSlug))
			.limit(1)
		if (!spec) {
			report.refused.push(
				`config '${slug}': no spec '${specSlug}' on this pub. A config over a ` +
					`spec the package does not ship is a requirement, and this one is not met.`
			)
			continue
		}
		const seedKey = pluginConfigSeedKey(pluginId, specSlug, slug)
		const name = i18nText(decl.label as I18n | undefined) || slug
		try {
			let [existing] = await db
				.select({
					id: schema.pipelineConfigs.id,
					isImmutable: schema.pipelineConfigs.isImmutable
				})
				.from(schema.pipelineConfigs)
				.where(eq(schema.pipelineConfigs.seedKey, seedKey))
				.limit(1)
			// ⏳ A row the previous key (`plugin:<id>:<slug>`) wrote is adopted
			// by the config of the spec it sits on, and by no other: that key
			// collided across specs, and the last config declared moved the
			// row onto its own spec. Taking it for a different spec would be
			// the same move again. Remove once no install predates the key.
			if (!existing) {
				const [legacy] = await db
					.update(schema.pipelineConfigs)
					.set({ seedKey })
					.where(
						and(
							eq(
								schema.pipelineConfigs.seedKey,
								legacyPluginConfigSeedKey(pluginId, slug)
							),
							eq(schema.pipelineConfigs.specId, spec.id)
						)
					)
					.returning({
						id: schema.pipelineConfigs.id,
						isImmutable: schema.pipelineConfigs.isImmutable
					})
				existing = legacy
			}
			// A shipped row is immutable — selectable and copyable, never
			// edited in place — so re-forcing it is how an update ships new
			// prose, exactly as core's seeds re-sync on boot. A row under the
			// key that is NOT immutable has been made somebody's; its name
			// and values are theirs, and neither install nor update touches
			// them. A person's own copy has no seed key and is never reached.
			if (existing && !existing.isImmutable) {
				report.configs.push(seedKey)
				continue
			}
			const configId = existing
				? (await db
						.update(schema.pipelineConfigs)
						.set({ specId: spec.id, name, updatedAt: new Date() })
						.where(eq(schema.pipelineConfigs.id, existing.id))
						.returning({ id: schema.pipelineConfigs.id }))[0]!.id
				: (await db
						.insert(schema.pipelineConfigs)
						.values({
							specId: spec.id,
							seedKey,
							name,
							// Shipped, so selectable and copyable but never edited in
							// place — the same posture core's own seeded configs take.
							isImmutable: true,
							isDefault: false
						})
						.returning({ id: schema.pipelineConfigs.id }))[0]!.id

			// Values are replaced wholesale, never merged: a re-install must
			// leave exactly what the package declares, and a merge would keep a
			// deviation the author has since deleted.
			await db
				.delete(schema.pipelineConfigValues)
				.where(eq(schema.pipelineConfigValues.configId, configId))
			const values: Array<{
				configId: number
				nodeKey: string
				slot: string
				path: string
				value: unknown
			}> = []
			for (const [nodeKey, slots] of Object.entries(
				(decl.values ?? {}) as Record<string, Record<string, unknown>>
			))
				for (const [slot, value] of Object.entries(slots ?? {}))
					// Whole-slot values: `ConfigDecl` is nodeKey → slot → value,
					// and `path` is the field WITHIN a slot, which a declaration
					// has no way to name.
					values.push({ configId, nodeKey, slot, path: "", value })
			if (values.length)
				await db.insert(schema.pipelineConfigValues).values(values)
			report.configs.push(seedKey)
		} catch (e) {
			report.refused.push(
				`config '${slug}': ${e instanceof Error ? e.message : String(e)}`
			)
		}
	}

	return report
}

/**
 * Remove what {@link projectPluginPackage} wrote for this plugin, and nothing
 * else. Call it **before** the plugin row goes: ownership is that row's id.
 */
export async function cullPluginProjection(
	db: Db,
	pluginId: string
): Promise<{ specs: string[]; configs: number; definitions: string[] }> {
	const [row] = await db
		.select({ id: schema.plugins.id })
		.from(schema.plugins)
		.where(eq(schema.plugins.pluginId, pluginId))
		.limit(1)
	if (!row) return { specs: [], configs: 0, definitions: [] }

	// Configs first, by seed key: this is the only handle on a config over a
	// spec the package does not own. A config over its OWN spec matches here
	// too and is removed here; the cascade below would have taken it anyway.
	const configs = await db
		.delete(schema.pipelineConfigs)
		.where(like(schema.pipelineConfigs.seedKey, `plugin:${pluginId}:%`))
		.returning({ id: schema.pipelineConfigs.id })

	// Then the specs, by owner. Versions, nodes, edges, clauses, includes,
	// author presets and any remaining configs go with them by FK cascade —
	// which is also why this is scoped by `source_plugin_id` and never by an id
	// prefix: a prefix is a claim a manifest makes, an owner is a row this
	// instance wrote.
	const specs = await db
		.delete(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.sourcePluginId, row.id))
		.returning({ slug: schema.pipelineSpecs.slug })

	/**
	 * And the definitions this package published, by owner (D-6b).
	 *
	 * **Deleted, where core's are only ever marked `removed`.** The reason
	 * core keeps a withdrawn row is that a stored spec still pins it and the
	 * row is the only place that pin's meaning survives; a plugin's row cannot
	 * do that job, because ownership is `plugins.id` and the row about to be
	 * deleted is what the column points at. A kept row would name an owner
	 * that does not exist — and the moment the package is installed again it
	 * would name the WRONG one, since a re-install is a new identity value, so
	 * every run of its own node would answer "belongs to an uninstalled
	 * extension". The declaration itself is not lost: the archive
	 * (`pipeline_definition_declarations`) keeps it under its hash, which is
	 * what anything pinning it named.
	 */
	const definitions = await db
		.delete(schema.pipelineDefinitionRegistry)
		.where(eq(schema.pipelineDefinitionRegistry.ownerPluginId, row.id))
		.returning({
			definitionId: schema.pipelineDefinitionRegistry.definitionId,
			version: schema.pipelineDefinitionRegistry.version
		})

	return {
		specs: specs.map((s) => s.slug),
		configs: configs.length,
		definitions: definitions.map((d) => `${d.definitionId}@${d.version}`)
	}
}

/**
 * Install the package built in `dir` — read it, hold it to this instance's
 * requirements, store it, and project what it declares.
 *
 * Shared by the admin socket handler and the CLI so a dev install is the same
 * install either way. The caller decides consent and gating: this function
 * neither checks `pluginsEnabled()` nor asks who is running it.
 */
export async function installPluginPackage(
	db: Db,
	dir: string
): Promise<InstallPluginPackageReport> {
	const pkg = await readPluginPackage(dir)
	const pluginId = pkg.manifest.slug
	const warnings: string[] = []

	// What the package references and does not ship must exist here (24 §10,
	// T7b) — the same gate `plugins:install` runs, before anything is written.
	const missing = await missingRequirements(db, requirementsOf(pkg.manifest))
	if (missing.length)
		throw new Error(
			`'${pluginId}' requires ${missing.join(", ")} — not installed on this ` +
				`pub. Install what it builds on first.`
		)

	// A custom pipeline must include a default preset (owner ruling
	// 2026-10-02): a genre the package declares with no preset for it has
	// pipelines nobody can start a session on, and the Pipelines view lists a
	// genre's pipelines only under its presets. The SDK refuses this at
	// packaging; a manifest built before that rule is refused here, in the
	// same sentence.
	{
		const { genrePresetFindings } = await import("@serene-pub/sdk")
		const problems = genrePresetFindings(
			((pkg.manifest as any)?.genres ?? []) as any[],
			((pkg.manifest as any)?.presets ?? []) as any[]
		)
		if (problems.length)
			throw new Error(`'${pluginId}' cannot install: ${problems.join("; ")}`)
	}

	// Swap contributions (R29): the target node and the fit are this
	// instance's to check, before anything is written.
	{
		const { swapContributionProblems } = await import("$lib/server/plugins/swaps")
		const problems = await swapContributionProblems(db, pkg.manifest as any)
		if (problems.length)
			throw new Error(`'${pluginId}' cannot install: ${problems.join("; ")}`)
	}

	const bundleSource = await readBundle(pkg.dir)
	if (!bundleSource && (pkg.manifest as any).hooks?.handlers?.length)
		warnings.push(
			`'${pluginId}' declares ${(pkg.manifest as any).hooks.handlers.length} handler(s) and ` +
				`ships no sandbox bundle, so its own node definitions will not dispatch. ` +
				`Its declarations — genre, pipelines, configs, prompts, surfaces — install ` +
				`regardless.`
		)

	const [prior] = await db
		.select({ enabled: schema.plugins.enabled })
		.from(schema.plugins)
		.where(eq(schema.plugins.pluginId, pluginId))
	await upsertPlugin(db, {
		pluginId,
		name: i18nText(pkg.manifest.name as I18n | undefined) || pluginId,
		version: pkg.manifest.version,
		bundleSource,
		bundleHash: createHash("sha256").update(bundleSource, "utf8").digest("hex"),
		// Conformance is what compiles this list from a bundle, and there is no
		// bundle to run. QuickJS is the floor every install starts on; a real
		// bundle re-derives it through `plugins:install`.
		backends: ["quickjs"],
		manifest: pkg.manifest as Record<string, unknown>
	})

	const files = await storePluginFiles(db, pluginId, pkg.files)
	if (files.refused.length)
		warnings.push(
			`client files refused as unservable paths: ${files.refused.join(", ")}`
		)

	const projection = await projectPluginPackage(db, pkg)
	return {
		pluginId,
		files,
		warnings,
		wasEnabled: !!prior?.enabled,
		...projection
	}
}
