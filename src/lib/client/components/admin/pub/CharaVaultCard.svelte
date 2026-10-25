<script lang="ts">
	/**
	 * The CharaVault card source — one pub-wide credential, admin-set,
	 * the same shared-config pattern the Connections settings use.
	 *
	 * The two fields are write-only credentials with no saved value to diff
	 * against, and they clear on a successful connect, so "non-empty" is what
	 * unsaved means here: the saved snapshot is two empty fields. The inputs
	 * opt out of autofill — a password manager filling the admin's own login
	 * into them was an unsaved change nobody typed.
	 */
	import { getContext } from "svelte"
	import { UnsavedEdits } from "$lib/client/forms/unsavedEdits.svelte"
	import * as Icons from "@lucide/svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import SettingCard from "$lib/client/components/settingsTabs/SettingCard.svelte"

	interface Props {
		hasUnsavedChanges?: boolean
	}
	let { hasUnsavedChanges = $bindable(false) }: Props = $props()

	const socket = useTypedSocket()
	let userCtx: UserCtx = $state(getContext("userCtx"))

	let connected = $state(false)
	let connectedEmail = $state<string | null>(null)
	let emailField = $state("")
	let tokenField = $state("")
	let isConnecting = $state(false)
	let isDisconnecting = $state(false)

	const edits = new UnsavedEdits(() => ({
		email: emailField.trim(),
		token: tokenField.trim()
	}))
	edits.markSaved({ email: "", token: "" })
	$effect(() => {
		hasUnsavedChanges = edits.dirty
	})
	$effect(() => () => (hasUnsavedChanges = false))

	function connect() {
		if (!userCtx.user?.isAdmin) return
		if (!emailField.trim() || !tokenField.trim()) return
		isConnecting = true
		socket?.emit("cardSources:charaVault:connect", {
			email: emailField.trim(),
			token: tokenField.trim()
		})
	}

	function disconnect() {
		if (!userCtx.user?.isAdmin) return
		isDisconnecting = true
		socket?.emit("cardSources:charaVault:disconnect", {})
	}

	$effect(() => {
		if (!socket) return

		const handleStatus = (
			message: Sockets.CardSources.CharaVaultStatus.Response
		) => {
			connected = message.connected
			connectedEmail = message.email
		}
		const handleConnect = (
			message: Sockets.CardSources.CharaVaultConnect.Response
		) => {
			isConnecting = false
			if (message.success) {
				emailField = ""
				tokenField = ""
				toaster.success({ title: "CharaVault account connected" })
				socket?.emit("cardSources:charaVault:status", {})
			}
		}
		const handleConnectError = (message: { error?: string }) => {
			isConnecting = false
			toaster.error({
				title: "Failed to connect CharaVault account",
				description: message.error
			})
		}
		const handleDisconnect = (
			message: Sockets.CardSources.CharaVaultDisconnect.Response
		) => {
			isDisconnecting = false
			if (message.success) {
				connected = false
				connectedEmail = null
				toaster.success({ title: "CharaVault account disconnected" })
			}
		}
		const handleDisconnectError = (message: { error?: string }) => {
			isDisconnecting = false
			toaster.error({
				title: "Failed to disconnect CharaVault account",
				description: message.error
			})
		}

		// All BARE: one account is connected at a time, so no reply is about
		// a particular row. Standing, because `status` is re-sent after a
		// connect or a disconnect.
		const releases = [
			declareInterest<"cardSources:charaVault:status">(
				"cardSources:charaVault:status",
				handleStatus
			),
			declareInterest<"cardSources:charaVault:connect">(
				"cardSources:charaVault:connect",
				handleConnect
			),
			declareInterest<"cardSources:charaVault:connect:error">(
				"cardSources:charaVault:connect:error",
				handleConnectError
			),
			declareInterest<"cardSources:charaVault:disconnect">(
				"cardSources:charaVault:disconnect",
				handleDisconnect
			),
			declareInterest<"cardSources:charaVault:disconnect:error">(
				"cardSources:charaVault:disconnect:error",
				handleDisconnectError
			)
		]

		if (userCtx.user?.isAdmin) {
			socket.emit("cardSources:charaVault:status", {})
		}

		return () => {
			hasUnsavedChanges = false
			for (const release of releases) release()
		}
	})
</script>

<!-- One account for the whole pub, so its higher search limit is
     everyone's. How to make the App Password rides the password box's title
     and the docs; the card says what it is for. -->
<SettingCard
	title="Community library: CharaVault"
	titleId="charavault-heading"
	headingLevel={2}
	help="One CharaVault account, shared by everyone on this pub, lets the Library browse charavault.net at its higher search limit."
	layout="stack"
>

	{#if connected}
		<div class="flex flex-wrap items-center gap-2">
			<span class="bg-success-500 size-2 shrink-0 rounded-full" aria-hidden="true"></span>
			<span class="min-w-0 text-sm break-words">
				Connected{#if connectedEmail}
					as <span class="font-medium">{connectedEmail}</span>{/if}
			</span>
			<button
				type="button"
				class="btn btn-sm preset-tonal-error ml-auto"
				onclick={disconnect}
				disabled={isDisconnecting}
			>
				{#if isDisconnecting}
					<Icons.Loader2 size={16} class="animate-spin" />
				{:else}
					<Icons.Unlink size={16} />
				{/if}
				Disconnect
			</button>
		</div>
	{:else}
		<div class="flex flex-col gap-2 @lg/view:flex-row">
			<input
				type="email"
				bind:value={emailField}
				autocomplete="off"
				placeholder="CharaVault account email"
				class="input flex-1"
				aria-label="CharaVault account email"
			/>
			<input
				type="password"
				bind:value={tokenField}
				autocomplete="new-password"
				placeholder="App password (cv_...)"
				title={'Create an App Password at charavault.net named "Serene Pub"'}
				class="input flex-1"
				aria-label="CharaVault app password"
			/>
			<button
				type="button"
				class="btn preset-filled-primary-500 shrink-0"
				onclick={connect}
				disabled={isConnecting || !emailField.trim() || !tokenField.trim()}
			>
				{#if isConnecting}
					<Icons.Loader2 size={16} class="animate-spin" />
				{:else}
					<Icons.Link size={16} />
				{/if}
				Connect
			</button>
		</div>
	{/if}
</SettingCard>
