<script lang="ts">
	import { Tabs } from "@skeletonlabs/skeleton-svelte"
	import type { ValueChangeDetails } from "@zag-js/tabs"
	import { getContext, onMount, untrack } from "svelte"
	import {
		appVersion,
		appVersionDisplay
	} from "$lib/shared/constants/version"
	import * as Icons from "@lucide/svelte"
	import PanelTabList from "$lib/client/components/panels/PanelTabList.svelte"
	import PanelTab from "$lib/client/components/panels/PanelTab.svelte"
	import PanelSectionTitle from "$lib/client/components/panels/PanelSectionTitle.svelte"
	import UserSettingsTab from "../settingsTabs/UserSettingsTab.svelte"
	import DataSettingsTab from "../settingsTabs/DataSettingsTab.svelte"
	import MediaManagerTab from "../media/MediaManagerTab.svelte"
	import CustomThemeManager from "../CustomThemeManager.svelte"
	import ImportSettingsTab from "../settingsTabs/ImportSettingsTab.svelte"
	import SettingsUnsavedChangesModal from "../modals/SettingsUnsavedChangesModal.svelte"
	import { ViewModeTracker } from "$lib/client/shell/viewMode.svelte"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}
	let { onclose = $bindable() }: Props = $props()

	// State
	//
	// There is deliberately no System tab. Instance-wide settings live in
	// Admin › Pub (/admin/general, /admin/network, /admin/data,
	// /admin/diagnostics). This panel is entirely per-user: your settings,
	// your media, your theme.
	type SettingsSection = NonNullable<PanelsCtx["digest"]["settingsSection"]>
	let activeTab = $state<SettingsSection>("user")

	const panelsCtx: PanelsCtx = getContext("panelsCtx")
	const userCtx: UserCtx = getContext("userCtx")
	const systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")
	/**
	 * Import (the SillyTavern import, once the standalone /import page — owner
	 * note 23, 2026-10-02) is an admin's section, and the Android wrapper has
	 * no folder to pick, so the tab is drawn under the same condition the old
	 * entry-point buttons were.
	 */
	let importOpened = $state(false)
	$effect(() => {
		if (activeTab === "import") importOpened = true
	})
	const canImport = $derived(
		!!userCtx?.user?.isAdmin &&
			!systemSettingsCtx?.settings?.isAndroidWrapper
	)

	/**
	 * Given a view's worth of room the icon strip becomes a labelled rail down
	 * the left with the section beside it — one `orientation`, and PanelTabList
	 * / PanelTab carry the rest. Measured rather than asked of the window: this
	 * panel is 400px wide in the dock on the same desktop where it is 1376px
	 * full page, and only the first of those has room for a rail.
	 */
	const viewMode = new ViewModeTracker()
	const tabsOrientation = $derived(
		viewMode.mode === "desk" ? "vertical" : "horizontal"
	)

	// Section names. The tab triggers are icon-only (see PanelTab), so
	// PanelSectionTitle is where the active section's full name is shown.
	const SECTION_LABELS: Record<string, string> = {
		user: "User",
		media: "Media",
		data: "Data",
		themes: "Themes",
		import: "Import",
		about: "About"
	}
	let sectionLabel = $derived(SECTION_LABELS[activeTab] ?? "")
	// Only the User tab has buffered, explicitly-saved fields now; Media acts
	// immediately, so there is nothing to lose by leaving it. Kept as the
	// shared flag rather than folded into UserSettingsTab because the guard is
	// on tab *switching* — same pattern as LorebooksSidebar.
	let tabHasUnsavedChanges = $state(false)
	let nextTab: SettingsSection | undefined = $state()
	let showUnsavedChangesModal = $state(false)
	let confirmCloseSidebarResolve: ((v: boolean) => void) | null = null

	// Handle tab switching
	function handleTabChange(e: ValueChangeDetails): void {
		const target = e.value as SettingsSection
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

	/**
	 * A section named from outside (`digest.settingsSection`) — the "Import
	 * from SillyTavern" buttons. An effect, so a press lands whether this view
	 * was already open or not; through `handleTabChange`, so unsaved User
	 * fields still ask first. Consumed on read: the digest is one shared slot.
	 */
	$effect(() => {
		const section = panelsCtx?.digest?.settingsSection
		if (!section) return
		untrack(() => {
			panelsCtx.digest.settingsSection = undefined
			if (section === "import" && !canImport) return
			if (section !== activeTab)
				handleTabChange({ value: section } as ValueChangeDetails)
		})
	})
</script>

<div class="flex h-full flex-col p-4" use:viewMode.observe>

	<!-- Settings Tabs -->
	<div class="flex-1 overflow-y-auto">
		<Tabs
			value={activeTab}
			onValueChange={handleTabChange}
			orientation={tabsOrientation}
		>
			<PanelTabList>
				<PanelTab value="user" label="User" icon={Icons.UserCog} />
				<PanelTab value="media" label="Media" icon={Icons.Images} />
				<PanelTab value="data" label="Data" icon={Icons.Database} />
				<PanelTab value="themes" label="Themes" icon={Icons.Palette} />
				{#if canImport}
					<PanelTab value="import" label="Import" icon={Icons.Download} />
				{/if}
				<PanelTab value="about" label="About" icon={Icons.Info} />
			</PanelTabList>
			<!-- Title and panels share one box because the rail form lays the
			     root out as a ROW: loose, each of the six would be a column of
			     its own beside the rail. (Only the selected panel is in flow —
			     zag marks the rest `hidden` — but the title never is.) -->
			<div class="min-w-0 flex-1">
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
				<Tabs.Content value="data">
					{#if activeTab === "data"}
						<DataSettingsTab />
					{/if}
				</Tabs.Content>
				<Tabs.Content value="themes">
					{#if activeTab === "themes"}
						<CustomThemeManager />
					{/if}
				</Tabs.Content>
				{#if canImport}
					<Tabs.Content value="import">
						<!-- Kept mounted once opened, unlike its siblings: a
						     scan or import in flight answers on this section's
						     interest, and a tab switch must not drop the reply. -->
						{#if activeTab === "import" || importOpened}
							<ImportSettingsTab />
						{/if}
					</Tabs.Content>
				{/if}
				<Tabs.Content value="about">
					{#if activeTab === "about"}
						<div class="flex flex-col gap-4">
							<div class="mb-1 flex items-center gap-2">
								<Icons.Info
									size={20}
									class="text-primary-500"
								/>
								<span class="text-lg font-bold">
									Serene Pub
								</span>
								<span
									class="preset-tonal-primary ml-2 rounded px-2 py-0.5 font-mono text-xs"
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
									class="btn preset-tonal-surface gap-1"
									aria-label="Visit the Serene Pub website"
								>
									<Icons.Globe size={16} aria-hidden="true" />
									<span>Website</span>
								</a>
								<a
									href="https://github.com/doolijb/serene-pub"
									target="_blank"
									rel="noopener noreferrer"
									class="btn preset-tonal-surface gap-1"
									aria-label="Visit Serene Pub GitHub repository"
								>
									<Icons.GitBranch
										size={16}
										aria-hidden="true"
									/>
									<span>Repository</span>
								</a>
								<a
									href="https://github.com/doolijb/serene-pub/milestones"
									target="_blank"
									rel="noopener noreferrer"
									class="btn preset-tonal-surface"
									aria-label="View Serene Pub release milestones"
								>
									<Icons.Milestone
										size={16}
										aria-hidden="true"
									/>
									<span>Milestones</span>
								</a>
								<a
									href="https://discord.gg/3kUx3MDcSa"
									target="_blank"
									rel="noopener noreferrer"
									class="btn preset-tonal-surface"
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
									class="btn preset-tonal-surface"
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
									class="btn preset-tonal-surface"
									aria-label="Join discussions on GitHub"
								>
									<Icons.MessageCircle
										size={16}
										aria-hidden="true"
									/>
									<span>Discussions</span>
								</a>
							</div>
							<div class="text-surface-600-400 mt-2 text-xs">
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
							<div class="text-surface-600-400 mt-2 text-xs">
								Distributed under the AGPL-3.0 License.
							</div>
						</div>
					{/if}
				</Tabs.Content>
			</div>
		</Tabs>
	</div>
</div>

<SettingsUnsavedChangesModal
	open={showUnsavedChangesModal}
	onOpenChange={handleUnsavedChangesModalOnOpenChange}
	onConfirm={handleUnsavedChangesModalConfirm}
	onCancel={handleUnsavedChangesModalCancel}
/>
