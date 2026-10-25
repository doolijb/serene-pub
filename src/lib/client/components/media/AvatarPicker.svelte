<script lang="ts">
	/**
	 * THE avatar picker: the picture IS the upload control. It takes a click
	 * and it takes a drop, the camera badge says so, and anything the picture
	 * cannot carry — re-cropping, removing — is in the menu under it. A chosen
	 * file opens the crop editor before anything is uploaded.
	 *
	 * One component for every picture something wears as its identity: a
	 * character's avatar, an account's avatar, a lorebook's cover image. It
	 * never uploads. Either the parent sends `file` with its own save and,
	 * once the save answers with the file's id, calls `commitPendingFrame` —
	 * or, given `onCommit`, the crop editor's Save is the save (a settings
	 * card with no Save of its own), and Cancel drops the pick.
	 *
	 * The crop of a file that does not exist yet is held here until the
	 * parent says what id it got (`avatarFrameCommit`); the crop of a stored
	 * one is sent at once (`media:setFrame`).
	 */
	import { onDestroy } from "svelte"
	import * as Icons from "@lucide/svelte"
	import AvatarCropEditor from "./AvatarCropEditor.svelte"
	import RowMenu from "../menus/RowMenu.svelte"
	import {
		avatarFrameCommit,
		type PendingAvatarFrame
	} from "./avatarFrameCommit"
	import type { MediaFrame } from "$lib/shared/media/frame"
	import type { AvatarMedia } from "$lib/client/utils/media"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { toaster } from "$lib/client/utils/toaster"

	interface Props {
		/** The stored picture, as the tile shows it (the display form). */
		src?: string | null
		/** The stored file's id, for Adjust crop. Null when there is none. */
		mediaId?: number | null
		/** The stored file's address and crop, when the payload joined them. */
		media?: AvatarMedia | null
		/** The picked file, not yet uploaded. The parent sends it. */
		file?: File
		/** The picked file as a data URL, shown in place of `src`. */
		preview?: string
		/**
		 * `square` (rounded 14px) for a card or a book; `round` for an
		 * account, drawn round everywhere else (STYLE-GUIDE §6.4).
		 */
		shape?: "round" | "square"
		/** What the picture is, in the labels: "avatar" or "cover". */
		noun?: string
		/** The empty tile's glyph (a lucide icon). */
		glyph?: typeof Icons.UsersRound
		/** The crop editor's heading: "Aria's avatar". */
		subject?: string
		/** Removes the stored picture. Without it, Remove only drops a pick. */
		onRemove?: () => void
		/** Commit each pick as its crop is answered, instead of on a save. */
		onCommit?: (file: File) => void
		/** A stored picture's crop was just sent, for the parent's own copy. */
		onStoredFrame?: (frame: MediaFrame | null) => void
		/**
		 * Hold a stored picture's new crop until the parent's save too
		 * (`commitPendingFrame`), instead of sending it at once — for a form
		 * whose Save is the only thing that changes anything (Book settings).
		 */
		deferStoredCrop?: boolean
		/** A crop is held for the save. Bindable, so the form counts it as a change. */
		cropPending?: boolean
		/** An upload is in flight: the tile shows it and takes nothing. */
		busy?: boolean
		disabled?: boolean
	}

	let {
		src = null,
		mediaId = null,
		media = null,
		file = $bindable(),
		preview = $bindable(""),
		shape = "square",
		noun = "avatar",
		glyph: Glyph = Icons.UsersRound,
		subject,
		onRemove,
		onCommit,
		onStoredFrame,
		deferStoredCrop = false,
		cropPending = $bindable(false),
		busy = false,
		disabled = false
	}: Props = $props()

	const socket = useTypedSocket()

	const article = $derived(/^[aeiou]/i.test(noun) ? "an" : "a")
	const chooseLabel = $derived(`Choose ${article} ${noun} image`)
	const menuLabel = $derived(noun.charAt(0).toUpperCase() + noun.slice(1))
	const radius = $derived(
		shape === "round" ? "rounded-full" : "rounded-[14px]"
	)
	const shown = $derived(preview || src || "")
	const inert = $derived(disabled || busy)

	/**
	 * The crop editor's answer, held until the save comes back with a media
	 * id to attach it to. Null means "upload it as it is".
	 */
	let pendingFrame = $state<PendingAvatarFrame | null>(null)
	let cropOpen = $state(false)
	/** What the editor is measuring: an object URL for a chosen file, or the
	 *  stored original. Object URLs are revoked when they are replaced. */
	let cropSrc = $state("")
	let cropObjectUrl: string | null = null
	/** Null while cropping a file that has not been uploaded; the stored frame
	 *  when adjusting a picture that already exists. */
	let cropFrame = $state<MediaFrame | null>(null)
	/** Whether the editor's Save was pressed, so a Cancel in commit mode can
	 *  drop the pick it was asked about. */
	let cropSaved = false

	let inputRef = $state<HTMLInputElement | null>(null)
	let menuOpen = $state(false)
	let isDragOver = $state(false)

	function releaseCropUrl() {
		if (cropObjectUrl) URL.revokeObjectURL(cropObjectUrl)
		cropObjectUrl = null
	}

	function pick(chosen: File) {
		const reader = new FileReader()
		reader.onload = (ev) => {
			preview = ev.target?.result as string
		}
		reader.readAsDataURL(chosen)
		file = chosen

		// The editor measures the file itself, so the frame is in the pixels
		// the server will store.
		releaseCropUrl()
		cropObjectUrl = URL.createObjectURL(chosen)
		cropSrc = cropObjectUrl
		cropFrame = null
		pendingFrame = null
		cropPending = false
		cropSaved = false
		cropOpen = true
	}

	/** Re-crop a picture that already exists: the file has an id, so the
	 *  frame is sent now rather than held for a save. */
	function adjustStoredCrop() {
		if (!mediaId && !media) return
		releaseCropUrl()
		cropSrc = media
			? `/media/${media.uuid}?v=original&r=${media.rev}`
			: `/media/${mediaId}?v=original`
		// A crop held for the save reopens as chosen, not as stored.
		cropFrame = cropPending
			? (pendingFrame?.frame ?? null)
			: (media?.frame ?? null)
		cropSaved = false
		cropOpen = true
	}

	function onCropSaved(frame: MediaFrame | null) {
		cropSaved = true
		if (file) {
			pendingFrame = { frame }
			// Held so reopening the editor before the save shows the crop
			// that was just chosen rather than starting over at the default.
			cropFrame = frame
			if (onCommit) onCommit(file)
			return
		}
		if (!mediaId) return
		if (deferStoredCrop) {
			pendingFrame = { frame }
			cropFrame = frame
			cropPending = true
			return
		}
		socket.emit("media:setFrame", { mediaId, frame })
		onStoredFrame?.(frame)
		toaster.success({ title: "Crop updated" })
	}

	function onCropCancelled() {
		// A pick with no save of its own: Cancel is "not this one".
		if (onCommit && file && !cropSaved) clear()
	}

	/** The crop the save just earned the right to store. */
	export function commitPendingFrame(
		savedMediaId: number | null | undefined
	) {
		const commit = avatarFrameCommit(pendingFrame, savedMediaId)
		pendingFrame = null
		cropPending = false
		if (commit) socket.emit("media:setFrame", commit)
	}

	/** Drops the picked file and its preview, back to the stored picture. */
	export function clear() {
		file = undefined
		preview = ""
		pendingFrame = null
		cropPending = false
		// The editor is mounted whether or not it is open, so a revoked url
		// left in it is one it would try to load. An open one (a Cancel) is
		// still closing on it: the url goes once it has closed.
		if (cropOpen) return
		releaseCropUrl()
		cropSrc = ""
	}

	function onCropClosed() {
		// A pick keeps its url: it is what Adjust crop reopens on.
		if (file || !cropObjectUrl) return
		releaseCropUrl()
		cropSrc = ""
	}

	function openPicker() {
		if (!inert) inputRef?.click()
	}

	function handleInputChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement
		const chosen = input.files?.[0]
		if (chosen) pick(chosen)
		// Cleared so choosing the same file twice in a row fires `change` again.
		input.value = ""
	}

	function handleDragOver(e: DragEvent) {
		// A drop only happens where the default is prevented, so this is what
		// makes the picture a target rather than a page the browser navigates.
		e.preventDefault()
		if (inert) return
		if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"
		isDragOver = true
	}

	function handleDragLeave(e: DragEvent) {
		const next = e.relatedTarget
		if (
			next instanceof Node &&
			(e.currentTarget as HTMLElement).contains(next)
		)
			return
		isDragOver = false
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault()
		isDragOver = false
		if (inert) return
		const chosen = e.dataTransfer?.files?.[0]
		if (chosen) pick(chosen)
	}

	/** The crop editor, on whichever source there is: a chosen file that has
	 *  not been uploaded, or the stored original. */
	function openCropEditor() {
		if (file && cropSrc) {
			cropSaved = false
			cropOpen = true
		} else adjustStoredCrop()
	}

	function remove() {
		if (file) clear()
		else onRemove?.()
	}

	onDestroy(releaseCropUrl)
</script>

<div class="flex flex-col items-center gap-1.5" data-avatar-picker={shape}>
	<button
		type="button"
		class="relative h-[88px] w-[88px] shrink-0 {radius} {isDragOver
			? 'ring-primary-500 ring-2'
			: ''}"
		onclick={openPicker}
		ondragover={handleDragOver}
		ondragleave={handleDragLeave}
		ondrop={handleDrop}
		disabled={inert}
		title={chooseLabel}
		aria-label="{chooseLabel}, or drop one here"
		aria-busy={busy || undefined}
	>
		<span
			class="border-surface-200-800 absolute inset-0 overflow-hidden border {radius}"
		>
			{#if shown}
				<img
					src={shown}
					alt=""
					class="absolute inset-0 h-full w-full object-cover object-top"
				/>
			{:else}
				<span
					class="bg-surface-200-800 absolute inset-0 grid place-items-center"
				>
					<Glyph size={36} class="text-surface-600-400" />
				</span>
			{/if}
			{#if busy}
				<span
					class="bg-surface-950/50 absolute inset-0 grid place-items-center"
				>
					<Icons.Loader2
						size={24}
						class="animate-spin text-white"
						aria-hidden="true"
					/>
				</span>
			{/if}
		</span>
		<!-- Outside the clipped picture, so a round tile does not cut it. -->
		<span
			class="bg-surface-900/90 text-surface-800-200 absolute grid size-6 place-items-center rounded-full backdrop-blur-sm {shape ===
			'round'
				? 'right-0 bottom-0'
				: 'right-1 bottom-1'}"
		>
			<Icons.Camera size={14} aria-hidden="true" />
		</span>
	</button>
	<input
		type="file"
		accept="image/*"
		class="hidden"
		tabindex="-1"
		bind:this={inputRef}
		onchange={handleInputChange}
		aria-hidden="true"
	/>
	<RowMenu
		label={menuLabel}
		triggerClass="btn btn-icon hover:bg-surface-200-800 data-[state=open]:bg-surface-200-800 h-7 min-h-0 w-7 p-0"
		bind:open={menuOpen}
		items={[
			{
				label: "Adjust crop",
				icon: Icons.Crop,
				disabled: inert || (!file && !mediaId && !media),
				onSelect: openCropEditor
			},
			{
				label: "Remove image",
				icon: Icons.Trash2,
				destructive: true,
				disabled: inert || !(file || (onRemove && shown)),
				onSelect: remove
			}
		]}
	/>
</div>

<!-- Mounted whether or not it is open: a dialog torn down mid-close leaves its
     machine reading state that went with it. The source outlives the close
     here, so it is `open` alone that opens and closes the editor. -->
<AvatarCropEditor
	open={cropOpen}
	onOpenChange={(e) => (cropOpen = e.open)}
	src={cropSrc}
	frame={cropFrame}
	{subject}
	onSave={onCropSaved}
	onCancel={onCropCancelled}
	onClosed={onCropClosed}
/>
