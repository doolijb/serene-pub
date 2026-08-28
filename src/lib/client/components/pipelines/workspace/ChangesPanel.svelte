<script lang="ts">
	/**
	 * The Changes view (22 §2.2): the configuration *is* its diff — every
	 * setting it holds, saved overrides and the unsaved draft together. Reset
	 * queues a change; nothing writes until Save all.
	 */
	import * as Icons from "@lucide/svelte"
	import AdminList, {
		type AdminColumn
	} from "$lib/client/components/admin/AdminList.svelte"

	export interface ChangeRow {
		option: Sockets.Pipelines.Option
		stepKey: string
		stepLabel: string
		state: "pending" | "pending-reset" | "saved"
		current: unknown
	}

	interface Props {
		rows: ChangeRow[]
		onJump: (stepKey: string, optionId: string) => void
		onQueueReset: (option: Sockets.Pipelines.Option) => void
	}

	let { rows, onJump, onQueueReset }: Props = $props()

	const columns: AdminColumn<ChangeRow>[] = [
		{ key: "option", label: "Option", value: (r) => r.option.label },
		{ key: "step", label: "Step", value: (r) => r.stepLabel },
		{ key: "facet", label: "Facet", value: (r) => r.option.facet },
		{ key: "values", label: "Shipped → Current" },
		{
			key: "state",
			label: "State",
			value: (r) =>
				r.state === "saved" ? 2 : r.state === "pending" ? 0 : 1
		},
		{ key: "actions", label: "", class: "w-px text-right" }
	]

	/** A value, said briefly: refs and objects compress, long text elides. */
	const fmtVal = (v: unknown): string => {
		if (v == null) return "—"
		if (typeof v === "string")
			return v.length > 60 ? `${v.slice(0, 57)}…` : v || "—"
		if (typeof v === "object") {
			const s = JSON.stringify(v)
			return s.length > 60 ? `${s.slice(0, 57)}…` : s
		}
		return String(v)
	}
</script>

<p class="text-surface-600-400 text-sm">
	Every setting this configuration holds — saved overrides and the unsaved
	draft together. Reset queues a change; nothing writes until Save all.
</p>
<AdminList
	{rows}
	{columns}
	searchText={(r) => `${r.option.label} ${r.stepLabel} ${r.option.facet}`}
	searchPlaceholder="Search changes…"
	defaultSort="step"
	storageKey="serene-pub:adminView:pipelineChanges"
	emptyMessage="Nothing is overridden — this configuration inherits everything."
	onRowClick={(r) => onJump(r.stepKey, r.option.id)}
>
	{#snippet cell(row, col)}
		{#if col.key === "option"}
			<span class="font-semibold">{row.option.label}</span>
		{:else if col.key === "step"}
			<span class="text-surface-700-300 text-xs">{row.stepLabel}</span>
		{:else if col.key === "facet"}
			<span class="text-surface-600-400 text-xs">{row.option.facet}</span>
		{:else if col.key === "values"}
			<span class="font-mono text-xs">
				<span class="text-surface-600-400">
					{fmtVal(row.option.authorDefault)}
				</span>
				<span aria-hidden="true"> → </span>
				<span
					class={row.state === "pending-reset"
						? "line-through opacity-60"
						: "font-semibold"}
				>
					{fmtVal(row.current)}
				</span>
			</span>
		{:else if col.key === "state"}
			{#if row.state === "pending"}
				<span class="preset-tonal-warning rounded-full px-2 py-0.5 text-xs"
					>pending</span
				>
			{:else if row.state === "pending-reset"}
				<span class="preset-tonal-warning rounded-full px-2 py-0.5 text-xs"
					>resets on save</span
				>
			{:else}
				<span
					class="preset-tonal-secondary rounded-full px-2 py-0.5 text-xs"
					>saved</span
				>
			{/if}
		{:else if col.key === "actions"}
			<span class="flex justify-end gap-1.5">
				{#if row.state !== "pending-reset"}
					<button
						class="btn btn-sm preset-tonal-surface"
						title="Queue a reset to the inherited value"
						onclick={(e) => {
							e.stopPropagation()
							onQueueReset(row.option)
						}}
					>
						<Icons.RotateCcw size={13} />
					</button>
				{/if}
				<button
					class="btn btn-sm preset-tonal-surface"
					title="Go to this setting"
					onclick={(e) => {
						e.stopPropagation()
						onJump(row.stepKey, row.option.id)
					}}
				>
					<Icons.ArrowRight size={13} />
				</button>
			</span>
		{/if}
	{/snippet}
</AdminList>
