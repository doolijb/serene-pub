<script lang="ts">
	import { z } from "zod"
	import * as Icons from "@lucide/svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import {
		useTypedSocket,
		refreshAuthAfterLogin
	} from "$lib/client/sockets/loadSockets.client"
	import { enableAccessibility } from "$lib/client/accessibility/state.svelte"
	import { onMount } from "svelte"
	import AtmosphereLayer from "$lib/client/atmospheres/AtmosphereLayer.svelte"
	import { pickRandom } from "$lib/client/atmospheres/definitions"
	import type { AtmosphereDefinition } from "$lib/client/atmospheres/types"

	// Login form schema
	const loginSchema = z.object({
		username: z
			.string()
			.min(1, "Username is required")
			.max(50, "Username must be 50 characters or less"),
		passphrase: z.string().min(1, "Passphrase is required")
	})

	type LoginForm = z.infer<typeof loginSchema>

	// Form state
	let formData: LoginForm = $state({
		username: "",
		passphrase: ""
	})

	let errors: Partial<Record<keyof LoginForm, string>> = $state({})
	let isLoading = $state(false)
	let showPassphrase = $state(false)

	/**
	 * One atmosphere, drawn behind the card and chosen fresh on every load —
	 * this is the one screen in the app with nothing else on it, and the
	 * effects paint in whatever theme is live, so it stays the same house.
	 *
	 * Picked in onMount rather than at module scope so the server never
	 * renders one choice and the client another.
	 */
	let atmosphere: AtmosphereDefinition | undefined = $state()

	onMount(() => {
		atmosphere = pickRandom()
	})

	// Validation function
	function validateForm() {
		try {
			loginSchema.parse(formData)
			errors = {}
			return true
		} catch (error) {
			if (error instanceof z.ZodError) {
				errors = {}
				error.errors.forEach((err) => {
					if (err.path[0]) {
						errors[err.path[0] as keyof LoginForm] = err.message
					}
				})
			}
			return false
		}
	}

	// Handle form submission
	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault()

		// The submit button is disabled while loading, but a browser can still
		// fire implicit submission from a focused field, so guard here too.
		if (isLoading) return

		if (!validateForm()) {
			return
		}

		isLoading = true

		try {
			const response = await fetch("/api/login", {
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify({
					username: formData.username,
					passphrase: formData.passphrase
				})
			})

			const data = await response.json()

			if (!response.ok) {
				toaster.error({
					title: "Sign-in failed",
					description: data.error || "Invalid username or passphrase"
				})
				isLoading = false
				return
			}

			toaster.success({
				title: "Signed in",
				description: "Welcome back."
			})

			// Refresh authentication to load user context.
			//
			// isLoading is deliberately NOT cleared on this path, and there is
			// no `finally` for the same reason. refreshAuthAfterLogin() returns
			// as soon as it has *scheduled* the reload, which it delays by a
			// second so the success toast stays readable — clearing the flag
			// here re-enabled every field and the submit button for that whole
			// window, after the login had already succeeded. Staying disabled
			// until the page actually swaps is the honest state.
			refreshAuthAfterLogin()
		} catch (error) {
			console.error("Login error:", error)
			toaster.error({
				title: "Sign-in error",
				description: "An unexpected error occurred. Please try again."
			})
			isLoading = false
		}
	}

	// Handle input changes with real-time validation
	function handleInputChange(field: keyof LoginForm, value: string) {
		formData[field] = value

		// Clear field-specific error when user starts typing
		if (errors[field]) {
			errors[field] = ""
		}
	}
</script>

<div
	class="bg-surface-100 dark:bg-surface-900 relative isolate flex min-h-screen items-center justify-center overflow-hidden px-4 py-12"
>
	{#if atmosphere}
		<AtmosphereLayer definition={atmosphere} />
	{/if}

	<!-- The card is the form itself: there is nothing else on this screen.
	     aria-busy so screen-reader users are told the form is working rather
	     than just finding every control gone dead. -->
	<form
		class="border-surface-200/80 bg-surface-50/80 dark:border-surface-800/80 dark:bg-surface-950/75 relative z-10 grid w-full max-w-[360px] gap-4 rounded-2xl border p-7 shadow-2xl backdrop-blur-md"
		onsubmit={handleSubmit}
		aria-busy={isLoading}
		aria-label="Sign in"
	>
		<div class="flex items-center gap-3">
			<img
				src="/icon-x48.png"
				srcset="/icon-x48.png 1x, /icon-x256.png 2x"
				alt=""
				width="34"
				class="h-auto w-[34px]"
			/>
			<span
				class="text-surface-950 dark:text-surface-50 [font-family:var(--typo-heading--font-family)] text-[20px] leading-tight font-semibold tracking-[-0.01em]"
			>
				Serene Pub
			</span>
		</div>

		<div class="grid gap-0.5">
			<h1
				class="text-surface-950 dark:text-surface-50 [font-family:var(--typo-heading--font-family)] text-[18px] leading-[1.3] font-semibold"
			>
				Welcome back.
			</h1>
			<p class="text-surface-600 dark:text-surface-400 text-[13px]">
				Sign in to pick up where the story left off.
			</p>
		</div>

		<div class="grid gap-1.5">
			<label for="username" class="text-surface-600-400 text-xs">
				Username
			</label>
			<input
				id="username"
				name="username"
				type="text"
				autocomplete="username"
				required
				class="input bg-surface-100 dark:bg-surface-900 h-10 w-full {errors.username
					? 'border-error-500'
					: ''}"
				bind:value={formData.username}
				oninput={(e) =>
					handleInputChange("username", e.currentTarget.value)}
				disabled={isLoading}
			/>
			{#if errors.username}
				<p class="text-error-500 text-xs" role="alert">
					{errors.username}
				</p>
			{/if}
		</div>

		<div class="grid gap-1.5">
			<label for="passphrase" class="text-surface-600-400 text-xs">
				Passphrase
			</label>
			<div class="relative">
				<input
					id="passphrase"
					name="passphrase"
					type={showPassphrase ? "text" : "password"}
					autocomplete="current-password"
					required
					class="input bg-surface-100 dark:bg-surface-900 h-10 w-full pr-11 {errors.passphrase
						? 'border-error-500'
						: ''}"
					bind:value={formData.passphrase}
					oninput={(e) =>
						handleInputChange("passphrase", e.currentTarget.value)}
					disabled={isLoading}
				/>
				<button
					type="button"
					class="text-surface-500 hover:text-surface-950 dark:hover:text-surface-50 focus-visible:outline-primary-500 absolute top-1/2 right-2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2"
					onclick={() => (showPassphrase = !showPassphrase)}
					aria-label={showPassphrase
						? "Hide passphrase"
						: "Show passphrase"}
					disabled={isLoading}
				>
					{#if showPassphrase}
						<Icons.EyeOff class="h-4 w-4" aria-hidden="true" />
					{:else}
						<Icons.Eye class="h-4 w-4" aria-hidden="true" />
					{/if}
				</button>
			</div>
			{#if errors.passphrase}
				<p class="text-error-500 text-xs" role="alert">
					{errors.passphrase}
				</p>
			{/if}
		</div>

		<button
			type="submit"
			class="btn preset-filled-primary-500 mt-1 h-10 w-full"
			disabled={isLoading}
		>
			{#if isLoading}
				<Icons.Loader2
					class="mr-2 h-4 w-4 animate-spin"
					aria-hidden="true"
				/>
				Signing in...
			{:else}
				Sign in
			{/if}
		</button>

		<div
			class="text-surface-600-400 mt-0.5 flex items-center justify-between text-xs"
		>
			<!-- Also disabled mid-submit: this navigates to a different shell,
			     and a successful login is already on its way to reloading
			     the page. -->
			<button
				type="button"
				class="text-surface-600 hover:text-surface-950 dark:text-surface-400 dark:hover:text-surface-50 focus-visible:outline-primary-500 inline-flex items-center gap-1 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
				onclick={enableAccessibility}
				disabled={isLoading}
			>
				<Icons.Accessibility class="h-3.5 w-3.5" aria-hidden="true" />
				Document View
			</button>
			<span>
				{__APP_VERSION__}
				<span class="text-warning-500">beta</span>
			</span>
		</div>
	</form>
</div>
