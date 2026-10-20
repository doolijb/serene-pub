/**
 * The one time-zone rule, shared by the socket handler and the picker.
 *
 * A profile time zone is an IANA id ("America/Los_Angeles", "UTC") — the zone
 * real-world times are SHOWN in. Storage is always UTC; this never moves a
 * stored instant, and story time never reads it.
 *
 * Returns the engine's canonical spelling of the id, or null when the engine
 * does not know it. Canonical rather than as-typed so two browsers that spell
 * one zone differently ("US/Pacific", "America/Los_Angeles") store one value.
 */
export function canonicalTimeZone(value: unknown): string | null {
	if (typeof value !== "string") return null
	const id = value.trim()
	if (!id || id.length > 64) return null
	try {
		return new Intl.DateTimeFormat("en-US", { timeZone: id }).resolvedOptions()
			.timeZone
	} catch {
		return null
	}
}

/**
 * Every zone the engine offers, with UTC first — what the picker lists.
 * `Intl.supportedValuesOf` omits "UTC" on some engines, so it is added.
 */
export function listTimeZones(): string[] {
	let zones: string[] = []
	try {
		zones = (
			Intl as unknown as { supportedValuesOf(key: string): string[] }
		).supportedValuesOf("timeZone")
	} catch {
		zones = []
	}
	return ["UTC", ...zones.filter((z) => z !== "UTC")]
}
