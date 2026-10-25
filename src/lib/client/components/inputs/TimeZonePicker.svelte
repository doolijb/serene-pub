<script lang="ts">
	/**
	 * The profile time-zone picker: every IANA zone the browser knows, filed
	 * under its region ("America", "Europe", …) with UTC on top, on
	 * `Select.svelte` so typing "los" finds Los Angeles in a list of ~400.
	 *
	 * Each row names the zone's current offset, so a person who knows "I am
	 * GMT+2" but not their zone's id can still find it.
	 */
	import Select, { type SelectOption } from "./Select.svelte"
	import { listTimeZones } from "$lib/shared/validation/timeZone"

	interface Props {
		value: string
		label: string
		describedBy?: string
		/** The label for a screen reader only: a setting card's title says it
		 *  on screen (STYLE-GUIDE §6.4). */
		labelHidden?: boolean
		disabled?: boolean
		class?: string
		onValueChange?: (value: string) => void
	}

	let {
		value,
		label,
		describedBy,
		labelHidden = false,
		disabled = false,
		class: className = "",
		onValueChange
	}: Props = $props()

	function offsetOf(zone: string, at: Date): string {
		try {
			const part = new Intl.DateTimeFormat("en-US", {
				timeZone: zone,
				timeZoneName: "shortOffset"
			})
				.formatToParts(at)
				.find((p) => p.type === "timeZoneName")
			return part?.value ?? ""
		} catch {
			return ""
		}
	}

	const options: SelectOption[] = (() => {
		const now = new Date()
		return listTimeZones().map((zone) => {
			const slash = zone.indexOf("/")
			const region = slash > 0 ? zone.slice(0, slash) : "Universal"
			const place = (slash > 0 ? zone.slice(slash + 1) : zone).replaceAll(
				"_",
				" "
			)
			const offset = offsetOf(zone, now)
			return {
				value: zone,
				label: offset ? `${place} (${offset})` : place,
				group: region
			}
		})
	})()
</script>

<Select
	{label}
	{options}
	{value}
	{disabled}
	{describedBy}
	{labelHidden}
	class={className}
	{onValueChange}
/>
