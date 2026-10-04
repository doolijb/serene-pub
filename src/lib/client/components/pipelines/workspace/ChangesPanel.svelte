<script lang="ts">
	/**
	 * The Changes view (22 §2.2): the configuration *is* its diff — every
	 * setting it departs from the shipped default by, saved deviations and the
	 * unsaved draft together. Per-row Reset queues a change; nothing writes
	 * until Save all.
	 *
	 * ⚠ **The list is the rows, not a comparison** (ruled 2026-09-10). A
	 * configuration stores deviations: `pipeline_config_values` holds a row only
	 * where the value differs from what the declaration says, so a row IS a
	 * change and a configuration nobody has tuned answers with an empty list.
	 * Before that ruling this view had to filter one out of every declared
	 * setting the config had materialized, which is why the empty state below
	 * can now be believed.
	 *
	 * **Reset all is the exception to "nothing writes until Save all"**, and it
	 * is on the same side of the line the rest of this page already draws:
	 * choosing, creating, renaming and deleting a configuration write straight
	 * through because they are acts on the configuration itself, and only edits
	 * to a SETTING draft. See the host's `resetAll`.
	 */
	import * as Icons from "@lucide/svelte"
	import AdminList, {
		type AdminColumn
	} from "$lib/client/components/admin/AdminList.svelte"

	export interface ChangeRow {
		option: Sockets.Pipelines.Option
		stepKey: string
		/** The agent (settings group) the step belongs to; "" for the one unheaded group. */
		agent: string
		stepLabel: string
		state: "pending" | "pending-reset" | "saved"
		current: unknown
	}

	interface Props {
		rows: ChangeRow[]
		/** Named in the Reset all button, so the act says what it lands on. */
		configName?: string
		/**
		 * Whether Reset all is offered at all — false for a shipped
		 * configuration (it has nothing to reset, because it IS the reset) and
		 * for one with no saved deviations. The server refuses the first case
		 * regardless; hiding a button is never what protects a row.
		 */
		canResetAll?: boolean
		onJump: (stepKey: string, optionId: string) => void
		onQueueReset: (option: Sockets.Pipelines.Option) => void
		onResetAll?: () => void
	}

	let {
		rows,
		configName,
		canResetAll = false,
		onJump,
		onQueueReset,
		onResetAll
	}: Props = $props()

	const columns: AdminColumn<ChangeRow>[] = [
		{ key: "agent", label: "Agent", value: (r) => r.agent },
		{ key: "step", label: "Step", value: (r) => r.stepLabel },
		{ key: "option", label: "Setting", value: (r) => r.option.label },
		{ key: "values", label: "Was → Now" },
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

<div class="flex flex-wrap items-start justify-between gap-2">
	<p class="text-surface-600-400 max-w-prose text-sm">
		Everything this configuration departs from the shipped default by —
		saved deviations and the unsaved draft together. A setting with no row
		here follows the default, including when the default later moves.
		Per-row Reset queues a change; nothing writes until Save.
	</p>
	{#if canResetAll}
		<button
			type="button"
			class="btn btn-sm preset-tonal-error shrink-0"
			onclick={() => onResetAll?.()}
			title="Delete every one of this configuration's saved deviations"
		>
			<Icons.RotateCcw size={14} />
			Reset all{configName ? ` in ${configName}` : ""}
		</button>
	{/if}
</div>
<AdminList
	{rows}
	{columns}
	searchText={(r) => `${r.option.label} ${r.stepLabel} ${r.agent}`}
	searchPlaceholder="Search changes…"
	defaultSort="step"
	storageKey="serene-pub:adminView:pipelineChanges"
	emptyMessage="Nothing is changed — this configuration is exactly what the pipeline ships."
	onRowClick={(r) => onJump(r.stepKey, r.option.id)}
>
	{#snippet cell(row, col)}
		{#if col.key === "option"}
			<span class="font-semibold">{row.option.label}</span>
		{:else if col.key === "step"}
			<span class="text-surface-700-300 text-xs">{row.stepLabel}</span>
		{:else if col.key === "agent"}
			<span class="text-surface-700-300 text-xs">{row.agent || "—"}</span>
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
						aria-label="Queue a reset to the inherited value"
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
					aria-label="Go to this setting"
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
