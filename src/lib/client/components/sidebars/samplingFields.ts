/**
 * The bookkeeping shared by the two sampling screens.
 *
 * The values screen and the enable/disable screen read the same schema and edit
 * the same `enabled` array from opposite ends — one shows only the keys that are
 * on, the other decides which those are. Keeping the grouping, the counting and
 * the switch-on rule here means the two screens cannot disagree about what "on"
 * means, and means the rules are reachable by a test: vitest runs in `node`
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
 * The "N of M" on the nav button — the information the inline checkboxes used
 * to carry, now that the values screen no longer shows the switched-off keys.
 *
 * Counted against the SCHEMA, not against `enabled.length`: a row written by a
 * newer build may name keys this build's vocabulary has never heard of, and
 * those survive the round-trip deliberately (see `resolveSamplingValues`). They
 * are not drawable here, so counting them would print "26 of 25".
 */
export function countEnabled(
	schema: SettingsSchema,
	enabled: readonly string[] | null | undefined
): { on: number; total: number } {
	const keys = Object.keys(schema ?? {})
	const set = new Set(enabled ?? [])
	return {
		on: keys.filter((k) => set.has(k)).length,
		total: keys.length
	}
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
