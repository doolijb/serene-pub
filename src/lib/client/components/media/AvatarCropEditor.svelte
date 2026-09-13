<script lang="ts">
	/**
	 * Choosing what an avatar's thumbnail is cut from.
	 *
	 * The mask is FIXED and the image moves under it, which is what makes the
	 * two previews honest: they are the same frame at two more sizes, not a
	 * second guess at it. Every gesture is direct manipulation, so nothing here
	 * animates — there is no transition for `prefers-reduced-motion` to
	 * collapse, and adding one would put the image behind the pointer.
	 *
	 * Saving emits a frame in the ORIGINAL's pixels, or null when the frame is
	 * the default rule's own answer: null keeps the file on the rule rather than
	 * freezing today's output of it.
	 *
	 * ⚠ **The caller keeps this mounted while it is closed.** A dialog machine
	 * reads its own state as it closes, so unmounting an open one destroys what
	 * that read needs (`derived_inert`, one per effect the open state holds).
	 * The caller drives `open` and waits for `onClosed` before it drops `src`.
	 */
	import { tick } from "svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import {
		defaultFrame,
		framesEqual,
		type MediaFrame
	} from "$lib/shared/media/frame"
	import {
		MAX_ZOOM,
		frameAtZoom,
		frameTransform,
		frameZoom,
		nudgeFrame,
		panFrame,
		savedFrame,
		zoomFrameAt
	} from "./cropMath"

	interface Props {
		open: boolean
		onOpenChange: (e: { open: boolean }) => void
		/** The image at its natural size: an object URL for a file being
		 *  uploaded, or `/media/{uuid}?v=original&r={rev}` for a stored one. */
		src: string
		/** The stored frame, or null to open on the default rule. */
		frame?: MediaFrame | null
		/** The frame to store. Null means "keep using the default rule". */
		onSave: (frame: MediaFrame | null) => void
		onCancel?: () => void
		/** The dialog has finished closing, so `src` and whatever named it may
		 *  be released now. Clearing them any earlier is the unmount this
		 *  component must not be given. */
		onClosed?: () => void
		/** What is being cropped, for the heading — a name, or a name plus
		 *  "'s avatar". Absent for an image nothing else names. */
		subject?: string
	}

	let {
		open = $bindable(),
		onOpenChange,
		src,
		frame = null,
		onSave,
		onCancel,
		onClosed,
		subject
	}: Props = $props()

	/** The image's natural size, and the units every frame is written in. */
	let natural = $state<{ width: number; height: number } | null>(null)
	let failed = $state(false)
	let current = $state<MediaFrame | null>(null)

	/** The stage sizes itself to the dialog; the mask is a fraction of it, so
	 *  the image around the frame stays visible as context. */
	const DEFAULT_STAGE_WIDTH = 360
	let stageWidth = $state(DEFAULT_STAGE_WIDTH)

	/**
	 * A measurement of zero is a box that is hidden or detached, never a stage
	 * width, so it is refused rather than stored: a closed dialog measures
	 * zero, and the last real width is the better guess for the next open.
	 */
	function measureStage(width: number) {
		if (width > 0) stageWidth = width
	}

	/** The source every value above is measured in. */
	let measuredSrc = ""

	/**
	 * A frame is written in ONE image's pixels, so another image starts over.
	 * The component outlives a close, and every value it carries across one
	 * belongs to the image that was open.
	 */
	$effect(() => {
		if (src === measuredSrc) return
		measuredSrc = src
		natural = null
		current = null
		failed = false
		stageWidth = DEFAULT_STAGE_WIDTH
	})

	/** Whether the dialog was showing, to catch the edge where it closes. */
	let wasOpen = false

	/**
	 * The caller hears about a close only once the dialog has finished closing.
	 *
	 * Zag's dialog has no close-complete event, so this is the end of the flush
	 * that closed it plus the frame its effects are torn down in.
	 */
	$effect(() => {
		if (open) {
			wasOpen = true
			return
		}
		if (!wasOpen) return
		wasOpen = false
		let live = true
		let frameId = 0
		tick().then(() => {
			if (live) frameId = requestAnimationFrame(() => onClosed?.())
		})
		return () => {
			live = false
			cancelAnimationFrame(frameId)
		}
	})

	let stage = $derived(Math.max(220, Math.min(stageWidth, 420)))
	let mask = $derived(Math.round(stage * 0.78))
	let maskOffset = $derived(Math.round((stage - mask) / 2))

	let maskEl = $state<HTMLDivElement | null>(null)

	/** Where the image sits so the frame fills the mask. */
	let placement = $derived.by(() => {
		if (!current || !natural) return null
		const t = frameTransform(current, mask)
		return {
			left: maskOffset + t.left,
			top: maskOffset + t.top,
			width: natural.width * t.scale,
			height: natural.height * t.scale
		}
	})

	let zoom = $derived(
		current && natural
			? frameZoom(current, natural.width, natural.height)
			: 1
	)
	let atDefault = $derived(
		!!current &&
			!!natural &&
			framesEqual(current, defaultFrame(natural.width, natural.height))
	)

	function onImageLoad(event: Event) {
		const img = event.currentTarget as HTMLImageElement
		natural = { width: img.naturalWidth, height: img.naturalHeight }
		failed = false
		current = frame ?? defaultFrame(img.naturalWidth, img.naturalHeight)
	}

	function onImageError() {
		failed = true
		natural = null
	}

	/** Pointer id to its last position — the second entry is what turns a drag
	 *  into a pinch. */
	const pointers = new Map<number, { x: number; y: number }>()
	let pinchDistance = 0

	function maskPoint(clientX: number, clientY: number) {
		const rect = maskEl?.getBoundingClientRect()
		if (!rect) return { x: mask / 2, y: mask / 2 }
		return { x: clientX - rect.left, y: clientY - rect.top }
	}

	function spread() {
		const [a, b] = [...pointers.values()]
		return Math.hypot(a.x - b.x, a.y - b.y)
	}

	function midpoint() {
		const [a, b] = [...pointers.values()]
		return maskPoint((a.x + b.x) / 2, (a.y + b.y) / 2)
	}

	function onPointerDown(event: PointerEvent) {
		if (!current || !natural) return
		;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
		pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
		if (pointers.size === 2) pinchDistance = spread()
	}

	function onPointerMove(event: PointerEvent) {
		const last = pointers.get(event.pointerId)
		if (!last || !current || !natural) return
		const next = { x: event.clientX, y: event.clientY }
		pointers.set(event.pointerId, next)

		if (pointers.size >= 2) {
			const distance = spread()
			if (pinchDistance > 0 && distance > 0) {
				current = zoomFrameAt(
					current,
					distance / pinchDistance,
					midpoint(),
					mask,
					natural.width,
					natural.height
				)
			}
			pinchDistance = distance
			return
		}

		current = panFrame(
			current,
			next.x - last.x,
			next.y - last.y,
			mask,
			natural.width,
			natural.height
		)
	}

	function onPointerUp(event: PointerEvent) {
		pointers.delete(event.pointerId)
		if (pointers.size < 2) pinchDistance = 0
	}

	function onWheel(event: WheelEvent) {
		if (!current || !natural) return
		event.preventDefault()
		current = zoomFrameAt(
			current,
			event.deltaY < 0 ? 1.12 : 1 / 1.12,
			maskPoint(event.clientX, event.clientY),
			mask,
			natural.width,
			natural.height
		)
	}

	function zoomBy(factor: number) {
		if (!current || !natural) return
		current = zoomFrameAt(
			current,
			factor,
			{ x: mask / 2, y: mask / 2 },
			mask,
			natural.width,
			natural.height
		)
	}

	function onStageKeydown(event: KeyboardEvent) {
		if (!current || !natural) return
		// Shift moves ten source pixels; on its own an arrow moves one, which
		// is what makes a frame placeable exactly.
		const step = event.shiftKey ? 10 : 1
		const moves: Record<string, [number, number]> = {
			ArrowLeft: [-step, 0],
			ArrowRight: [step, 0],
			ArrowUp: [0, -step],
			ArrowDown: [0, step]
		}
		const move = moves[event.key]
		if (move) {
			event.preventDefault()
			current = nudgeFrame(
				current,
				move[0],
				move[1],
				natural.width,
				natural.height
			)
			return
		}
		if (event.key === "+" || event.key === "=") {
			event.preventDefault()
			zoomBy(1.12)
		} else if (event.key === "-" || event.key === "_") {
			event.preventDefault()
			zoomBy(1 / 1.12)
		}
	}

	function onZoomInput(event: Event) {
		if (!current || !natural) return
		current = frameAtZoom(
			current,
			Number((event.currentTarget as HTMLInputElement).value),
			natural.width,
			natural.height
		)
	}

	function reset() {
		if (!natural) return
		current = defaultFrame(natural.width, natural.height)
	}

	function save() {
		if (!current || !natural) return
		// Handed over as a plain copy: nothing the caller keeps may be state of
		// this component's, which the close is free to start over.
		onSave(savedFrame(current, natural.width, natural.height))
		onOpenChange({ open: false })
	}

	function cancel() {
		onCancel?.()
		onOpenChange({ open: false })
	}

	/** One preview: the same frame drawn at another size. */
	function previewStyle(size: number) {
		if (!current || !natural) return ""
		const t = frameTransform(current, size)
		return `left:${t.left}px;top:${t.top}px;width:${
			natural.width * t.scale
		}px;height:${natural.height * t.scale}px;`
	}
</script>

<Dialog {open} {onOpenChange}>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/60 fixed inset-0 z-[1100] backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-[1100] flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 max-h-[90dvh] w-[min(92vw,720px)] overflow-y-auto p-4 shadow-xl"
			>
				<header class="mb-3 flex items-center gap-2">
					<Icons.Crop size={18} aria-hidden="true" />
					<h2 class="h4" id="avatar-crop-title">
						{subject ? `Crop ${subject}` : "Crop image"}
					</h2>
				</header>

				<div
					class="flex flex-col gap-4 sm:flex-row"
					bind:clientWidth={() => stageWidth, measureStage}
				>
					<div class="flex flex-col items-center gap-2">
						<!-- The gesture surface. `role="application"` because it
						     has its own keyboard model: arrows nudge the frame
						     rather than moving focus, which is exactly what that
						     role exists to announce. Svelte's a11y rules read
						     `application` as non-interactive and would have this
						     be a button, which would announce the wrong thing. -->
						<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
						<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
						<div
							class="bg-surface-200-800 relative touch-none overflow-hidden rounded select-none"
							style="width:{stage}px;height:{stage}px;"
							role="application"
							tabindex="0"
							aria-label="Crop area. Drag to move the image, arrow keys to nudge it, shift and an arrow to nudge further, plus and minus to zoom."
							onpointerdown={onPointerDown}
							onpointermove={onPointerMove}
							onpointerup={onPointerUp}
							onpointercancel={onPointerUp}
							onwheel={onWheel}
							onkeydown={onStageKeydown}
						>
							<!-- Nothing is fetched without a source: a closed
							     editor is still mounted, and an empty `src`
							     would be one failed request per caller. Keyed
							     on the source so opening the editor on a
							     different image re-measures it: the frame is
							     in THAT image's pixels. -->
							{#if src}
								{#key src}
									<img
										{src}
										alt=""
										draggable="false"
										class="pointer-events-none absolute max-w-none"
										style={placement
											? `left:${placement.left}px;top:${placement.top}px;width:${placement.width}px;height:${placement.height}px;`
											: "opacity:0;"}
										onload={onImageLoad}
										onerror={onImageError}
									/>
								{/key}
							{/if}
							<!-- Everything outside the frame, dimmed by one
							     box-shadow rather than four rectangles. -->
							<div
								bind:this={maskEl}
								class="pointer-events-none absolute border-2 border-white/80"
								style="left:{maskOffset}px;top:{maskOffset}px;width:{mask}px;height:{mask}px;box-shadow:0 0 0 9999px rgb(0 0 0 / 0.55);"
								aria-hidden="true"
							></div>
							{#if failed}
								<p
									class="text-error-500 absolute inset-0 flex items-center justify-center p-4 text-center text-sm"
								>
									That image could not be loaded, so there is
									nothing to crop.
								</p>
							{/if}
						</div>

						<label
							class="flex w-full items-center gap-2 text-sm"
							for="avatar-crop-zoom"
						>
							<Icons.ZoomOut size={16} aria-hidden="true" />
							<input
								id="avatar-crop-zoom"
								type="range"
								class="w-full"
								min="1"
								max={MAX_ZOOM}
								step="0.01"
								value={zoom}
								disabled={!natural}
								oninput={onZoomInput}
								aria-label="Zoom"
							/>
							<Icons.ZoomIn size={16} aria-hidden="true" />
						</label>
					</div>

					<div class="flex flex-1 flex-col gap-4">
						<div class="flex flex-col gap-2">
							<p
								class="text-surface-600-400 text-xs font-semibold"
							>
								Preview
							</p>
							<div class="flex items-end gap-4">
								<div class="flex flex-col items-center gap-1">
									<div
										class="bg-surface-200-800 relative h-24 w-24 overflow-hidden rounded-full"
									>
										{#if natural}
											<img
												{src}
												alt="Round preview of the crop"
												draggable="false"
												class="absolute max-w-none"
												style={previewStyle(96)}
											/>
										{/if}
									</div>
									<span class="text-surface-600-400 text-xs">
										Round
									</span>
								</div>
								<div class="flex flex-col items-center gap-1">
									<div
										class="bg-surface-200-800 relative h-24 w-24 overflow-hidden rounded"
									>
										{#if natural}
											<img
												{src}
												alt="Square preview of the crop"
												draggable="false"
												class="absolute max-w-none"
												style={previewStyle(96)}
											/>
										{/if}
									</div>
									<span class="text-surface-600-400 text-xs">
										Square
									</span>
								</div>
							</div>
						</div>

						<p class="text-surface-600-400 text-xs">
							The crop decides what small pictures of this image
							show. The full image is kept, so you can change this
							at any time.
						</p>

						<div class="flex flex-wrap gap-2">
							<button
								type="button"
								class="btn btn-sm preset-tonal-surface"
								onclick={reset}
								disabled={!natural || atDefault}
								aria-label="Reset the crop to the largest square from the top of the image"
							>
								<Icons.RotateCcw size={16} aria-hidden="true" />
								Reset
							</button>
						</div>

						{#if natural && current}
							<p class="text-surface-600-400 font-mono text-xs">
								{current.w}×{current.h} from {current.x},{current.y}
							</p>
						{/if}
					</div>
				</div>

				<footer class="mt-4 flex justify-end gap-2">
					<button
						type="button"
						class="btn btn-sm preset-filled-surface-500"
						onclick={cancel}
						aria-label="Cancel cropping"
					>
						Cancel
					</button>
					<button
						type="button"
						class="btn btn-sm preset-filled-primary-500"
						onclick={save}
						disabled={!natural}
						aria-label="Save this crop"
					>
						<Icons.Check size={16} aria-hidden="true" />
						Save
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
