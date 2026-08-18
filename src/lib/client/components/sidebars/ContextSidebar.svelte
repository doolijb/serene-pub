<script lang="ts">
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getContext, onDestroy, onMount } from "svelte"
	import { SvelteSet } from "svelte/reactivity"
	import * as Icons from "@lucide/svelte"
	import PanelTabList from "$lib/client/components/panels/PanelTabList.svelte"
	import PanelTab from "$lib/client/components/panels/PanelTab.svelte"
	import PanelSectionTitle from "$lib/client/components/panels/PanelSectionTitle.svelte"
	import ContextConfigUnsavedChangesModal from "../modals/ContextConfigUnsavedChangesModal.svelte"
	import NewNameModal from "../modals/NewNameModal.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { z } from "zod"
	import { dndzone } from "svelte-dnd-action"
	import { Popover, Tabs, Portal } from "@skeletonlabs/skeleton-svelte"
	import {
		parseContextTemplate,
		lintContextTemplate,
		INSERTABLE_CARD_OPTIONS,
		type InsertableKind
	} from "$lib/shared/utils/contextConfigCards"
	import { makeCardListActions } from "$lib/shared/utils/contextCardListActions"
	import CardListDnd from "./CardListDnd.svelte"
	import ContextCardNode from "./ContextCardNode.svelte"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}

	let { onclose = $bindable() }: Props = $props()

	const socket = useTypedSocket()
	let userCtx: { user: SelectUser } = getContext("userCtx")
	let userSettingsCtx: UserSettingsCtx = getContext("userSettingsCtx")
	let configsList: Sockets.ContextConfigs.List.Response["contextConfigsList"] =
		$state([])
	let selectedConfigId: number | undefined = $state(
		userSettingsCtx.settings?.activeContextConfigId || undefined
	)
	let contextConfig: Sockets.ContextConfigs.Get.Response["contextConfig"] =
		$state({} as Sockets.ContextConfigs.Get.Response["contextConfig"])
	let originalData: Sockets.ContextConfigs.Get.Response["contextConfig"] =
		$state({} as Sockets.ContextConfigs.Get.Response["contextConfig"])
	let unsavedChanges = $derived(
		JSON.stringify(contextConfig) !== JSON.stringify(originalData)
	)
	let showNewNameModal = $state(false)
	let showUnsavedChangesModal = $state(false)
	let confirmCloseSidebarResolve: ((v: boolean) => void) | null = null
	let activeView: "cards" | "raw" | "preview" = $state("cards")

	// Section names. The tab triggers are icon-only (see PanelTab), so
	// PanelSectionTitle is where the active section's full name is shown.
	const SECTION_LABELS: Record<string, string> = {
		cards: "Cards",
		raw: "Raw",
		preview: "Preview"
	}
	let sectionLabel = $derived(SECTION_LABELS[activeView] ?? "")

	// The Cards tab's tree editor isn't usable at mobile widths yet — hidden
	// there for now (same lg breakpoint Layout.svelte/MessageComposer use for
	// mobile detection elsewhere). Bounce off "cards" to "raw" so a load (or
	// a resize down from desktop) never strands the user on a tab whose
	// trigger just disappeared.
	let isMobile = $state(false)
	onMount(() => {
		const mq = window.matchMedia("(min-width: 1024px)")
		const update = () => (isMobile = !mq.matches)
		update()
		mq.addEventListener("change", update)
		return () => mq.removeEventListener("change", update)
	})
	$effect(() => {
		if (isMobile && activeView === "cards") activeView = "raw"
	})

	let parsedTemplate = $derived(
		parseContextTemplate(contextConfig.template || "")
	)

	// Top-level cards default to collapsed the first time their id is seen,
	// except ids just created via an Add Card/Insert-above action (queued in
	// pendingExpandIds by the two root-level insertAt call sites below) —
	// those should stay open so the user immediately sees what they added.
	// Both tracking sets are plain (non-reactive) — they only gate what the
	// effect below does the FIRST time an id shows up, not something the UI
	// re-renders off of directly.
	// A plain $state(new Set()) doesn't give fine-grained reactivity on Set
	// mutations (add/delete don't touch the tracked own-property, so nothing
	// re-renders) — SvelteSet from svelte/reactivity is the reactive
	// collection type Svelte 5 provides for exactly this.
	let collapsedIds: Set<string> = new SvelteSet()
	let seenTopLevelIds = new Set<string>()
	let pendingExpandIds = new Set<string>()

	$effect(() => {
		const currentIds = new Set(parsedTemplate.cards.map((c) => c.id))
		for (const id of currentIds) {
			if (seenTopLevelIds.has(id)) continue
			seenTopLevelIds.add(id)
			if (pendingExpandIds.has(id)) {
				pendingExpandIds.delete(id)
			} else {
				collapsedIds.add(id)
			}
		}
		for (const id of seenTopLevelIds) {
			if (!currentIds.has(id)) seenTopLevelIds.delete(id)
		}
	})

	function toggleCollapsed(id: string) {
		if (collapsedIds.has(id)) collapsedIds.delete(id)
		else collapsedIds.add(id)
	}

	// Line numbers for display only — lintContextTemplate itself works in
	// plain byte offsets, same as every other card position in this file.
	let templateLintIssues = $derived(
		parsedTemplate.parseError
			? []
			: lintContextTemplate(parsedTemplate.cards).map((issue) => ({
					...issue,
					line: (contextConfig.template || "")
						.slice(0, issue.start)
						.split("\n").length
				}))
	)

	function updateTemplate(newTemplate: string) {
		contextConfig = { ...contextConfig, template: newTemplate }
	}

	// Root-level card list actions — same factory each block card uses for
	// its own children/elseChildren (see ContextCardNode.svelte), applied
	// here to the top-level card list.
	let rootActions = $derived(
		makeCardListActions({
			template: contextConfig.template || "",
			siblings: parsedTemplate.cards,
			parentBodyStart: 0,
			parentBodyEnd: (contextConfig.template || "").length,
			onTemplateChange: updateTemplate
		})
	)

	let previewLoading = $state(false)
	let previewMessages: { role: string; content: string }[] | undefined =
		$state(undefined)
	let previewError: string | undefined = $state(undefined)

	function requestPreview() {
		previewLoading = true
		previewMessages = undefined
		previewError = undefined
		socket.emit("contextConfigs:preview", {
			template: contextConfig.template || ""
		})
	}

	// Zod validation schema
	const contextConfigSchema = z.object({
		name: z.string().min(1, "Name is required").trim()
	})

	type ValidationErrors = Record<string, string>
	let validationErrors: ValidationErrors = $state({})

	function validateForm(): boolean {
		const result = contextConfigSchema.safeParse({
			name: contextConfig.name
		})

		if (result.success) {
			validationErrors = {}
			return true
		} else {
			const errors: ValidationErrors = {}
			result.error.errors.forEach((error) => {
				if (error.path.length > 0) {
					errors[error.path[0] as string] = error.message
				}
			})
			validationErrors = errors
			return false
		}
	}

	function handleSave() {
		if (!validateForm()) return
		socket.emit("contextConfigs:update", {
			contextConfig
		})
		// After saving, reload the config from the server
		// socket.emit("contextConfigs:get", { id: selectedConfigId })
	}

	$effect(() => {
		// When selectedConfigId changes, load the config from the server
		if (selectedConfigId) {
			socket.emit("contextConfigs:get", { id: selectedConfigId })
		}
	})

	function handleDelete() {
		if (!contextConfig.isImmutable) {
			socket.emit("contextConfigs:delete", { id: contextConfig.id })
			selectedConfigId = undefined
		}
	}

	function handleReset() {
		contextConfig = { ...originalData }
	}

	function handleNew() {
		showNewNameModal = true
	}

	function handleNewNameConfirm(name: string) {
		if (!name.trim()) return
		const newContextConfig: Partial<SelectContextConfig> & {
			name: string
		} = {
			...contextConfig,
			name: name.trim(),
			isImmutable: false
		}
		delete newContextConfig.id
		socket.emit("contextConfigs:create", {
			contextConfig: newContextConfig
		})
		showNewNameModal = false
	}

	function handleNewNameCancel() {
		showNewNameModal = false
	}

	async function handleOnClose() {
		if (unsavedChanges) {
			showUnsavedChangesModal = true
			return new Promise<boolean>((resolve) => {
				confirmCloseSidebarResolve = resolve
			})
		} else {
			return true
		}
	}

	function handleUnsavedChangesModalConfirm() {
		showUnsavedChangesModal = false
		if (confirmCloseSidebarResolve) confirmCloseSidebarResolve(true)
	}
	function handleUnsavedChangesModalCancel() {
		showUnsavedChangesModal = false
		if (confirmCloseSidebarResolve) confirmCloseSidebarResolve(false)
	}
	function handleUnsavedChangesModalOpenChange(e: OpenChangeDetails) {
		if (!e.open) {
			showUnsavedChangesModal = false
			if (confirmCloseSidebarResolve) confirmCloseSidebarResolve(false)
		}
	}

	function handleSetDefault() {
		if (!selectedConfigId) return
		socket.emit("contextConfigs:setUserActive", { id: selectedConfigId })
	}

	onMount(() => {
		socket.on(
			"contextConfigs:list",
			(msg: Sockets.ContextConfigs.List.Response) => {
				configsList = msg.contextConfigsList
				if (!selectedConfigId && configsList.length > 0) {
					selectedConfigId =
						userSettingsCtx.settings?.activeContextConfigId ??
						configsList[0].id
				}
			}
		)

		socket.on(
			"contextConfigs:get",
			(msg: Sockets.ContextConfigs.Get.Response) => {
				contextConfig = { ...msg.contextConfig }
				originalData = { ...msg.contextConfig }
				previewMessages = undefined
				previewError = undefined
			}
		)

		socket.on(
			"contextConfigs:create",
			(msg: Sockets.ContextConfigs.Create.Response) => {
				selectedConfigId = msg.contextConfig.id
			}
		)
		socket.on(
			"contextConfigs:update",
			(msg: Sockets.ContextConfigs.Update.Response) => {
				contextConfig = { ...msg.contextConfig }
				originalData = { ...msg.contextConfig }
				toaster.success({ title: "Context config saved successfully." })
			}
		)
		socket.on("contextConfigs:setUserActive", () => {
			toaster.success({ title: "Default context config updated" })
		})
		socket.on(
			"contextConfigs:preview",
			(msg: Sockets.ContextConfigs.Preview.Response) => {
				previewLoading = false
				previewMessages = msg.messages
				previewError = msg.error
			}
		)
		socket.emit("contextConfigs:list", {})
		if (selectedConfigId) {
			socket.emit("contextConfigs:get", {
				id: selectedConfigId
			})
		}
		onclose = handleOnClose
	})

	onDestroy(() => {
		socket.off("contextConfigs:list")
		socket.off("contextConfigs:get")
		socket.off("contextConfigs:create")
		socket.off("contextConfigs:update")
		socket.off("contextConfigs:setUserActive")
		socket.off("contextConfigs:preview")
		onclose = undefined
	})

	function roleIcon(role: string) {
		if (role === "user") return Icons.User
		if (role === "assistant") return Icons.Bot
		return Icons.ScrollText
	}
	function roleLabel(role: string) {
		if (role === "user") return "User"
		if (role === "assistant") return "Assistant"
		return "System"
	}
	function rolePreset(role: string) {
		if (role === "user") return "preset-tonal-secondary"
		if (role === "assistant") return "preset-tonal-primary"
		return "preset-tonal-surface"
	}
</script>

<div class="text-foreground h-full p-4">
	<div class="mt-2 mb-2 flex flex-wrap gap-2 sm:mt-0">
		<button
			type="button"
			class="btn btn-sm preset-filled-primary-500"
			onclick={handleNew}
			title="Clone to new config"
		>
			<Icons.Plus size={16} />
			Clone
		</button>
		<button
			type="button"
			class="btn btn-sm preset-filled-secondary-500"
			onclick={handleReset}
			disabled={!unsavedChanges}
			title="Reset unsaved changes"
		>
			<Icons.RefreshCcw size={16} />
			Reset
		</button>
		<button
			type="button"
			class="btn btn-sm preset-filled-error-500"
			onclick={handleDelete}
			disabled={!contextConfig || contextConfig.isImmutable}
			title="Delete context config"
		>
			<Icons.X size={16} />
			Delete
		</button>
	</div>
	<div class="mb-6">
		<select
			class="select w-full"
			bind:value={selectedConfigId}
			disabled={unsavedChanges}
		>
			{#each configsList.filter((c) => c.isImmutable) as c}
				{@const isDefault =
					c.id === userSettingsCtx.settings?.activeContextConfigId}
				<option value={c.id}>{isDefault ? "★ " : ""}{c.name}*</option>
			{/each}
			{#each configsList.filter((c) => !c.isImmutable) as c}
				{@const isDefault =
					c.id === userSettingsCtx.settings?.activeContextConfigId}
				<option value={c.id}>{isDefault ? "★ " : ""}{c.name}</option>
			{/each}
		</select>
	</div>
	{#if contextConfig}
		<div class="mt-4 mb-4 flex w-full flex-wrap gap-2">
			<button
				class="btn btn-sm preset-filled-success-500 flex-1"
				onclick={handleSave}
				disabled={contextConfig.isImmutable || !unsavedChanges}
			>
				<Icons.Save size={16} />
				Update
			</button>
			<button
				class="btn btn-sm preset-filled-warning-500 shrink-0"
				onclick={handleSetDefault}
				disabled={!selectedConfigId ||
					selectedConfigId ===
						userSettingsCtx.settings?.activeContextConfigId}
				title={selectedConfigId ===
				userSettingsCtx.settings?.activeContextConfigId
					? "Already the default"
					: "Set as default"}
			>
				<Icons.Star
					size={16}
					fill={selectedConfigId ===
					userSettingsCtx.settings?.activeContextConfigId
						? "currentColor"
						: "none"}
				/>
				{selectedConfigId ===
				userSettingsCtx.settings?.activeContextConfigId
					? "Default"
					: "Set Default"}
			</button>
		</div>
		<div class="flex flex-col gap-4">
			<div class="flex flex-col gap-1">
				<label class="font-semibold" for="contextName">Name*</label>
				<input
					id="contextName"
					type="text"
					bind:value={contextConfig.name}
					class="input w-full {validationErrors.name
						? 'border-error-500'
						: ''}"
					disabled={contextConfig.isImmutable}
					oninput={() => {
						if (validationErrors.name) {
							const { name, ...rest } = validationErrors
							validationErrors = rest
						}
					}}
				/>
				{#if validationErrors.name}
					<p class="text-error-500 mt-1 text-sm" role="alert">
						{validationErrors.name}
					</p>
				{/if}
			</div>
			{#if contextConfig.isImmutable}
				<div
					class="preset-tonal-warning flex items-center gap-2 rounded-xl p-2 text-sm"
				>
					<Icons.Info size={16} class="shrink-0" />
					This is a built-in config — edit freely, then use "+ Clone" to save
					your changes as a copy.
				</div>
			{/if}
			<Tabs
				value={activeView}
				onValueChange={(e) =>
					(activeView = e.value as typeof activeView)}
			>
				<PanelTabList>
					<!-- Still hidden below lg: the Cards tree editor isn't usable
					     at mobile widths yet (see the isMobile guard above). -->
					<PanelTab
						value="cards"
						label="Cards"
						icon={Icons.LayoutList}
						class="max-lg:hidden"
					/>
					<PanelTab value="raw" label="Raw" icon={Icons.Code} />
					<PanelTab
						value="preview"
						label="Preview"
						icon={Icons.Eye}
					/>
				</PanelTabList>
				<PanelSectionTitle title={sectionLabel} />
				<Tabs.Content value="cards">
					<div class="flex flex-col gap-3">
						{#if parsedTemplate.parseError}
							<div
								class="preset-outlined-error-500 bg-error-100-900 rounded-xl p-3 text-sm whitespace-pre-wrap"
							>
								{parsedTemplate.parseError}
							</div>
						{:else}
							{#if parsedTemplate.cards.length === 0}
								<p class="text-surface-700-300 text-sm">
									No cards yet — add one below.
								</p>
							{/if}
							<CardListDnd
								cards={parsedTemplate.cards}
								onReorder={(ids) => rootActions.reorder(ids)}
							>
								{#snippet row(card, i)}
									<ContextCardNode
										{card}
										template={contextConfig.template || ""}
										onTemplateChange={updateTemplate}
										onRemove={() => rootActions.remove(i)}
										onMoveUp={() => rootActions.moveUp(i)}
										onMoveDown={() =>
											rootActions.moveDown(i)}
										canMoveUp={i > 0}
										canMoveDown={i <
											parsedTemplate.cards.length - 1}
										onInsertAbove={(spec) => {
											const { insertedId } =
												rootActions.insertAt(i, spec)
											if (insertedId)
												pendingExpandIds.add(insertedId)
										}}
										showDragHandle={parsedTemplate.cards
											.length > 1}
										{collapsedIds}
										onToggleCollapsed={toggleCollapsed}
									/>
								{/snippet}
							</CardListDnd>
							<Popover positioning={{ placement: "bottom" }}>
								<Popover.Trigger
									class="btn btn-sm preset-outlined-primary-500 self-start"
									aria-label="Add a card"
								>
									<Icons.Plus size={14} />
									Add Card
								</Popover.Trigger>
								<Portal>
									<Popover.Positioner class="z-[1000]!">
										<Popover.Content
											class="card preset-tonal-surface flex max-w-[16rem] flex-col gap-1 p-2"
										>
											{#each INSERTABLE_CARD_OPTIONS as option}
												<button
													type="button"
													class="btn btn-sm preset-filled-surface-400-600 w-full justify-start"
													onclick={() => {
														const { insertedId } =
															rootActions.insertAt(
																parsedTemplate
																	.cards
																	.length,
																option.spec
															)
														if (insertedId)
															pendingExpandIds.add(
																insertedId
															)
													}}
													title={option.description}
												>
													<Icons.Plus size={14} />
													{option.label}
												</button>
											{/each}
										</Popover.Content>
									</Popover.Positioner>
								</Portal>
							</Popover>
						{/if}
					</div>
				</Tabs.Content>
				<Tabs.Content value="raw">
					<div class="flex flex-col gap-1">
						<label class="font-semibold" for="contextTemplate">
							Template
						</label>
						<textarea
							id="template"
							rows="20"
							bind:value={contextConfig.template}
							class="input w-full font-mono text-xs"
						></textarea>
						{#if templateLintIssues.length > 0}
							<div
								class="preset-outlined-warning-500 bg-warning-100-900 flex flex-col gap-1 rounded-xl p-2 text-xs"
							>
								<p class="font-semibold">
									{templateLintIssues.length}
									{templateLintIssues.length === 1
										? "issue"
										: "issues"} found
								</p>
								<ul class="flex flex-col gap-0.5">
									{#each templateLintIssues as issue}
										<li>
											<span class="font-mono">
												Line {issue.line}:
											</span>
											{issue.message}
										</li>
									{/each}
								</ul>
							</div>
						{/if}
					</div>
				</Tabs.Content>
				<Tabs.Content value="preview">
					<div class="flex flex-col gap-2">
						<p class="text-surface-700-300 text-sm">
							Renders this template against static mock story
							data, using the same engine as real chats.
						</p>
						<button
							type="button"
							class="btn btn-sm preset-filled-primary-500 self-start"
							onclick={requestPreview}
							disabled={previewLoading}
						>
							<Icons.Play size={14} />
							{previewLoading ? "Rendering…" : "Render Preview"}
						</button>
						{#if previewError}
							<div
								class="preset-outlined-error-500 bg-error-100-900 rounded-xl p-3 text-sm whitespace-pre-wrap"
							>
								{previewError}
							</div>
						{:else if previewMessages !== undefined}
							<div
								class="flex max-h-[36rem] flex-col gap-2 overflow-auto"
							>
								{#each previewMessages as msg}
									{@const RoleIcon = roleIcon(msg.role)}
									<div
										class="{rolePreset(
											msg.role
										)} flex flex-col gap-1 rounded-xl p-3"
									>
										<div
											class="flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase opacity-70"
										>
											<RoleIcon size={14} />
											{roleLabel(msg.role)}
										</div>
										<div
											class="text-sm whitespace-pre-wrap"
										>
											{msg.content}
										</div>
									</div>
								{/each}
								{#if previewMessages.length === 0}
									<p class="text-surface-700-300 text-sm">
										This template didn't render any content.
									</p>
								{/if}
							</div>
						{/if}
					</div>
				</Tabs.Content>
			</Tabs>
		</div>
	{/if}
</div>

<ContextConfigUnsavedChangesModal
	open={showUnsavedChangesModal}
	onOpenChange={handleUnsavedChangesModalOpenChange}
	onConfirm={handleUnsavedChangesModalConfirm}
	onCancel={handleUnsavedChangesModalCancel}
/>

<NewNameModal
	open={showNewNameModal}
	onOpenChange={(e) => (showNewNameModal = e.open)}
	onConfirm={handleNewNameConfirm}
	onCancel={handleNewNameCancel}
	title="New Context Config"
	description="Your current settings will be copied."
/>
