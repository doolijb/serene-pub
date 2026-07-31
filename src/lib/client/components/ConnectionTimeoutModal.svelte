<!-- Connection timeout and reconnection UI component -->
<script lang="ts">
	import { onDestroy, onMount } from "svelte"
	import {
		connectionTimeout,
		type ConnectionTimeoutService
	} from "$lib/client/services/connectionTimeout"
	import { toaster } from "$lib/client/utils/toaster"
	import { refreshAuthAfterLogin } from "$lib/client/sockets/loadSockets.client"
	import * as Icons from "@lucide/svelte"

	interface Props {
		isVisible?: boolean
		onReconnect?: () => Promise<void>
	}

	let { isVisible = false, onReconnect }: Props = $props()

	let showModal = $state(false)
	let reconnectCountdown = $state(0)
	let canReconnect = $state(false)
	let isReconnecting = $state(false)
	let updateInterval: number | null = null

	// Initialize connection timeout service
	onMount(() => {
		connectionTimeout.startTimeout(
			// On timeout callback
			() => {
				showModal = true
				toaster.warning({
					title: "Connection Timed Out",
					description:
						"Your session has expired due to inactivity. You can reconnect in 30 seconds."
				})
			},
			// On reconnect available callback
			() => {
				canReconnect = true
				toaster.info({
					title: "Reconnection Available",
					description: "You can now reconnect to the application."
				})
			}
		)

		// Update countdown every second
		updateInterval = setInterval(() => {
			reconnectCountdown = connectionTimeout.getReconnectCountdown()
		}, 1000) as unknown as number

		return () => {
			if (updateInterval) {
				clearInterval(updateInterval)
			}
		}
	})

	onDestroy(() => {
		if (updateInterval) {
			clearInterval(updateInterval)
		}
		connectionTimeout.stopTimeout()
	})

	// Handle reconnection attempt
	async function handleReconnect() {
		if (!canReconnect || isReconnecting) return

		try {
			isReconnecting = true

			if (onReconnect) {
				await onReconnect()
			} else {
				// Default reconnection behavior - refresh auth and reload
				await refreshAuthAfterLogin()
			}

			// Reset timeout state
			connectionTimeout.reset()
			connectionTimeout.startTimeout()

			showModal = false
			canReconnect = false
			reconnectCountdown = 0

			toaster.success({
				title: "Reconnected",
				description: "Successfully reconnected to the application."
			})
		} catch (error) {
			console.error("Reconnection failed:", error)
			toaster.error({
				title: "Reconnection Failed",
				description:
					"Failed to reconnect. Please refresh the page manually."
			})
		} finally {
			isReconnecting = false
		}
	}

	// Close modal and refresh page
	function handleRefreshPage() {
		if (
			!window.confirm(
				"Refreshing will lose any unsent message draft or in-progress edit. Refresh anyway?"
			)
		) {
			return
		}
		window.location.reload()
	}

	// Update activity when user interacts with the page
	function updateActivity() {
		connectionTimeout.updateActivity()
	}

	// Listen for user activity
	onMount(() => {
		const events = [
			"mousedown",
			"mousemove",
			"keypress",
			"scroll",
			"touchstart",
			"click"
		]

		const activityHandler = () => updateActivity()

		events.forEach((event) => {
			document.addEventListener(event, activityHandler, true)
		})

		return () => {
			events.forEach((event) => {
				document.removeEventListener(event, activityHandler, true)
			})
		}
	})
</script>

<!-- Connection Timeout Modal -->
{#if showModal || isVisible}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
	>
		<div class="card bg-surface-100-900 mx-4 w-full max-w-md p-6 shadow-xl">
			<div class="text-center">
				<!-- Icon -->
				<div
					class="bg-warning-500/10 mx-auto flex h-16 w-16 items-center justify-center rounded-full"
				>
					<Icons.WifiOff class="text-warning-500 h-8 w-8" />
				</div>

				<!-- Title -->
				<h3 class="h3 mt-4">Connection Timed Out</h3>

				<!-- Description -->
				<p class="text-surface-600-400 mt-2 text-sm">
					Your session has expired due to inactivity. You can
					reconnect to continue using the application.
				</p>

				<!-- Countdown or Ready State -->
				<div class="mt-4">
					{#if canReconnect}
						<p class="text-success-500 text-sm font-medium">
							Ready to reconnect
						</p>
					{:else if reconnectCountdown > 0}
						<p class="text-surface-700-300 text-sm">
							Reconnect available in {reconnectCountdown} seconds
						</p>
					{/if}
				</div>

				<!-- Actions -->
				<div class="mt-6 flex flex-col gap-3 sm:flex-row">
					<!-- Reconnect Button -->
					<button
						class="btn preset-filled-primary-500 flex-1"
						onclick={handleReconnect}
						disabled={!canReconnect || isReconnecting}
					>
						{#if isReconnecting}
							<Icons.Loader2 size={16} class="animate-spin" />
							Reconnecting...
						{:else}
							<Icons.RotateCcw size={16} />
							Reconnect
						{/if}
					</button>

					<!-- Refresh Page Button -->
					<button
						class="btn preset-outlined-surface-500 flex-1"
						onclick={handleRefreshPage}
					>
						<Icons.RefreshCw size={16} />
						Refresh Page
					</button>
				</div>

				<!-- Additional Info -->
				<p class="text-surface-700-300 mt-3 text-xs">
					Sessions expire after 1 hour of inactivity
				</p>
			</div>
		</div>
	</div>
{/if}
