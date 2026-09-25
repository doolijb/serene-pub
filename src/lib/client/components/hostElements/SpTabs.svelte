<script lang="ts">
	/**
	 * `sp-tabs` — the list is drawn from its `sp-tab` children; its
	 * `sp-tab-panel` children are real content and show by `value` (each
	 * reads the shared `state.value`, and takes its id from `state.base` so
	 * a trigger's `aria-controls` names it).
	 */
	import { Tabs } from "@skeletonlabs/skeleton-svelte"
	import { flag, type SpElementProps } from "./spElement.svelte"

	let { attrs, writes, emit, slot, items, seatItem, state }: SpElementProps = $props()
	const base = `sp-tabs-${Math.random().toString(36).slice(2)}`
	$effect.pre(() => {
		state.base = base
	})
	$effect(() => {
		void writes.value
		const first = items[0]?.attrs.value ?? null
		state.value = attrs.value ?? (state.value as string | null) ?? first
	})
</script>

<Tabs
	value={(state.value as string | null) ?? ""}
	ids={{ trigger: (v: string) => `${base}-tab-${v}`, content: (v: string) => `${base}-panel-${v}` }}
	onValueChange={(e) => {
		state.value = e.value
		emit("change", { value: e.value })
	}}
>
	<Tabs.List class="sp-tabs-list" aria-label={attrs.label ?? undefined}>
		<!-- Keyed by position: two tabs may share a value. Each trigger shows
		     its `sp-tab`'s own content (an icon, a label). -->
		{#each items as tab, i (i)}
			<Tabs.Trigger
				value={tab.attrs.value ?? String(i)}
				disabled={flag(tab.attrs.disabled)}
				class="sp-tab-trigger {tab.attrs.class ?? ''}"
				title={tab.attrs.label ?? undefined}
				aria-label={tab.attrs.label ?? undefined}
			>
				<span class="sp-tab-trigger-body" {@attach seatItem(tab.el)}></span>
			</Tabs.Trigger>
		{/each}
		<div class="sp-tabs-list-end" style:display="contents" {@attach slot("list-end")}></div>
	</Tabs.List>
	<div class="sp-tabs-panels" {@attach slot()}></div>
</Tabs>
