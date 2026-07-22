<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { toaster } from "$lib/client/utils/toaster"
	import { getContext, onMount, onDestroy } from "svelte"

	interface Props {
		onDownloadStarted: () => void
	}

	let { onDownloadStarted }: Props = $props()

	const socket = useTypedSocket()
	const koboldCppSettingsCtx: KoboldCppSettingsCtx = $state(
		getContext("koboldCppSettingsCtx")
	)

	type Variant = Sockets.KoboldCPP.ListBinaryVariants.BinaryVariant
	type ReleaseVersion = Sockets.KoboldCPP.ListReleaseVersions.ReleaseVersion
	type DownloadState = Sockets.KoboldCPP.BinaryDownloadProgress.DownloadState

	let versions = $state<ReleaseVersion[]>([])
	let loadingVersions = $state(true)
	let selectedTag = $state("latest")

	let variants = $state<Variant[]>([])
	let releaseTag = $state("")
	let defaultDir = $state("")
	let loading = $state(true)
	let error = $state<string | null>(null)
	let selected = $state<Variant | null>(null)
	let destDir = $state(
		koboldCppSettingsCtx.settings?.koboldCppManagedBinaryDir ?? ""
	)
	let download = $state<DownloadState | null>(null)
	let confirming = $state(false)
	let downloadStarted = $state(false)
	let isDownloading = $derived(!!download && !download.isDone)

	$effect(() => {
		if (
			downloadStarted &&
			download?.status === "success" &&
			download?.isDone
		) {
			onDownloadStarted()
		}
	})

	const platformOrder: Record<string, number> = {
		linux: 0,
		windows: 1,
		macos: 2,
		other: 3
	}
	let grouped = $derived(
		variants.reduce<Record<string, Variant[]>>((acc, v) => {
			if (!acc[v.platform]) acc[v.platform] = []
			acc[v.platform].push(v)
			return acc
		}, {})
	)
	let sortedPlatforms = $derived(
		Object.keys(grouped).sort(
			(a, b) => (platformOrder[a] ?? 9) - (platformOrder[b] ?? 9)
		)
	)

	const platformLabel: Record<string, string> = {
		linux: "Linux",
		windows: "Windows",
		macos: "macOS",
		other: "Other"
	}

	function formatSize(bytes: number): string {
		if (bytes === 0) return "?"
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
		return `${(bytes / 1024 / 1024).toFixed(1)} MB`
	}

	function fetchVariants(tag: string) {
		loading = true
		error = null
		selected = null
		variants = []
		socket.emit("koboldcpp:listBinaryVariants", {
			tag: tag === "latest" ? undefined : tag
		})
	}

	function startDownload() {
		if (!selected || !destDir.trim()) return
		socket.emit("koboldcpp:downloadBinary", {
			assetName: selected.name,
			downloadUrl: selected.downloadUrl,
			destDir: destDir.trim(),
			releaseTag
		})
		confirming = false
		downloadStarted = true
	}

	onMount(() => {
		socket.emit("koboldcpp:listReleaseVersions", {})
		socket.emit("koboldcpp:listBinaryVariants", {})
		socket.emit("koboldcpp:getBinaryDownloadProgress", {})

		socket.on(
			"koboldcpp:listReleaseVersions",
			(msg: Sockets.KoboldCPP.ListReleaseVersions.Response) => {
				loadingVersions = false
				versions = msg.versions
			}
		)
		socket.on("koboldcpp:listReleaseVersions:error", () => {
			loadingVersions = false
		})

		socket.on(
			"koboldcpp:listBinaryVariants",
			(msg: Sockets.KoboldCPP.ListBinaryVariants.Response) => {
				loading = false
				variants = msg.variants
				releaseTag = msg.releaseTag
				defaultDir = msg.defaultDir
				if (!destDir) destDir = msg.defaultDir
			}
		)
		socket.on(
			"koboldcpp:listBinaryVariants:error",
			(msg: Sockets.ErrorResponse) => {
				loading = false
				error = msg?.error ?? "Failed to fetch releases"
			}
		)
		socket.on(
			"koboldcpp:binaryDownloadProgress",
			(msg: Sockets.KoboldCPP.BinaryDownloadProgress.Response) => {
				download = msg.download
			}
		)
		socket.on(
			"koboldcpp:getBinaryDownloadProgress",
			(msg: Sockets.KoboldCPP.GetBinaryDownloadProgress.Response) => {
				download = msg.download
			}
		)
	})

	onDestroy(() => {
		socket.off("koboldcpp:listReleaseVersions")
		socket.off("koboldcpp:listReleaseVersions:error")
		socket.off("koboldcpp:listBinaryVariants")
		socket.off("koboldcpp:listBinaryVariants:error")
		socket.off("koboldcpp:binaryDownloadProgress")
		socket.off("koboldcpp:getBinaryDownloadProgress")
	})
</script>

<div class="flex flex-col gap-4 p-3">
	<div class="flex items-center justify-between">
		<div>
			<p class="text-sm font-semibold">Choose a KoboldCPP build</p>
			{#if releaseTag}
				<p class="text-surface-700-300 text-xs">
					Release: {releaseTag}
				</p>
			{/if}
		</div>
	</div>

	<!-- Version picker -->
	<div>
		<label
			class="text-surface-600-400 mb-1 block text-xs font-medium"
			for="versionSelect"
		>
			Version
		</label>
		{#if loadingVersions}
			<div class="flex items-center gap-2 text-xs">
				<Icons.Loader2 size={12} class="animate-spin" />
				Loading versions…
			</div>
		{:else}
			<select
				id="versionSelect"
				class="select w-full text-sm"
				bind:value={selectedTag}
				onchange={() => fetchVariants(selectedTag)}
				disabled={isDownloading}
			>
				<option value="latest">
					Latest{versions[0] ? ` (${versions[0].tag})` : ""}
				</option>
				{#each versions as v}
					{#if !v.isLatest}
						<option value={v.tag}>{v.tag}</option>
					{/if}
				{/each}
			</select>
		{/if}
	</div>

	<!-- Download directory -->
	<div>
		<label
			class="text-surface-600-400 mb-1 block text-xs font-medium"
			for="binaryDestDir"
		>
			Download directory
		</label>
		<input
			id="binaryDestDir"
			type="text"
			bind:value={destDir}
			placeholder="/home/user/koboldcpp"
			class="input w-full text-sm"
			disabled={isDownloading}
		/>
		<p class="text-surface-700-300 mt-0.5 text-xs">
			Where the KoboldCPP binary will be saved.{defaultDir
				? ` Default: ${defaultDir}`
				: ""}
		</p>
	</div>

	{#if download && !download.isDone}
		<!-- Active download -->
		<div class="bg-surface-100-900 rounded-lg p-3">
			<div class="mb-2 flex items-center gap-2">
				<Icons.Download size={14} class="text-primary-500 shrink-0" />
				<span class="text-xs font-medium">
					Downloading {download.assetName}
				</span>
				<button
					class="btn btn-sm preset-tonal-error ml-auto text-xs"
					onclick={() =>
						socket.emit("koboldcpp:cancelBinaryDownload", {})}
				>
					Cancel
				</button>
			</div>
			{#if download.total > 0}
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
					{formatSize(download.downloaded)} / {formatSize(
						download.total
					)}
				</p>
			{/if}
		</div>
	{:else if download?.status === "success"}
		<div
			class="bg-success-100-900 text-success-700-300 flex items-center gap-2 rounded-lg p-3 text-xs"
		>
			<Icons.CheckCircle size={14} />
			Download complete — KoboldCPP is starting…
		</div>
	{:else if download?.status === "error"}
		<div
			class="bg-error-100-900 text-error-700-300 flex items-center gap-2 rounded-lg p-3 text-xs"
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
		<div class="text-error-500 flex items-center gap-2 text-sm">
			<Icons.AlertTriangle size={14} />
			{error}
		</div>
	{:else}
		{#each sortedPlatforms as platform}
			<div>
				<p
					class="text-surface-700-300 mb-2 text-xs font-semibold tracking-wide uppercase"
				>
					{platformLabel[platform] ?? platform}
				</p>
				<div class="flex flex-col gap-1.5">
					{#each grouped[platform] as variant (variant.name)}
						{@const isSelected = selected?.name === variant.name}
						<button
							class="border-surface-300-700 flex items-start gap-3 rounded-lg border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 {isSelected
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
								<p class="text-xs font-medium">
									{variant.name}
								</p>
								<p class="text-surface-700-300 text-xs">
									{variant.description}
								</p>
							</div>
							<span class="text-surface-400 shrink-0 text-xs">
								{formatSize(variant.sizeBytes)}
							</span>
						</button>
					{/each}
				</div>
			</div>
		{/each}

		{#if selected}
			<div class="border-surface-300-700 mt-1 rounded-lg border p-3">
				<p class="text-xs font-medium">
					Selected: <span class="text-primary-500">
						{selected.name}
					</span>
				</p>
				<p class="text-surface-700-300 text-xs">
					{selected.description}
				</p>
			</div>
		{/if}

		<button
			class="btn preset-filled-primary-500 w-full"
			disabled={!selected || !destDir.trim() || isDownloading}
			onclick={startDownload}
		>
			<Icons.Download size={16} />
			Download & Start
		</button>
	{/if}
</div>
