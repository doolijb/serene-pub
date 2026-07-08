<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { onMount, onDestroy, getContext } from "svelte"
	import * as skio from "sveltekit-io"
	import { toaster } from "$lib/client/utils/toaster"
	import CustomThemeEditor from "./CustomThemeEditor.svelte"

	const socket = skio.get()
	const userCtx: { user: SelectUser } = getContext("userCtx")
	const systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")

	let isAccountsEnabled = $derived(systemSettingsCtx?.settings?.isAccountsEnabled ?? false)
	let isAdmin = $derived(userCtx?.user?.isAdmin ?? false)

	type ThemeMeta = Sockets.CustomThemes.ThemeMeta

	let myThemes = $state<ThemeMeta[]>([])
	let instanceThemes = $state<ThemeMeta[]>([])
	let isLoading = $state(true)

	// Editor state: null = list view, object = editing existing, "new" = creating new
	let editing = $state<ThemeMeta | "new" | null>(null)

	function loadList() {
		isLoading = true
		socket.emit("customThemes:list", {})
	}

	onMount(() => {
		socket.on("customThemes:list", (msg: Sockets.CustomThemes.List.Response) => {
			isLoading = false
			myThemes = msg.myThemes
			instanceThemes = msg.instanceThemes
		})
		socket.on("customThemes:list:error", () => {
			isLoading = false
			toaster.error({ title: "Failed to load themes" })
		})
		loadList()
	})

	onDestroy(() => {
		socket.off("customThemes:list")
		socket.off("customThemes:list:error")
	})

	function onSaved(theme: ThemeMeta) {
		loadList()
		editing = null
	}

	function onDeleted(id: number) {
		loadList()
		editing = null
	}
</script>

{#if editing !== null}
	<div class="flex h-full flex-col gap-0">
		<CustomThemeEditor
			theme={editing === "new" ? null : editing}
			{onSaved}
			{onDeleted}
			onCancel={() => (editing = null)}
		/>
	</div>

{:else}
	<div class="flex flex-col gap-4 p-4">
		<div class="flex items-center justify-between">
			<h3 class="text-sm font-semibold">Custom Themes</h3>
			<button class="btn btn-sm preset-filled-primary-500" onclick={() => (editing = "new")}>
				<Icons.Plus size={14} />
				New Theme
			</button>
		</div>

		{#if isLoading}
			<div class="flex items-center justify-center py-8">
				<Icons.Loader2 class="animate-spin" size={24} />
			</div>

		{:else}
			<!-- Generator tip -->
			<div class="bg-surface-100-800 flex items-start gap-3 rounded-lg p-3 text-sm">
				<Icons.Sparkles size={16} class="text-primary-500 mt-0.5 shrink-0" />
				<p class="text-surface-500 leading-snug">
					Use the <a
						href="https://themes.skeleton.dev/themes/create"
						target="_blank"
						rel="noopener noreferrer"
						class="text-primary-500 hover:underline font-medium"
					>Skeleton theme generator</a> to build a theme visually, then import the downloaded file here.
				</p>
			</div>

			<!-- My Themes -->
			<div class="space-y-2">
				<p class="text-surface-500 text-xs font-semibold uppercase tracking-wide">My Themes</p>
				{#if myThemes.length === 0}
					<div class="bg-surface-100-800 rounded-lg p-4 text-center text-sm opacity-60">
						No custom themes yet. Import a file or start from scratch.
					</div>
				{:else}
					{#each myThemes as theme}
						<div class="bg-surface-100-800 flex items-center gap-3 rounded-lg p-3">
							<!-- Theme preview swatch -->
							<div
								class="h-8 w-8 shrink-0 rounded-md border border-black/10"
								data-theme={theme.name}
								style="background: var(--color-primary-500, #6366f1);"
							></div>
							<div class="flex-1 min-w-0">
								<p class="truncate text-sm font-medium">{theme.label}</p>
								<p class="text-surface-500 font-mono text-xs">{theme.name}</p>
								{#if isAdmin && theme.uploaderName && isAccountsEnabled}
									<p class="text-surface-500 text-xs">by {theme.uploaderName}</p>
								{/if}
							</div>
							<div class="flex shrink-0 items-center gap-1">
								{#if theme.isInstanceTheme}
									<span class="badge text-xs" style="background: #2a1f4a; color: #a78bfa; padding: 0.1rem 0.5rem; border-radius: 999px;">
										<Icons.Globe size={9} />
										Instance
									</span>
								{/if}
								<button
									class="btn btn-sm preset-tonal-surface text-xs"
									onclick={() => (editing = theme)}
								>
									<Icons.Pencil size={12} />
									Edit
								</button>
							</div>
						</div>
					{/each}
				{/if}
			</div>

			<!-- Instance Themes (only when accounts enabled and there are some) -->
			{#if isAccountsEnabled && instanceThemes.length > 0}
				<div class="space-y-2">
					<p class="text-surface-500 text-xs font-semibold uppercase tracking-wide">Instance Themes</p>
					{#each instanceThemes as theme}
						<div class="bg-surface-100-800 flex items-center gap-3 rounded-lg p-3">
							<div
								class="h-8 w-8 shrink-0 rounded-md border border-black/10"
								data-theme={theme.name}
								style="background: var(--color-primary-500, #6366f1);"
							></div>
							<div class="flex-1 min-w-0">
								<p class="truncate text-sm font-medium">{theme.label}</p>
								<p class="text-surface-500 font-mono text-xs">{theme.name}</p>
								{#if isAdmin && theme.uploaderName}
									<p class="text-surface-500 text-xs">by {theme.uploaderName}</p>
								{/if}
							</div>
							{#if isAdmin}
								<button class="btn btn-sm preset-tonal-surface text-xs" onclick={() => (editing = theme)}>
									<Icons.Pencil size={12} />
									Edit
								</button>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</div>
{/if}
