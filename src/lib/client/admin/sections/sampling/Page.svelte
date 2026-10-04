<script lang="ts">
	/**
	 * Admin → Sampling: the changelist (owner ruling 2026-09-27 — admin
	 * manages its objects Django-style instead of nesting the Sampling view).
	 * Every sampling config on the instance with its modality, the values it
	 * is recognised by, how many parameters it sends, and what uses it — the
	 * capability defaults (`capabilityDefaults[*].samplingConfigId`) and the
	 * pipelines whose sampling slots pick it (`pipelines:library`'s
	 * `samplingUsedBy`). Filters, search, bulk delete. A row opens its change
	 * form at `/admin/sampling/<id>`.
	 *
	 * Sampling configs belong to the instance, not to a user, so there is no
	 * owner column. Built-in configs cannot be deleted; a bulk delete names
	 * them as kept.
	 */
	import { getContext, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { requestWithInterest, useInterest } from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { docsHref } from "$lib/shared/utils/docsHref"
	import AdminChangelist from "$lib/client/components/admin/AdminChangelist.svelte"
	import type {
		AdminBulkAction,
		AdminChangelistColumn,
		AdminChangelistFilter
	} from "$lib/client/components/admin/changelist"
	import {
		SAMPLING_MODALITY_ORDER,
		samplingDefaultsFor,
		samplingDeletion,
		samplingEnabledCount,
		samplingKeyValues,
		samplingModality,
		samplingModalityWord,
		samplingEditability,
		type SamplingRow
	} from "./samplingAdmin"
	import { modalityWord } from "../connections/connectionsAdmin"

	type Row = SamplingRow

	const socket = useTypedSocket()
	const systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")
	const panelsCtx: PanelsCtx | undefined = getContext("panelsCtx")

	let rows = $state<Row[]>([])
	let loading = $state(true)
	useInterest<"samplingConfigs:list">("samplingConfigs:list", (msg) => {
		rows = msg.samplingConfigsList as Row[]
		loading = false
	})

	let usedBy = $state<Record<number, string[]>>({})
	$effect(() =>
		requestWithInterest("pipelines:library", {}, (res) => {
			usedBy = res.samplingUsedBy ?? {}
		})
	)

	/**
	 * Deletes this page asked for and has not heard back on. The response
	 * carries no id, so the page counts answers instead of matching them. A
	 * refusal (`:delete:error`) reaches the shell's generic toast; built-in
	 * rows, the one refusal a person can cause, are never sent.
	 */
	let deleting = 0
	useInterest<"samplingConfigs:delete">("samplingConfigs:delete", () => {
		if (!deleting) return
		deleting--
		if (!deleting) toaster.success({ title: "Deleted" })
	})

	onMount(() => socket.emit("samplingConfigs:list", {}))

	const defaults = $derived(systemSettingsCtx?.capabilityDefaults ?? {})
	const useCount = (r: Row) =>
		samplingDefaultsFor(r.id, defaults).length + (usedBy[r.id]?.length ?? 0)

	const columns: AdminChangelistColumn<Row>[] = [
		{
			key: "name",
			label: "Name",
			primary: true,
			text: (r) => r.name,
			sortValue: (r) => r.name
		},
		{
			key: "modality",
			label: "Modality",
			text: (r) => samplingModalityWord(r.shape),
			sortValue: (r) => SAMPLING_MODALITY_ORDER.indexOf(samplingModality(r.shape))
		},
		{
			key: "values",
			label: "Key values",
			text: (r) => samplingKeyValues(r)
		},
		{
			key: "sent",
			label: "Parameters",
			numeric: true,
			text: (r) => {
				const { on, total } = samplingEnabledCount(r)
				return `${on} of ${total} sent`
			},
			sortValue: (r) => samplingEnabledCount(r).on
		},
		{
			key: "usedBy",
			label: "Used by",
			custom: true,
			sortValue: (r) => useCount(r) || null
		},
		{
			key: "immutable",
			label: "Origin",
			text: (r) => (r.isImmutable ? "Built-in" : "Custom"),
			sortValue: (r) => (r.isImmutable ? 0 : 1)
		}
	]

	const filters: AdminChangelistFilter<Row>[] = [
		{
			key: "modality",
			label: "Modality",
			values: (r) => samplingModality(r.shape),
			optionLabel: modalityWord,
			order: SAMPLING_MODALITY_ORDER
		},
		{
			key: "immutable",
			label: "Origin",
			values: samplingEditability,
			optionLabel: (v) => (v === "immutable" ? "Built-in" : "Custom"),
			order: ["immutable", "editable"]
		},
		{
			key: "use",
			label: "Use",
			values: (r) => {
				const out: string[] = []
				if (samplingDefaultsFor(r.id, defaults).length) out.push("default")
				if (usedBy[r.id]?.length) out.push("pipeline")
				return out.length ? out : "unused"
			},
			optionLabel: (v) =>
				({
					default: "Holds a default",
					pipeline: "Picked by a pipeline",
					unused: "Unused"
				})[v] ?? v,
			order: ["default", "pipeline", "unused"]
		}
	]

	const bulkActions: AdminBulkAction<Row>[] = [
		{
			key: "delete",
			label: "Delete selected sampling configs…",
			icon: Icons.Trash2,
			destructive: true,
			confirm: (selected) => samplingDeletion(selected, defaults, usedBy),
			run: (selected) => {
				const ids = selected.filter((r) => !r.isImmutable).map((r) => r.id)
				deleting += ids.length
				for (const id of ids) socket.emit("samplingConfigs:delete", { id })
			}
		}
	]

	function openView() {
		panelsCtx?.openPanel({ key: "sampling" })
	}
</script>

<AdminChangelist
	title="Sampling"
	doc={docsHref("connections", "sampling-configs")}
	purpose="Named sets of generation settings, one modality each. Defaults and pipelines point at them."
	{rows}
	rowKey={(r) => r.id}
	{columns}
	{filters}
	{bulkActions}
	{loading}
	noun={{ singular: "sampling config", plural: "sampling configs" }}
	searchText={(r) =>
		`${r.name} ${samplingModalityWord(r.shape)} ${r.isImmutable ? "built-in" : "custom"} ${(usedBy[r.id] ?? []).join(" ")} ${samplingDefaultsFor(r.id, defaults)
			.map((d) => d.label)
			.join(" ")}`}
	rowHref={(r) => `/admin/sampling/${r.id}`}
	addHref="/admin/sampling/new"
	defaultSort="name"
	emptyIcon={Icons.SlidersHorizontal}
	emptyMessage="No sampling configs yet. Add one to decide how replies and images are generated."
>
	{#snippet headerActions()}
		<button type="button" class="btn btn-sm preset-tonal-surface" onclick={openView}>
			<Icons.SlidersHorizontal size={16} aria-hidden="true" />
			Open Sampling view
		</button>
	{/snippet}
	{#snippet cell(row, col)}
		{#if col.key === "usedBy"}
			{@const held = samplingDefaultsFor(row.id, defaults)}
			{@const pipelines = usedBy[row.id] ?? []}
			{#if held.length || pipelines.length}
				<span class="flex flex-wrap items-center gap-1">
					{#each held as h (h.capability)}
						<span
							class="preset-tonal-primary rounded-full px-2 py-0.5 text-[11px]"
							title="The default for {h.label}"
						>
							Default · {h.label}
						</span>
					{/each}
					{#if pipelines.length}
						<span
							class="border-surface-300-700 text-surface-600-400 rounded-full border px-2 py-0.5 text-[11px]"
							title={pipelines.join(", ")}
						>
							{pipelines.length}
							{pipelines.length === 1 ? "pipeline" : "pipelines"}
						</span>
					{/if}
				</span>
			{:else}
				<span class="text-surface-600-400">—</span>
			{/if}
		{/if}
	{/snippet}
</AdminChangelist>
