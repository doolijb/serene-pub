/**
 * The printed forms of a date value and a date delta: what the `formatDate` and
 * `formatDateDelta` template helpers print. Pure; story time only.
 *
 * A date value prints in the calendar's spelling when its parts carry names
 * (the same text as `formatStoryTime` gives that date) and numerically when
 * they do not. A named year over a month with no name is a date the calendar
 * could not place (`storyDateValueOf`): it prints `formatStoryTime`'s
 * free-form fallback, `Year 412, Mo. 13, Day 5, 22:30` (a zero month or day
 * is left out). A delta prints as signed counts of its parts, `-0y 2m 3d`;
 * 🚧 the form is provisional.
 */

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

const pad2 = (n: number) => String(n).padStart(2, "0")

const namePart = (v: unknown): { number: number; name?: unknown } | null =>
	isObject(v) && num(v.number) ? (v as { number: number; name?: unknown }) : null

const named = (v: { name?: unknown } | null): v is { number: number; name: string } =>
	!!v && typeof v.name === "string" && v.name !== ""

const timeOf = (v: unknown): { hour: number; minute: number } | null =>
	isObject(v) && num(v.hour) ? { hour: v.hour, minute: num(v.minute) ? v.minute : 0 } : null

export function storyDateText(value: unknown): string {
	if (!isObject(value)) return ""
	const year = namePart(value.year)
	if (!year) return ""
	const month = namePart(value.month)
	const day = month ? namePart(value.day) : null
	const time = timeOf(value.time)

	if (named(year) && (!month || named(month))) {
		const clock = time ? `, ${pad2(time.hour)}:${pad2(time.minute)}` : ""
		if (!month) return `${year.name}${clock}`
		if (!day) return `${(month as { name: string }).name}, ${year.name}${clock}`
		const weekday = typeof day.name === "string" && day.name ? `${day.name}, ` : ""
		return `${weekday}${day.number} ${(month as { name: string }).name}, ${year.name}${clock}`
	}

	if (named(year) && month) {
		// A date the calendar could not place: `formatStoryTime`'s free-form
		// fallback, spelled from the value alone.
		let out = year.name
		if (month.number) out += `, Mo. ${month.number}`
		if (day && day.number) out += `, Day ${day.number}`
		if (time) out += `, ${pad2(time.hour)}:${pad2(time.minute)}`
		return out
	}

	let out = month ? `${year.number}-${pad2(month.number)}` : `Year ${year.number}`
	if (month && day) out += `-${pad2(day.number)}`
	if (time) out += ` ${pad2(time.hour)}:${pad2(time.minute)}`
	return out
}

export function storyDateDeltaText(delta: unknown): string {
	if (!isObject(delta)) return ""
	const { sign, year, month, day } = delta
	if ((sign !== -1 && sign !== 0 && sign !== 1) || !num(year)) return ""
	const parts = [`${year}y`]
	if (num(month)) parts.push(`${month}m`)
	if (num(day)) parts.push(`${day}d`)
	const time = timeOf(delta.time)
	if (time) parts.push(`${time.hour}h ${time.minute}min`)
	const prefix = sign === -1 ? "-" : sign === 1 ? "+" : ""
	return prefix + parts.join(" ")
}
