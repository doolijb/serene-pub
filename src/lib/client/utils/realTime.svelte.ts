/**
 * Real-world time, shown in the signed-in person's **profile time zone**.
 *
 * Every instant the server sends is UTC (an ISO-8601 string, or a `Date` in
 * tests). This is the one place the client turns one into a calendar date or
 * clock time a person reads, so the zone it is shown in is decided once: the
 * account's `users.time_zone`, or the browser's own zone until that is known.
 *
 * Story time — a session's or lorebook's in-world clock — is not this. Genres
 * and widgets show that through the timeline; nothing here reads it.
 *
 * `$state`, so a template that formats through these helpers redraws when the
 * profile zone arrives or changes.
 */
import { canonicalTimeZone } from "$lib/shared/validation/timeZone"

type Instant = string | number | Date | null | undefined

let profileZone = $state<string | null>(null)

/** The browser's own IANA zone, or "UTC" when the engine will not say. */
export function browserTimeZone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
	} catch {
		return "UTC"
	}
}

/** The zone real-world times are shown in now. */
export function displayTimeZone(): string {
	return profileZone ?? browserTimeZone()
}

/** Adopt the account's zone (null falls back to the browser's). */
export function setProfileTimeZone(zone: string | null | undefined): void {
	profileZone = canonicalTimeZone(zone)
}

function toDate(value: Instant): Date | null {
	if (value == null || value === "") return null
	const d = value instanceof Date ? value : new Date(value)
	return Number.isNaN(d.getTime()) ? null : d
}

/** A calendar date in the profile zone — `""` for a missing or bad stamp. */
export function realDate(
	value: Instant,
	options: Intl.DateTimeFormatOptions = {}
): string {
	const d = toDate(value)
	return d
		? d.toLocaleDateString(undefined, { ...options, timeZone: displayTimeZone() })
		: ""
}

/** A date and clock time in the profile zone — `""` for a missing or bad stamp. */
export function realDateTime(
	value: Instant,
	options: Intl.DateTimeFormatOptions = {}
): string {
	const d = toDate(value)
	return d
		? d.toLocaleString(undefined, { ...options, timeZone: displayTimeZone() })
		: ""
}

/** A clock time in the profile zone — `""` for a missing or bad stamp. */
export function realTime(
	value: Instant,
	options: Intl.DateTimeFormatOptions = {}
): string {
	const d = toDate(value)
	return d
		? d.toLocaleTimeString(undefined, { ...options, timeZone: displayTimeZone() })
		: ""
}

/** Accounts whose missing zone this tab has already reported. */
const reported = new Set<number>()

/**
 * Take in the signed-in account: adopt its zone, and when it has none, report
 * the browser's once — one `users:current:setTimeZone` with `onlyIfUnset`, so
 * a zone the person picked is never overwritten and a repeat is a no-op.
 */
export function adoptAccountTimeZone(
	user: { id?: number | null; timeZone?: string | null } | null | undefined,
	report: (timeZone: string) => void
): void {
	if (!user) return
	setProfileTimeZone(user.timeZone)
	if (user.timeZone || typeof user.id !== "number") return
	if (reported.has(user.id)) return
	reported.add(user.id)
	report(browserTimeZone())
}
