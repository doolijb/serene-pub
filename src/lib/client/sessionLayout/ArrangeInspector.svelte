<script lang="ts" module>
	let headingCount = 0

	/** 1 → "1st", 2 → "2nd", 11 → "11th", 21 → "21st". */
	export function ordinal(n: number): string {
		const teen = n % 100
		if (teen >= 11 && teen <= 13) return `${n}th`
		const suffix = (
			{ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>
		)[n % 10]
		return `${n}${suffix ?? "th"}`
	}
</script>

<script lang="ts">
	/**
	 * The editor's inspector (lead decision D12, owner rulings 2026-11-05 R4 /
	 * R7 / R9): one pane, filled by whatever box the editor gives it. A chosen
	 * tab shows its settings and style; nothing chosen shows the layout's own
	 * look. There is no window — settings apply as they change.
	 */
	import { untrack } from "svelte"
	import type { PanelLayoutV2, PanelLook } from "@serene-pub/sdk"
	import WidgetSettingsPanel from "./WidgetSettingsPanel.svelte"
	import WidgetStyleSection from "./WidgetStyleSection.svelte"
	import LayoutLookSection from "./LayoutLookSection.svelte"
	import { ZONE_LABELS, type ZoneId } from "./sessionZones.svelte"
	import { widgetStylesStore } from "$lib/client/stores/widgetStyles.svelte"

	interface Props {
		/** The editor's working panels (for where the chosen tab sits). */
		panels: PanelLayoutV2
		/** The chosen tab's instance id, or null: the layout's own look. */
		chosenId: string | null
		/** A placed id's name on screen (the instance's title). */
		label: (id: string) => string
		/** A placed id's WIDGET name (the kind's title, e.g. "Messages" for "messages#journal"). */
		kindLabel: (id: string) => string
		/** The layout's look, effective. */
		look: PanelLook
		onLook: (patch: Partial<PanelLook>) => void
	}

	let { panels, chosenId, label, kindLabel, look, onLook }: Props = $props()

	/** This pane's heading id: the landmark around it takes its name from it. */
	export const headingId = `ai-heading-${++headingCount}`

	const styles = widgetStylesStore()

	const ZONES: ZoneId[] = ["left", "middle", "right"]

	/** Where the chosen tab sits; null when it is not placed. */
	let where = $derived.by(() => {
		if (!chosenId) return null
		for (const zone of ZONES) {
			const i = panels[zone].findIndex((p) => p.tabs.includes(chosenId))
			if (i >= 0) return { zone, nth: i + 1 }
		}
		return null
	})
	let chosen = $derived(where ? chosenId : null)

	let editing = $state(false)
	let section = $state<{ cancelEditor: () => boolean } | null>(null)

	/**
	 * The chosen widget is ARMED for as long as it is chosen: that keeps its
	 * in-box ring showing while the style editor previews on it, and releasing
	 * the arm is what drops any draft preview and save hold with it.
	 */
	$effect(() => {
		const id = chosen
		if (!id) return
		// Untracked: arming reads the pin it writes, and a re-run here would
		// disarm — dropping the draft preview — on every write.
		untrack(() => styles.arm(id))
		return () =>
			untrack(() => {
				styles.disarm(id)
				editing = false
			})
	})

	/**
	 * Escape, asked by the editor first: blur a field being typed in (so its
	 * `change` writes), then back out of the style editor. True when it handled
	 * the key (the style editor was open).
	 */
	export function escape(): boolean {
		// 🚧 A field being typed in commits before anything closes (the
		// 100-turn walk, B18: Escape lost a typed edit). Settings write on
		// `change`, which a box fires as it loses focus — never as it is torn
		// down — so it is let go of first.
		const active =
			typeof document !== "undefined" ? document.activeElement : null
		if (
			active instanceof HTMLInputElement ||
			active instanceof HTMLTextAreaElement ||
			active instanceof HTMLSelectElement
		)
			active.blur()
		// The editor answers Escape first — Cancel, putting the saved style back.
		return section?.cancelEditor() ?? false
	}
</script>

<div class="ai">
	{#if chosen && where}
		<header class="ai-head">
			<h2 class="ai-title" id={headingId}>{label(chosen)}</h2>
			<p class="ai-where">
				{kindLabel(chosen)} · {ZONE_LABELS[where.zone]}, {ordinal(
					where.nth
				)} panel
			</p>
		</header>
		<div class="ai-body">
			{#key chosen}
				{#if !editing}
					<WidgetSettingsPanel widgetId={chosen} />
				{/if}
				<WidgetStyleSection
					bind:this={section}
					bind:editing
					widgetId={chosen}
					label={label(chosen)}
					mount="remote"
				/>
			{/key}
		</div>
	{:else}
		<header class="ai-head">
			<h2 class="ai-title" id={headingId}>Layout settings</h2>
		</header>
		<div class="ai-body">
			<LayoutLookSection {look} onChange={onLook} />
		</div>
	{/if}
</div>

<style>
	.ai {
		display: flex;
		flex-direction: column;
		block-size: 100%;
		min-block-size: 0;
	}
	.ai-head {
		padding: 0.9rem 1rem 0.6rem;
	}
	.ai-title {
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 1.125rem;
		font-weight: 600;
	}
	.ai-where {
		margin: 0.15rem 0 0;
		font-size: 14px;
		opacity: 0.72;
	}
	.ai-body {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		flex: 1;
		min-block-size: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 0.25rem 1rem 1rem;
	}
</style>
