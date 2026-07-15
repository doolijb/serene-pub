<script lang="ts">
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getContext, onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import ContextConfigUnsavedChangesModal from "../modals/ContextConfigUnsavedChangesModal.svelte"
	import NewNameModal from "../modals/NewNameModal.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { z } from "zod"
	import { dndzone } from "svelte-dnd-action"
	import { Popover, Tabs } from "@skeletonlabs/skeleton-svelte"
	import {
		CONTEXT_CARD_TYPES,
		getContextCardType,
		parseContextTemplate,
		insertContextCard,
		insertContextCardAt,
		removeContextCard,
		reorderContextCards,
		updateCustomTextCard,
		updateBlockCard,
		updateFieldCardContent,
		type ParsedContextCard,
		type ContextBlockRole
	} from "$lib/shared/utils/contextConfigCards"

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

	let parsedTemplate = $derived(
		parseContextTemplate(contextConfig.template || "")
	)
	let systemCards = $derived(
		parsedTemplate.cards.filter((c) => c.zone === "systemMessage") as (ParsedContextCard & {
			id: string
		})[]
	)
	let chatMessagesCard = $derived(
		parsedTemplate.cards.find((c) => c.zone === "chatMessages")
	)
	let postHistoryCard = $derived(
		parsedTemplate.cards.find((c) => c.zone === "postHistory")
	)
	let addableSystemCardTypes = $derived(
		CONTEXT_CARD_TYPES.filter(
			(t) =>
				t.zone === "systemMessage" &&
				(t.repeatable || !systemCards.some((c) => c.typeId === t.id))
		)
	)

	// svelte-dnd-action expects to own the array it's given during a drag
	// gesture (via `id`-keyed reconciliation) — re-deriving `systemCards`
	// fresh from a re-parsed template on every `consider` tick desyncs its
	// internal drag state and makes the dragged card vanish mid-gesture. This
	// local mirror is what dndzone actually drives; the template is only
	// re-spliced once, on `finalize`.
	let systemCardsDnd: (ParsedContextCard & { id: string })[] = $state([])
	$effect(() => {
		systemCardsDnd = systemCards.map((c) => ({ ...c, id: c.key }))
	})

	let previewLoading = $state(false)
	let previewMessages: { role: string; content: string }[] | undefined =
		$state(undefined)
	let previewError: string | undefined = $state(undefined)

	function addCardAt(index: number, typeId: string) {
		const { template, error } = insertContextCardAt(
			contextConfig.template || "",
			typeId,
			{ zone: "systemMessage", index }
		)
		if (error) {
			toaster.error({ title: error })
			return
		}
		contextConfig = { ...contextConfig, template }
	}

	function addPostHistoryCard() {
		const { template, error } = insertContextCard(
			contextConfig.template || "",
			"postHistoryInstructions"
		)
		if (error) {
			toaster.error({ title: error })
			return
		}
		contextConfig = { ...contextConfig, template }
	}

	function removeCard(card: Pick<ParsedContextCard, "start" | "end">) {
		contextConfig = {
			...contextConfig,
			template: removeContextCard(contextConfig.template || "", card)
		}
	}

	function updateCustomTextContent(
		card: Pick<ParsedContextCard, "start" | "end" | "content">,
		newContent: string
	) {
		if (newContent === card.content) return
		contextConfig = {
			...contextConfig,
			template: updateCustomTextCard(
				contextConfig.template || "",
				card,
				newContent
			)
		}
	}

	function updateBlockContent(
		card: Pick<ParsedContextCard, "start" | "end" | "content" | "role">,
		newContent: string
	) {
		if (newContent === card.content) return
		contextConfig = {
			...contextConfig,
			template: updateBlockCard(contextConfig.template || "", card, {
				role: card.role || "system",
				content: newContent
			})
		}
	}

	function updateBlockRole(
		card: Pick<ParsedContextCard, "start" | "end" | "content" | "role">,
		newRole: ContextBlockRole
	) {
		if (newRole === card.role) return
		contextConfig = {
			...contextConfig,
			template: updateBlockCard(contextConfig.template || "", card, {
				role: newRole,
				content: card.content || ""
			})
		}
	}

	// Keyed by typeId (not card.key) since these field cards are singleton — a
	// stable identifier across re-parses, unlike the repeatable card types.
	let expandedFieldCards: Set<string> = $state(new Set())
	function toggleFieldCardExpanded(typeId: string) {
		const next = new Set(expandedFieldCards)
		if (next.has(typeId)) next.delete(typeId)
		else next.add(typeId)
		expandedFieldCards = next
	}

	function updateFieldContent(
		card: Pick<ParsedContextCard, "start" | "end" | "typeId" | "content">,
		newContent: string
	) {
		if (newContent === card.content) return
		contextConfig = {
			...contextConfig,
			template: updateFieldCardContent(
				contextConfig.template || "",
				card,
				newContent
			)
		}
	}

	function reorderSystemCards(orderedKeys: string[]) {
		contextConfig = {
			...contextConfig,
			template: reorderContextCards(
				contextConfig.template || "",
				"systemMessage",
				orderedKeys
			)
		}
	}

	function moveSystemCardUp(index: number) {
		if (index <= 0) return
		const keys = systemCardsDnd.map((c) => c.key)
		;[keys[index - 1], keys[index]] = [keys[index], keys[index - 1]]
		reorderSystemCards(keys)
	}

	function moveSystemCardDown(index: number) {
		if (index >= systemCardsDnd.length - 1) return
		const keys = systemCardsDnd.map((c) => c.key)
		;[keys[index], keys[index + 1]] = [keys[index + 1], keys[index]]
		reorderSystemCards(keys)
	}

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
		const newContextConfig = {
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
		socket.emit("contextConfigs:get", {
			id: selectedConfigId
		})
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
			title="New context config"
		>
			<Icons.Plus size={16} />
			New
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
				{@const isDefault = c.id === userSettingsCtx.settings?.activeContextConfigId}
				<option value={c.id}>{isDefault ? "★ " : ""}{c.name}*</option>
			{/each}
			{#each configsList.filter((c) => !c.isImmutable) as c}
				{@const isDefault = c.id === userSettingsCtx.settings?.activeContextConfigId}
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
				disabled={!selectedConfigId || selectedConfigId === userSettingsCtx.settings?.activeContextConfigId}
				title="Set as default"
			>
				<Icons.Star size={16} /> Set Default
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
						? 'border-red-500'
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
					<p class="mt-1 text-sm text-red-500" role="alert">
						{validationErrors.name}
					</p>
				{/if}
			</div>
			{#if contextConfig.isImmutable}
				<div
					class="preset-tonal-warning flex items-center gap-2 rounded-xl p-2 text-sm"
				>
					<Icons.Info size={16} class="shrink-0" />
					This is a built-in config — edit freely, then use "New" to save
					your changes as a copy.
				</div>
			{/if}
			<Tabs
				value={activeView}
				onValueChange={(e) => (activeView = e.value as typeof activeView)}
				listBase="flex flex-wrap gap-1"
			>
				{#snippet list()}
					<Tabs.Control value="cards">
						<Icons.LayoutList size={16} class="inline" /> Cards
					</Tabs.Control>
					<Tabs.Control value="raw">
						<Icons.Code size={16} class="inline" /> Raw
					</Tabs.Control>
					<Tabs.Control value="preview">
						<Icons.Eye size={16} class="inline" /> Preview
					</Tabs.Control>
				{/snippet}
				{#snippet content()}
					<Tabs.Panel value="cards">
						<div class="flex flex-col gap-4">
							<!-- System Message zone -->
							<div
								class="preset-outlined-surface-300-700 flex flex-col gap-3 rounded-2xl p-3"
							>
								<div class="flex items-start gap-2">
									<div
										class="preset-tonal-primary shrink-0 rounded-lg p-1.5"
									>
										<Icons.ScrollText size={18} />
									</div>
									<div class="min-w-0">
										<div class="font-semibold">System Message</div>
										<p class="text-surface-500 text-xs">
											Everything the model sees as scene-setting context,
											wrapped in one system-role block.
										</p>
									</div>
								</div>

								{#if systemCardsDnd.length === 0}
									<p class="text-surface-500 text-sm">
										No cards yet — add one below.
									</p>
								{/if}
								<div
									class="flex flex-col gap-2"
									use:dndzone={{
										items: systemCardsDnd,
										flipDurationMs: 150,
										dragDisabled: !(systemCardsDnd.length > 1),
										dropFromOthersDisabled: true
									}}
									onconsider={(e) => (systemCardsDnd = e.detail.items)}
									onfinalize={(e) => {
										systemCardsDnd = e.detail.items
										reorderSystemCards(e.detail.items.map((c) => c.key))
									}}
								>
									{#each systemCardsDnd as card, i (card.key)}
										{@const cardType = getContextCardType(card.typeId)!}
										<div
											class="preset-outlined-surface-400-600 bg-surface-100-800 hover:bg-surface-200-800 flex flex-col gap-2 rounded-xl p-3 shadow-sm transition-colors"
											data-dnd-handle
										>
											<div class="flex items-start gap-2">
												{#if systemCardsDnd.length > 1}
													<span
														class="text-surface-400 hover:text-primary-500 mt-0.5 cursor-grab"
														data-dnd-handle
														title="Drag to reorder"
													>
														<Icons.GripVertical size={18} />
													</span>
												{/if}
												<div class="min-w-0 flex-1">
													<div class="flex items-center gap-1">
														{#if card.typeId === "customText"}
															<Icons.Type
																size={14}
																class="text-surface-400 shrink-0"
															/>
														{:else if card.typeId === "block"}
															<Icons.Layers
																size={14}
																class="text-surface-400 shrink-0"
															/>
														{/if}
														<span class="truncate font-semibold select-none">
															{cardType.label}
														</span>
														{#if card.typeId === "block"}
															<select
																class="select w-auto py-0.5 text-xs"
																value={card.role || "system"}
																onchange={(e) =>
																	updateBlockRole(
																		card,
																		e.currentTarget.value as ContextBlockRole
																	)}
															>
																<option value="system">System</option>
																<option value="user">User</option>
																<option value="assistant">Assistant</option>
															</select>
														{/if}
														<Popover
															positioning={{ placement: "top" }}
															zIndex="1000"
															triggerBase="btn-ghost rounded p-0.5"
															contentBase="card preset-tonal-surface p-2 max-w-xs text-sm"
															triggerAriaLabel="About {cardType.label}"
														>
															{#snippet trigger()}
																<Icons.Info size={14} />
															{/snippet}
															{#snippet content()}
																{cardType.description}
															{/snippet}
														</Popover>
													</div>
												</div>
												<div class="flex shrink-0 items-center gap-0.5">
													<Popover
														positioning={{ placement: "bottom-end" }}
														zIndex="1000"
														triggerBase="btn-ghost rounded p-0.5"
														contentBase="card preset-tonal-surface p-2 flex flex-col gap-1 max-w-[16rem]"
														triggerAriaLabel="Insert card above {cardType.label}"
													>
														{#snippet trigger()}
															<Icons.Plus size={16} />
														{/snippet}
														{#snippet content()}
															<p
																class="text-surface-500 px-1 pb-1 text-xs font-semibold tracking-wide uppercase"
															>
																Insert above
															</p>
															{#each addableSystemCardTypes as insertType}
																<button
																	type="button"
																	class="btn btn-sm preset-filled-surface-400-600 w-full justify-start"
																	onclick={() =>
																		addCardAt(i, insertType.id)}
																>
																	<Icons.Plus size={14} />
																	{insertType.label}
																</button>
															{/each}
														{/snippet}
													</Popover>
													{#if systemCardsDnd.length > 1}
														<button
															class="btn-ghost rounded p-0.5 disabled:opacity-30"
															onclick={() => moveSystemCardUp(i)}
															disabled={i === 0}
															title="Move up"
															aria-label="Move {cardType.label} up"
														>
															<Icons.ChevronUp size={16} />
														</button>
														<button
															class="btn-ghost rounded p-0.5 disabled:opacity-30"
															onclick={() => moveSystemCardDown(i)}
															disabled={i === systemCardsDnd.length - 1}
															title="Move down"
															aria-label="Move {cardType.label} down"
														>
															<Icons.ChevronDown size={16} />
														</button>
													{/if}
													{#if card.content !== undefined && card.typeId !== "customText" && card.typeId !== "block"}
														<button
															class="btn-ghost rounded p-0.5"
															onclick={() =>
																toggleFieldCardExpanded(card.typeId)}
															title="Edit wrapper text"
															aria-label="Edit {cardType.label} wrapper text"
														>
															<Icons.Pencil size={14} />
														</button>
													{/if}
													<button
														class="btn-ghost text-error-500 rounded p-0.5"
														onclick={() => removeCard(card)}
														title="Remove {cardType.label}"
														aria-label="Remove {cardType.label}"
													>
														<Icons.X size={16} />
													</button>
												</div>
											</div>
											{#if card.content !== undefined && card.typeId !== "customText" && card.typeId !== "block" && expandedFieldCards.has(card.typeId)}
												<textarea
													class="input w-full font-mono text-xs"
													rows="4"
													value={card.content}
													onblur={(e) =>
														updateFieldContent(card, e.currentTarget.value)}
												></textarea>
											{/if}
											{#if card.typeId === "customText"}
												<textarea
													class="input w-full text-sm"
													rows="3"
													value={card.content}
													placeholder="Write anything here."
													onblur={(e) =>
														updateCustomTextContent(
															card,
															e.currentTarget.value
														)}
												></textarea>
											{:else if card.typeId === "block"}
												<textarea
													class="input w-full text-sm"
													rows="3"
													value={card.content}
													placeholder="Write anything here."
													onblur={(e) =>
														updateBlockContent(
															card,
															e.currentTarget.value
														)}
												></textarea>
											{/if}
										</div>
									{/each}
								</div>
								<Popover
									positioning={{ placement: "bottom" }}
									zIndex="1000"
									triggerBase="btn btn-sm preset-outlined-primary-500 self-start"
									contentBase="card preset-tonal-surface p-2 flex flex-col gap-1 max-w-[16rem]"
									triggerAriaLabel="Add a card"
								>
									{#snippet trigger()}
										<Icons.Plus size={14} />
										Add Card
									{/snippet}
									{#snippet content()}
										<p
											class="text-surface-500 px-1 pb-1 text-xs font-semibold tracking-wide uppercase"
										>
											Add to end
										</p>
										{#each addableSystemCardTypes as insertType}
											<button
												type="button"
												class="btn btn-sm preset-filled-surface-400-600 w-full justify-start"
												onclick={() =>
													addCardAt(systemCardsDnd.length, insertType.id)}
											>
												<Icons.Plus size={14} />
												{insertType.label}
											</button>
										{/each}
									{/snippet}
								</Popover>
							</div>

							<!-- Chat Messages zone -->
							<div
								class="preset-outlined-surface-300-700 flex flex-col gap-3 rounded-2xl p-3"
							>
								<div class="flex items-start gap-2">
									<div
										class="preset-tonal-secondary shrink-0 rounded-lg p-1.5"
									>
										<Icons.MessagesSquare size={18} />
									</div>
									<div class="min-w-0">
										<div class="font-semibold">Chat Messages</div>
										<p class="text-surface-500 text-xs">
											The conversation itself. Fixed in place — always
											present, can't be reordered or removed.
										</p>
									</div>
								</div>
								{#if chatMessagesCard}
									{@const cardType = getContextCardType("chatMessages")!}
									<div
										class="preset-outlined-surface-400-600 bg-surface-100-800 flex items-start gap-2 rounded-xl p-3 shadow-sm"
									>
										<div class="min-w-0 flex-1">
											<div class="flex items-center gap-1">
												<span class="truncate font-semibold select-none">
													{cardType.label}
												</span>
												<Popover
													positioning={{ placement: "top" }}
													zIndex="1000"
													triggerBase="btn-ghost rounded p-0.5"
													contentBase="card preset-tonal-surface p-2 max-w-xs text-sm"
													triggerAriaLabel="About {cardType.label}"
												>
													{#snippet trigger()}
														<Icons.Info size={14} />
													{/snippet}
													{#snippet content()}
														{cardType.description}
													{/snippet}
												</Popover>
											</div>
										</div>
									</div>
								{:else}
									<div
										class="preset-outlined-warning-500 bg-warning-100-900 rounded-xl p-3 text-sm"
									>
										This template doesn't include the chat history. Add
										it back from the Raw tab.
									</div>
								{/if}
							</div>

							<!-- Post-History Instructions zone -->
							<div
								class="preset-outlined-surface-300-700 flex flex-col gap-3 rounded-2xl p-3"
							>
								<div class="flex items-start gap-2">
									<div
										class="preset-tonal-tertiary shrink-0 rounded-lg p-1.5"
									>
										<Icons.ListEnd size={18} />
									</div>
									<div class="min-w-0">
										<div class="font-semibold">
											Post-History Instructions
										</div>
										<p class="text-surface-500 text-xs">
											A reminder injected right after the chat history,
											closest to where the model starts writing.
										</p>
									</div>
								</div>
								{#if postHistoryCard}
									{@const cardType = getContextCardType(
										"postHistoryInstructions"
									)!}
									<div
										class="preset-outlined-surface-400-600 bg-surface-100-800 flex flex-col gap-2 rounded-xl p-3 shadow-sm"
									>
										<div class="flex items-start gap-2">
											<div class="min-w-0 flex-1">
												<div class="flex items-center gap-1">
													<span class="truncate font-semibold select-none">
														{cardType.label}
													</span>
													<Popover
														positioning={{ placement: "top" }}
														zIndex="1000"
														triggerBase="btn-ghost rounded p-0.5"
														contentBase="card preset-tonal-surface p-2 max-w-xs text-sm"
														triggerAriaLabel="About {cardType.label}"
													>
														{#snippet trigger()}
															<Icons.Info size={14} />
														{/snippet}
														{#snippet content()}
															{cardType.description}
														{/snippet}
													</Popover>
												</div>
											</div>
											<button
												class="btn-ghost rounded p-0.5"
												onclick={() =>
													toggleFieldCardExpanded(
														"postHistoryInstructions"
													)}
												title="Edit wrapper text"
												aria-label="Edit {cardType.label} wrapper text"
											>
												<Icons.Pencil size={14} />
											</button>
											<button
												class="btn-ghost text-error-500 rounded p-0.5"
												onclick={() => removeCard(postHistoryCard)}
												title="Remove {cardType.label}"
												aria-label="Remove {cardType.label}"
											>
												<Icons.X size={16} />
											</button>
										</div>
										{#if expandedFieldCards.has("postHistoryInstructions")}
											<textarea
												class="input w-full font-mono text-xs"
												rows="4"
												value={postHistoryCard.content}
												onblur={(e) =>
													updateFieldContent(
														postHistoryCard,
														e.currentTarget.value
													)}
											></textarea>
										{/if}
									</div>
								{:else}
									<button
										type="button"
										class="btn btn-sm preset-outlined-primary-500 self-start"
										onclick={addPostHistoryCard}
									>
										<Icons.Plus size={14} />
										Post-History Instructions
									</button>
								{/if}
							</div>
						</div>
					</Tabs.Panel>
					<Tabs.Panel value="raw">
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
						</div>
					</Tabs.Panel>
					<Tabs.Panel value="preview">
						<div class="flex flex-col gap-2">
							<p class="text-surface-500 text-sm">
								Renders this template against static mock story data, using
								the same engine as real chats.
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
								<div class="flex max-h-[36rem] flex-col gap-2 overflow-auto">
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
											<div class="text-sm whitespace-pre-wrap">
												{msg.content}
											</div>
										</div>
									{/each}
									{#if previewMessages.length === 0}
										<p class="text-surface-500 text-sm">
											This template didn't render any content.
										</p>
									{/if}
								</div>
							{/if}
						</div>
					</Tabs.Panel>
				{/snippet}
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
