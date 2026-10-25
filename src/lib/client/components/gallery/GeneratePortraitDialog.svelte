<script lang="ts">
	/**
	 * 🚧 **Generate portrait** — the Gallery tab's dialog
	 * (DESIGN-image-generation §6.2; I8). How many pictures, Tags or Prose,
	 * the cost line (*2 pictures · 1 call*), the notices the picture step
	 * raises before the run (a reference the model cannot take), Generate.
	 *
	 * Presentational: the tab owns the sockets. Every change of count or
	 * style asks the tab for a fresh preview (`onPreview`).
	 */
	import * as Icons from "@lucide/svelte"
	import { Dialog, Portal, SegmentedControl } from "@skeletonlabs/skeleton-svelte"

	type Style = "tags" | "prose"

	interface Props {
		open: boolean
		characterName: string
		preview: Sockets.Characters.PreviewPortrait.Response | null
		previewing: boolean
		/** A portrait run is already going — Generate waits for it. */
		running: boolean
		onPreview: (count: number, style: Style) => void
		onGenerate: (count: number, style: Style) => void
	}

	let {
		open = $bindable(),
		characterName,
		preview,
		previewing,
		running,
		onPreview,
		onGenerate
	}: Props = $props()

	const COUNTS = [1, 2, 3, 4] as const
	const STYLE_LABELS: Record<Style, string> = { tags: "Tags", prose: "Prose" }

	let count = $state(2)
	let style = $state<Style>("tags")

	/** Ask for the preview each time the dialog opens or a choice moves. */
	$effect(() => {
		if (open) onPreview(count, style)
	})
</script>

<Dialog open={open} onOpenChange={(e) => (open = e.open)}>
	<Portal>
		<Dialog.Backdrop class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content
				class="card bg-surface-100-900 flex max-h-[90vh] w-full max-w-md flex-col gap-4 overflow-y-auto p-6 shadow-xl"
			>
				<header class="space-y-1">
					<Dialog.Title class="text-lg font-bold">Generate portrait</Dialog.Title>
					<p class="text-surface-600-400 text-sm">
						Draw a few pictures of {characterName} from their likeness to
						choose from. They are added to the gallery; nothing changes
						until you pick one.
					</p>
				</header>
				<form
					class="flex flex-col gap-4"
					data-testid="portrait-form"
					onsubmit={(e) => {
						e.preventDefault()
						onGenerate(count, style)
					}}
				>
					<fieldset class="space-y-1">
						<legend class="label-text mb-1">How many</legend>
						<div class="flex gap-1" role="radiogroup" aria-label="How many pictures">
							{#each COUNTS as n (n)}
								<button
									type="button"
									role="radio"
									aria-checked={count === n}
									class="btn btn-sm min-w-10 {count === n
										? 'preset-pressed'
										: 'preset-tonal-surface'}"
									onclick={() => (count = n)}
								>
									{n}
								</button>
							{/each}
						</div>
					</fieldset>

					<div class="space-y-1">
						<SegmentedControl
							value={style}
							onValueChange={(d) => (style = (d.value ?? "tags") as Style)}
							aria-describedby="portrait-style-hint"
						>
							<SegmentedControl.Label class="label-text">Style</SegmentedControl.Label>
							<SegmentedControl.Control>
								<SegmentedControl.Indicator />
								{#each ["tags", "prose"] as const as option (option)}
									<SegmentedControl.Item value={option}>
										<SegmentedControl.ItemText>
											{STYLE_LABELS[option]}
										</SegmentedControl.ItemText>
										<SegmentedControl.ItemHiddenInput />
									</SegmentedControl.Item>
								{/each}
							</SegmentedControl.Control>
						</SegmentedControl>
						<p class="text-surface-600-400 text-xs" id="portrait-style-hint">
							{#if style === "tags"}
								A list of short tags — what most local image models read best.
							{:else}
								A plain sentence — what hosted image services read best.
							{/if}
						</p>
					</div>

					<div class="space-y-1" aria-live="polite">
						{#if previewing}
							<p class="text-surface-600-400 text-sm">Working out the cost…</p>
						{:else if preview?.line}
							<p class="text-sm font-medium" data-testid="portrait-plan-line">
								{preview.line}
							</p>
						{/if}
						{#if preview?.refusal && !previewing}
							<p class="text-error-600-400 text-sm" role="alert">{preview.refusal}</p>
						{/if}
						{#each preview?.notices ?? [] as notice (notice)}
							<p class="text-warning-700-300 flex gap-1.5 text-xs">
								<Icons.Info size={14} class="mt-0.5 shrink-0" aria-hidden="true" />
								<span>{notice}</span>
							</p>
						{/each}
						{#if preview?.review && !preview.refusal}
							<p class="text-surface-600-400 text-xs" data-testid="portrait-review-hint">
								You'll see the prompt before anything is drawn, and can change it.
							</p>
						{/if}
					</div>

					<footer class="flex justify-end gap-2">
						<button type="button" class="btn preset-tonal-surface" onclick={() => (open = false)}>
							Cancel
						</button>
						<button
							type="submit"
							class="btn preset-filled-primary-500"
							disabled={previewing || running || !preview || !!preview.refusal}
						>
							<Icons.WandSparkles size={16} aria-hidden="true" />
							Generate
						</button>
					</footer>
				</form>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
