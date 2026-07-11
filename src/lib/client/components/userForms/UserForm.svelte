<script lang="ts">
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { toaster } from "$lib/client/utils/toaster"
	import { Modal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { z } from "zod"
	import { untrack } from "svelte"

	interface Props {
		user?: SelectUser
		onSave?: (user: SelectUser) => void
		onCancel?: () => void
	}

	let { user, onSave, onCancel }: Props = $props()

	const socket = useTypedSocket()

	// Form state
	let formUsername = $state(untrack(() => user?.username || ""))
	let formDisplayName = $state(untrack(() => user?.displayName || ""))
	let formIsAdmin = $state(untrack(() => user?.isAdmin || false))
	let formPassphrase = $state("")
	let formConfirmPassphrase = $state("")
	let showAdminConfirmModal = $state(false)
	let pendingAdminValue = $state(false)
	let passphraseError = $state("")
	let showPassphrase = $state(false)
	let copiedPassphrase = $state(false)

	// Track if we're creating or editing
	let isCreating = $derived(!user)

	// Passphrase validation schema
	const passphraseSchema = z
		.string()
		.min(6, "Passphrase must be at least 6 characters long")
		.regex(/[a-z]/, "Passphrase must contain at least one lowercase letter")
		.regex(/[A-Z]/, "Passphrase must contain at least one uppercase letter")
		.regex(/[0-9]/, "Passphrase must contain at least one number")

	// Validation state
	let isPassphraseValid = $derived.by(() => {
		// For creation, passphrase is required
		if (isCreating && !formPassphrase) return false
		// For updates, empty is valid (won't update)
		if (!isCreating && !formPassphrase) return true
		// Check if passwords match
		if (formPassphrase !== formConfirmPassphrase) return false
		try {
			passphraseSchema.parse(formPassphrase)
			return true
		} catch {
			return false
		}
	})

	// Handle admin checkbox change
	function handleAdminChange(e: Event) {
		const checked = (e.currentTarget as HTMLInputElement).checked
		if (checked && !formIsAdmin) {
			// Show confirmation when enabling admin
			pendingAdminValue = true
			showAdminConfirmModal = true
			// Reset checkbox to current state
			;(e.currentTarget as HTMLInputElement).checked = formIsAdmin
		} else {
			// No confirmation needed when disabling
			formIsAdmin = checked
		}
	}

	function confirmAdminChange() {
		formIsAdmin = pendingAdminValue
		showAdminConfirmModal = false
	}

	function cancelAdminChange() {
		showAdminConfirmModal = false
		pendingAdminValue = false
	}

	// Generate random passphrase
	function generateRandomPassphrase() {
		const words = [
			"Apple",
			"Banana",
			"Cherry",
			"Dragon",
			"Eagle",
			"Forest",
			"Galaxy",
			"Harbor",
			"Island",
			"Jungle",
			"Knight",
			"Lotus",
			"Mountain",
			"Nebula",
			"Ocean",
			"Phoenix",
			"Quartz",
			"River",
			"Shadow",
			"Thunder",
			"Unicorn",
			"Valley",
			"Wizard",
			"Zenith"
		]
		const numbers = Math.floor(Math.random() * 900) + 100 // 3-digit number
		const specialChars = "!@#$%^&*"
		const special =
			specialChars[Math.floor(Math.random() * specialChars.length)]

		// Pick 3 random words
		const selectedWords = []
		for (let i = 0; i < 3; i++) {
			const randomIndex = Math.floor(Math.random() * words.length)
			selectedWords.push(words[randomIndex])
		}

		const passphrase = `${selectedWords.join("-")}${numbers}${special}`
		formPassphrase = passphrase
		formConfirmPassphrase = passphrase
		passphraseError = ""
	}

	// Copy passphrase to clipboard
	async function copyPassphrase() {
		if (formPassphrase && isPassphraseValid) {
			try {
				await navigator.clipboard.writeText(formPassphrase)
				copiedPassphrase = true
				setTimeout(() => {
					copiedPassphrase = false
				}, 2000)
				toaster.success({
					title: "Passphrase copied",
					description:
						"The passphrase has been copied to your clipboard"
				})
			} catch (error) {
				toaster.error({
					title: "Copy failed",
					description: "Failed to copy passphrase to clipboard"
				})
			}
		}
	}

	// Validate passphrase on input
	function validatePassphrase() {
		passphraseError = ""

		// Check if passphrase is required (for creation)
		if (isCreating && !formPassphrase) {
			passphraseError = "Passphrase is required"
			return
		}

		// For updates, empty is valid
		if (!formPassphrase) return

		if (formPassphrase !== formConfirmPassphrase) {
			passphraseError = "Passphrases do not match"
			return
		}

		try {
			passphraseSchema.parse(formPassphrase)
		} catch (error) {
			if (error instanceof z.ZodError) {
				passphraseError =
					error.errors[0]?.message || "Invalid passphrase"
			}
		}
	}

	async function saveUser() {
		if (!formUsername.trim()) {
			toaster.error({
				title: "Validation Error",
				description: "Username is required"
			})
			return
		}

		// Validate passphrase
		if (isCreating && !formPassphrase) {
			toaster.error({
				title: "Validation Error",
				description: "Passphrase is required when creating a user"
			})
			validatePassphrase()
			return
		}

		if (formPassphrase && !isPassphraseValid) {
			validatePassphrase()
			return
		}

		if (isCreating) {
			socket.emit("users:create", {
				username: formUsername.trim(),
				displayName: formDisplayName.trim() || undefined,
				isAdmin: formIsAdmin,
				passphrase: formPassphrase
			})
		} else if (user) {
			socket.emit("users:update", {
				id: user.id,
				username: formUsername.trim(),
				displayName: formDisplayName.trim() || undefined,
				isAdmin: formIsAdmin,
				passphrase: formPassphrase || undefined
			})
		}
	}

	function handleCancel() {
		onCancel?.()
	}
</script>

<div class="flex h-full flex-col p-4">
	<div class="mb-4 flex items-center gap-2">
		<button
			class="btn btn-sm preset-filled-surface-400-600 shrink-0 p-2"
			onclick={handleCancel}
			title="Cancel"
		>
			<Icons.ChevronLeft size={16} />
		</button>
		<h1 class="flex-1 truncate font-semibold">
			{isCreating ? "New User" : (user?.displayName || user?.username || "Edit User")}
		</h1>
		<button
			class="btn btn-sm preset-filled-primary-500 shrink-0"
			onclick={saveUser}
		>
			<Icons.Save size={16} />
			{isCreating ? "Create" : "Update"}
		</button>
	</div>

	<div class="flex-1 overflow-y-auto">
		<div class="space-y-4">
			<div>
				<label for="username" class="mb-1 block font-semibold">
					Username*
				</label>
				<input
					id="username"
					type="text"
					bind:value={formUsername}
					placeholder="Username"
					class="input w-full"
				/>
			</div>

			<div>
				<label for="displayName" class="mb-1 block font-semibold">
					Display Name
				</label>
				<input
					id="displayName"
					type="text"
					bind:value={formDisplayName}
					placeholder="Display Name (optional)"
					class="input w-full"
				/>
			</div>

			<label class="flex cursor-pointer items-center gap-2">
				<input
					type="checkbox"
					checked={formIsAdmin}
					onchange={handleAdminChange}
					class="checkbox"
				/>
				<span class="text-sm">Administrator</span>
			</label>

			<div class="space-y-2">
				<label for="passphrase" class="mb-1 block font-semibold">
					{isCreating ? "Passphrase*" : "New Passphrase"}
					{#if !isCreating}
						<span class="text-surface-600-400 text-sm font-normal">
							(leave blank to keep current)
						</span>
					{/if}
				</label>
				<div class="relative">
					<input
						id="passphrase"
						type={showPassphrase ? "text" : "password"}
						bind:value={formPassphrase}
						onblur={validatePassphrase}
						placeholder="Enter passphrase"
						class="input w-full pr-10 {passphraseError
							? 'border-error-500'
							: ''}"
					/>
					<button
						type="button"
						class="text-surface-600-400 hover:text-surface-900-100 absolute top-1/2 right-2 -translate-y-1/2"
						onclick={() => (showPassphrase = !showPassphrase)}
					>
						{#if showPassphrase}
							<Icons.EyeOff size={20} />
						{:else}
							<Icons.Eye size={20} />
						{/if}
					</button>
				</div>

				<div>
					<label
						for="confirmPassphrase"
						class="mb-1 block font-semibold"
					>
						Confirm Passphrase
					</label>
					<input
						id="confirmPassphrase"
						type={showPassphrase ? "text" : "password"}
						bind:value={formConfirmPassphrase}
						onblur={validatePassphrase}
						placeholder="Confirm passphrase"
						class="input w-full {passphraseError
							? 'border-error-500'
							: ''}"
					/>
				</div>

				{#if passphraseError}
					<p class="text-error-500 text-sm">{passphraseError}</p>
				{/if}

				<div class="flex gap-2">
					<button
						type="button"
						class="btn btn-sm preset-filled-secondary-500"
						onclick={generateRandomPassphrase}
					>
						<Icons.Dices size={16} />
						Generate Random
					</button>
					<button
						type="button"
						class="btn btn-sm preset-filled-secondary-500"
						onclick={copyPassphrase}
						disabled={!formPassphrase || !isPassphraseValid}
					>
						{#if copiedPassphrase}
							<Icons.Check size={16} />
							Copied!
						{:else}
							<Icons.Copy size={16} />
							Copy
						{/if}
					</button>
				</div>

				<p class="text-surface-600-400 text-xs">
					Passphrase must be at least 6 characters with uppercase,
					lowercase, and numbers.
				</p>
			</div>
		</div>
	</div>
</div>

<!-- Admin Confirmation Modal -->
<Modal
	open={showAdminConfirmModal}
	onOpenChange={(e) => {
		if (!e.open) {
			cancelAdminChange()
		}
	}}
	contentBase="card bg-surface-100-900 p-6 space-y-6 shadow-xl max-w-lg"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet content()}
		<header class="flex items-center justify-between">
			<h2 class="text-xl font-bold">Grant Administrator Privileges?</h2>
			<button class="btn-ghost" onclick={cancelAdminChange}>
				<Icons.X class="h-5 w-5" />
			</button>
		</header>
		<article class="space-y-4">
			<div class="text-warning-500 flex items-center gap-2">
				<Icons.ShieldAlert class="h-5 w-5" />
				<span class="font-semibold">Warning: Powerful Access</span>
			</div>
			<p>
				Are you sure you want to grant administrator privileges to this
				user? Administrators have full access to all system features
				including:
			</p>
			<ul class="ml-4 list-inside list-disc space-y-1">
				<li>Managing all users and their permissions</li>
				<li>Accessing and modifying all chats and characters</li>
				<li>Changing system settings</li>
				<li>Deleting content across the system</li>
			</ul>
			<p class="font-medium">
				This action should only be performed for trusted users.
			</p>
		</article>
		<footer class="flex justify-end gap-2">
			<button
				class="btn btn-sm preset-filled-surface-500"
				onclick={cancelAdminChange}
			>
				Cancel
			</button>
			<button
				class="btn btn-sm preset-filled-warning-500"
				onclick={confirmAdminChange}
			>
				Grant Admin Access
			</button>
		</footer>
	{/snippet}
</Modal>
