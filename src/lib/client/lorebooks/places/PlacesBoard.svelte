<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { SvelteMap } from "svelte/reactivity"
	import EmptyState from "$lib/client/components/EmptyState.svelte"
	import {
		PLACES_EMPTY_LINE,
		placesHeaderLine,
		type PlaceRegion,
		type PlacesMap
	} from "./placesMap"

	/**
	 * The map: boxes inside boxes, lines between them, pins in the rooms.
	 *
	 * Containment is the nesting and nothing else, so a box's position on screen
	 * is its position in the tree — a layout that moved boxes to suit the lines
	 * would be drawing a claim the data does not make. The lines are measured
	 * against the boxes after they land, which is why the overlay is a sibling
	 * of the boxes rather than something they are drawn inside.
	 */
	interface Props {
		map: PlacesMap
		selectedEntryId: number | null
		onOpenEntry: (entryId: number) => void
		onOpenCast: (castId: number) => void
	}

	let { map, selectedEntryId, onOpenEntry, onOpenCast }: Props = $props()

	let containerEl = $state<HTMLDivElement | undefined>(undefined)
	/** Reactive so the overlay re-measures as boxes arrive and leave. */
	const boxEls = new SvelteMap<number, HTMLElement>()

	interface Point {
		x: number
		y: number
	}
	let centers = $state<Map<number, Point>>(new Map())

	function measure() {
		if (!containerEl) return
		const base = containerEl.getBoundingClientRect()
		const next = new Map<number, Point>()
		for (const [id, el] of boxEls) {
			const box = el.getBoundingClientRect()
			next.set(id, {
				x: box.left - base.left + box.width / 2,
				y: box.top - base.top + box.height / 2
			})
		}
		centers = next
	}

	function register(el: HTMLElement, id: number) {
		boxEls.set(id, el)
		return {
			destroy() {
				boxEls.delete(id)
			}
		}
	}

	// Re-measure whenever the boxes or the map change; the read of `boxEls.size`
	// and of the map is what makes this run again rather than once.
	$effect(() => {
		boxEls.size
		map.regions
		measure()
	})

	$effect(() => {
		if (!containerEl) return
		const observer = new ResizeObserver(() => measure())
		observer.observe(containerEl)
		return () => observer.disconnect()
	})

	let drawnLinks = $derived(
		map.links
			.map((link) => ({
				link,
				from: centers.get(link.fromId),
				to: centers.get(link.toId)
			}))
			.filter((l) => l.from && l.to)
	)

	/** Links whose far end is not a box on screen, counted rather than drawn. */
	let offMapLinks = $derived(map.links.length - drawnLinks.length)
</script>

<div class="flex min-h-0 flex-1 flex-col gap-2" data-lore-graph="places">
	<p class="text-surface-700-300 text-sm" data-places-headline>
		{placesHeaderLine(map.mapped, map.linkCount)}
	</p>

	{#if map.regions.length === 0}
		<EmptyState icon={Icons.Map} message={PLACES_EMPTY_LINE} />
	{:else}
		<div
			class="bg-surface-200-800 relative min-h-72 flex-1 overflow-auto rounded-lg p-4"
			bind:this={containerEl}
			data-places-canvas
		>
			<svg
				class="pointer-events-none absolute inset-0 h-full w-full"
				aria-hidden="true"
			>
				<defs>
					<marker
						id="placeArrow"
						markerWidth="8"
						markerHeight="6"
						refX="8"
						refY="3"
						orient="auto"
					>
						<polygon
							points="0 0, 8 3, 0 6"
							fill="#6b7280"
							opacity="0.7"
						/>
					</marker>
				</defs>
				{#each drawnLinks as { link, from, to } (link.id)}
					<line
						x1={from!.x}
						y1={from!.y}
						x2={to!.x}
						y2={to!.y}
						stroke="#6b7280"
						stroke-width="1.5"
						stroke-dasharray="6 3"
						marker-end="url(#placeArrow)"
					/>
					<text
						x={(from!.x + to!.x) / 2}
						y={(from!.y + to!.y) / 2 - 4}
						text-anchor="middle"
						font-size="10"
						fill="#9ca3af"
					>
						{link.label}
					</text>
				{/each}
			</svg>

			<div class="relative flex flex-col gap-3">
				{#each map.regions as region (region.id)}
					{@render box(region)}
				{/each}
			</div>
		</div>

		{#if offMapLinks > 0}
			<p class="text-surface-600-400 text-xs">
				{offMapLinks} link{offMapLinks === 1 ? "" : "s"} reach{offMapLinks ===
				1
					? "es"
					: ""} somewhere this scope does not hold.
			</p>
		{/if}
	{/if}
</div>

{#snippet box(region: PlaceRegion)}
	<div
		class="border-border bg-surface-100-900/80 rounded-lg border p-2"
		class:preset-tonal-primary={selectedEntryId === region.id}
		data-place-region={region.id}
	>
		<div class="flex flex-wrap items-center gap-1.5">
			<button
				type="button"
				class="min-w-0 flex-1 truncate text-left text-sm font-semibold"
				use:register={region.id}
				onclick={() => onOpenEntry(region.id)}
			>
				{region.name}
			</button>
			{#each region.pins as pin (pin.castId)}
				<button
					type="button"
					class="chip preset-tonal-secondary gap-1 text-[10px]"
					title={pin.relationshipType}
					data-place-pin={pin.castId}
					onclick={() => onOpenCast(pin.castId)}
				>
					<Icons.MapPin size={11} aria-hidden="true" />
					{pin.name}
				</button>
			{/each}
		</div>
		{#if region.children.length > 0}
			<div class="mt-2 flex flex-col gap-2 pl-3">
				{#each region.children as child (child.id)}
					{@render box(child)}
				{/each}
			</div>
		{/if}
	</div>
{/snippet}
