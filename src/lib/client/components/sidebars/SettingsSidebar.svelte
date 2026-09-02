<script lang="ts">
	import { Tabs } from "@skeletonlabs/skeleton-svelte"
	import type { ValueChangeDetails } from "@zag-js/tabs"
	import { getContext, onMount } from "svelte"
	import {
		appVersion,
		appVersionDisplay
	} from "$lib/shared/constants/version"
	import * as Icons from "@lucide/svelte"
	import PanelTabList from "$lib/client/components/panels/PanelTabList.svelte"
	import PanelTab from "$lib/client/components/panels/PanelTab.svelte"
	import PanelSectionTitle from "$lib/client/components/panels/PanelSectionTitle.svelte"
	import { page } from "$app/state"
	import UserSettingsTab from "../settingsTabs/UserSettingsTab.svelte"
	import MediaManagerTab from "../media/MediaManagerTab.svelte"
	import CustomThemeManager from "../CustomThemeManager.svelte"
	import SettingsUnsavedChangesModal from "../modals/SettingsUnsavedChangesModal.svelte"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}
	let { onclose = $bindable() }: Props = $props()

	// State
	//
	// There is deliberately no System tab. Instance-wide settings live on
	// /admin/settings, which renders the very same `SystemSettingsTab`
	// component this used to — so nothing moved, the duplicate entry point
	// just went away. This panel is now entirely per-user: your settings, your
	// media, your theme.
	let activeTab = $state<"user" | "media" | "themes" | "about">("user")

	// Section names. The tab triggers are icon-only (see PanelTab), so
	// PanelSectionTitle is where the active section's full name is shown.
	const SECTION_LABELS: Record<string, string> = {
		user: "User",
		media: "Media",
		themes: "Themes",
		about: "About"
	}
	let sectionLabel = $derived(SECTION_LABELS[activeTab] ?? "")
	// Read solely for the update notice's admin gate below. This panel is
	// otherwise entirely per-user — instance-wide settings moved to /admin —
	// but a notice only an admin can act on still has to know who is looking.
	let userCtx: UserCtx = $state(getContext("userCtx"))
	// Only the User tab has buffered, explicitly-saved fields now; Media acts
	// immediately, so there is nothing to lose by leaving it. Kept as the
	// shared flag rather than folded into UserSettingsTab because the guard is
	// on tab *switching* — same pattern as LorebooksSidebar.
	let tabHasUnsavedChanges = $state(false)
	let nextTab: "user" | "media" | "themes" | "about" | undefined = $state()
	let showUnsavedChangesModal = $state(false)
	let confirmCloseSidebarResolve: ((v: boolean) => void) | null = null

	// Handle tab switching
	function handleTabChange(e: ValueChangeDetails): void {
		const target = e.value as "user" | "media" | "themes" | "about"
		if (!tabHasUnsavedChanges) {
			activeTab = target
		} else {
			nextTab = target
			showUnsavedChangesModal = true
		}
	}

	function handleUnsavedChangesModalOnOpenChange(e: OpenChangeDetails) {
		if (!e.open) {
			showUnsavedChangesModal = false
			nextTab = undefined
			if (confirmCloseSidebarResolve) {
				confirmCloseSidebarResolve(false)
				confirmCloseSidebarResolve = null
			}
		}
	}

	function handleUnsavedChangesModalConfirm() {
		showUnsavedChangesModal = false
		if (nextTab) {
			activeTab = nextTab
			nextTab = undefined
		}
		if (confirmCloseSidebarResolve) {
			confirmCloseSidebarResolve(true)
			confirmCloseSidebarResolve = null
		}
	}

	function handleUnsavedChangesModalCancel() {
		showUnsavedChangesModal = false
		nextTab = undefined
		if (confirmCloseSidebarResolve) {
			confirmCloseSidebarResolve(false)
			confirmCloseSidebarResolve = null
		}
	}

	async function handleOnClose(): Promise<boolean> {
		if (!tabHasUnsavedChanges) return true
		showUnsavedChangesModal = true
		return new Promise<boolean>((resolve) => {
			confirmCloseSidebarResolve = resolve
		})
	}

	onMount(() => {
		onclose = handleOnClose
	})
</script>

<div class="flex h-full flex-col p-4">
	<!-- Admin-only: a non-admin can't upgrade the install, so an update
	     notice is noise for them. Same rule as UpdateNoticeBar. -->
	{#if page.data?.isNewerReleaseAvailable && userCtx.user?.isAdmin}
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
			<PanelTabList>
				<PanelTab value="user" label="User" icon={Icons.UserCog} />
				<PanelTab value="media" label="Media" icon={Icons.Images} />
				<PanelTab value="themes" label="Themes" icon={Icons.Palette} />
				<PanelTab value="about" label="About" icon={Icons.Info} />
			</PanelTabList>
			<PanelSectionTitle title={sectionLabel} />
			<Tabs.Content value="user">
				{#if activeTab === "user"}
					<UserSettingsTab
						bind:hasUnsavedChanges={tabHasUnsavedChanges}
					/>
				{/if}
			</Tabs.Content>
			<Tabs.Content value="media">
				{#if activeTab === "media"}
					<MediaManagerTab />
				{/if}
			</Tabs.Content>
			<Tabs.Content value="themes">
				{#if activeTab === "themes"}
					<CustomThemeManager />
				{/if}
			</Tabs.Content>
			<Tabs.Content value="about">
				{#if activeTab === "about"}
					<div class="flex flex-col gap-4">
						<div class="mb-1 flex items-center gap-2">
							<Icons.Info size={20} class="text-primary-500" />
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
								href="https://serenepub.com"
								target="_blank"
								rel="noopener noreferrer"
								class="btn preset-filled-primary-500 gap-1"
								aria-label="Visit the Serene Pub website"
							>
								<Icons.Globe size={16} aria-hidden="true" />
								<span>Website</span>
							</a>
							<a
								href="https://github.com/doolijb/serene-pub"
								target="_blank"
								rel="noopener noreferrer"
								class="btn preset-filled-surface-500 gap-1"
								aria-label="Visit Serene Pub GitHub repository"
							>
								<Icons.GitBranch size={16} aria-hidden="true" />
								<span>Repository</span>
							</a>
							<a
								href="https://github.com/doolijb/serene-pub/milestones"
								target="_blank"
								rel="noopener noreferrer"
								class="btn preset-filled-surface-500"
								aria-label="View Serene Pub release milestones"
							>
								<Icons.Milestone size={16} aria-hidden="true" />
								<span>Milestones</span>
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

<SettingsUnsavedChangesModal
	open={showUnsavedChangesModal}
	onOpenChange={handleUnsavedChangesModalOnOpenChange}
	onConfirm={handleUnsavedChangesModalConfirm}
	onCancel={handleUnsavedChangesModalCancel}
/>
