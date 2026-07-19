<script lang="ts">
	// Note: this component currently has no callers anywhere in the app, and
	// its expected shape (a nested `date: {year,month,day}` object, plus a
	// `priority` field) doesn't match the `historyEntries` DB table (which
	// stores flat `year`/`month`/`day` columns and has no `priority` column)
	// — kept as-is, typed to match what the template below actually reads.
	interface HistoryEntryDisplay {
		date?: { year: number; month: number; day: number } | null
		content: string
		keys: string | string[]
		useRegex?: boolean
		caseSensitive?: boolean
		priority?: number
		constant?: boolean
		enabled?: boolean
	}

	interface Props {
		historyEntries: HistoryEntryDisplay[]
	}

	let { historyEntries }: Props = $props()
</script>

<div class="mt-2 flex flex-col gap-2">
	{#each [...historyEntries].sort((a, b) => {
		const ad = a.date || { year: 1, month: 1, day: 1 }
		const bd = b.date || { year: 1, month: 1, day: 1 }
		if (ad.year !== bd.year) return bd.year - ad.year
		if (ad.month !== bd.month) return bd.month - ad.month
		return bd.day - ad.day
	}) as entry, i (i)}
		<details class="bg-surface-100-900 relative rounded border p-2">
			<summary class="flex cursor-pointer items-center gap-2 select-none">
				<span class="font-mono text-sm">
					{entry.date?.year ?? "????"}-{String(
						entry.date?.month ?? "??"
					).padStart(2, "0")}-{String(
						entry.date?.day ?? "??"
					).padStart(2, "0")}
				</span>
				{#if i === 0}
					<span class="badge preset-filled-success-500 ml-2">
						Current Date
					</span>
				{/if}
			</summary>
			<div class="text-muted-foreground mt-2 text-xs">
				{entry.content}
			</div>
			<details class="mt-2">
				<summary
					class="cursor-pointer text-xs font-semibold select-none"
				>
					More Info
				</summary>
				<div class="mt-2 flex flex-col gap-1 text-xs">
					<div>
						<span class="font-semibold">Keys:</span>
						{Array.isArray(entry.keys) ? entry.keys.join(", ") : ""}
					</div>
					<div>
						<span class="font-semibold">Regex:</span>
						{entry.useRegex ? "Yes" : "No"}
					</div>
					<div>
						<span class="font-semibold">Case Sensitive:</span>
						{entry.caseSensitive ? "Yes" : "No"}
					</div>
					<div>
						<span class="font-semibold">Priority:</span>
						{entry.priority}
					</div>
					<div>
						<span class="font-semibold">Constant:</span>
						{entry.constant ? "Yes" : "No"}
					</div>
					<div>
						<span class="font-semibold">Enabled:</span>
						{entry.enabled ? "Yes" : "No"}
					</div>
				</div>
			</details>
		</details>
	{/each}
</div>
