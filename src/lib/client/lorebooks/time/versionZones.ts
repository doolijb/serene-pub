import { getContext, setContext } from "svelte"
import type { ZoneField } from "./entryVersions"

/**
 * 🚧 How the entry form splits its fields into two zones: the entry, and the
 * entry version being read. A field is the entry's until it is made to differ
 * at a date; storage is unchanged, this only says where the form draws it.
 *
 * The form implements this with getters so what the sections read stays
 * reactive. No context set (Timeline off, History, a new entry) means every
 * field draws as it always did.
 */
export interface VersionZones {
	/** The form draws two zones: set only while an entry's versions are shown. */
	readonly railed: boolean
	/** The form draws the entry zone's row, which holds Keywords, Part of, Pinned and Off while they are the entry's. */
	readonly entryZoneRow: boolean
	/** Where a field of the four is edited at the version being read. */
	zoneOf(field: ZoneField): "entry" | "version"
	/**
	 * What **Make it the same everywhere** does to a field that differs by
	 * version: how many of this line's own dated changes it removes it from,
	 * and the removal; or why it is not offered.
	 */
	sameEverywhere(
		field: ZoneField
	): { count: number; run: () => void } | { blocked: string }
}

export const DIFFERS_BY_VERSION_LABEL = "differs by version"
export const SAME_EVERYWHERE_LABEL = "Make it the same everywhere"
export const CHANGE_FROM_VERSION_LABEL = "Change from this version…"
export const SAME_EVERYWHERE_CONFIRM = "Make it the same"

export function sameEverywhereQuestion(count: number): string {
	return `Make this the same in every version? ${count} ${count === 1 ? "version" : "versions"} on this line will read the value shown here.`
}

const KEY = Symbol("versionZones")

export function setVersionZones(z: VersionZones): void {
	setContext(KEY, z)
}

/** `null` when no ancestor set it. */
export function getVersionZones(): VersionZones | null {
	return getContext<VersionZones | undefined>(KEY) ?? null
}
