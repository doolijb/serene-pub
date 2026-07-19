<script lang="ts">
	import { Tabs } from "@skeletonlabs/skeleton-svelte"
	import type { ValueChangeDetails } from "@zag-js/tabs"
	import { getContext, onMount } from "svelte"
	import {
		appVersion,
		appVersionDisplay
	} from "$lib/shared/constants/version"
	import * as Icons from "@lucide/svelte"
	import { page } from "$app/state"
	import UserSettingsTab from "../settingsTabs/UserSettingsTab.svelte"
	import SystemSettingsTab from "../settingsTabs/SystemSettingsTab.svelte"
	import CustomThemeManager from "../CustomThemeManager.svelte"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}
	let { onclose = $bindable() }: Props = $props()

	// State
	let activeTab = $state<"user" | "system" | "themes" | "about">("user")
	let userCtx: UserCtx = $state(getContext("userCtx"))

	// Handle tab switching
	function handleTabChange(e: ValueChangeDetails): void {
		activeTab = e.value as "user" | "system" | "themes" | "about"
	}

	onMount(() => {
		onclose = async () => {
			return true
		}
	})
</script>

<div class="flex h-full flex-col p-4">
	{#if page.data?.isNewerReleaseAvailable}
		<div
			class="bg-surface-200-800 mb-4 flex w-full flex-col items-center justify-between gap-4 rounded p-3 text-center"
		>
			<p>A newer version of Serene Pub is available!</p>
			<div class="mt-2">
				<a
					href="https://github.com/doolijb/serene-pub/releases"
					target="_blank"
					rel="noopener"
					class="btn preset-filled-success-500"
					aria-label="Download newer version of Serene Pub"
				>
					<Icons.Download size={16} aria-hidden="true" />
					Download here
				</a>
			</div>
		</div>
	{/if}

	<!-- Settings Tabs -->
	<div class="flex-1 overflow-y-auto">
		<Tabs value={activeTab} onValueChange={handleTabChange}>
			<Tabs.List class="flex flex-wrap gap-1">
				<Tabs.Trigger value="user">
					<Icons.UserCog size={20} class="inline" />
					{#if activeTab === "user"}
						User
					{/if}
				</Tabs.Trigger>
				{#if userCtx.user?.isAdmin}
					<Tabs.Trigger value="system">
						<Icons.Server size={20} class="inline" />
						{#if activeTab === "system"}
							System
						{/if}
					</Tabs.Trigger>
				{/if}
				<Tabs.Trigger value="themes">
					<Icons.Palette size={20} class="inline" />
					{#if activeTab === "themes"}
						Themes
					{/if}
				</Tabs.Trigger>
				<Tabs.Trigger value="about">
					<Icons.Info size={20} class="inline" />
					{#if activeTab === "about"}
						About
					{/if}
				</Tabs.Trigger>
			</Tabs.List>
			<Tabs.Content value="user">
				{#if activeTab === "user"}
					<UserSettingsTab />
				{/if}
			</Tabs.Content>
			{#if userCtx.user?.isAdmin}
				<Tabs.Content value="system">
					{#if activeTab === "system"}
						<SystemSettingsTab />
					{/if}
				</Tabs.Content>
			{/if}
			<Tabs.Content value="themes">
				{#if activeTab === "themes"}
					<CustomThemeManager />
				{/if}
			</Tabs.Content>
			<Tabs.Content value="about">
				{#if activeTab === "about"}
						<div class="flex flex-col gap-4">
							<div class="mb-1 flex items-center gap-2">
								<Icons.Info
									size={20}
									class="text-primary-500"
								/>
								<span class="text-lg font-bold tracking-wide">
									Serene Pub
								</span>
								<span
									class="bg-primary-200-800 text-primary-700 dark:text-primary-200 ml-2 rounded px-2 py-0.5 font-mono text-xs"
								>
									{appVersionDisplay}
								</span>
							</div>
							<div class="text-surface-700-300 mb-2 text-xs">
								Build: <span class="font-mono">
									{appVersion}
								</span>
							</div>
							<div class="flex flex-wrap items-center gap-3">
								<a
									href="https://github.com/doolijb/serene-pub"
									target="_blank"
									rel="noopener noreferrer"
									class="btn preset-filled-primary-500 gap-1"
									aria-label="Visit Serene Pub GitHub repository"
								>
									<Icons.GitBranch
										size={16}
										aria-hidden="true"
									/>
									<span>Repository</span>
								</a>
								<a
									href="https://github.com/doolijb/serene-pub/wiki"
									target="_blank"
									rel="noopener noreferrer"
									class="btn preset-filled-surface-500"
									aria-label="Visit Serene Pub wiki documentation"
								>
									<Icons.BookOpen
										size={16}
										aria-hidden="true"
									/>
									<span>Wiki</span>
								</a>
								<a
									href="https://discord.gg/3kUx3MDcSa"
									target="_blank"
									rel="noopener noreferrer"
									class="btn preset-filled-tertiary-500"
									aria-label="Join Serene Pub Discord community"
								>
									<Icons.MessageSquare
										size={16}
										aria-hidden="true"
									/>
									<span>Discord</span>
								</a>
								<a
									href="https://github.com/doolijb/serene-pub/issues"
									target="_blank"
									rel="noopener noreferrer"
									class="btn preset-filled-error-500"
									aria-label="Report issues on GitHub"
								>
									<Icons.AlertCircle
										size={16}
										aria-hidden="true"
									/>
									<span>Issues</span>
								</a>
								<a
									href="https://github.com/doolijb/serene-pub/discussions"
									target="_blank"
									rel="noopener noreferrer"
									class="btn preset-filled-secondary-500"
									aria-label="Join discussions on GitHub"
								>
									<Icons.MessageCircle
										size={16}
										aria-hidden="true"
									/>
									<span>Discussions</span>
								</a>
							</div>
							<div class="text-muted-foreground mt-2 text-xs">
								&copy; {new Date().getFullYear()} Serene Pub (
								<a
									href="https://github.com/doolijb"
									target="_blank"
									rel="noopener noreferrer"
									class="text-primary-500 hover:underline"
								>
									Jody Doolittle
								</a>
								).
							</div>
							<div class="text-muted-foreground mt-2 text-xs">
								Distributed under the AGPL-3.0 License.
							</div>
						</div>
					{/if}
			</Tabs.Content>
		</Tabs>
	</div>
</div>
