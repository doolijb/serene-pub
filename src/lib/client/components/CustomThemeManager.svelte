<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import { onMount, onDestroy, getContext } from "svelte"
	import * as skio from "sveltekit-io"
	import { Theme } from "$lib/client/consts/Theme"
	import { toaster } from "$lib/client/utils/toaster"
	import BackgroundPicker from "$lib/client/components/backgrounds/BackgroundPicker.svelte"
	import CustomThemeEditor from "./CustomThemeEditor.svelte"

	const socket = skio.get()
	const userCtx: { user: SelectUser } = getContext("userCtx")
	const systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")
	const userSettingsCtx: UserSettingsCtx = getContext("userSettingsCtx")

	let isAccountsEnabled = $derived(systemSettingsCtx?.settings?.isAccountsEnabled ?? false)
	let isAdmin = $derived(userCtx?.user?.isAdmin ?? false)

	let isDarkMode = $state(false)
	let selectedTheme = $state("")
	let selectedBackground = $state<string | null>(null)
	let backgroundOpacity = $state(75)
	let backgroundExpanded = $state(false)

	$effect(() => {
		isDarkMode = userSettingsCtx.settings?.darkMode ?? true
	})

	$effect(() => {
		selectedTheme = userSettingsCtx.settings?.theme ?? "hamlindigo"
	})

	$effect(() => {
		selectedBackground = userSettingsCtx.settings?.backgroundImagePath ?? null
		backgroundOpacity = userSettingsCtx.settings?.backgroundOpacity ?? 75
	})

	function handleBackgroundChange(path: string | null, opacity: number) {
		socket.emit("userSettings:updateBackground", { path, opacity })
	}

	const onDarkModeChanged = (event: { checked: boolean }) => {
		socket.emit("userSettings:updateDarkMode", { enabled: event.checked })
	}

	const onThemeChanged = (event: Event) => {
		const target = event.target as HTMLSelectElement
		socket.emit("userSettings:updateTheme", { theme: target.value })
	}

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

		socket.on("userSettings:updateDarkMode", (message: any) => {
			if (message.success) {
				toaster.success({
					title: `${message.enabled ? "Dark" : "Light"} mode enabled`
				})
			} else {
				toaster.error({ title: "Failed to update dark mode setting" })
			}
		})

		socket.on("userSettings:updateTheme", (message: any) => {
			if (message.success) {
				toaster.success({
					title: "Theme updated successfully"
				})
			} else {
				toaster.error({ title: "Failed to update theme" })
			}
		})
	})

	onDestroy(() => {
		socket.off("customThemes:list")
		socket.off("customThemes:list:error")
		socket.off("userSettings:updateDarkMode")
		socket.off("userSettings:updateTheme")
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
		<div>
			<label for="theme" class="font-semibold">Theme</label>
			<select
				id="theme"
				class="select"
				name="theme"
				value={selectedTheme}
				onchange={onThemeChanged}
				aria-label="Select application theme"
			>
				<optgroup label="Built-in">
					{#each Theme.options as [key, label]}
						<option value={key}>{label}</option>
					{/each}
				</optgroup>
				{#if myThemes.length > 0}
					<optgroup label="My Themes">
						{#each myThemes as t}
							<option value={t.name}>{t.label}</option>
						{/each}
					</optgroup>
				{/if}
				{#if instanceThemes.length > 0}
					<optgroup label="Instance Themes">
						{#each instanceThemes as t}
							<option value={t.name}>{t.label}</option>
						{/each}
					</optgroup>
				{/if}
			</select>
		</div>

		<div class="flex gap-2">
			<Switch
				name="dark-mode"
				checked={isDarkMode}
				onCheckedChange={onDarkModeChanged}
			>
				<Switch.Control class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500">
					<Switch.Thumb />
				</Switch.Control>
				<Switch.HiddenInput />
			</Switch>
			<label for="dark-mode" class="font-semibold">Dark Mode</label>
		</div>

		<!-- Background -->
		<div class="border-t pt-4">
			<button
				type="button"
				class="flex w-full items-center justify-between"
				onclick={() => (backgroundExpanded = !backgroundExpanded)}
			>
				<h3 class="text-lg font-semibold">Background</h3>
				<Icons.ChevronDown
					class="text-muted-foreground h-4 w-4 transition-transform {backgroundExpanded ? 'rotate-180' : ''}"
				/>
			</button>
			{#if backgroundExpanded}
				<div class="mt-3">
					<BackgroundPicker
						bind:selectedPath={selectedBackground}
						bind:opacity={backgroundOpacity}
						onchange={handleBackgroundChange}
					/>
				</div>
			{/if}
		</div>

		<div class="flex items-center justify-between border-t pt-4">
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
									class="btn btn-sm preset-filled-surface-400-600 text-xs"
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
								<button class="btn btn-sm preset-filled-surface-400-600 text-xs" onclick={() => (editing = theme)}>
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
