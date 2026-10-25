<script module lang="ts">
	/**
	 * The section last chosen, at MODULE scope so closing the view and opening
	 * it again lands on it at desk (the shell unmounts a view on close, and
	 * state inside the component would go with it). In memory only; a
	 * reload starts at User.
	 * Compact ignores it on purpose: a fresh open there shows the list.
	 */
	let lastSection: NonNullable<PanelsCtx["digest"]["settingsSection"]> =
		"user"
</script>

<script lang="ts">
	import { getContext, onMount, untrack } from "svelte"
	import {
		appVersion,
		appVersionDisplay
	} from "$lib/shared/constants/version"
	import * as Icons from "@lucide/svelte"
	import PanelSplit from "$lib/client/components/panels/PanelSplit.svelte"
	import SectionList from "$lib/client/components/panels/SectionList.svelte"
	import PanelNavHeader from "$lib/client/components/panels/PanelNavHeader.svelte"
	import type { SectionItem } from "$lib/client/components/panels/sectionList"
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
	// There is deliberately no System section. Instance-wide settings live in
	// Admin › Pub (/admin/general, /admin/network, /admin/data,
	// /admin/diagnostics). This panel is entirely per-user: your settings,
	// your media, your theme.
	type SettingsSection = NonNullable<PanelsCtx["digest"]["settingsSection"]>

	const panelsCtx: PanelsCtx = getContext("panelsCtx")
	const userCtx: UserCtx = getContext("userCtx")
	const systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")
	/**
	 * Import (the SillyTavern import, once the standalone /import page — owner
	 * note 23, 2026-10-02) is an admin's section, and the Android wrapper has
	 * no folder to pick, so the row is drawn under the same condition the old
	 * entry-point buttons were.
	 */
	const canImport = $derived(
		!!userCtx?.user?.isAdmin &&
			!systemSettingsCtx?.settings?.isAndroidWrapper
	)

	/**
	 * A section list beside the section at desk; at compact the list fills
	 * the view and a section drills in over it (ruling Q1, PLAN-sidebar-nav-
	 * normalization §3). Measured rather than asked of the window: this view
	 * is 400px wide in the dock on the same desktop where it is 1376px full
	 * page.
	 */
	const vm = new ViewModeTracker()

	/**
	 * The section chosen in this mount; `null` until one is. At desk a
	 * section is always shown — the chosen one, else the remembered one — so
	 * the detail column is never empty; at compact `null` is the list.
	 */
	let picked = $state<SettingsSection | null>(null)
	const remembered = lastSection
	const section = $derived.by((): SettingsSection | null => {
		const s = picked ?? (vm.mode === "desk" ? remembered : null)
		// A remembered or picked Import that this user cannot open (the
		// module memory outlives a sign-out) falls back like no pick.
		if (s === "import" && !canImport)
			return vm.mode === "desk" ? "user" : null
		return s
	})

	const SECTIONS: Record<SettingsSection, SectionItem> = {
		user: { key: "user", label: "User", icon: Icons.UserCog },
		media: { key: "media", label: "Media", icon: Icons.Images },
		data: { key: "data", label: "Data", icon: Icons.Database },
		themes: { key: "themes", label: "Themes", icon: Icons.Palette },
		import: { key: "import", label: "Import", icon: Icons.Download },
		about: { key: "about", label: "About", icon: Icons.Info }
	}
	const sectionGroups = $derived([
		{
			items: [
				SECTIONS.user,
				SECTIONS.media,
				SECTIONS.data,
				SECTIONS.themes,
				...(canImport ? [SECTIONS.import] : []),
				SECTIONS.about
			]
		}
	])
	const sectionLabel = $derived(section ? SECTIONS[section].label : "")

	/**
	 * Import is kept mounted once opened, unlike its siblings: a scan or
	 * import in flight answers on this section's interest, and leaving the
	 * section must not drop the reply. Its siblings live inside the split's
	 * detail, which unmounts at compact when back returns to the list (and
	 * remounts when the view crosses desk/compact), so Import is rendered
	 * once, outside the split, in a hidden parking box — and its host node is
	 * moved into the detail's slot while the section is shown and back to
	 * the parking box otherwise. Moving the node keeps the one component
	 * instance (its scan state, its interest) alive across every one of
	 * those transitions.
	 */
	let importOpened = $state(false)
	$effect(() => {
		if (section === "import") importOpened = true
	})
	const importMounted = $derived(
		canImport && (importOpened || section === "import")
	)
	let importParking: HTMLDivElement | undefined = $state()
	let importHost: HTMLDivElement | undefined = $state()
	let importSlot: HTMLDivElement | undefined = $state()
	$effect(() => {
		const host = importHost
		if (!host) return
		const target =
			section === "import" && importSlot ? importSlot : importParking
		if (target && host.parentNode !== target) target.appendChild(host)
	})

	// Only the User section has buffered, explicitly-saved fields now; Media
	// acts immediately, so there is nothing to lose by leaving it. Kept as the
	// shared flag rather than folded into UserSettingsTab because the guard is
	// on leaving the section — picking another, or back to the list — the
	// same pattern as LorebooksSidebar.
	let tabHasUnsavedChanges = $state(false)
	/** Where a guarded move was headed; `to: null` is back to the list. */
	let pendingMove: { to: SettingsSection | null } | null = $state(null)
	let showUnsavedChangesModal = $state(false)
	let confirmCloseSidebarResolve: ((v: boolean) => void) | null = null

	function goTo(target: SettingsSection | null) {
		picked = target
		if (target) lastSection = target
	}

	/** Every way out of a section — a row, back, the digest — comes here. */
	function requestSection(target: SettingsSection | null): void {
		if (target === section) return
		if (!tabHasUnsavedChanges) {
			goTo(target)
		} else {
			pendingMove = { to: target }
			showUnsavedChangesModal = true
		}
	}

	function handleUnsavedChangesModalOnOpenChange(e: OpenChangeDetails) {
		if (!e.open) {
			showUnsavedChangesModal = false
			pendingMove = null
			if (confirmCloseSidebarResolve) {
				confirmCloseSidebarResolve(false)
				confirmCloseSidebarResolve = null
			}
		}
	}

	function handleUnsavedChangesModalConfirm() {
		showUnsavedChangesModal = false
		if (pendingMove) {
			goTo(pendingMove.to)
			pendingMove = null
		}
		if (confirmCloseSidebarResolve) {
			confirmCloseSidebarResolve(true)
			confirmCloseSidebarResolve = null
		}
	}

	function handleUnsavedChangesModalCancel() {
		showUnsavedChangesModal = false
		pendingMove = null
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
	 * was already open or not; through `requestSection`, so unsaved User
	 * fields still ask first. Consumed on read: the digest is one shared slot.
	 */
	$effect(() => {
		const named = panelsCtx?.digest?.settingsSection
		if (!named) return
		untrack(() => {
			panelsCtx.digest.settingsSection = undefined
			if (named === "import" && !canImport) return
			requestSection(named)
		})
	})
</script>

<div class="flex h-full min-h-0 flex-col" use:vm.observe>
	<PanelSplit
		kind="sections"
		mode={vm.mode}
		hasDetail={section !== null}
		emptyMessage="Pick a section."
	>
		{#snippet list()}
			<SectionList
				ariaLabel="Settings sections"
				groups={sectionGroups}
				value={section}
				onselect={(key) => requestSection(key as SettingsSection)}
			/>
		{/snippet}
		{#snippet detail()}
			<div class="flex flex-col gap-3">
				<PanelNavHeader
					title={sectionLabel}
					onBack={vm.mode === "compact"
						? () => requestSection(null)
						: undefined}
					backLabel="Settings"
				/>
				{#if section === "user"}
					<UserSettingsTab
						bind:hasUnsavedChanges={tabHasUnsavedChanges}
					/>
				{:else if section === "media"}
					<MediaManagerTab />
				{:else if section === "data"}
					<DataSettingsTab />
				{:else if section === "themes"}
					<CustomThemeManager />
				{:else if section === "import"}
					<!-- Import's host is moved in here while shown; see
					     `importParking` in the script. -->
					<div bind:this={importSlot}></div>
				{:else if section === "about"}
					<div class="flex flex-col gap-4">
						<div class="mb-1 flex items-center gap-2">
							<Icons.Info size={20} class="text-primary-500" />
							<span class="text-lg font-bold">Serene Pub</span>
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
								<Icons.GitBranch size={16} aria-hidden="true" />
								<span>Repository</span>
							</a>
							<a
								href="https://github.com/doolijb/serene-pub/milestones"
								target="_blank"
								rel="noopener noreferrer"
								class="btn preset-tonal-surface"
								aria-label="View Serene Pub release milestones"
							>
								<Icons.Milestone size={16} aria-hidden="true" />
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
								class="text-primary-ink hover:underline"
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
			</div>
		{/snippet}
	</PanelSplit>

	<!-- Import's parking box: never shown. The host below lives here while
	     Import is not the section on screen, and is moved into the detail's
	     slot while it is (see the script). One element in the `{#if}`, so
	     the block's start and end are the host itself wherever it sits. -->
	<div bind:this={importParking} hidden>
		{#if importMounted}
			<div bind:this={importHost}><ImportSettingsTab /></div>
		{/if}
	</div>
</div>

<SettingsUnsavedChangesModal
	open={showUnsavedChangesModal}
	onOpenChange={handleUnsavedChangesModalOnOpenChange}
	onConfirm={handleUnsavedChangesModalConfirm}
	onCancel={handleUnsavedChangesModalCancel}
/>
