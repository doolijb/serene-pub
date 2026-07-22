<script lang="ts">
	/** Accessible-mode analogue of LoginForm.svelte — same POST /api/login +
	 * refreshAuthAfterLogin() flow, high-contrast/keyboard-first markup. */
	import { onDestroy } from "svelte"
	import { z } from "zod"
	import { refreshAuthAfterLogin } from "$lib/client/sockets/loadSockets.client"
	import "./accessible.css"
	import { isDarkMode, pause } from "./state.svelte"

	const loginSchema = z.object({
		username: z
			.string()
			.min(1, "Username is required")
			.max(50, "Username must be 50 characters or less"),
		passphrase: z.string().min(1, "Passphrase is required")
	})
	type LoginFormData = z.infer<typeof loginSchema>

	let formData: LoginFormData = $state({ username: "", passphrase: "" })
	let errors: Partial<Record<keyof LoginFormData, string>> = $state({})
	let isLoading = $state(false)
	let formError = $state("")
	let darkMode = $state(true)
	let showPassphrase = $state(false)
	let rootEl: HTMLElement | undefined = $state()
	$effect(() => {
		darkMode = isDarkMode()
	})

	// See AccessibleShell.svelte for why: .a11y-root's own background doesn't
	// reliably cover the full page on its own, and <html> underneath still
	// carries the main app's globally-bundled theme background regardless of
	// which shell is actually rendering.
	$effect(() => {
		void darkMode
		if (typeof document === "undefined" || !rootEl) return
		requestAnimationFrame(() => {
			if (!rootEl) return
			const bg = getComputedStyle(rootEl)
				.getPropertyValue("--a11y-bg")
				.trim()
			if (!bg) return
			document.documentElement.style.backgroundColor = bg
			document.body.style.backgroundColor = bg
		})
	})
	onDestroy(() => {
		if (typeof document === "undefined") return
		document.documentElement.style.backgroundColor = ""
		document.body.style.backgroundColor = ""
	})

	// Reciprocal to the standard login's "Switch to Document View" link — a
	// pure client-side swap (both forms render at the same pre-auth URL), so
	// pausing is enough on its own; no navigation needed.
	function switchToStandardSite() {
		pause()
	}

	function validateForm(): boolean {
		const result = loginSchema.safeParse(formData)
		if (result.success) {
			errors = {}
			return true
		}
		const next: typeof errors = {}
		for (const err of result.error.errors) {
			if (err.path[0])
				next[err.path[0] as keyof LoginFormData] = err.message
		}
		errors = next
		return false
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault()
		formError = ""
		if (!validateForm()) return
		isLoading = true
		try {
			const response = await fetch("/api/login", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(formData)
			})
			const data = await response.json()
			if (!response.ok) {
				formError = data.error || "Invalid username or passphrase"
				return
			}
			await refreshAuthAfterLogin()
		} catch (error) {
			console.error("Login error:", error)
			formError = "An unexpected error occurred. Please try again."
		} finally {
			isLoading = false
		}
	}
</script>

<div
	class="a11y-root"
	data-a11y-mode={darkMode ? "dark" : "light"}
	bind:this={rootEl}
>
	<main class="a11y-main">
		<h1>Serene Pub — Document View (Accessible)</h1>
		<p>Sign in to your Serene Pub account.</p>

		{#if formError}
			<div class="a11y-status a11y-status-error" role="alert">
				<p class="a11y-error-text">{formError}</p>
			</div>
		{/if}

		<form onsubmit={handleSubmit} novalidate>
			<div class="a11y-field">
				<label for="a11y-username">Username</label>
				<input
					id="a11y-username"
					name="username"
					type="text"
					autocomplete="username"
					required
					bind:value={formData.username}
					disabled={isLoading}
					aria-invalid={!!errors.username}
					aria-describedby={errors.username
						? "a11y-username-error"
						: undefined}
				/>
				{#if errors.username}
					<p
						id="a11y-username-error"
						class="a11y-error-text"
						role="alert"
					>
						{errors.username}
					</p>
				{/if}
			</div>

			<div class="a11y-field">
				<label for="a11y-passphrase">Passphrase</label>
				<div class="a11y-inline-add">
					<input
						id="a11y-passphrase"
						name="passphrase"
						type={showPassphrase ? "text" : "password"}
						autocomplete="current-password"
						required
						bind:value={formData.passphrase}
						disabled={isLoading}
						aria-invalid={!!errors.passphrase}
						aria-describedby={errors.passphrase
							? "a11y-passphrase-error"
							: undefined}
					/>
					<button
						type="button"
						class="a11y-btn a11y-btn-secondary a11y-btn-small"
						onclick={() => (showPassphrase = !showPassphrase)}
						aria-pressed={showPassphrase}
					>
						{showPassphrase ? "Hide passphrase" : "Show passphrase"}
					</button>
				</div>
				{#if errors.passphrase}
					<p
						id="a11y-passphrase-error"
						class="a11y-error-text"
						role="alert"
					>
						{errors.passphrase}
					</p>
				{/if}
			</div>

			<button type="submit" class="a11y-btn" disabled={isLoading}>
				{isLoading ? "Signing in…" : "Sign in"}
			</button>
		</form>

		<p class="a11y-hint">Need help? Contact your administrator.</p>
		<p>
			<button
				type="button"
				class="a11y-btn a11y-btn-secondary a11y-btn-small"
				onclick={switchToStandardSite}
			>
				Switch to Standard Site
			</button>
		</p>
	</main>
</div>
