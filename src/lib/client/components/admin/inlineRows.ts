/**
 * The rows of an editable **admin inline** (`AdminInline` with `editable`,
 * Django's `TabularInline` formset): related objects edited in place on
 * their parent's change form, held as part of that form's unsaved edits and
 * written only by the parent's Save (owner ruling 2026-10-02).
 *
 * Each row is the related object's editable fields (`values`), the id it is
 * saved under (`id`, null for a row added on this form and not saved yet)
 * and Django's **Delete** tick. Pure, so the add / change / delete split a
 * Save sends is pinned by tests (`inlineRows.test.ts`).
 */
import { sameFormValue } from "$lib/client/forms/sameFormValue"

export interface InlineRow<V extends Record<string, unknown>> {
	/** Stable across the form's life: the saved id, or a fresh key for a new row. */
	key: string
	/** The saved object's id; null until a Save creates it. */
	id: number | string | null
	values: V
	/** Django's per-row Delete tick: goes on Save. */
	delete: boolean
}

let seq = 0
/** A key for a row added on the form; never collides with a saved id's key. */
export function newInlineKey(): string {
	return `new-${++seq}`
}

/** The row for a saved object. */
export function savedInlineRow<V extends Record<string, unknown>>(
	id: number | string,
	values: V
): InlineRow<V> {
	return { key: `id-${id}`, id, values, delete: false }
}

export interface InlineChanges<V extends Record<string, unknown>> {
	/** New rows not ticked for deletion: created on Save. */
	added: InlineRow<V>[]
	/** Saved rows whose fields moved, with just the fields that did. */
	changed: { row: InlineRow<V>; fields: (keyof V & string)[] }[]
	/** Saved rows ticked for deletion. */
	deleted: InlineRow<V>[]
}

/**
 * What a Save of these rows sends, against the saved objects. A new row
 * ticked for deletion is simply dropped; a saved row both edited and ticked
 * is only deleted; a field put back to its saved value is no change
 * (`sameFormValue`: `""` and `null` are one empty, `"5"` is `5`).
 */
export function inlineChanges<V extends Record<string, unknown>>(
	saved: readonly { id: number | string; values: V }[],
	rows: readonly InlineRow<V>[]
): InlineChanges<V> {
	const byId = new Map(saved.map((s) => [s.id, s.values]))
	const out: InlineChanges<V> = { added: [], changed: [], deleted: [] }
	for (const row of rows) {
		if (row.id == null) {
			if (!row.delete) out.added.push(row)
			continue
		}
		const before = byId.get(row.id)
		// Gone from the server meanwhile (another tab deleted it): nothing to send.
		if (!before) continue
		if (row.delete) {
			out.deleted.push(row)
			continue
		}
		const fields = (Object.keys(row.values) as (keyof V & string)[]).filter(
			(k) => !sameFormValue(row.values[k], before[k])
		)
		if (fields.length) out.changed.push({ row, fields })
	}
	return out
}

/** How many changes the rows hold — the inline's own share of "unsaved". */
export function inlineChangeCount<V extends Record<string, unknown>>(c: InlineChanges<V>): number {
	return c.added.length + c.changed.length + c.deleted.length
}
