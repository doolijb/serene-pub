<script lang="ts">
	import { z } from "zod"
	import * as Icons from "@lucide/svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import {
		useTypedSocket,
		refreshAuthAfterLogin
	} from "$lib/client/sockets/loadSockets.client"
	import { enableAccessibility } from "$lib/client/accessibility/state.svelte"

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
					title: "Login Failed",
					description: data.error || "Invalid username or passphrase"
				})
				isLoading = false
				return
			}

			toaster.success({
				title: "Login Successful",
				description: "Welcome back!"
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
				title: "Login Error",
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
	class="from-surface-50 to-surface-200 dark:from-surface-900 dark:to-surface-950 flex min-h-screen items-center justify-center bg-gradient-to-br px-4 py-12 sm:px-6 lg:px-8"
>
	<div class="w-full max-w-md">
		<!-- Login Container Card -->
		<div
			class="bg-surface-0 dark:bg-surface-900 border-surface-200 dark:border-surface-800 space-y-8 rounded-2xl border p-8 shadow-2xl"
		>
			<!-- Logo and Header -->
			<div class="text-center">
				<div class="mb-6 flex justify-center">
					<img src="/logo.png" alt="Serene Pub" class="h-30" />
				</div>
				<h2 class="text-foreground text-3xl font-bold tracking-tight">
					Welcome Back
				</h2>
				<p class="text-muted-foreground mt-2 text-sm">
					Sign in to your Serene Pub account
				</p>
			</div>

			<!-- aria-busy so screen-reader users are told the form is working
			     rather than just finding every control gone dead. -->
			<form
				class="space-y-6"
				onsubmit={handleSubmit}
				aria-busy={isLoading}
			>
				<div class="space-y-4">
					<!-- Username Field -->
					<div>
						<label
							for="username"
							class="text-foreground mb-2 block text-sm font-medium"
						>
							Username
						</label>
						<div class="relative">
							<input
								id="username"
								name="username"
								type="text"
								autocomplete="username"
								required
								class="input w-full pl-10 {errors.username
									? 'border-error-500'
									: ''}"
								placeholder="Enter your username"
								bind:value={formData.username}
								oninput={(e) =>
									handleInputChange(
										"username",
										e.currentTarget.value
									)}
								disabled={isLoading}
							/>
							<Icons.User
								class="text-muted-foreground absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2"
								aria-hidden="true"
							/>
						</div>
						{#if errors.username}
							<p class="text-error-500 mt-2 text-sm" role="alert">
								{errors.username}
							</p>
						{/if}
					</div>

					<!-- Passphrase Field -->
					<div>
						<label
							for="passphrase"
							class="text-foreground mb-2 block text-sm font-medium"
						>
							Passphrase
						</label>
						<div class="relative">
							<input
								id="passphrase"
								name="passphrase"
								type={showPassphrase ? "text" : "password"}
								autocomplete="current-password"
								required
								class="input w-full pr-12 pl-10 {errors.passphrase
									? 'border-error-500'
									: ''}"
								placeholder="Enter your passphrase"
								bind:value={formData.passphrase}
								oninput={(e) =>
									handleInputChange(
										"passphrase",
										e.currentTarget.value
									)}
								disabled={isLoading}
							/>
							<Icons.Key
								class="text-muted-foreground absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2"
								aria-hidden="true"
							/>
							<button
								type="button"
								class="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 transition-colors"
								onclick={() =>
									(showPassphrase = !showPassphrase)}
								aria-label={showPassphrase
									? "Hide passphrase"
									: "Show passphrase"}
								disabled={isLoading}
							>
								{#if showPassphrase}
									<Icons.EyeOff
										class="h-5 w-5"
										aria-hidden="true"
									/>
								{:else}
									<Icons.Eye
										class="h-5 w-5"
										aria-hidden="true"
									/>
								{/if}
							</button>
						</div>
						{#if errors.passphrase}
							<p class="text-error-500 mt-2 text-sm" role="alert">
								{errors.passphrase}
							</p>
						{/if}
					</div>
				</div>

				<div>
					<button
						type="submit"
						disabled={isLoading}
						class="btn preset-filled-primary-500 focus:ring-primary-500 flex w-full items-center justify-center px-4 py-3 text-sm font-medium transition-all duration-200 hover:shadow-lg focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
					>
						{#if isLoading}
							<Icons.Loader2
								class="mr-2 h-4 w-4 animate-spin"
								aria-hidden="true"
							/>
							Signing in...
						{:else}
							<Icons.LogIn
								class="mr-2 h-4 w-4"
								aria-hidden="true"
							/>
							Sign in
						{/if}
					</button>
				</div>
			</form>

			<div class="text-center">
				<p class="text-muted-foreground text-xs">
					Need help? Contact your administrator.
				</p>
				<!-- Also disabled mid-submit: this navigates to a different shell,
				     and a successful login is already on its way to reloading
				     the page. -->
				<button
					type="button"
					class="text-muted-foreground hover:text-foreground mt-3 inline-flex items-center gap-1 text-xs underline disabled:cursor-not-allowed disabled:opacity-50"
					onclick={enableAccessibility}
					disabled={isLoading}
				>
					<Icons.Accessibility
						class="h-3.5 w-3.5"
						aria-hidden="true"
					/>
					Switch to Document View (Accessible)
				</button>
			</div>
		</div>
	</div>
</div>

<style lang="postcss">
	@reference "tailwindcss";
</style>
