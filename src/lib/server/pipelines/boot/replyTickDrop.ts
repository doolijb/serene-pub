/**
 * ⏳ **Story's reply tick leaves with its stored settings** (owner ruling,
 * 2026-11-11).
 *
 * *Each reply advances the clock by…* — the `tick` step and the `clock`
 * junction's outlet (`clock.moves.advance`) of `core:spec/story-respond` — is
 * removed: "Remove it. The setting mentioned allows pipelines to handle time
 * arbitrarily" (the session's *round worth*, one owner for the clock). A
 * stored value for a step the pipeline does not have is refused at the
 * registration door, and the boot's refit would then leave a session's whole
 * reply registration out as stale; the configs reconcile would also cull a
 * config value with a notice. So they are removed here first, quietly.
 *
 * What goes, on `core:spec/story-respond` only, at the two node keys
 * (`REPLY_TICK_NODE_KEYS`):
 *
 *  - those keys from `registrations.values` — every scope and origin — of a
 *    row that registers the reply (`spec_slug`) or changes it (its base key
 *    names the reply's pipeline; a change row has no `spec_slug`); `null`
 *    when nothing is left;
 *  - those keys from the spec's `instance_values`; `null` when nothing is left;
 *  - the spec's `pipeline_node_overrides` at those keys;
 *  - the spec's named-config values at those keys.
 *
 * Every other node's values, column and spec are left alone. It runs before
 * `seedCoreSpecs` (which reconciles configs against the new version) and
 * before the registrations projection and refit.
 *
 * Idempotent: a second boot finds nothing. Delete this module once a release
 * has shipped it (the RC1 squash).
 */

import { and, eq, inArray, isNotNull } from "drizzle-orm"
import { REGISTRATION_KEY_JOIN, registrationKeyOf } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { baseKeyOf } from "$lib/server/pipelines/registrations/rows"

/** The reply's tick step and its clock outlet's node key. */
export const REPLY_TICK_NODE_KEYS = ["tick", "clock.moves.advance"]

/** What one boot's drop did, as counts of rows changed or removed. */
export interface ReplyTickDropReport {
	registrations: number
	instanceValues: number
	overrides: number
	configValues: number
}

/** `values` without the two keys; null when none are left; undefined when nothing was there to remove. */
function without(
	values: Record<string, Record<string, unknown>> | null
): Record<string, Record<string, unknown>> | null | undefined {
	if (!values || !REPLY_TICK_NODE_KEYS.some((k) => k in values))
		return undefined
	const rest = Object.fromEntries(
		Object.entries(values).filter(
			([k]) => !REPLY_TICK_NODE_KEYS.includes(k)
		)
	)
	return Object.keys(rest).length ? rest : null
}

export async function dropReplyTickSettings(
	db: Db
): Promise<ReplyTickDropReport> {
	const { STORY_RESPOND_SPEC_ID } = await import("@serene-pub/core-catalog")
	const report: ReplyTickDropReport = {
		registrations: 0,
		instanceValues: 0,
		overrides: 0,
		configValues: 0
	}

	// A change row's key ends in the reply's pipeline segment; the SDK derives
	// it, so the segment is read off a key it built.
	const segment = registrationKeyOf(
		{ family: "event", event: "core:event/any@1" },
		STORY_RESPOND_SPEC_ID
	).split(REGISTRATION_KEY_JOIN)[1]!
	const names = (key: string) =>
		baseKeyOf(key).split(REGISTRATION_KEY_JOIN)[1] === segment

	const rows = await db
		.select({
			id: schema.registrations.id,
			key: schema.registrations.key,
			specSlug: schema.registrations.specSlug,
			values: schema.registrations.values
		})
		.from(schema.registrations)
		.where(isNotNull(schema.registrations.values))
	for (const row of rows) {
		if (row.specSlug !== STORY_RESPOND_SPEC_ID && !names(row.key)) continue
		const next = without(row.values)
		if (next === undefined) continue
		await db
			.update(schema.registrations)
			.set({ values: next })
			.where(eq(schema.registrations.id, row.id))
		report.registrations++
	}

	const [spec] = await db
		.select({
			id: schema.pipelineSpecs.id,
			instanceValues: schema.pipelineSpecs.instanceValues
		})
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, STORY_RESPOND_SPEC_ID))
	if (spec) {
		const next = without(spec.instanceValues)
		if (next !== undefined) {
			await db
				.update(schema.pipelineSpecs)
				.set({ instanceValues: next })
				.where(eq(schema.pipelineSpecs.id, spec.id))
			report.instanceValues++
		}
		report.overrides = (
			await db
				.delete(schema.pipelineNodeOverrides)
				.where(
					and(
						eq(schema.pipelineNodeOverrides.specId, spec.id),
						inArray(
							schema.pipelineNodeOverrides.nodeKey,
							REPLY_TICK_NODE_KEYS
						)
					)
				)
				.returning({ id: schema.pipelineNodeOverrides.id })
		).length
		const configIds = (
			await db
				.select({ id: schema.pipelineConfigs.id })
				.from(schema.pipelineConfigs)
				.where(eq(schema.pipelineConfigs.specId, spec.id))
		).map((r) => r.id)
		if (configIds.length)
			report.configValues = (
				await db
					.delete(schema.pipelineConfigValues)
					.where(
						and(
							inArray(
								schema.pipelineConfigValues.configId,
								configIds
							),
							inArray(
								schema.pipelineConfigValues.nodeKey,
								REPLY_TICK_NODE_KEYS
							)
						)
					)
					.returning({ id: schema.pipelineConfigValues.id })
			).length
	}

	const {
		registrations: r,
		instanceValues: i,
		overrides: o,
		configValues: c
	} = report
	if (r || i || o || c)
		console.log(
			`[pipelines] removed the reply's retired tick settings: ${r} registration row(s), ` +
				`${i} instance value set(s), ${o} session setting(s), ${c} config value(s)`
		)
	return report
}
