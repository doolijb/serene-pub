/**
 * What core seeds into the pipeline tables, and the rule each kind seeds under.
 *
 * Three kinds of thing land here, and they are not the same kind of thing at
 * all — which is why they get three functions rather than one `seed()`:
 *
 * | kind | what it is | what a conflict means |
 * |---|---|---|
 * | the type registry | a *fact about the running code* | the code and the rows disagree — refuse (`registrySync.ts`) |
 * | the event registry | a *fact about the running code* | same, but nothing pins an event, so a change is a change |
 * | core's spec documents | *content* | a published version is immutable — leave it alone |
 *
 * The type registry's rule lives in `registrySync.ts` because it is the strict
 * one. The other two live here.
 *
 * ## Why the spec list is a registry rather than an array in `bootstrap`
 *
 * It was two collections that had to agree: an array of builders and a
 * `SPEC_NAMES` map keyed by slug. Adding a pipeline meant editing both, and
 * forgetting the second published a spec whose display name was its slug — a
 * failure that shows up in the user's sidebar rather than in a test. One row per
 * pipeline makes that unrepresentable.
 */

import { allTypes } from "@serene-pub/sdk"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { CORE_SPECS } from "./specs"
import { reconcileConfigs } from "./configs"
import { seedPipelinePrompts } from "./seedPrompts"

/** Loose on purpose — the app db and the test db are passed interchangeably. */
type Db = {
	insert: any
	select: any
	update: any
	delete: any
	transaction: any
}

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

/**
 * A core event, as core defines it.
 *
 * `affectsUser` is the load-bearing field: 11 §4 makes consent enforceable
 * *without hand-classifying every subscription* by declaring it once, on the
 * event. An event that touches somebody's content is marked here and every
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
}

/**
 * The events nothing in the type registry causes.
 *
 * Kept short and explicit. An ACTION event has no causing Consumer by
 * definition — a person clicked something, or a clock ticked — so it cannot be
 * derived the way the DATA events below are.
 */
const UNCAUSED_EVENTS: CoreEvent[] = [
	{
		slug: "core:event/ui-action",
		version: 1,
		family: "action",
		affectsUser: false,
		description: "Somebody pressed something in the interface."
	},
	{
		slug: "core:event/schedule-tick",
		version: 1,
		family: "action",
		affectsUser: false,
		description: "A scheduled moment arrived."
	}
]

/**
 * What each DATA event means, and whether it touches a person's content.
 *
 * Keyed by bare slug. An event core's Consumers cause but this table does not
 * describe is still registered — as `affectsUser: true`, because the safe
 * default for an unclassified event that writes something is that it writes
 * something of the user's. Being wrong in that direction over-asks for consent;
 * being wrong in the other direction is the failure 11 §4 exists to prevent.
 */
const DATA_EVENTS: Record<
	string,
	{ affectsUser: boolean; description: string }
> = {
	"core:event/message-created": {
		affectsUser: true,
		description: "A message was written into a chat."
	},
	"core:event/message-updated": {
		affectsUser: true,
		description: "An existing message was changed."
	}
}

const bareSlug = (ref: string) => ref.replace(/@\d+$/, "")
const refVersion = (ref: string) => Number(/@(\d+)$/.exec(ref)?.[1] ?? 1)

/**
 * The core event set, derived from the code rather than maintained beside it.
 *
 * 11 §2: *"the cause of each event is declared on the core consumer target, not
 * per spec"*. So the DATA half of this list **is** the set of `causesEvent`
 * declarations in the type registry, read off the descriptors. A Consumer that
 * starts causing a new event registers it by existing, which is the same
 * property `syncTypeRegistry` has and for the same reason: a list somebody
 * maintains by hand is a list that is eventually wrong.
 */
export function coreEvents(): CoreEvent[] {
	const out = new Map<string, CoreEvent>()
	for (const e of UNCAUSED_EVENTS) out.set(`${e.slug}@${e.version}`, e)

	for (const d of allTypes()) {
		if (!d.causesEvent) continue
		const slug = bareSlug(d.causesEvent)
		const version = refVersion(d.causesEvent)
		const known = DATA_EVENTS[slug]
		out.set(`${slug}@${version}`, {
			slug,
			version,
			family: "data",
			affectsUser: known?.affectsUser ?? true,
			description:
				known?.description ??
				`A ${slug.split("/").pop()} occurred. Caused by ${d.id}.`
		})
	}

	return [...out.values()].sort((a, b) =>
		a.slug === b.slug ? a.version - b.version : a.slug.localeCompare(b.slug)
	)
}

export interface EventSyncResult {
	inserted: string[]
	updated: string[]
	unchanged: string[]
}

/**
 * Project the core event set into rows.
 *
 * Unlike the type registry, this **updates on change rather than refusing**, and
 * the difference is not an inconsistency. A type version is a *pin*: a spec
 * names `assemble@2` and every run resolves that name, so rewriting the row
 * changes what an approved spec does. Nothing pins an event's description or its
 * `affects_user` flag — a subscription names the event, and the row is core
 * describing itself. Refusing here would mean a corrected description could
 * never ship without a version bump nobody can act on.
 *
 * The one field where that reasoning would fail is `payload_shape`, which a
 * subscription's shape-compatibility check reads. It is left NULL until
 * something populates it, rather than written speculatively.
 */
export async function syncEventRegistry(db: Db): Promise<EventSyncResult> {
	const result: EventSyncResult = {
		inserted: [],
		updated: [],
		unchanged: []
	}

	for (const event of coreEvents()) {
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
			descriptionI18n: { en: event.description }
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
				event.description

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
 * Publish core's specs, once each.
 *
 * Matched on the authored slug and semver rather than on a row id, so this
 * answers *"has this build's version of this spec been published here"*
 * identically on a fresh install and on one upgraded four times.
 *
 * A published version is immutable by construction (F3), which is why a match is
 * left alone rather than refreshed. Re-seeding one on every boot would either
 * clobber the version a run in flight resolved against, or need an exception in
 * a path whose whole rule is that there are none.
 */
export async function seedCoreSpecs(db: Db): Promise<SpecSeedReport[]> {
	const { saveDocument } = await import("./store")
	const out: SpecSeedReport[] = []

	// Three passes, in the only order where each step's inputs already exist:
	// a prompt is namespaced to a spec row, and a config references a prompt.
	// Interleaving them per-spec would seed prompts for a namespace six times
	// and still get the first one wrong.

	// 1 — publish
	for (const entry of CORE_SPECS) {
		const doc = entry.build()

		const existing = await db
			.select({ id: schema.pipelineSpecVersions.id })
			.from(schema.pipelineSpecVersions)
			.innerJoin(
				schema.pipelineSpecs,
				eq(schema.pipelineSpecVersions.specId, schema.pipelineSpecs.id)
			)
			.where(
				and(
					eq(schema.pipelineSpecs.slug, doc.id),
					eq(schema.pipelineSpecVersions.semver, doc.version)
				)
			)
			.limit(1)

		const action = existing.length > 0 ? "present" : "published"
		if (action === "published")
			await saveDocument(db, doc, { publish: true, name: entry.name })

		out.push({
			id: doc.id,
			version: doc.version,
			action,
			reconciled: []
		})
	}

	// 2 — the prompts each namespace ships
	await seedPipelinePrompts(db)

	// 3 — configs, which reference them
	//
	// Runs for present specs as well as published ones, and that is the point:
	// it establishes the shipped-config invariant on an instance upgraded from
	// before configs existed, which no publish would ever trigger.
	for (const report of out) {
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, report.id))
			.limit(1)
		if (!spec?.activeVersionId) continue

		const reports = await reconcileConfigs(
			db,
			spec.id,
			spec.activeVersionId,
			report.id
		)
		report.reconciled = reports.map((r) => ({
			name: r.name,
			culled: r.culled.length,
			backfilled: r.backfilled.length
		}))
	}

	return out
}
