<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { acppBackendLabel } from "$lib/client/components/connections/managedConnectionView"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import { onMount } from "svelte"

	interface Props {
		onDownloadStarted: () => void
	}

	let { onDownloadStarted }: Props = $props()

	const socket = useTypedSocket()

	type Variant = Sockets.AudioCpp.BinaryVariant
	type ReleaseVersion = Sockets.AudioCpp.ListReleaseVersions.ReleaseVersion
	type DownloadState = Sockets.AudioCpp.BinaryDownloadProgress.DownloadState

	let versions = $state<ReleaseVersion[]>([])
	let loadingVersions = $state(true)
	let selectedTag = $state("latest")

	let variants = $state<Variant[]>([])
	let releaseTag = $state("")
	let loading = $state(true)
	let error = $state<string | null>(null)
	let selected = $state<Variant | null>(null)
	let download = $state<DownloadState | null>(null)
	let isDownloading = $derived(!!download && !download.isDone)

	function formatSize(bytes: number): string {
		if (!bytes) return "?"
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
		return `${(bytes / 1024 / 1024).toFixed(1)} MB`
	}

	function fetchVariants(tag: string) {
		loading = true
		error = null
		selected = null
		variants = []
		socket.emit("audiocpp:listBinaryVariants", {
			tag: tag === "latest" ? undefined : tag
		})
	}

	function startDownload() {
		if (!selected || !releaseTag) return
		download = null
		socket.emit("audiocpp:downloadBinary", {
			assetName: selected.assetName,
			releaseTag
		})
		onDownloadStarted()
	}

	function cancelDownload() {
		socket.emit("audiocpp:cancelBinaryDownload", {})
	}

	function handleListReleaseVersions(
		msg: Sockets.AudioCpp.ListReleaseVersions.Response
	) {
		loadingVersions = false
		versions = msg.versions
	}

	function handleListReleaseVersionsError() {
		loadingVersions = false
	}

	function handleListBinaryVariants(
		msg: Sockets.AudioCpp.ListBinaryVariants.Response
	) {
		loading = false
		variants = msg.variants
		releaseTag = msg.releaseTag
		// Pre-pick the build proposed for this machine.
		selected = msg.variants.find((v) => v.recommended) ?? null
	}

	function handleListBinaryVariantsError(msg: Sockets.ErrorResponse) {
		loading = false
		error = msg?.error ?? "Could not fetch the audio.cpp releases"
	}

	function handleBinaryDownloadProgress(
		msg: Sockets.AudioCpp.BinaryDownloadProgress.Response
	) {
		download = msg.download
	}

	// Declared ABOVE the mount that emits (effects run in creation order).
	useInterest<"audiocpp:listReleaseVersions">(
		"audiocpp:listReleaseVersions",
		handleListReleaseVersions
	)
	useInterest<"audiocpp:listReleaseVersions:error">(
		"audiocpp:listReleaseVersions:error",
		handleListReleaseVersionsError
	)
	useInterest<"audiocpp:listBinaryVariants">(
		"audiocpp:listBinaryVariants",
		handleListBinaryVariants
	)
	useInterest<"audiocpp:listBinaryVariants:error">(
		"audiocpp:listBinaryVariants:error",
		handleListBinaryVariantsError
	)
	useInterest<"audiocpp:binaryDownloadProgress">(
		"audiocpp:binaryDownloadProgress",
		handleBinaryDownloadProgress
	)

	onMount(() => {
		socket.emit("audiocpp:listReleaseVersions", {})
		socket.emit("audiocpp:listBinaryVariants", {})
	})
</script>

<div class="flex flex-col gap-4 p-3">
	<div>
		<p class="text-sm font-semibold">Choose an audio.cpp build</p>
		{#if releaseTag}
			<p class="text-surface-700-300 text-xs">Release: {releaseTag}</p>
		{/if}
	</div>

	<div>
		<span
			class="text-surface-600-400 mb-1 block text-xs font-medium"
			aria-hidden="true"
		>
			Version
		</span>
		{#if loadingVersions}
			<div class="flex items-center gap-2 text-xs">
				<Icons.Loader2 size={12} class="animate-spin" />
				Loading versions…
			</div>
		{:else}
			<Select
				label="Version"
				labelHidden
				class="w-full text-sm"
				options={[
					{
						value: "latest",
						label: `Latest${versions[0] ? ` (${versions[0].tag})` : ""}`
					},
					...versions
						.filter((v) => !v.isLatest)
						.map((v) => ({ value: v.tag, label: v.tag }))
				]}
				bind:value={selectedTag}
				onValueChange={(v) => {
					if (v) fetchVariants(v)
				}}
				disabled={isDownloading}
			/>
		{/if}
	</div>

	{#if download && !download.isDone}
		<div class="bg-surface-100-900 rounded-lg p-3" data-testid="acpp-download">
			<div class="mb-2 flex items-center gap-2">
				<Icons.Download size={14} class="text-primary-500 shrink-0" />
				<span class="text-xs font-medium">
					{#if download.status === "unpacking"}
						Unpacking…
					{:else}
						Downloading {download.phase === "runtime"
							? "CUDA runtime"
							: "audio.cpp"}
					{/if}
				</span>
				<button
					class="btn btn-sm preset-tonal-error ml-auto text-xs"
					onclick={cancelDownload}
				>
					Cancel
				</button>
			</div>
			{#if download.status !== "unpacking" && download.total > 0}
				<div
					class="bg-surface-300-700 h-1.5 w-full overflow-hidden rounded-full"
				>
					<div
						class="bg-primary-500 h-full rounded-full transition-all"
						style="width: {Math.min(
							100,
							(download.downloaded / download.total) * 100
						).toFixed(1)}%"
					></div>
				</div>
				<p class="text-surface-700-300 mt-1 text-xs">
					{formatSize(download.downloaded)} / {formatSize(download.total)}
				</p>
			{/if}
		</div>
	{:else if download?.status === "success"}
		<div
			class="bg-success-100-900 text-success-700-300 flex items-center gap-2 rounded-lg p-3 text-xs"
		>
			<Icons.CheckCircle size={14} />
			Download complete.
		</div>
		{#if download.verified === false}
			<p class="text-surface-700-300 text-xs">
				Installed without a published checksum to check it against
				(unverified).
			</p>
		{/if}
	{:else if download?.status === "error"}
		<div
			class="bg-error-100-900 text-error-600-400 flex items-center gap-2 rounded-lg p-3 text-xs"
		>
			<Icons.AlertTriangle size={14} />
			{download.error ?? "Download failed"}
		</div>
	{/if}

	{#if loading}
		<div class="flex items-center gap-2 py-4 text-sm">
			<Icons.Loader2 size={16} class="animate-spin" />
			Fetching releases…
		</div>
	{:else if error}
		<div class="text-error-600-400 flex items-center gap-2 text-sm">
			<Icons.AlertTriangle size={14} />
			{error}
		</div>
	{:else}
		<div class="flex flex-col gap-1.5">
			{#each variants as variant (variant.assetName)}
				{@const isSelected = selected?.assetName === variant.assetName}
				<button
					class="border-surface-200-800 flex items-start gap-3 rounded-lg border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 {isSelected
						? 'border-primary-500 bg-primary-50-950'
						: 'bg-surface-100-900 hover:bg-surface-200-800'}"
					onclick={() => (selected = variant)}
					disabled={isDownloading}
				>
					<div
						class="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 {isSelected
							? 'border-primary-500 bg-primary-500'
							: 'border-surface-400-600'}"
					></div>
					<div class="min-w-0 flex-1">
						<p class="flex flex-wrap items-center gap-x-2 text-xs font-medium">
							<span>{variant.name}</span>
							<span class="text-surface-600-400 font-normal">
								{acppBackendLabel(variant.backend)}
							</span>
							{#if variant.recommended}
								<span class="text-primary-ink">Recommended</span>
							{/if}
							{#if variant.portable}
								<span
									class="preset-tonal-surface rounded px-1.5 py-0.5 font-normal"
								>
									Portable
								</span>
							{/if}
						</p>
						<!-- The server's reason already says what portable costs;
						     this line stands in only when it sends none. -->
						{#if variant.portable && !variant.reason}
							<p class="text-surface-700-300 text-xs">
								Portable: built to run on more CPUs, a little slower.
							</p>
						{/if}
						{#if variant.reason}
							<p class="text-surface-700-300 text-xs">
								{variant.reason}
							</p>
						{/if}
						{#if variant.needsRuntimeAsset}
							<p class="text-surface-700-300 text-xs">
								The matching CUDA runtime (about 600 MB) is
								downloaded with it and unpacked beside the
								binary.
							</p>
						{/if}
					</div>
					<span class="text-surface-600-400 shrink-0 text-xs">
						{formatSize(variant.sizeBytes)}
					</span>
				</button>
			{/each}
		</div>

		<button
			class="btn preset-filled-primary-500 w-full"
			disabled={!selected || isDownloading}
			onclick={startDownload}
		>
			<Icons.Download size={16} />
			Download
		</button>
	{/if}
</div>
