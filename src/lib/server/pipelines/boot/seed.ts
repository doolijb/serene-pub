/**
 * What core seeds into the pipeline tables, and the rule each kind seeds under.
 *
 * Three kinds of thing land here, and they are not the same kind of thing at
 * all — which is why they get three functions rather than one `seed()`:
 *
 * | kind | what it is | what a changed declaration does |
 * |---|---|---|
 * | the definition registry | a *fact about the running code* | publishes under a new hash, and the slug's pointer moves (`registrySync.ts`) |
 * | the event registry | a *fact about the running code* | overwrites the row, because nothing pins an event |
 * | core's spec documents | *content* | publishes as a new version row, and the slug's pointer moves |
 *
 * The definition registry's rule lives in `registrySync.ts` because that is where
 * the archive is. The other two live here.
 *
 * ⚠ The first and third are one rule under two names: **a slug resolves to a
 * content hash, and publishing moves the pointer** (ruling 2026-09-10). What
 * makes them look like separate rules is that one archives declarations and the
 * other archives documents.
 *
 * ## Why the spec list is a registry rather than an array in `bootstrap`
 *
 * It was two collections that had to agree: an array of builders and a
 * `SPEC_NAMES` map keyed by slug. Adding a pipeline meant editing both, and
 * forgetting the second published a spec whose display name was its slug — a
 * failure that shows up in the user's sidebar rather than in a test. One row per
 * pipeline makes that unrepresentable.
 */

import {
	allDefinitions,
	allEvents,
	canonicalHash,
	i18nText,
	sessionEvents,
	type SpecDocument
} from "@serene-pub/sdk"
import { and, asc, eq, inArray, ne, or } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { CORE_SPECS } from "$lib/server/pipelines/specs"
import { reconcileConfigs } from "$lib/server/pipelines/config/named"
import { seedPipelinePrompts } from "$lib/server/pipelines/boot/seedPrompts"
import { reconcilePromptFields } from "$lib/server/pipelines/boot/reconcilePromptFields"
import { parseActionIdentity } from "$lib/shared/actions/identity"

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

/**
 * A core event, as the SDK defines it — `pipeline_event_registry` is a
 * **projection of `CORE_EVENTS`** and of nothing else (R-4, ruled 2026-09-15,
 * landed 2026-09-16). This file kept its own list until then — `UNCAUSED_EVENTS`
 * plus a derivation off `causesEvent` — and the two disagreed about
 * `session-created`'s family (plans/29a §4). One registry now: the genre's
 * session events and the data events core's outlets cause are all
 * `defineEvent`s in `@serene-pub/sdk`, and this reads them.
 *
 * `affectsUser` is the load-bearing field: 11 §4 makes consent enforceable
 * *without hand-classifying every subscription* by declaring it once, on the
 * event. An event that touches somebody's content is marked there and every
 * subscription to it inherits the consequence.
 */
export interface CoreEvent {
	slug: string
	version: number
	/**
	 * DATA events describe a change and carry write targets, so they take part in
	 * the cycle check. ACTION events have no write targets and drop out of it by
	 * construction rather than by exception (13 §7g).
	 */
	family: "data" | "action"
	affectsUser: boolean
	description: string
	/**
	 * The shape id of what a listener receives (`core:shape/session-change@1`),
	 * when the SDK declares one — projected into `payload_shape` as
	 * `{ shape }`. Null for an event whose payload is still prose.
	 */
	payload: string | null
}

/**
 * The core event set, read off the SDK's registry. `slug` is the id without
 * its version (`core:event/message-created`), which is how the row keys it.
 *
 * A DATA event an outlet declares as `causesEvent` but the SDK does not define
 * is refused here rather than invented: the registry is one list, and a cause
 * naming an event outside it is a declaration error, not a row to synthesise.
 */
export function coreEvents(): CoreEvent[] {
	const out = allEvents().map<CoreEvent>((e) => ({
		slug: `core:event/${e.slug}`,
		version: e.version,
		family: e.family,
		affectsUser: e.affectsUser,
		description: e.description,
		payload: e.payload ?? null
	}))
	const known = new Set(out.map((e) => `${e.slug}@${e.version}`))
	for (const d of allDefinitions()) {
		if (!d.causesEvent) continue
		if (!known.has(d.causesEvent))
			throw new Error(
				`${d.id} causes ${d.causesEvent}, which CORE_EVENTS does not define. ` +
					`The event registry is one list (R-4): add the event to the SDK's ` +
					`CORE_EVENTS or drop the cause.`
			)
	}
	return out.sort((a, b) =>
		a.slug === b.slug ? a.version - b.version : a.slug.localeCompare(b.slug)
	)
}

export interface EventSyncResult {
	inserted: string[]
	updated: string[]
	unchanged: string[]
	/** Rows for events outside the SDK's set — a projection has no strays. */
	removed: string[]
}

/**
 * Project the core event set into rows.
 *
 * Unlike the definition registry, this **updates on change rather than refusing**,
 * and the difference is not an inconsistency. A definition version is a *pin*: a spec
 * names `assemble@2` and every run resolves that name, so rewriting the row
 * changes what an approved spec does. Nothing pins an event's description or its
 * `affects_user` flag — a subscription names the event, and the row is core
 * describing itself. Refusing here would mean a corrected description could
 * never ship without a version bump nobody can act on.
 *
 * The one field where that reasoning would fail is `payload_shape`, which a
 * subscription's shape-compatibility check reads. It carries the SDK's
 * declared `payload` shape id where an event has one (the built-in writes'
 * events, R-15) and stays NULL where none is declared, rather than being
 * written speculatively.
 */
export async function syncEventRegistry(db: Db): Promise<EventSyncResult> {
	const result: EventSyncResult = {
		inserted: [],
		updated: [],
		unchanged: [],
		removed: []
	}

	const events = coreEvents()
	// A projection carries exactly its source: a row for an event the SDK has
	// stopped defining is deleted, because nothing pins an event row (see
	// below) and a stray would offer the panel a subscription to nothing.
	const wanted = new Set(events.map((e) => e.slug))
	const existing = await db
		.select({ id: schema.pipelineEventRegistry.id, slug: schema.pipelineEventRegistry.slug })
		.from(schema.pipelineEventRegistry)
	for (const row of existing) {
		if (wanted.has(row.slug)) continue
		await db
			.delete(schema.pipelineEventRegistry)
			.where(eq(schema.pipelineEventRegistry.id, row.id))
		result.removed.push(row.slug)
	}

	for (const event of events) {
		const pin = `${event.slug}@${event.version}`
		const [row] = await db
			.select()
			.from(schema.pipelineEventRegistry)
			.where(eq(schema.pipelineEventRegistry.slug, event.slug))
			.limit(1)

		const values = {
			slug: event.slug,
			version: event.version,
			family: event.family,
			affectsUser: event.affectsUser,
			descriptionI18n: { en: event.description },
			// The one field the header said would stay NULL "until something
			// populates it": the SDK's `EventDef.payload` does, since the
			// built-in writes' events (R-15, 2026-09-16).
			payloadShape: event.payload ? { shape: event.payload } : null
		}

		if (!row) {
			await db.insert(schema.pipelineEventRegistry).values(values)
			result.inserted.push(pin)
			continue
		}

		const same =
			row.version === event.version &&
			row.family === event.family &&
			row.affectsUser === event.affectsUser &&
			(row.descriptionI18n as { en?: string } | null)?.en ===
				event.description &&
			((row.payloadShape as { shape?: string } | null)?.shape ?? null) ===
				(event.payload ?? null)

		if (same) {
			result.unchanged.push(pin)
			continue
		}

		await db
			.update(schema.pipelineEventRegistry)
			.set(values)
			.where(eq(schema.pipelineEventRegistry.id, row.id))
		result.updated.push(pin)
	}

	return result
}

/* ------------------------------------------------------------------ *
 * Specs
 * ------------------------------------------------------------------ */

export interface SpecSeedReport {
	id: string
	version: string
	action: "published" | "present"
	/**
	 * What publishing did to configs somebody had already tuned. Empty on a
	 * fresh install and on any boot that published nothing new.
	 */
	reconciled: Array<{
		name: string
		culled: number
		backfilled: number
	}>
}

/**
 * Publish core's specs, once per document.
 *
 * Matched on the authored slug, semver **and canonical hash** rather than on a
 * row id, so this answers *"is this build's document the one this instance
 * resolves that slug to"* identically on a fresh install and on one upgraded
 * four times.
 *
 * ## Why the hash is in the match (ruling 2026-09-10)
 *
 * A published version is immutable by construction (F3), and matching on
 * `(slug, semver)` alone therefore makes an edit under an unchanged semver
 * unreachable: the pair already exists, the pass skips, and the instance keeps
 * running a document the code does not describe, silently. The 0.6 version
 * freeze leaves editing in place as the only way to ship a spec change, so that
 * is not an edge case.
 *
 * With the hash in the match, the edited document lands as a new row, the row it
 * supersedes stays for the receipts naming it, and the slug's pointer moves —
 * which is what carries the edit to an install. Immutability is untouched; what
 * the pointer resolves to is what moves.
 */
export async function seedCoreSpecs(db: Db): Promise<SpecSeedReport[]> {
	const { saveDocument, assertInstallSlashNamesFree } = await import(
		"$lib/server/pipelines/boot/store"
	)
	const out: SpecSeedReport[] = []
	/**
	 * The batch (U5c review, S2): every slug this build republishes. Each
	 * publish below checks its slash names against the install *minus* these
	 * — a release swapping two names between two core specs would otherwise
	 * be refused on whichever landed first, against the other's old claim —
	 * and the install-wide rule runs once, after the loop, where the new
	 * claims meet.
	 */
	const docs = CORE_SPECS.map((entry) => ({ entry, doc: entry.build() }))
	const batch: ReadonlySet<string> = new Set(docs.map(({ doc }) => doc.id))

	// Four passes, in the only order where each step's inputs already exist.
	// The reason for the ordering changed with the pool: a prompt used to be
	// namespaced to a spec row, so it needed the spec published first. It is
	// now keyed by a NODE TYPE the registry sync has already published, which
	// is why publishing comes first for a different reason — the config in pass
	// 4 reads a spec's declarations, and pass 2 resolves `createdForSpec` into
	// a grouping id. Interleaving per-spec would still be wrong: one pool
	// serves several pipelines, so a per-spec loop would visit the summarize
	// pools four times and seed the first arrival as though it owned them.

	// 1 — publish
	for (const { entry, doc } of docs) {
		// Whether this instance already resolves the slug to *this* document —
		// the row exists AND the spec's pointer is on it. Both halves: a hash
		// this instance stored under an earlier boot but has since moved off is
		// present without being current, and republishing it is a pointer move.
		const [current] = await db
			.select({ id: schema.pipelineSpecVersions.id })
			.from(schema.pipelineSpecVersions)
			.innerJoin(
				schema.pipelineSpecs,
				eq(schema.pipelineSpecVersions.specId, schema.pipelineSpecs.id)
			)
			.where(
				and(
					eq(schema.pipelineSpecs.slug, doc.id),
					eq(schema.pipelineSpecVersions.semver, doc.version),
					eq(
						schema.pipelineSpecVersions.canonicalHash,
						canonicalHash(doc)
					),
					eq(
						schema.pipelineSpecVersions.id,
						schema.pipelineSpecs.activeVersionId
					)
				)
			)
			.limit(1)

		const action = current ? "present" : "published"
		// The row's name column is text: the catalogue's display text resolved
		// to `en` through the SDK's one resolver (R-20); the slug is the
		// fallback the type makes unreachable.
		const name = i18nText(entry.name) ?? doc.id
		if (action === "published")
			await saveDocument(db, doc, {
				publish: true,
				name,
				batch
			})
		else {
			// The display name is display, not content: a copyedit in the
			// catalog reaches existing installs without a version bump —
			// the same rule the definition registry applies to i18n.
			await db
				.update(schema.pipelineSpecs)
				.set({ name })
				.where(
					and(
						eq(schema.pipelineSpecs.slug, doc.id),
						ne(schema.pipelineSpecs.name, name)
					)
				)
			// `pipeline_nodes.expose` (0155, R28) arrived after documents
			// already carried the mark: a version stored in between is
			// "present" under the right hash with the column NULL, which
			// would leave its nodes un-swappable forever. Healed here, only
			// where a stored node disagrees with the document.
			await healNodeExpose(db, current!.id, doc)
			// `pipeline_clauses.parent_clause_chain` (0184, lair pass F2)
			// likewise: a version stored before it is "present" with every
			// nested clause's chain NULL, and such a clause never runs.
			await healClauseChains(db, current!.id, doc)
		}

		out.push({
			id: doc.id,
			version: doc.version,
			action,
			reconciled: []
		})
	}
	// One slash name means one function across the install — checked once,
	// now that every spec of this build is where it will stay.
	await assertInstallSlashNamesFree(db)

	// 2 — the prompts each pool ships
	await seedPipelinePrompts(db)

	// 3 — the archive sweep, between the seed and the configs on purpose.
	//
	// After the seed because it sweeps every prompt row including the ones just
	// written; before the configs because a config's back-fill picks a prompt
	// per pool, and a pool half-swept would offer a row whose declared fields
	// are still mixed with fields nothing declares.
	await reconcilePromptFields(db)

	// 4 — configs, which reference them
	//
	// Runs for present specs as well as published ones, and that is the point:
	// it establishes the shipped-config invariant on an instance upgraded from
	// before configs existed, which no publish would ever trigger.
	const reconciled = await reconcilePublishedConfigs(db)
	for (const report of out)
		report.reconciled = reconciled.get(report.id) ?? []

	return out
}

/**
 * Establish the config invariant for **every published spec**, core's or not.
 *
 * ## The gap this closes
 *
 * `ensureDefaultConfig` guarantees that every pipeline has a shipped, immutable
 * default — the row every other config is derived from and reconciled against —
 * and it is reached from exactly one place: `reconcileConfigs`. Which, until
 * this, was called only from `seedCoreSpecs`, over `CORE_SPECS`. So a plugin's
 * pipeline or an imported document had **no configuration at all**: no shipped
 * default, no cull notice when a republish dropped an option, no back-fill when
 * one arrived. Migration 0115 states it in as many words while explaining why
 * its own sweep found nothing to sweep — "*a non-core spec has no configuration
 * at all today and therefore nothing materialized*" — and calls it a finding.
 *
 * Walking the rows rather than a list is what keeps it closed: a spec published
 * by any route is a row, and the pass that reconciles configs should ask the
 * table which pipelines exist rather than ask the code which ones core ships.
 *
 * Keyed by slug so `seedCoreSpecs` can pick its own out of the answer — one pass
 * rather than two, because reconciling core's specs twice per boot would double
 * the most expensive step in the sequence for a report field.
 */
export async function reconcilePublishedConfigs(
	db: Db
): Promise<Map<string, SpecSeedReport["reconciled"]>> {
	const out = new Map<string, SpecSeedReport["reconciled"]>()
	const specs = await db
		.select()
		.from(schema.pipelineSpecs)
		.orderBy(asc(schema.pipelineSpecs.id))

	for (const spec of specs as any[]) {
		if (!spec.activeVersionId) continue
		try {
			const reports = await reconcileConfigs(
				db,
				spec.id,
				spec.activeVersionId,
				spec.slug
			)
			out.set(
				spec.slug,
				reports.map((r) => ({
					name: r.name,
					culled: r.culled.length,
					backfilled: r.backfilled.length
				}))
			)
		} catch (err) {
			// One malformed plugin document must not stop core's pipelines
			// getting their configs. The set this walks is not one core
			// controls, so a member of it may be anything.
			console.warn(
				`[pipelines] could not reconcile configs for ${spec.slug}:`,
				err
			)
		}
	}
	return out
}

/**
 * The floor preset (23 §9): "Chat" — the standard type, everything default.
 * Matched on seedKey, never a fixed id (a seeded row at a hardcoded id once
 * overwrote a user's sampling config on upgrade; the rule exists for a
 * reason). Immutable like the shipped configs: duplicate to change.
 */
export async function seedSessionPresets(
	db: Db
): Promise<{ created: number; present: number; bareIncluded: BareIncludedNotice[] }> {
	// The catalog declares the shipped presets (24 T6b) — one list, mapped
	// into the row shape there so the announcement and the seed cannot
	// disagree. Matched on seedKey, never a fixed id (the standing rule).
	const { corePresetSeeds } = await import("@serene-pub/core-catalog")
	const SEEDS = corePresetSeeds()
	let created = 0
	let present = 0
	for (const seed of SEEDS) {
		const existing = await db
			.select({ id: schema.sessionPresets.id })
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.seedKey, seed.seedKey))
			.limit(1)
		if (existing.length) {
			present++
			continue
		}
		await db.insert(schema.sessionPresets).values(seed)
		created++
	}

	// Backfill (24, admin IA): rows that predate the bindings column get
	// theirs composed against the input locks — session-created from the
	// genre's create pipeline, message-respond from the stored primary (or
	// the lock's answer). One-time and idempotent; pre-release migrations
	// squash, so this reconcile is the migration.
	const { resolveSessionEventSpec } = await import(
		"$lib/server/pipelines/runtime/sessionEvents"
	)
	const rows = await db.select().from(schema.sessionPresets)
	for (const row of rows as any[]) {
		if (row.bindings && Object.keys(row.bindings).length) continue
		const bindings: Record<string, { spec: string }> = {}
		const create = await resolveSessionEventSpec(
			db,
			row.genreId,
			sessionEvents.sessionCreated
		)
		if (create) bindings[sessionEvents.sessionCreated] = { spec: create }
		const respond =
			row.primarySlug ??
			(await resolveSessionEventSpec(
				db,
				row.genreId,
				sessionEvents.messageRespond
			))
		if (respond) bindings[sessionEvents.messageRespond] = { spec: respond }
		if (Object.keys(bindings).length)
			await db
				.update(schema.sessionPresets)
				.set({ bindings })
				.where(eq(schema.sessionPresets.id, row.id))
	}
	return { created, present, bareIncluded: noticeBareIncludedKeys(rows) }
}

/** One preset whose included set still carries bare function keys. */
export interface BareIncludedNotice {
	presetId: number
	name: string
	/** The entries that are not identities, in stored order. */
	keys: string[]
}

/**
 * ⏳ One release, with `presetIncludes`' bare-key fallback. Migration 0137
 * rewrote a preset's bare function keys to identities where exactly one
 * action declared the function (third pass, W4+W2); the keys it could not
 * — none declared it, or several — stay bare and are still answered by the
 * fallback, which promotes them by the same rule at read time. That is
 * silent, so this says which presets are living on it: logged once per
 * preset on every boot, the way `syncPluginPresets` reports a bare binding
 * key, and returned so a caller can assert on it. Pure over the rows the
 * seed already read; no second query.
 */
export function noticeBareIncludedKeys(
	rows: ReadonlyArray<{ id: number; name: string; includedActions: unknown }>
): BareIncludedNotice[] {
	const out: BareIncludedNotice[] = []
	for (const row of rows) {
		if (!Array.isArray(row.includedActions)) continue
		const keys = row.includedActions
			.map(String)
			.filter((entry) => !parseActionIdentity(entry))
		if (!keys.length) continue
		out.push({ presetId: row.id, name: row.name, keys })
		console.warn(
			`[pipelines] preset '${row.name}' (#${row.id}) includes bare function keys ` +
				`${keys.map((k) => `'${k}'`).join(", ")} — no single action declares them, so ` +
				`the read-side fallback serves them one release; re-save the preset naming ` +
				`each action by identity ('<spec slug>#<key>')`
		)
	}
	return out
}

/* ------------------------------------------------------------------ *
 * The rebind move (PLAN-turn-order §5 A5, R20)
 * ------------------------------------------------------------------ */

/** Bring a present version's `pipeline_nodes.expose` into line with its document. */
async function healNodeExpose(db: Db, specVersionId: number, doc: SpecDocument): Promise<void> {
	const stored = await db
		.select({
			id: schema.pipelineNodes.id,
			nodeKey: schema.pipelineNodes.nodeKey,
			expose: schema.pipelineNodes.expose
		})
		.from(schema.pipelineNodes)
		.where(eq(schema.pipelineNodes.specVersionId, specVersionId))
	const want = new Map(doc.nodes.map((n) => [n.key, n.expose ?? null]))
	for (const row of stored) {
		const expose = want.get(row.nodeKey) ?? null
		if (JSON.stringify(row.expose ?? null) !== JSON.stringify(expose))
			await db
				.update(schema.pipelineNodes)
				.set({ expose })
				.where(eq(schema.pipelineNodes.id, row.id))
	}
}

/** Bring a present version's `pipeline_clauses.parent_clause_chain` into line with its document. */
async function healClauseChains(db: Db, specVersionId: number, doc: SpecDocument): Promise<void> {
	const stored = await db
		.select({
			id: schema.pipelineClauses.id,
			clauseId: schema.pipelineClauses.clauseId,
			parentClauseChain: schema.pipelineClauses.parentClauseChain
		})
		.from(schema.pipelineClauses)
		.where(eq(schema.pipelineClauses.specVersionId, specVersionId))
	const want = new Map(doc.clauses.map((c) => [c.id, c.clauseChain ?? null]))
	for (const row of stored) {
		const chain = want.get(row.clauseId) ?? null
		if ((row.parentClauseChain ?? null) !== chain)
			await db
				.update(schema.pipelineClauses)
				.set({ parentClauseChain: chain })
				.where(eq(schema.pipelineClauses.id, row.id))
	}
}

/** What one boot's rebind move did. */
export interface RebindMoveReport {
	/** Rows moved onto their session genre's turn-order spec, node `strategy`, this boot. */
	moved: number
	/** Rows dropped because the session already had a strategy of its own. */
	kept: number
	/** Rows dropped because the session's genre has no core turn-order spec to move to. */
	dropped: number
}

/** The speaker rebind's old homes — the three respond specs (§7), node `speaker`. */
const SPEAKER_REBIND_SPECS = [
	"core:spec/respond",
	"core:spec/guide-respond",
	"core:spec/writing-room-respond"
]

/** The two shared turn-order specs A6 shipped and the modder pass retired (R27), node `strategy`. */
const RETIRED_TURN_ORDER_SPECS = ["core:spec/turn-order", "core:spec/turn-order-narrator"]

/**
 * ⏳ The Turn order control's row follows the node it names (PLAN-turn-order
 * §5 A5, R20, R27). A session's choice of strategy is a
 * `pipeline_node_rebinds` row on **the session genre's** turn-order spec, at
 * that spec's strategy node. A row found on a respond spec's `speaker`
 * (pre-0152 data) or on a retired shared slug's `strategy` is moved there —
 * the spec and node found in core-catalog's
 * `TURN_ORDER_BY_GENRE`, the declaration, never a slug built from the genre
 * id. `core:task/turn-none@1` is renamed `core:task/turn-manual@1` on the
 * way (§7).
 *
 * ## Why a boot-seed post-step and not a migration (R20)
 *
 * A row here points at a spec by `spec_id`, and the turn-order specs' rows
 * are inserted by the catalog seed — on this boot, minutes after every
 * migration has run. So this runs after `seedCoreSpecs`, is idempotent and
 * re-runnable, and leaves a row alone while its target spec does not exist
 * yet (a boot whose catalog seed failed); the next boot that publishes it
 * moves it.
 *
 * ## The rules
 *
 * - Session scope only. An instance-scope rebind is an administrator's
 *   choice, and the admin swap list is where it is re-made.
 * - A strategy row the person already has **wins** (`ON CONFLICT DO
 *   NOTHING`): their later choice is not overwritten by an earlier one.
 * - A session whose genre core ships no turn-order spec for (a plugin
 *   genre, a genre since uninstalled) has nowhere to go: the row is
 *   dropped and counted, never guessed at.
 * - So is a row whose target node does not offer its definition — in
 *   particular every genre but chat, whose turn-order spec offers no swaps
 *   (R42): a rebind there would run with no control to see or clear it.
 * - The source row is deleted whenever it was resolved: the node it names
 *   does not exist any more, so leaving it would be a rebind of nothing.
 * - `updated_by` and `updated_at` travel with the row, so the move does not
 *   claim the person's choice as the system's.
 */
export async function moveSpeakerRebinds(db: Db): Promise<RebindMoveReport> {
	const { TURN_ORDER_BY_GENRE } = await import("@serene-pub/core-catalog")
	const targetSlugs = TURN_ORDER_BY_GENRE.map((t) => t.spec)
	const targetRows = await db
		.select({ id: schema.pipelineSpecs.id, slug: schema.pipelineSpecs.slug })
		.from(schema.pipelineSpecs)
		.where(inArray(schema.pipelineSpecs.slug, targetSlugs))
	const specIdBySlug = new Map(targetRows.map((r) => [r.slug, r.id]))
	// The node each target's Turn order control swaps — from the table, never
	// the literal: chat's sits behind its model path (M4, `decide.rules.strategy`).
	const strategyNodeBySlug = new Map(TURN_ORDER_BY_GENRE.map((t) => [t.spec, t.strategyNode]))
	const strategyNodeById = new Map<number, string>()
	// What each target's `strategy` node offers (R28, R42): the pin and its
	// `expose.swaps`. A node offering no swaps has no control, so a rebind
	// moved onto it would run invisibly and could never be cleared — such a
	// row is dropped, not moved (M2 review).
	const offeredBySpecId = new Map<number, string[]>()
	for (const r of targetRows) {
		const [spec] = await db
			.select({ activeVersionId: schema.pipelineSpecs.activeVersionId })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.id, r.id))
			.limit(1)
		// A spec row with no published version is not published: treated
		// like an absent one (the row waits for the boot that publishes it).
		if (!spec?.activeVersionId) {
			specIdBySlug.delete(r.slug)
			continue
		}
		const [node] = await db
			.select({
				definitionId: schema.pipelineNodes.definitionId,
				definitionVersion: schema.pipelineNodes.definitionVersion,
				expose: schema.pipelineNodes.expose
			})
			.from(schema.pipelineNodes)
			.where(
				and(
					eq(schema.pipelineNodes.specVersionId, spec.activeVersionId),
					eq(schema.pipelineNodes.nodeKey, strategyNodeBySlug.get(r.slug) ?? "strategy")
				)
			)
			.limit(1)
		strategyNodeById.set(r.id, strategyNodeBySlug.get(r.slug) ?? "strategy")
		const swaps = node?.expose?.swaps ?? []
		offeredBySpecId.set(
			r.id,
			node && swaps.length ? [`${node.definitionId}@${node.definitionVersion}`, ...swaps] : []
		)
	}
	const targetSlugByGenre = new Map(TURN_ORDER_BY_GENRE.map((t) => [t.genre.id, t.spec]))

	const sources = await db
		.select({
			id: schema.pipelineNodeRebinds.id,
			scopeId: schema.pipelineNodeRebinds.scopeId,
			nodeKey: schema.pipelineNodeRebinds.nodeKey,
			specSlug: schema.pipelineSpecs.slug,
			definitionId: schema.pipelineNodeRebinds.definitionId,
			updatedBy: schema.pipelineNodeRebinds.updatedBy,
			updatedAt: schema.pipelineNodeRebinds.updatedAt,
			genreId: schema.sessions.genreId
		})
		.from(schema.pipelineNodeRebinds)
		.innerJoin(
			schema.pipelineSpecs,
			eq(schema.pipelineNodeRebinds.specId, schema.pipelineSpecs.id)
		)
		.innerJoin(schema.sessions, eq(schema.pipelineNodeRebinds.scopeId, schema.sessions.id))
		.where(
			and(
				eq(schema.pipelineNodeRebinds.scopeKind, "session"),
				or(
					and(
						eq(schema.pipelineNodeRebinds.nodeKey, "speaker"),
						inArray(schema.pipelineSpecs.slug, SPEAKER_REBIND_SPECS)
					),
					and(
						eq(schema.pipelineNodeRebinds.nodeKey, "strategy"),
						inArray(schema.pipelineSpecs.slug, [
							...RETIRED_TURN_ORDER_SPECS,
							// A genre's own spec whose strategy node moved behind a
							// model path (M4: chat's is `decide.rules.strategy`): a
							// row written at `strategy` before the move is a
							// rebind of nothing until it follows (M4 review).
							...TURN_ORDER_BY_GENRE.filter((t) => t.strategyNode !== "strategy").map(
								(t) => t.spec
							)
						])
					)
				)
			)
		)
		.orderBy(asc(schema.pipelineNodeRebinds.id))

	let moved = 0
	let kept = 0
	let dropped = 0
	for (const row of sources) {
		const targetSlug = targetSlugByGenre.get(row.genreId)
		const targetId = targetSlug ? specIdBySlug.get(targetSlug) : undefined
		// A core genre whose spec is not published yet: leave the row for
		// the boot that publishes it.
		if (targetSlug && targetId === undefined) continue
		const definitionId =
			row.definitionId === "core:task/turn-none@1" ? "core:task/turn-manual@1" : row.definitionId
		// A published target whose node does not offer this definition (or
		// offers no swaps at all): nowhere visible to put it.
		const offered = targetId !== undefined ? offeredBySpecId.get(targetId) : undefined
		if (targetId !== undefined && offered !== undefined && !offered.includes(definitionId)) {
			dropped++
			await db
				.delete(schema.pipelineNodeRebinds)
				.where(eq(schema.pipelineNodeRebinds.id, row.id))
			continue
		}
		if (targetId !== undefined) {
			const written = await db
				.insert(schema.pipelineNodeRebinds)
				.values({
					specId: targetId,
					scopeKind: "session",
					scopeId: row.scopeId,
					nodeKey: strategyNodeById.get(targetId) ?? "strategy",
					definitionId,
					updatedBy: row.updatedBy,
					updatedAt: row.updatedAt
				})
				.onConflictDoNothing()
				.returning({ id: schema.pipelineNodeRebinds.id })
			if (written.length) moved++
			else kept++
		} else dropped++
		await db
			.delete(schema.pipelineNodeRebinds)
			.where(eq(schema.pipelineNodeRebinds.id, row.id))
	}
	if (moved || dropped)
		console.log(
			`[pipelines] moved ${moved} Turn order choice(s) onto their genre's turn-order spec` +
				(dropped ? `; dropped ${dropped} whose genre has no core turn-order spec` : "")
		)
	return { moved, kept, dropped }
}
