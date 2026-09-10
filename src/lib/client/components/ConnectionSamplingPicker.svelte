<script lang="ts">
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import { notePreview } from "$lib/shared/utils/connectionNotes"

	interface Props {
		label?: string
		connectionsList: {
			id?: number | null
			name?: string | null
			type?: string | null
			modality?: string | null
			/** The user's own note about the connection, shown beside it here.
			 *  Display-only free text — see `$lib/shared/utils/connectionNotes`. */
			notes?: string | null
		}[]
		samplingList: { id?: number | null; name?: string | null }[]
		connectionId?: number | null
		samplingConfigId?: number | null
		disabled?: boolean
		/**
		 * Only offer connections of this modality (20 §14) — a text-gen slot
		 * must not list the embeddings endpoint. A legacy row with no modality
		 * is treated as `text-gen`, its original meaning.
		 */
		modalityFilter?: string
	}

	let {
		label,
		connectionsList,
		samplingList,
		connectionId = $bindable(null),
		samplingConfigId = $bindable(null),
		disabled = false,
		modalityFilter
	}: Props = $props()

	const eligible = $derived(
		connectionsList
			.filter((c) => c.id != null)
			.filter(
				(c) =>
					!modalityFilter ||
					(c.modality ?? "text-gen") === modalityFilter
			)
	)

	// Grouped by service, so a long list reads by kind — "per service".
	const byService = $derived.by(() => {
		const groups = new Map<string, typeof eligible>()
		for (const c of eligible) {
			const label =
				CONNECTION_TYPE.options.find((t) => t.value === c.type)
					?.label ??
				c.type ??
				"Other"
			const list = groups.get(label) ?? []
			list.push(c)
			groups.set(label, list)
		}
		return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
	})
</script>

{#if label}
	<p class="text-sm font-semibold">{label}</p>
{/if}
<div class="grid grid-cols-[5.5rem_1fr] items-center gap-x-2 gap-y-1.5">
	<span class="text-muted-foreground text-xs">Connection</span>
	<select class="select text-xs" bind:value={connectionId} {disabled}>
		<option value={null}>System default</option>
		{#each byService as [service, conns] (service)}
			<optgroup label={service}>
				{#each conns as c (c.id)}
					{@const preview = notePreview(c.notes)}
					<!-- A native `<option>` takes one line of plain text, so the
					     note joins it rather than sitting under it, and
					     `notePreview` is what stops a pasted note from making
					     this dropdown wider than the panel. The whole note is on
					     `title` — the same answer /admin/defaults already gives
					     an option row that has more to say than fits. -->
					<option value={c.id} title={c.notes ?? undefined}>
						{c.name ?? c.id}{preview ? ` — ${preview}` : ""}
					</option>
				{/each}
			</optgroup>
		{/each}
	</select>
	<span class="text-muted-foreground text-xs">Sampling</span>
	<select class="select text-xs" bind:value={samplingConfigId} {disabled}>
		<option value={null}>System default</option>
		{#each samplingList.filter((s) => s.id != null) as s (s.id)}
			<option value={s.id}>{s.name ?? s.id}</option>
		{/each}
	</select>
</div>
