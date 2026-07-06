<script lang="ts">
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

	interface Props {
		label?: string
		connectionsList: { id?: number | null; name?: string | null; type?: string | null }[]
		samplingList: { id?: number | null; name?: string | null }[]
		connectionId?: number | null
		samplingConfigId?: number | null
		disabled?: boolean
	}

	let {
		label,
		connectionsList,
		samplingList,
		connectionId = $bindable(null),
		samplingConfigId = $bindable(null),
		disabled = false
	}: Props = $props()
</script>

{#if label}
	<p class="text-sm font-semibold">{label}</p>
{/if}
<div class="grid grid-cols-[5.5rem_1fr] items-center gap-x-2 gap-y-1.5">
	<span class="text-muted-foreground text-xs">Connection</span>
	<select class="select text-xs" bind:value={connectionId} {disabled}>
		<option value={null}>System default</option>
		{#each connectionsList.filter((c) => c.id != null) as c (c.id)}
			{@const typeLabel = CONNECTION_TYPE.options.find((t) => t.value === c.type)?.label ?? c.type}
			<option value={c.id}>{c.name ?? c.id} ({typeLabel})</option>
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
