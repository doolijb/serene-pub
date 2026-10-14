/**
 * The bookkeeping shared by the sampling forms.
 *
 * The values form (sent parameters, or every parameter while choosing) and the
 * enabled form (Admin › Sampling's Advanced fieldset) read the same schema and
 * edit the same `enabled` array. Keeping the grouping, the counting and the
 * switch-on rule here means the forms cannot disagree about what "on" means,
 * and means the rules are reachable by a test: vitest runs in `node`
 * (vitest.config.ts), so nothing that lives inside a `.svelte` file is.
 *
 * Everything here is pure and returns NEW arrays. `enabled` is a plain array on
 * a `$state` object, and an in-place push/splice would not re-run the `$derived`
 * that watches it — a bug that renders as "the checkbox ticks but the field
 * never appears on the other screen".
 */

import type { FieldDecl, SettingsSchema } from "@serene-pub/sdk"

export interface SamplingFieldGroup {
	group: string
	fields: Array<{ key: string; decl: FieldDecl }>
}

/**
 * The schema as the screens draw it: declaration order within a group, group
 * order by first appearance, and a group that ends up empty is dropped rather
 * than rendered as a bare header.
 *
 * That last part is why `keep` lives here rather than in a `{#if}` in the
 * markup: the seeded "Disabled" config enables nothing at all, so a values
 * screen that filtered per-field would draw seven headings over nothing.
 */
export function groupSamplingFields(
	schema: SettingsSchema,
	keep?: (key: string, decl: FieldDecl) => boolean
): SamplingFieldGroup[] {
	const out: SamplingFieldGroup[] = []
	for (const [key, decl] of Object.entries(schema ?? {})) {
		if (keep && !keep(key, decl)) continue
		const name = decl.group ?? "Other"
		let g = out.find((x) => x.group === name)
		if (!g) out.push((g = { group: name, fields: [] }))
		g.fields.push({ key, decl })
	}
	return out
}

/**
 * The "N of M sent" a config's Parameters heading shows (its list row says
 * only "N settings on"): the values form draws only the sent parameters until
 * Choose parameters is on, so the count is how a reader learns there are
 * others.
 *
 * Counted against the SCHEMA, not against `enabled.length`: a row written by a
 * newer build may name keys this build's vocabulary has never heard of, and
 * those survive the round-trip deliberately (see `resolveSamplingValues`). They
 * are not drawable here, so counting them would print "26 of 25".
 */
export function countEnabled(
	schema: SettingsSchema,
	enabled: readonly string[] | null | undefined,
	/**
	 * Keys the pair this config runs against drops (an image pair's drawing
	 * sheet): switched on, but not sent, so not counted as sent.
	 */
	unhonoured: readonly string[] = []
): { on: number; total: number } {
	const keys = Object.keys(schema ?? {})
	const set = new Set(enabled ?? [])
	const dropped = new Set(unhonoured)
	return {
		on: keys.filter((k) => set.has(k) && !dropped.has(k)).length,
		total: keys.length
	}
}

/**
 * "N of M sent" per group, keyed by the group's name — what the values form's
 * group labels say. Counted against the whole schema, so a group whose
 * parameters are all off still reads "0 of 6" where it is drawn.
 */
export function countEnabledByGroup(
	schema: SettingsSchema,
	enabled: readonly string[] | null | undefined
): Map<string, { on: number; total: number }> {
	const set = new Set(enabled ?? [])
	const out = new Map<string, { on: number; total: number }>()
	for (const g of groupSamplingFields(schema))
		out.set(g.group, {
			on: g.fields.filter((f) => set.has(f.key)).length,
			total: g.fields.length
		})
	return out
}

/**
 * `enabled` after a switch is flipped — a new array every time, and never a
 * duplicate entry (a double `change` event would otherwise leave a key that
 * takes two clicks to turn back off).
 */
export function nextEnabled(
	enabled: readonly string[] | null | undefined,
	key: string,
	on: boolean
): string[] {
	const current = enabled ?? []
	if (!on) return current.filter((k) => k !== key)
	return current.includes(key) ? [...current] : [...current, key]
}

/**
 * What to write into `values` when a key is switched ON, or `undefined` to
 * write nothing.
 *
 * Resolution would supply the default anyway, so this changes no request —
 * it means the slider on the values screen has something to show, and that the
 * form and the eventual request agree about what the value is. An existing
 * value is never overwritten: switching a sampler off and back on must not lose
 * the number you had tuned.
 */
export function defaultOnEnable(
	schema: SettingsSchema,
	values: Record<string, unknown> | null | undefined,
	key: string
): unknown {
	if (values?.[key] !== undefined) return undefined
	return schema?.[key]?.default
}
