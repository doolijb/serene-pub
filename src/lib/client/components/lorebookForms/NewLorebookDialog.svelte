<script lang="ts">
	import {
		Dialog,
		Portal,
		SegmentedControl,
		Switch
	} from "@skeletonlabs/skeleton-svelte"
	import { z } from "zod"
	import { requestWithInterest } from "$lib/client/sockets/interest.svelte"
	import { refOfCard } from "$lib/client/lorebooks/starterKitCards"
	import BookRulesPicker from "./BookRulesPicker.svelte"
	import StarterKitPicker from "./StarterKitPicker.svelte"

	/**
	 * A new lorebook: its name, and its **Rules** (PLAN-rulesets §4, §21),
	 * which every session started on it adopts — Freeform unless another is
	 * picked. Nothing else: every capability is available in every lorebook,
	 * and what the workspace shows follows what the book comes to hold.
	 *
	 * 🚧 Two ways in (PLAN-lorebook-kinds §B), chosen at the top: **Blank** —
	 * the name and the Rules — or **Start from a starter lorebook**, whose card
	 * carries the Rules the book will play (the picker gives way to
	 * _Rules: ‹kit's rules›_). The choice is drawn only while the pub lists a
	 * kit; `starterKits:list` is asked while the dialog is open.
	 */
	interface Props {
		open: boolean
		onOpenChange: (e: OpenChangeDetails) => void
		/** `attachToSession` is meaningless unless the switch was offered. */
		onConfirm: (details: {
			name: string
			attachToSession: boolean
			/** The ruleset id picked; the server's default when unset. */
			primaryRuleset?: string
			/** 🚧 The kit to copy in; its Rules win over `primaryRuleset`. */
			starterKit?: Sockets.StarterKits.Ref
		}) => void
		onCancel: () => void
		/**
		 * Closes this and opens the import flow instead. Absent where no
		 * import flow stands behind the dialog (the start screen's lorebook
		 * step): the offer is not drawn.
		 */
		onImportInstead?: () => void
		/** Hidden rather than disabled when the switch would do nothing. */
		canOfferAttachToSession?: boolean
		/** What the session the book would be read into is called. */
		sessionName?: string | null
		/** A refusal from the server, shown under the name. */
		error?: string
	}

	let {
		open = $bindable(),
		onOpenChange,
		onConfirm,
		onCancel,
		onImportInstead,
		canOfferAttachToSession = false,
		sessionName = null,
		error
	}: Props = $props()

	const nameSchema = z.object({
		name: z.string().min(1, "Name is required").trim()
	})

	let name = $state("")
	let attachToSession = $state(true)
	/** Empty until the picker seeds it with the default. */
	let primaryRuleset = $state("")
	let inputRef: HTMLInputElement | null = $state(null)
	let validationErrors: Record<string, string> = $state({})

	type Way = "blank" | "kit"
	let way = $state<Way>("blank")
	/** Every kit on the pub while the dialog is open; null while on its way. */
	let kits = $state<Sockets.StarterKits.Card[] | null>(null)
	/** The kit card chosen, by its id; "" for none. */
	let kitId = $state("")
	/** The name a kit filled in, so a pick only replaces a name nobody typed. */
	let kitFilledName = ""
	let chosenKit = $derived(
		way === "kit" ? (kits?.find((k) => k.id === kitId) ?? null) : null
	)
	/** Offered only while the pub has a kit to start from. */
	let offerKits = $derived(!!kits?.length)

	// The kits, asked for while the dialog is open (the family is gated, so
	// interest is declared with the ask; a kit saved meanwhile arrives too).
	$effect(() => {
		if (!open) return
		return requestWithInterest("starterKits:list", {}, (res) => {
			kits = res?.kits ?? []
			if (kitId && !kits.some((k) => k.id === kitId)) kitId = ""
			if (!kits.length) way = "blank"
		})
	})

	function pickKit(card: Sockets.StarterKits.Card) {
		if (!name.trim() || name === kitFilledName) {
			name = card.name
			kitFilledName = card.name
		}
		if (validationErrors.name) {
			const { name: _name, ...rest } = validationErrors
			validationErrors = rest
		}
	}

	// Re-seed on each open: the dialog stays mounted, so a second open would
	// otherwise inherit the last name typed.
	$effect(() => {
		if (open) {
			name = ""
			attachToSession = true
			primaryRuleset = ""
			validationErrors = {}
			way = "blank"
			kitId = ""
			kitFilledName = ""
		}
	})

	// The cursor lands in the name field, which is the only thing to fill in.
	$effect(() => {
		if (open && inputRef) inputRef.focus()
	})

	const isValid = $derived(
		!!name.trim() &&
			Object.keys(validationErrors).length === 0 &&
			(way === "blank" || !!chosenKit)
	)

	const shownError = $derived(validationErrors.name ?? error)

	function validateForm(): boolean {
		const result = nameSchema.safeParse({ name })
		if (result.success) {
			validationErrors = {}
			return true
		}
		const errors: Record<string, string> = {}
		for (const issue of result.error.errors)
			if (issue.path.length > 0)
				errors[issue.path[0] as string] = issue.message
		validationErrors = errors
		return false
	}

	function confirm() {
		if (!validateForm()) return
		const starterKit = chosenKit ? refOfCard(chosenKit) : null
		if (way === "kit" && !starterKit) return
		onConfirm({
			name: name.trim(),
			attachToSession: attachToSession && canOfferAttachToSession,
			...(starterKit
				? { starterKit }
				: primaryRuleset
					? { primaryRuleset }
					: {})
		})
	}
</script>

<Dialog {open} {onOpenChange}>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 max-h-full max-w-lg space-y-6 overflow-y-auto p-6 shadow-xl"
				role="dialog"
				aria-labelledby="new-lorebook-title"
				aria-describedby="new-lorebook-description"
			>
				<header class="space-y-1">
					<h2 id="new-lorebook-title" class="h2">New lorebook</h2>
					<p
						id="new-lorebook-description"
						class="text-surface-600-400 text-sm"
					>
						{way === "kit"
							? "A copy of a starter lorebook, yours to change: its world, its cast and the rules its stories are told by."
							: "A name, and the rules its stories are told by. Everything else, cast, dates, nesting, branches, appears as you use it."}
					</p>
				</header>
				<article class="space-y-5">
					{#if offerKits}
						<!-- Two ways in, drawn only while the pub has a kit. -->
						<SegmentedControl
							value={way}
							onValueChange={(d) =>
								(way = (d.value ?? "blank") as Way)}
						>
							<SegmentedControl.Label class="sr-only">
								Start from
							</SegmentedControl.Label>
							<SegmentedControl.Control>
								<SegmentedControl.Indicator />
								{#each [{ value: "blank", label: "Blank" }, { value: "kit", label: "Start from a starter lorebook" }] as option (option.value)}
									<SegmentedControl.Item
										value={option.value}
										data-new-lorebook-way={option.value}
									>
										<SegmentedControl.ItemText>
											{option.label}
										</SegmentedControl.ItemText>
										<SegmentedControl.ItemHiddenInput />
									</SegmentedControl.Item>
								{/each}
							</SegmentedControl.Control>
						</SegmentedControl>
					{/if}

					{#if way === "kit" && open}
						<div class="space-y-2">
							<p id="new-lorebook-kits" class="font-semibold">
								Starter lorebook
							</p>
							<StarterKitPicker
								bind:value={kitId}
								{kits}
								labelledby="new-lorebook-kits"
								onpick={pickKit}
							/>
						</div>
					{/if}

					<div class="form-field">
						<label for="new-lorebook-name" class="font-semibold">
							Name
						</label>
						<input
							id="new-lorebook-name"
							bind:this={inputRef}
							bind:value={name}
							class="input w-full {shownError
								? 'border-error-500'
								: ''}"
							type="text"
							placeholder="Enter a name..."
							aria-required="true"
							aria-invalid={!!shownError}
							aria-describedby={shownError
								? "new-lorebook-name-error"
								: undefined}
							onkeydown={(e) => {
								if (e.key === "Enter" && isValid) confirm()
							}}
							oninput={() => {
								if (validationErrors.name) {
									const { name: _name, ...rest } =
										validationErrors
									validationErrors = rest
								}
							}}
						/>
						{#if shownError}
							<p
								id="new-lorebook-name-error"
								class="text-error-600-400 mt-1 text-sm"
								role="alert"
							>
								{shownError}
							</p>
						{/if}
					</div>

					<!-- Rules (NOMENCLATURE §28): every session on this book
					     plays them. Drawn only while open, so the list is asked
					     for when it can be seen. -->
					{#if way === "kit"}
						{#if chosenKit}
							<p class="text-sm" data-new-lorebook-kit-rules>
								<span class="font-semibold">Rules:</span>
								{chosenKit.rulesName}
								<span
									class="text-surface-600-400 block text-xs"
								>
									The book plays the starter lorebook's rules. You can
									change them later in Book settings.
								</span>
							</p>
						{/if}
					{:else if open}
						<div class="space-y-2">
							<p id="new-lorebook-rules" class="font-semibold">
								Rules
							</p>
							<BookRulesPicker
								bind:value={primaryRuleset}
								labelledby="new-lorebook-rules"
							/>
							<p class="text-surface-600-400 text-xs">
								Sessions you start on this book play its rules.
								You can change them later in Book settings.
							</p>
						</div>
					{/if}

					{#if canOfferAttachToSession}
						<Switch
							name="new-lorebook-attach"
							checked={attachToSession}
							onCheckedChange={(e) =>
								(attachToSession = e.checked)}
							class="flex items-center gap-2"
						>
							<Switch.Control
								class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
							>
								<Switch.Thumb />
							</Switch.Control>
							<Switch.HiddenInput />
							<Switch.Label class="text-sm">
								{sessionName
									? `Read it into ${sessionName}`
									: "Read it into this session"}
							</Switch.Label>
						</Switch>
					{/if}

					{#if onImportInstead}
						<button
							class="btn btn-sm preset-tonal-surface"
							type="button"
							onclick={onImportInstead}
						>
							Start from an import instead
						</button>
					{/if}
				</article>
				<footer class="flex justify-end gap-4">
					<button
						class="btn preset-tonal-surface"
						onclick={onCancel}
						type="button"
					>
						Cancel
					</button>
					<button
						class="btn preset-filled-primary-500"
						onclick={confirm}
						disabled={!isValid}
						type="button"
					>
						Create
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
