<!--
	The media lightbox (composer attachments plan §3.4, lane F): the page's
	answer to `view-image`. One image, or a message's images to page through —
	←/→, a swipe, or the side buttons — with a counter, a Download for the
	app's own files, and an Info pane reading the file's record: the prompt,
	seed and model of a generated image; the name, type and size of an upload.

	Skeleton's Dialog is the modal: it traps focus while open, closes on Esc
	and on the backdrop, and hands focus back to whatever opened it (the strip's
	tile). Every control is a 44px target.
-->
<script lang="ts">
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { SvelteMap, SvelteSet } from "svelte/reactivity"
	import type { MediaInfoV1 } from "$lib/shared/media/info"
	import {
		displaySrc,
		downloadHref,
		fetchMediaInfo,
		infoRows,
		stepIndex,
		swipeDirection,
		type LightboxState
	} from "./mediaLightbox"

	interface Props {
		open: boolean
		onOpenChange: (e: { open: boolean }) => void
		/** What to show; `lightboxStateOf` reads it off a `view-image`. */
		state: LightboxState | null
		/** Reads a file's info; the page's `fetch` unless a test passes its own. */
		loadInfo?: (mediaRef: string) => Promise<MediaInfoV1 | null>
	}

	let {
		open = $bindable(),
		onOpenChange,
		state: viewState,
		loadInfo = (ref: string) => fetchMediaInfo(ref)
	}: Props = $props()

	let index = $state(0)
	let showInfo = $state(false)
	/** Info by media ref: the record, null when it could not be read. */
	const infos = new SvelteMap<string, MediaInfoV1 | null>()
	/** Images that failed to load, by src. */
	const broken = new SvelteSet<string>()

	const images = $derived(viewState?.images ?? [])
	const count = $derived(images.length)
	const current = $derived(images[index] ?? null)
	const many = $derived(count > 1)
	const download = $derived(current ? downloadHref(current) : null)
	const title = $derived(current?.caption ?? "Image")
	const info = $derived(
		current?.mediaRef ? infos.get(current.mediaRef) : undefined
	)
	const infoLoading = $derived(
		!!current?.mediaRef && !infos.has(current.mediaRef)
	)

	// Each open starts where it was asked to, with the pane as it was left.
	$effect(() => {
		if (open && viewState) index = viewState.index
	})

	// The pane reads the shown file's record once, when it is open.
	$effect(() => {
		const ref = current?.mediaRef
		if (!open || !showInfo || !ref || infos.has(ref)) return
		let live = true
		void loadInfo(ref).then((got) => {
			if (live) infos.set(ref, got)
		})
		return () => {
			live = false
		}
	})

	function step(by: 1 | -1) {
		if (many) index = stepIndex(index, by, count)
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === "ArrowRight") {
			step(1)
			e.preventDefault()
		} else if (e.key === "ArrowLeft") {
			step(-1)
			e.preventDefault()
		}
	}

	let swipeFrom: { x: number; y: number } | null = null
	function onPointerDown(e: PointerEvent) {
		if (e.pointerType === "mouse") return
		swipeFrom = { x: e.clientX, y: e.clientY }
	}
	function onPointerUp(e: PointerEvent) {
		if (!swipeFrom) return
		const by = swipeDirection(e.clientX - swipeFrom.x, e.clientY - swipeFrom.y)
		swipeFrom = null
		if (by) step(by)
	}

	const close = () => onOpenChange({ open: false })
</script>

<Dialog {open} {onOpenChange}>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/80 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 border-surface-300-700 @container flex max-h-[96dvh] w-[min(96vw,1200px)] flex-col gap-2 border p-2 shadow-xl sm:p-3"
				data-media-lightbox
				onkeydown={onKeydown}
			>
				<header class="flex shrink-0 items-center gap-2">
					<Dialog.Title class="min-w-0 flex-1 truncate text-base font-semibold">
						{title}
					</Dialog.Title>
					{#if many}
						<span
							class="text-surface-700-300 shrink-0 text-sm tabular-nums"
							aria-live="polite"
							data-lightbox-counter
						>
							{index + 1} of {count}
						</span>
					{/if}
					{#if current?.mediaRef}
						<button
							type="button"
							class="btn-icon hover:preset-tonal size-11"
							aria-label="Info"
							title="Info"
							aria-expanded={showInfo}
							aria-controls="media-lightbox-info"
							aria-pressed={showInfo}
							onclick={() => (showInfo = !showInfo)}
						>
							<Icons.Info size={20} />
						</button>
					{/if}
					{#if download}
						<a
							class="btn-icon hover:preset-tonal size-11"
							href={download}
							download
							aria-label="Download"
							title="Download"
						>
							<Icons.Download size={20} />
						</a>
					{/if}
					<button
						type="button"
						class="btn-icon hover:preset-tonal size-11"
						aria-label="Close"
						title="Close"
						onclick={close}
					>
						<Icons.X size={20} />
					</button>
				</header>

				<div class="flex min-h-0 flex-1 flex-col gap-2 @3xl:flex-row">
					<div
						class="relative flex min-h-0 flex-1 touch-pan-y items-center justify-center"
						onpointerdown={onPointerDown}
						onpointerup={onPointerUp}
						onpointercancel={() => (swipeFrom = null)}
						role="presentation"
					>
						{#if current}
							{#key current.src}
								{#if broken.has(current.src)}
									<div
										class="text-surface-700-300 flex flex-col items-center gap-2 py-16 text-sm"
										data-lightbox-missing
									>
										<Icons.ImageOff size={32} />
										File no longer available
									</div>
								{:else}
									<img
										src={displaySrc(current)}
										alt={current.caption ?? "Image"}
										class="max-h-[80dvh] max-w-full rounded-lg object-contain select-none"
										draggable="false"
										decoding="async"
										onerror={() => broken.add(current.src)}
									/>
								{/if}
							{/key}
						{/if}
						{#if many}
							<button
								type="button"
								class="btn-icon preset-tonal bg-surface-100-900/80 absolute top-1/2 left-1 size-11 -translate-y-1/2"
								aria-label="Previous image"
								onclick={() => step(-1)}
							>
								<Icons.ChevronLeft size={22} />
							</button>
							<button
								type="button"
								class="btn-icon preset-tonal bg-surface-100-900/80 absolute top-1/2 right-1 size-11 -translate-y-1/2"
								aria-label="Next image"
								onclick={() => step(1)}
							>
								<Icons.ChevronRight size={22} />
							</button>
						{/if}
					</div>

					{#if showInfo && current?.mediaRef}
						<section
							id="media-lightbox-info"
							class="border-surface-300-700 max-h-[30dvh] shrink-0 overflow-y-auto border-t pt-2 text-sm @3xl:max-h-none @3xl:w-80 @3xl:border-t-0 @3xl:border-l @3xl:pt-0 @3xl:pl-3"
							aria-label="Image info"
							data-lightbox-info
						>
							{#if infoLoading}
								<p class="text-surface-700-300">Reading…</p>
							{:else if !info}
								<p class="text-surface-700-300">
									No details are available for this file.
								</p>
							{:else}
								<dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
									{#each infoRows(info) as row (row.label)}
										<dt class="text-surface-700-300">{row.label}</dt>
										<dd class="break-words whitespace-pre-wrap">{row.value}</dd>
									{/each}
								</dl>
							{/if}
						</section>
					{/if}
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
