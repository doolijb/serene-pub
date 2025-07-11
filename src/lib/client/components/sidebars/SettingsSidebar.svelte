<script lang="ts">
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import { getContext, onMount } from "svelte"
	import { Theme } from "$lib/client/consts/Theme"
	import { appVersion, appVersionDisplay } from "$lib/shared/constants/version"
	import * as Icons from "@lucide/svelte"
	import { page } from "$app/state"
	import * as skio from "sveltekit-io"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}
	let { onclose = $bindable() }: Props = $props()

	const socket = skio.get()

	let isDarkMode = $state(false)
	let selectedTheme: string = $state("")
	let themeCtx: ThemeCtx = $state(getContext("themeCtx"))
	let systemSettingsCtx: SystemSettingsCtx = $state(getContext("systemSettingsCtx"))

	$effect(() => {
		const _s = {...$state.snapshot(systemSettingsCtx)}
		console.log("SettingsSidebar systemSettingsCtx", $state.snapshot(systemSettingsCtx))
	})

	$effect(() => {
		isDarkMode = themeCtx.mode === "dark"
	})

	$effect(() => {
		selectedTheme = themeCtx.theme
	})

	const onDarkModeChanged = (event: { checked: boolean }) => {
		themeCtx.mode = event.checked ? "dark" : "light"
		// TODO use setTheme socket call
	}

	const onThemeChanged = (event: Event) => {
		const target = event.target as HTMLSelectElement
		themeCtx.theme = target.value
		// TODO use setTheme socket call
	}

	async function onOllamaManagerEnabledClick(event: { checked: boolean }) {
		const res: Sockets.UpdateOllamaManagerEnabled.Call = {
			enabled: event.checked
		}
		socket.emit("updateOllamaManagerEnabled", res)
	}

	onMount(() => {
		onclose = async () => {
			return true
		}
	})
</script>

<div class="p-4">
	<div class="flex flex-col gap-4">

		{#if page.data?.isNewerReleaseAvailable}
			<div class="w-full flex flex-col items-center justify-between gap-4 p-3 mb-2 rounded bg-surface-200-800 text-center">
				<p>
					A newer version of Serene Pub is available!
				</p>
				<div class="mt-2">
					<a
						href="https://github.com/doolijb/serene-pub/releases"
						target="_blank"
						rel="noopener"
						class="btn preset-filled-success-500"
					>
						<Icons.Download size={16} />
						Download here
					</a>
				</div>
			</div>
		{/if}

		<div>
			<label for="theme" class="font-semibold">Theme</label>
			<select
				class="select"
				name="theme"
				value={selectedTheme}
				onchange={onThemeChanged}
			>
				{#each Theme.options as [key, label]}
					<option value={key}>{label}</option>
				{/each}
			</select>
		</div>

		<div class="flex gap-2">
			<Switch
				name="dark-mode"
				checked={isDarkMode}
				onCheckedChange={onDarkModeChanged}
			></Switch>
			<label for="dark-mode" class="font-semibold">Dark Mode</label>
		</div>
		<div class="flex gap-2">
			<Switch
				name="dark-mode"
				checked={systemSettingsCtx.settings.ollamaManagerEnabled}
				onCheckedChange={onOllamaManagerEnabledClick}
			></Switch>
			<label for="dark-mode" class="font-semibold">Enable Ollama Manager</label>
		</div>
	</div>

	<div class="about-section mt-6 rounded-lg bg-surface-500/25 p-4 shadow-md flex flex-col gap-2 items-start">

		<div class="flex items-center gap-2 mb-1">
			<Icons.Info size={20} class="text-primary-500" />
			<span class="text-lg font-bold tracking-wide">Serene Pub</span>
			<span class="ml-2 px-2 py-0.5 rounded bg-primary-200-800 text-primary-700 dark:text-primary-200 text-xs font-mono">
				{appVersionDisplay}
			</span>
		</div>
		<div class="text-xs text-surface-500 mb-2">
			Build: <span class="font-mono">{appVersion}</span>
		</div>
		<div class="flex flex-wrap gap-3 items-center">
			<a
				href="https://github.com/doolijb/serene-pub"
				target="_blank"
				rel="noopener noreferrer"
				class="btn gap-1 preset-filled-primary-500"
			>
				<Icons.GitBranch size={16} />
				<span>Repository</span>
			</a>
			<a
				href="https://github.com/doolijb/serene-pub/wiki"
				target="_blank"
				rel="noopener noreferrer"
				class="btn preset-filled-surface-500"
			>
				<Icons.BookOpen size={16} />
				<span>Wiki</span>
			</a>
			<a
				href="https://discord.gg/3kUx3MDcSa"
				target="_blank"
				rel="noopener noreferrer"
				class="btn preset-filled-tertiary-500"
			>
				<Icons.MessageSquare size={16} />
				<span>Discord</span>
			</a>
			<a
				href="https://github.com/doolijb/serene-pub/issues"
				target="_blank"
				rel="noopener noreferrer"
				class="btn preset-filled-error-500"
			>
				<Icons.AlertCircle size={16} />
				<span>Issues</span>
			</a>
			<a
				href="https://github.com/doolijb/serene-pub/discussions"
				target="_blank"
				rel="noopener noreferrer"
				class="btn preset-filled-secondary-500"
			>
				<Icons.MessageCircle size={16} />
				<span>Discussions</span>
			</a>
		</div>
		<div class="text-xs text-muted-foreground mt-2">
			&copy; {new Date().getFullYear()} Serene Pub (<a href="https://github.com/doolijb" target="_blank" rel="noopener noreferrer" class="hover:underline text-primary-500">Jody Doolittle</a>).
		</div>
		<div class="text-xs text-muted-foreground mt-2">
			Distributed under the AGPL-3.0 License.
		</div>
	</div>
</div>
