<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { SegmentedControl, Switch } from "@skeletonlabs/skeleton-svelte"
	import { shellPrefs, PROSE_SIZES } from "$lib/client/shell/shellPrefs.svelte"
	import { onMount, getContext } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import { Theme } from "$lib/client/consts/Theme"
	import { toaster } from "$lib/client/utils/toaster"
	import BackgroundPicker from "$lib/client/components/backgrounds/BackgroundPicker.svelte"
	import CustomThemeEditor from "./CustomThemeEditor.svelte"
	import type { SocketEventMap } from "$lib/client/sockets/typedSocket"

	const socket = useTypedSocket()
	const userCtx: { user: SelectUser } = getContext("userCtx")
	const systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")
	const userSettingsCtx: UserSettingsCtx = getContext("userSettingsCtx")

	let isAccountsEnabled = $derived(
		systemSettingsCtx?.settings?.isAccountsEnabled ?? false
	)
	let isAdmin = $derived(userCtx?.user?.isAdmin ?? false)

	let isDarkMode = $state(false)
	let selectedTheme = $state("")
	let selectedBackground = $state<string | null>(null)
	let backgroundOpacity = $state(75)

	$effect(() => {
		isDarkMode = userSettingsCtx.settings?.darkMode ?? true
	})

	$effect(() => {
		selectedTheme = userSettingsCtx.settings?.theme ?? "lamplight"
	})

	$effect(() => {
		selectedBackground =
			userSettingsCtx.settings?.backgroundImagePath ?? null
		backgroundOpacity = userSettingsCtx.settings?.backgroundOpacity ?? 75
	})

	function handleBackgroundChange(path: string | null, opacity: number) {
		socket.emit("userSettings:updateBackground", { path, opacity })
	}

	const onDarkModeChanged = (event: { checked: boolean }) => {
		socket.emit("userSettings:updateDarkMode", { enabled: event.checked })
	}

	function selectTheme(theme: string) {
		if (theme === selectedTheme) return
		socket.emit("userSettings:updateTheme", { theme })
	}

	function onProseSizeChange(details: { value: string | null }) {
		if (details.value) shellPrefs.setProseSize(Number(details.value))
	}

	type ThemeMeta = Sockets.CustomThemes.ThemeMeta

	let myThemes = $state<ThemeMeta[]>([])
	let instanceThemes = $state<ThemeMeta[]>([])
	let isLoading = $state(true)

	/**
	 * The picker's groups. `value` is what the user settings store (the theme
	 * name); `dataTheme` is the selector its CSS answers to — the name for a
	 * built-in, the cssKey for a custom theme (Layout injects each custom
	 * theme's stylesheet under `[data-theme='<cssKey>']`). A theme that is
	 * both yours and the instance's shows once, under My themes.
	 */
	type ThemeChoice = { value: string; label: string; dataTheme: string }
	let themeGroups = $derived.by(() => {
		const toChoice = (t: ThemeMeta): ThemeChoice => ({
			value: t.name,
			label: t.label,
			dataTheme: t.cssKey || t.name
		})
		const mine = new Set(myThemes.map((t) => t.name))
		return [
			{
				key: "builtin",
				label: "Built-in",
				themes: Theme.options.map(
					([value, label]): ThemeChoice => ({
						value,
						label,
						dataTheme: value
					})
				)
			},
			{ key: "mine", label: "My themes", themes: myThemes.map(toChoice) },
			{
				key: "instance",
				label: "Instance themes",
				themes: instanceThemes
					.filter((t) => !mine.has(t.name))
					.map(toChoice)
			}
		]
	})

	// Editor state: null = list view, object = editing existing, "new" = creating new
	let editing = $state<ThemeMeta | "new" | null>(null)

	function loadList() {
		isLoading = true
		socket.emit("customThemes:list", {})
	}

	// Declared through the interest registry below, which counts subscribers
	// per key and owns one raw listener per event — Layout and the editor want
	// `customThemes:list` at the same time as this panel, and no teardown can
	// silence another's. The hazard that replaces is a bare
	// `socket.off("customThemes:list")`, which removes EVERY listener for that
	// event across the whole app.
	function handleCustomThemesList(msg: Sockets.CustomThemes.List.Response) {
		isLoading = false
		myThemes = msg.myThemes
		instanceThemes = msg.instanceThemes
	}

	function handleCustomThemesListError() {
		isLoading = false
		toaster.error({ title: "Failed to load themes" })
	}

	function handleUserSettingsUpdateDarkMode(
		message: SocketEventMap["userSettings:updateDarkMode"]["response"]
	) {
		if (message.success) {
			toaster.success({
				title: `${message.enabled ? "Dark" : "Light"} mode enabled`
			})
		} else {
			toaster.error({ title: "Failed to update dark mode setting" })
		}
	}

	function handleUserSettingsUpdateTheme(
		message: SocketEventMap["userSettings:updateTheme"]["response"]
	) {
		if (message.success) {
			toaster.success({
				title: "Theme updated"
			})
		} else {
			toaster.error({ title: "Failed to update theme" })
		}
	}

	/**
	 * All four BARE — nothing in either family is in `SCOPED_EVENTS`. The list
	 * is STANDING because saving or deleting a theme in the child editor
	 * answers only through a fresh `customThemes:list`, which is how this
	 * panel's rows change without asking again; the two `userSettings:` write
	 * replies are standing for the same reason the toggles can be pressed more
	 * than once.
	 */
	useInterest<"customThemes:list">(
		"customThemes:list",
		handleCustomThemesList
	)
	useInterest<"customThemes:list:error">(
		"customThemes:list:error",
		handleCustomThemesListError
	)
	useInterest<"userSettings:updateDarkMode">(
		"userSettings:updateDarkMode",
		handleUserSettingsUpdateDarkMode
	)
	useInterest<"userSettings:updateTheme">(
		"userSettings:updateTheme",
		handleUserSettingsUpdateTheme
	)

	onMount(() => {
		loadList()
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
		<!-- Theme picker: one swatch card per theme. Each preview carries its
		     own `data-theme`, so the role colours inside it resolve to THAT
		     theme's ladders — built-ins are all imported in app.css, and every
		     custom theme's stylesheet is injected by Layout under
		     `[data-theme='<cssKey>']`. Light/dark follows the page's data-mode. -->
		<section class="panel-card flex flex-col gap-4" aria-labelledby="theme-heading">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<h3 id="theme-heading" class="text-sm font-medium">Theme</h3>
				<Switch
					name="dark-mode"
					checked={isDarkMode}
					onCheckedChange={onDarkModeChanged}
				>
					<Switch.Control
						class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
					>
						<Switch.Thumb />
					</Switch.Control>
					<Switch.HiddenInput />
					<Switch.Label class="text-sm">Dark mode</Switch.Label>
				</Switch>
			</div>

			{#each themeGroups as group (group.label)}
				{#if group.themes.length > 0}
					<div class="flex flex-col gap-2">
						{#if themeGroups.filter((g) => g.themes.length > 0).length > 1}
							<p
								id="theme-group-{group.key}"
								class="text-surface-600-400 text-xs font-medium"
							>
								{group.label}
							</p>
						{/if}
						<div
							role="radiogroup"
							aria-label="{group.label} themes"
							class="grid grid-cols-2 gap-3 @min-[900px]/view:grid-cols-4"
						>
							{#each group.themes as t (t.value)}
								{@const isSelected = selectedTheme === t.value}
								<label
									class="bg-surface-50-950 border-surface-300 dark:border-surface-800 hover:border-surface-400 dark:hover:border-surface-600 has-[:focus-visible]:ring-primary-500 relative flex cursor-pointer flex-col gap-2 rounded-[12px] border p-2 has-[:focus-visible]:ring-2 {isSelected
										? 'ring-primary-500 ring-offset-surface-100 dark:ring-offset-surface-900 ring-2 ring-offset-2'
										: ''}"
								>
									<input
										type="radio"
										name="theme"
										class="sr-only"
										value={t.value}
										checked={isSelected}
										onchange={() => selectTheme(t.value)}
									/>
									<!-- The preview: the theme's own ground, two
									     ink bars and an accent pill. -->
									<div
										data-theme={t.dataTheme}
										class="bg-surface-50-950 border-surface-200 dark:border-surface-800 flex h-16 flex-col justify-center gap-1.5 rounded-[8px] border px-3"
										aria-hidden="true"
									>
										<span
											class="bg-surface-950-50 block h-1.5 w-3/4 rounded-full"
										></span>
										<span
											class="bg-surface-600-400 block h-1.5 w-1/2 rounded-full"
										></span>
										<span
											class="bg-primary-500 mt-0.5 block h-2.5 w-8 rounded-full"
										></span>
									</div>
									<span
										class="flex min-w-0 items-center gap-1 text-[13px]"
									>
										<!-- "(Default)" is part of the option label for the
										     dropdowns elsewhere; on a swatch it would push
										     the name into an ellipsis, so it becomes a line. -->
										<span class="min-w-0 flex-1">
											<span class="block truncate">
												{t.label.replace(/\s*\(Default\)$/, "")}
											</span>
											{#if /\(Default\)$/.test(t.label)}
												<span
													class="text-surface-600-400 block text-[11px]"
													>Default</span
												>
											{/if}
										</span>
										{#if isSelected}
											<Icons.Check
												size={14}
												class="text-primary-700 dark:text-primary-500 shrink-0"
												aria-hidden="true"
											/>
										{/if}
									</span>
								</label>
							{/each}
						</div>
					</div>
				{/if}
			{/each}
		</section>

		<!-- Per-browser, not per-account: shellPrefs keeps these in
		     localStorage, so a phone and a desktop can differ. -->
		<section
			class="panel-card flex flex-col gap-4"
			aria-labelledby="reading-motion-heading"
		>
			<div>
				<h3 id="reading-motion-heading" class="text-sm font-medium">
					Reading and motion
				</h3>
				<p class="text-surface-600-400 text-xs">
					Saved in this browser only.
				</p>
			</div>

			<div class="flex flex-col gap-2">
				<SegmentedControl
					value={String(shellPrefs.proseSize)}
					onValueChange={onProseSizeChange}
					class="items-start"
				>
					<SegmentedControl.Label class="text-sm">
						Story text size
					</SegmentedControl.Label>
					<SegmentedControl.Control>
						<SegmentedControl.Indicator />
						{#each PROSE_SIZES as px (px)}
							<SegmentedControl.Item
								value={String(px)}
								aria-label="{px} pixels"
							>
								<SegmentedControl.ItemText>{px}</SegmentedControl.ItemText>
								<SegmentedControl.ItemHiddenInput />
							</SegmentedControl.Item>
						{/each}
					</SegmentedControl.Control>
				</SegmentedControl>
				<p class="text-surface-600-400 text-xs">
					Only the story in a session; the interface stays the same size.
				</p>
			</div>

			<div class="flex flex-col gap-1">
				<Switch
					name="animate-views"
					checked={shellPrefs.animateViews}
					onCheckedChange={(e) => shellPrefs.setAnimateViews(e.checked)}
				>
					<Switch.Control
						class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
					>
						<Switch.Thumb />
					</Switch.Control>
					<Switch.HiddenInput />
					<Switch.Label class="text-sm">Animate views</Switch.Label>
				</Switch>
				<p class="text-surface-600-400 text-xs">
					Opening, resizing and focusing a view. Your system's
					reduced-motion setting always wins.
				</p>
			</div>
		</section>

		<!-- Background -->
		<div class="border-t pt-4">
			<h3 class="text-sm font-medium">Background</h3>

			<div class="mt-3">
				<BackgroundPicker
					bind:selectedPath={selectedBackground}
					bind:opacity={backgroundOpacity}
					onchange={handleBackgroundChange}
				/>
			</div>
		</div>

		<div class="flex items-center justify-between pt-4">
			<h3 class="text-sm font-medium">Custom themes</h3>
			<button
				class="btn btn-sm preset-filled-primary-500"
				onclick={() => (editing = "new")}
			>
				<Icons.Plus size={14} />
				New theme
			</button>
		</div>

		{#if isLoading}
			<div class="flex items-center justify-center py-8">
				<Icons.Loader2 class="animate-spin" size={24} />
			</div>
		{:else}
			<!-- Generator tip -->
			<div
				class="bg-surface-100-800 flex items-start gap-3 rounded-lg p-3 text-sm"
			>
				<Icons.Sparkles
					size={16}
					class="text-primary-500 mt-0.5 shrink-0"
				/>
				<p class="text-surface-700-300 leading-snug">
					Use the <a
						href="https://themes.skeleton.dev/themes/create"
						target="_blank"
						rel="noopener noreferrer"
						class="text-primary-500 font-medium hover:underline"
					>
						Skeleton theme generator
					</a>
					to build a theme visually, then import the downloaded file here.
				</p>
			</div>

			<!-- My Themes -->
			<div class="space-y-2">
				<p
					class="text-surface-600-400 text-xs"
				>
					My themes
				</p>
				{#if myThemes.length === 0}
					<div
						class="bg-surface-100-800 rounded-lg p-4 text-center text-sm opacity-60"
					>
						No custom themes yet. Import a file or start from
						scratch.
					</div>
				{:else}
					{#each myThemes as theme}
						<div
							class="bg-surface-100-800 flex items-center gap-3 rounded-lg p-3"
						>
							<!-- Theme preview swatch -->
							<div
								class="h-8 w-8 shrink-0 rounded-md border border-black/10"
								data-theme={theme.name}
								style="background: var(--color-primary-500, #6366f1);"
							></div>
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-medium">
									{theme.label}
								</p>
								<p
									class="text-surface-700-300 font-mono text-xs"
								>
									{theme.name}
								</p>
								{#if isAdmin && theme.uploaderName && isAccountsEnabled}
									<p class="text-surface-700-300 text-xs">
										by {theme.uploaderName}
									</p>
								{/if}
							</div>
							<div class="flex shrink-0 items-center gap-1">
								{#if theme.isInstanceTheme}
									<span
										class="badge text-xs"
										style="background: #2a1f4a; color: #a78bfa; padding: 0.1rem 0.5rem; border-radius: 999px;"
									>
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
					<p
						class="text-surface-600-400 text-xs"
					>
						Instance themes
					</p>
					{#each instanceThemes as theme}
						<div
							class="bg-surface-100-800 flex items-center gap-3 rounded-lg p-3"
						>
							<div
								class="h-8 w-8 shrink-0 rounded-md border border-black/10"
								data-theme={theme.name}
								style="background: var(--color-primary-500, #6366f1);"
							></div>
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-medium">
									{theme.label}
								</p>
								<p
									class="text-surface-700-300 font-mono text-xs"
								>
									{theme.name}
								</p>
								{#if isAdmin && theme.uploaderName}
									<p class="text-surface-700-300 text-xs">
										by {theme.uploaderName}
									</p>
								{/if}
							</div>
							{#if isAdmin}
								<button
									class="btn btn-sm preset-filled-surface-400-600 text-xs"
									onclick={() => (editing = theme)}
								>
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
