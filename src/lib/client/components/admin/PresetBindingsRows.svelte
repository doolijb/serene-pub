<script lang="ts" module>
	export type PresetBindings = Record<string, { spec: string; config?: number }>
</script>

<script lang="ts">
	/**
	 * A preset's event bindings as rows: one per bindable slot of its genre
	 * (open slots take any number of pipelines, so nobody binds them), each a
	 * **Pipeline** choice among the slot's candidates — the pipelines whose
	 * inlet lock answers it — and a **Configuration** choice among that
	 * pipeline's saved configurations.
	 *
	 * Lifted from Admin › Presets › one preset's "Event bindings" for the
	 * genre change form, which writes its default preset's bindings
	 * (PLAN-pipeline-canvas-and-genre-authoring §6.2, ruling 5). The rows are
	 * the caller's draft: `bindings` is bindable and replaced whole on every
	 * pick, so the caller's unsaved-edits snapshot sees the change.
	 */
	import * as Icons from "@lucide/svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { eventDisplayName } from "$lib/client/utils/eventName"

	interface Props {
		slots: readonly Sockets.SessionAdmin.GenreDetail.Slot[]
		bindings: PresetBindings
		/** Every saved configuration (`pipelines:configsIndex`). */
		configs: readonly Sockets.Pipelines.ConfigsIndex.Row[]
		/** The saved bindings that do not resolve here, keyed by event. */
		stale?: readonly { event: string; bound: string; reason: string }[]
		readonly?: boolean
	}
	let {
		slots,
		bindings = $bindable(),
		configs,
		stale = [],
		readonly = false
	}: Props = $props()

	const bindableSlots = $derived(slots.filter((s) => !s.open))
	const staleByEvent = $derived(new Map(stale.map((b) => [b.event, b])))
	const configsOf = (spec: string) => configs.filter((c) => c.specSlug === spec)

	function setSpec(event: string, spec: string) {
		if (!spec) {
			const next = { ...bindings }
			delete next[event]
			bindings = next
			return
		}
		if (bindings[event]?.spec === spec) return
		// A new pipeline means its configurations — the old pick is meaningless.
		bindings = { ...bindings, [event]: { spec } }
	}
	function setConfig(event: string, raw: string) {
		const b = bindings[event]
		if (!b) return
		bindings = {
			...bindings,
			[event]: raw ? { spec: b.spec, config: Number(raw) } : { spec: b.spec }
		}
	}
</script>

{#if !bindableSlots.length}
	<p class="text-surface-600-400 text-sm">This genre declares no event a preset binds.</p>
{/if}

{#each bindableSlots as slot (slot.event)}
	{@const bound = bindings[slot.event]}
	{@const gone = staleByEvent.get(slot.event)}
	<div class="bg-surface-50-950 flex flex-col gap-2 rounded-[10px] p-3" data-event={slot.event}>
		<div class="flex flex-wrap items-center gap-2">
			<span class="text-sm font-semibold" title={slot.event}>{eventDisplayName(slot.event)}</span>
			<span
				class="{slot.required
					? 'preset-tonal-primary'
					: 'preset-tonal-surface'} rounded-full px-1.5 py-0.5 text-[11px]"
			>
				{slot.required ? "required" : "optional"}
			</span>
			{#if slot.required && !bound?.spec}
				<span class="text-warning-600-400 text-xs">
					<Icons.TriangleAlert size={12} class="mr-0.5 inline" aria-hidden="true" />unbound
				</span>
			{/if}
			{#if gone}
				<span class="text-warning-600-400 text-xs" title={gone.reason}>
					<Icons.TriangleAlert size={12} class="mr-0.5 inline" aria-hidden="true" />{gone.bound} is not
					available
				</span>
			{/if}
		</div>
		<div class="grid gap-2 @min-[36rem]/content:grid-cols-2">
			<div class="flex flex-col gap-1 text-xs">
				<span class="text-surface-600-400" aria-hidden="true">Pipeline</span>
				<Select
					label="Pipeline for {eventDisplayName(slot.event)}"
					labelHidden
					disabled={readonly}
					placeholder={slot.required ? "— choose —" : undefined}
					emptyMessage="No published pipeline answers this event."
					options={[
						...(slot.required ? [] : [{ value: "", label: "— unbound —" }]),
						...slot.candidates.map((c) => ({ value: c.slug, label: c.name }))
					]}
					value={bound?.spec ?? ""}
					onValueChange={(v) => setSpec(slot.event, v)}
				/>
			</div>
			<div class="flex flex-col gap-1 text-xs">
				<span class="text-surface-600-400" aria-hidden="true">Configuration</span>
				<Select
					label="Configuration for {eventDisplayName(slot.event)}"
					labelHidden
					disabled={readonly || !bound?.spec}
					options={[
						{ value: "", label: "shipped default" },
						...(bound?.spec
							? configsOf(bound.spec).map((c) => ({
									value: String(c.id),
									label: `${c.isDefault ? "★ " : ""}${c.name}`
								}))
							: [])
					]}
					value={bound?.config != null ? String(bound.config) : ""}
					onValueChange={(v) => setConfig(slot.event, v)}
				/>
			</div>
		</div>
		{#if bound?.spec}
			<a
				class="text-surface-600-400 self-start text-[11px] underline"
				href="/admin/pipelines/{encodeURIComponent(bound.spec)}{bound.config != null
					? `?config=${bound.config}`
					: ''}"
			>
				Open in workspace
			</a>
		{/if}
	</div>
{/each}
