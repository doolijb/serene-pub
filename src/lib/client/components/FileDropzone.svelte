<script lang="ts">
	import { FileUpload, useFileUpload } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { getContext } from "svelte"

	interface Props {
		/** Form field name for the underlying hidden `<input type="file">`. */
		name: string
		/** Standard `accept` string, eg. `".png,.json"` or `"image/*"`. */
		accept?: string
		maxFiles?: number
		onFileAccept: (details: FileAcceptDetails) => void
		onFileReject?: (details: any) => void
		/** Label on the browse button. */
		triggerLabel?: string
		/** Format hint, eg. "PNG, JPG or GIF". Shown on every platform. */
		hint?: string
		/** Classes for the dropzone itself, replacing the default box styling. */
		class?: string
	}

	let {
		name,
		accept,
		maxFiles = 1,
		onFileAccept,
		onFileReject = console.error,
		triggerLabel = "Browse",
		hint,
		class: className = "border-surface-300-700 bg-surface-50-950 hover:bg-surface-100-900 flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6"
	}: Props = $props()

	const systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")

	// Android's WebView never receives file drag events — there is no
	// drag-and-drop gesture to make on a phone — so the wrapper build hides the
	// "or drag and drop" affordance and describes the zone as tap-to-browse
	// instead. Tapping anywhere in the zone opens the picker either way (zag
	// wires the dropzone's own click to it, not just the Browse button).
	let isAndroidWrapper = $derived(
		!!systemSettingsCtx?.settings?.isAndroidWrapper
	)

	// `FileUpload.Root` derives this itself; driving the machine directly (so
	// the accept handler below can reach `clearFiles`) means supplying it here.
	const id = $props.id()

	const fileUpload = useFileUpload(() => ({
		id,
		name,
		accept,
		maxFiles,
		translations: {
			dropzone: isAndroidWrapper
				? "Choose a file"
				: "Choose a file, or drop one here"
		},
		onFileAccept: (details: FileAcceptDetails) => {
			if (!details.files?.length) return
			onFileAccept(details)
			// Zag holds accepted files in the machine and rejects anything it
			// already holds as FILE_EXISTS, so re-picking the same file after a
			// failed import would silently do nothing. Reset once the file has
			// been handed off. (The empty-set change this triggers is caught by
			// the length guard above.)
			queueMicrotask(() => fileUpload().clearFiles())
		},
		onFileReject
	}))
</script>

<FileUpload.Provider value={fileUpload}>
	<FileUpload.Dropzone class={className}>
		<Icons.Upload class="text-surface-700-300 h-8 w-8" />
		<FileUpload.Trigger class="btn btn-sm preset-filled-primary-500">
			{triggerLabel}
		</FileUpload.Trigger>
		{#if !isAndroidWrapper}
			<span class="text-surface-700-300 text-xs">or drag and drop</span>
		{/if}
		{#if hint}
			<span class="text-surface-700-300 text-xs">{hint}</span>
		{/if}
		<FileUpload.HiddenInput />
	</FileUpload.Dropzone>
</FileUpload.Provider>
