<script lang="ts">
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import { notePreview } from "$lib/shared/utils/connectionNotes"
	import Select, {
		type SelectOption
	} from "$lib/client/components/inputs/Select.svelte"

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

	// "System default" first and ungrouped, then one heading per service.
	// `notePreview` keeps a pasted note from making a row run on; the old
	// native option also carried the whole note as a `title`, which Select
	// rows do not take.
	const connectionOptions: SelectOption[] = $derived([
		{ value: "", label: "System default" },
		...byService.flatMap(([service, conns]) =>
			conns.map((c) => {
				const preview = notePreview(c.notes)
				return {
					value: String(c.id),
					label: `${c.name ?? c.id}${preview ? ` — ${preview}` : ""}`,
					group: service
				}
			})
		)
	])
	const samplingOptions: SelectOption[] = $derived([
		{ value: "", label: "System default" },
		...samplingList
			.filter((s) => s.id != null)
			.map((s) => ({ value: String(s.id), label: `${s.name ?? s.id}` }))
	])
</script>

{#if label}
	<p class="text-sm font-semibold">{label}</p>
{/if}
<!-- The visible column labels are visual only; each Select names itself,
     prefixed with the picker's own label so two pickers on one form stay
     distinguishable to a screen reader. -->
<div class="grid grid-cols-[5.5rem_1fr] items-center gap-x-2 gap-y-1.5">
	<span class="text-surface-600-400 text-xs" aria-hidden="true">Connection</span>
	<Select
		label={label ? `${label} connection` : "Connection"}
		labelHidden
		class="min-w-0 text-xs"
		{disabled}
		options={connectionOptions}
		bind:value={
			() => (connectionId == null ? "" : String(connectionId)),
			(v) => (connectionId = v ? Number(v) : null)
		}
	/>
	<span class="text-surface-600-400 text-xs" aria-hidden="true">Sampling</span>
	<Select
		label={label ? `${label} sampling` : "Sampling"}
		labelHidden
		class="min-w-0 text-xs"
		{disabled}
		options={samplingOptions}
		bind:value={
			() => (samplingConfigId == null ? "" : String(samplingConfigId)),
			(v) => (samplingConfigId = v ? Number(v) : null)
		}
	/>
</div>
