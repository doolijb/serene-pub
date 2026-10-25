/**
 * 🚧 **When a routine runs, in words** (PLAN-layering lane 7, 2026-10-21) —
 * the one sentence the session's settings, the composer's Routines menu and
 * the admin preset editor print for a routine's cadence: _After each turn_,
 * _Every 5 turns_, _Every 30 minutes of story time_, _Daily at 09:00_.
 *
 * Read off the cadence's id and options as a registration stores them
 * (`CadenceRef`), never off a label: core's cadences are named by the SDK's
 * own objects (`coreCadences`), so a renamed id cannot leave this behind.
 * A cadence this module does not know (a plugin's) reads as its declared
 * name, which the caller hands in.
 *
 * Member-facing words (STYLE-GUIDE §10): no "cadence", no "cron" — those are
 * the admin's canon words, and the admin's own fields name the cadence
 * beside this sentence.
 */
import { coreCadences } from "@serene-pub/sdk"

/** A cadence as a registration stores it: its id and its option values. */
export interface CadenceLike {
	id: string
	options?: Record<string, unknown> | null
	/** The cadence's declared name, for one this module does not know. */
	name?: string
}

export interface CadenceWordsOptions {
	/** An event's name in words (`onEvent`'s event), when the caller can say it. */
	eventName?: (eventId: string) => string | undefined
}

const UNIT_ONE: Record<string, string> = {
	minutes: "minute",
	hours: "hour",
	days: "day",
	weeks: "week",
	months: "month",
	years: "year"
}

/** "5 minutes", "1 hour" — a count and its unit, the unit singular for one. */
export function spanInWords(every: unknown, unit: unknown): string {
	const n = typeof every === "number" && Number.isFinite(every) ? every : 1
	const u = typeof unit === "string" ? unit : "minutes"
	const one = UNIT_ONE[u] ?? u.replace(/s$/, "")
	return n === 1 ? `1 ${one}` : `${n} ${u}`
}

/** "Every hour", "Every 5 minutes" — `every` with its unit, "Every <unit>" for one. */
function everyInWords(every: unknown, unit: unknown): string {
	const n = typeof every === "number" && Number.isFinite(every) ? every : 1
	const u = typeof unit === "string" ? unit : "minutes"
	return n === 1 ? `Every ${UNIT_ONE[u] ?? u.replace(/s$/, "")}` : `Every ${n} ${u}`
}

/** A quiet span in minutes as a reader says it: 30 minutes, 2 hours, 3 days. */
export function minutesInWords(minutes: unknown): string {
	const m = typeof minutes === "number" && Number.isFinite(minutes) ? Math.max(0, minutes) : 0
	if (m >= 1440 && m % 1440 === 0) return spanInWords(m / 1440, "days")
	if (m >= 60 && m % 60 === 0) return spanInWords(m / 60, "hours")
	return spanInWords(m, "minutes")
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

/** A Schedule's `at` — stored as the object, or (an older row, a text option) its JSON. */
function scheduleAt(raw: unknown): Record<string, unknown> | null {
	if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>
	if (typeof raw === "string")
		try {
			const v = JSON.parse(raw) as unknown
			return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
		} catch {
			return null
		}
	return null
}

function scheduleInWords(options: Record<string, unknown>): string {
	const story = options.clock === "story"
	const at = scheduleAt(options.at)
	const tail = story ? " (story time)" : ""
	if (!at) return `On a schedule${tail}`
	const time = (v: unknown) => (typeof v === "string" ? v : "")
	if (typeof at.once === "string") return `Once, at ${at.once.replace("T", " ")}${tail}`
	if (typeof at.daily === "string") return `Daily at ${at.daily}${tail}`
	const weekly = at.weekly as { weekday?: unknown; time?: unknown } | undefined
	if (weekly && typeof weekly === "object") {
		const i = typeof weekly.weekday === "number" ? weekly.weekday : 0
		// The story calendar names its own weekdays; this one counts them.
		const day = story ? `day ${i + 1} of the week` : (WEEKDAYS[i] ?? `day ${i + 1} of the week`)
		return `Weekly on ${day} at ${time(weekly.time)}${tail}`
	}
	const monthly = at.monthly as { day?: unknown; time?: unknown } | undefined
	if (monthly && typeof monthly === "object") return `Monthly on day ${String(monthly.day ?? 1)} at ${time(monthly.time)}${tail}`
	const annually = at.annually as { month?: unknown; day?: unknown; time?: unknown } | undefined
	if (annually && typeof annually === "object")
		return `Yearly on month ${String(annually.month ?? 1)}, day ${String(annually.day ?? 1)} at ${time(annually.time)}${tail}`
	return `On a schedule${tail}`
}

/**
 * **When a routine runs**, as one sentence a member reads. Never empty: an
 * unknown cadence falls back to its declared name, then to _On its own
 * schedule_.
 */
export function cadenceWords(cadence: CadenceLike, opts: CadenceWordsOptions = {}): string {
	const o = (cadence.options ?? {}) as Record<string, unknown>
	switch (cadence.id) {
		case coreCadences.everyNTurns.id: {
			const n = typeof o.n === "number" ? o.n : Number(coreCadences.everyNTurns.options.n?.default ?? 5)
			return n === 1 ? "After each turn" : `Every ${n} turns`
		}
		case coreCadences.afterEachTurn.id:
			return "After each turn"
		case coreCadences.afterEachRound.id:
			return "After each round"
		case coreCadences.afterEachScene.id:
			return "After each scene"
		case coreCadences.whenIdle.id:
			return `When nobody has played for ${minutesInWords(typeof o.minutes === "number" ? o.minutes : 30)}`
		case coreCadences.onEvent.id: {
			const named = typeof o.event === "string" ? opts.eventName?.(o.event) : undefined
			return named ? `On ${named.charAt(0).toLowerCase()}${named.slice(1)}` : "When something happens"
		}
		case coreCadences.whenValue.id:
			return "When a value in the story says so"
		case coreCadences.systemCron.id:
			return everyInWords(o.every, o.unit ?? "hours")
		case coreCadences.timelineCron.id:
			return `${everyInWords(o.every, o.unit ?? "days")} of story time`
		case coreCadences.schedule.id:
			return scheduleInWords(o)
		default:
			return cadence.name?.trim() || "On its own schedule"
	}
}

/**
 * The jump ceiling of a story-time cadence (R19), as its label says it —
 * _Skips when the clock jumps more than 12 hours_ — or null when it has none.
 */
export function jumpCeilingWords(cadence: CadenceLike): string | null {
	const j = (cadence.options ?? {}).maxJump as { every?: unknown; unit?: unknown } | undefined
	if (!j || typeof j !== "object" || typeof j.every !== "number") return null
	return `Skips when the clock jumps more than ${spanInWords(j.every, j.unit)}`
}
