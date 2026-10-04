/**
 * How Admin › History words and links a logbook record — shared by the
 * changelist (`Page.svelte`) and the record's change view (`IdPage.svelte`),
 * and the When facet's translation to the server's `since`. Pure, tested
 * (`logbookView.test.ts`).
 */
import {
	LOGBOOK_OBJECT_TYPES,
	isLogbookObjectType,
	type LogbookAction,
	type LogbookRecordView
} from "$lib/shared/adminLogbook"

export const typeLabel = (t: string) =>
	isLogbookObjectType(t) ? LOGBOOK_OBJECT_TYPES[t].label : t

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** "connection “Local”"; a singleton whose name IS its kind says it once. */
export function objectName(t: string, label: string): string {
	const kind = typeLabel(t)
	if (!label || label.toLowerCase() === kind.toLowerCase()) return capitalize(kind)
	return `${kind} “${label}”`
}

/** The record's object's own page, when it has one and still exists. */
export function objectHref(r: LogbookRecordView): string | null {
	if (!isLogbookObjectType(r.objectType)) return null
	const t = LOGBOOK_OBJECT_TYPES[r.objectType] as {
		href?: (id: string | null) => string | null
	}
	// A deleted object has no page to open.
	if (r.action === "delete") return null
	return t.href?.(r.objectId) ?? null
}

/** This object's whole history: the address a change form's History button uses. */
export function objectHistoryHref(r: LogbookRecordView): string {
	const p = new URLSearchParams()
	p.set("type", r.objectType)
	p.set("id", r.objectId ?? "")
	return `/admin/history?${p}`
}

export const fmtWhen = (iso: string, seconds = false) =>
	new Date(iso).toLocaleString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
		...(seconds ? { second: "2-digit" } : {})
	})

export function fmtValue(v: unknown): string {
	if (v === undefined) return ""
	if (v == null || v === "") return "empty"
	if (typeof v === "boolean") return v ? "on" : "off"
	if (typeof v === "string" || typeof v === "number") return String(v)
	try {
		return JSON.stringify(v, null, 1)
	} catch {
		return String(v)
	}
}

export const ACTION_TONE: Record<LogbookAction, string> = {
	add: "preset-tonal-success",
	change: "preset-tonal-primary",
	delete: "preset-tonal-error",
	other: "preset-tonal-surface"
}
export const ACTION_ICON: Record<LogbookAction, "Plus" | "Pencil" | "Trash2" | "Zap"> = {
	add: "Plus",
	change: "Pencil",
	delete: "Trash2",
	other: "Zap"
}

/**
 * The When facet (Django's `DateFieldListFilter`): its address values, in
 * order, and what each means. "Any date" is the facet's All.
 */
export const WHEN_OPTIONS = [
	{ value: "today", label: "Today" },
	{ value: "past-7-days", label: "Past 7 days" },
	{ value: "this-month", label: "This month" },
	{ value: "this-year", label: "This year" }
] as const

/**
 * The server's `since` (ISO, inclusive) for a When value, from local
 * midnight — the day as the reader means it. Unknown or empty → null.
 */
export function whenSince(when: string, now: Date = new Date()): string | null {
	const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
	switch (when) {
		case "today":
			break
		case "past-7-days":
			d.setDate(d.getDate() - 7)
			break
		case "this-month":
			d.setDate(1)
			break
		case "this-year":
			d.setMonth(0, 1)
			break
		default:
			return null
	}
	return d.toISOString()
}
