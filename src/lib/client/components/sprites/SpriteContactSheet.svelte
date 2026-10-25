<script lang="ts">
	/**
	 * 🚧 The Sprites tab's **contact sheet** (DESIGN-image-generation §6.3;
	 * I5): one tile per sprite label a fill draws, filling as the run goes.
	 * Not the Album widget — the Album shows a session's pictures; this shows
	 * one fill's, labelled, with what to do about each.
	 *
	 * Per tile: **Keep** (nothing to do — it is filed already; the tile just
	 * says so), **Redo** (draw that label again; the new picture is added as a
	 * variant), and **Move to** another label (drag the tile onto another, or
	 * use its menu — the sprite row moves, the picture with it). When the
	 * pair's sheet says `expressions`, the menu also offers **Re-express from
	 * neutral** (§6.3). A label the
	 * run brought nothing for is an empty tile with Redo.
	 *
	 * Presentational: the tab owns the run and hands the tiles in.
	 */
	import * as Icons from "@lucide/svelte"
	import RowMenu from "$lib/client/components/menus/RowMenu.svelte"
	import type { ContactTile } from "./contactSheet"

	interface Props {
		tiles: ContactTile[]
		running: boolean
		/** What the run is doing, in a sentence. */
		statusText?: string
		percent?: number | null
		error?: string | null
		/** May tiles be moved to another label (the card's owner). */
		canMove?: boolean
		onKeep?: (label: string) => void
		onRedo?: (label: string) => void
		onRedoAll?: () => void
		onMove?: (spriteId: number, toLabel: string) => void
		/**
		 * 🚧 May this tile be redrawn from the set's neutral sprite
		 * (*Re-express from neutral*, §6.3) — the pair's sheet says
		 * `expressions` and the set has a neutral picture.
		 */
		canReexpress?: (label: string) => boolean
		/** Labels with a re-express in flight. */
		reexpressing?: ReadonlySet<string>
		onReexpress?: (label: string) => void
		onStop?: () => void
		onClose?: () => void
	}

	let {
		tiles,
		running,
		statusText = "",
		percent = null,
		error = null,
		canMove = false,
		onKeep,
		onRedo,
		onRedoAll,
		onMove,
		canReexpress = () => false,
		reexpressing = new Set<string>(),
		onReexpress,
		onStop,
		onClose
	}: Props = $props()

	let done = $derived(tiles.filter((t) => t.state === "attached").length)
	let menuFor = $state<string | null>(null)
	let dragging = $state<number | null>(null)
	let dropOn = $state<string | null>(null)

	function drop(label: string) {
		const id = dragging
		dragging = null
		dropOn = null
		if (id == null) return
		const from = tiles.find((t) => t.spriteId === id)
		if (from && from.label !== label) onMove?.(id, label)
	}
</script>

<section class="panel-card space-y-3 p-3" aria-labelledby="contact-sheet-title">
	<header class="flex flex-wrap items-center gap-2">
		<h3 id="contact-sheet-title" class="text-sm font-medium">
			Contact sheet
		</h3>
		<span
			class="text-surface-600-400 text-xs"
			data-testid="contact-sheet-count"
		>
			{done} of {tiles.length} filed
		</span>
		<span class="flex-1"></span>
		{#if running}
			<button
				type="button"
				class="btn btn-sm preset-tonal-surface"
				onclick={() => onStop?.()}
			>
				<Icons.Square size={14} aria-hidden="true" />
				Stop
			</button>
		{:else}
			<button
				type="button"
				class="btn btn-sm preset-tonal-primary"
				onclick={() => onRedoAll?.()}
				disabled={!tiles.length}
			>
				<Icons.RefreshCw size={14} aria-hidden="true" />
				Redo all
			</button>
			<button
				type="button"
				class="btn btn-sm preset-tonal-surface"
				onclick={() => onClose?.()}
				aria-label="Close the contact sheet"
			>
				<Icons.X size={14} aria-hidden="true" />
			</button>
		{/if}
	</header>

	{#if running || statusText}
		<div class="space-y-1" role="status" aria-live="polite">
			<p class="text-surface-600-400 text-xs">
				{statusText || "Drawing…"}{#if percent != null && running}
					· {Math.round(percent)}%{/if}
			</p>
			{#if running}
				<div
					class="bg-surface-200-800 h-1 overflow-hidden rounded-full"
				>
					<div
						class="bg-primary-500 h-full transition-[width]"
						class:animate-pulse={percent == null}
						style:width="{percent ?? 100}%"
					></div>
				</div>
			{/if}
		</div>
	{/if}
	{#if error}
		<p class="text-error-600-400 text-sm" role="alert">{error}</p>
	{/if}

	<ul class="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2">
		{#each tiles as tile (tile.label)}
			{@const moves =
				canMove && tile.spriteId != null && tiles.length > 1}
			{@const express = canReexpress(tile.label)}
			<li
				class="border-surface-200-800 space-y-1 rounded-md border p-1.5"
				class:ring-2={dropOn === tile.label}
				class:ring-primary-500={dropOn === tile.label}
				data-testid="contact-tile"
				data-label={tile.label}
				data-state={tile.state}
				ondragover={(e) => {
					if (dragging == null) return
					e.preventDefault()
					dropOn = tile.label
				}}
				ondragleave={() => {
					if (dropOn === tile.label) dropOn = null
				}}
				ondrop={(e) => {
					e.preventDefault()
					drop(tile.label)
				}}
			>
				<div class="relative aspect-[3/4] overflow-hidden rounded">
					{#if tile.src}
						<img
							src={tile.src}
							alt="{tile.label} sprite"
							class="h-full w-full object-contain"
							draggable={canMove && tile.spriteId != null}
							ondragstart={() =>
								(dragging = tile.spriteId ?? null)}
							ondragend={() => {
								dragging = null
								dropOn = null
							}}
						/>
					{:else if tile.state === "waiting"}
						<div
							class="text-surface-500 flex h-full items-center justify-center"
						>
							<Icons.Loader2
								class="h-5 w-5 animate-spin"
								aria-hidden="true"
							/>
							<span class="sr-only">Drawing {tile.label}</span>
						</div>
					{:else}
						<div
							class="text-surface-500 flex h-full items-center justify-center border-2 border-dashed"
						>
							<Icons.ImageOff size={18} aria-hidden="true" />
							<span class="sr-only">
								No picture came back for {tile.label}
							</span>
						</div>
					{/if}
					{#if tile.kept}
						<span
							class="bg-success-500 absolute top-1 left-1 rounded-full p-0.5 text-white"
							title="Kept"
						>
							<Icons.Check size={12} aria-hidden="true" />
						</span>
					{/if}
				</div>
				<p class="truncate text-xs font-medium" title={tile.label}>
					{tile.label}
				</p>
				{#if !running && (tile.state === "attached" || tile.state === "missing")}
					<div class="flex items-center gap-1">
						{#if tile.state === "attached" && !tile.kept}
							<button
								type="button"
								class="btn btn-sm preset-tonal-success px-2"
								onclick={() => onKeep?.(tile.label)}
								aria-label="Keep the {tile.label} sprite"
							>
								Keep
							</button>
						{/if}
						<button
							type="button"
							class="btn btn-sm preset-tonal-surface px-2"
							onclick={() => onRedo?.(tile.label)}
							aria-label="Draw {tile.label} again"
						>
							Redo
						</button>
						{#if moves || express}
							<RowMenu
								label={tile.label}
								width={220}
								triggerLabel="More actions for the {tile.label} sprite"
								triggerClass="btn btn-sm preset-tonal-surface px-1"
								bind:open={
									() => menuFor === tile.label,
									(v) => (menuFor = v ? tile.label : null)
								}
								items={[
									express && {
										label: reexpressing.has(tile.label)
											? "Re-expressing…"
											: "Re-express from neutral",
										icon: Icons.Sparkles,
										disabled: reexpressing.has(tile.label),
										onSelect: () => {
											menuFor = null
											onReexpress?.(tile.label)
										}
									},
									...(moves
										? tiles
												.filter(
													(o) =>
														o.label !== tile.label
												)
												.map((o) => ({
													label: `Move to ${o.label}`,
													icon: Icons.Tag,
													onSelect: () => {
														menuFor = null
														onMove?.(
															tile.spriteId!,
															o.label
														)
													}
												}))
										: [])
								]}
							>
								{#snippet trigger()}
									<Icons.EllipsisVertical
										class="h-3 w-3"
										aria-hidden="true"
									/>
								{/snippet}
							</RowMenu>
						{/if}
					</div>
				{/if}
			</li>
		{/each}
	</ul>
</section>
