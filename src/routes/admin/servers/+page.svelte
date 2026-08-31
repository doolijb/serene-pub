<script lang="ts">
	/**
	 * Servers → this instance. The reserved section (ruled 2026-08-27) is now
	 * plan 26: how this instance becomes reachable from outside.
	 *
	 * Two modes, not a provider dropdown. "Easy" is one switch and no account;
	 * "Custom domain" is the persistent one. The mode split is the product
	 * decision — `provider` and `mode` are derived from it rather than picked,
	 * so nobody can save a combination the supervisor can't run.
	 */
	import { onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import {
		DEFAULT_TUNNEL_TTL_SECONDS,
		MAX_TUNNEL_TTL_SECONDS,
		MIN_TUNNEL_TTL_SECONDS,
		TUNNEL_TTL_PRESET_HOURS,
		TunnelProviders
	} from "$lib/shared/constants/Tunnels"

	const socket = useTypedSocket()

	let tunnel = $state<Sockets.Tunnels.TunnelView | null>(null)
	let available = $state(true)
	let unavailableReason = $state<string | undefined>(undefined)
	let accountsEnabled = $state(false)
	let loading = $state(true)
	let busy = $state(false)
	/**
	 * Set while a start is in flight.
	 *
	 * Starting a tunnel means downloading cloudflared on first run, spawning
	 * it, and waiting for Cloudflare to hand back a URL — up to a minute, with
	 * the socket handler awaiting the whole thing. Without an indicator the
	 * page simply sits there and reads as broken.
	 */
	let starting = $state(false)
	let pollTimer: ReturnType<typeof setInterval> | null = null

	let allowedHosts = $state<Sockets.AllowedHosts.HostEntry[]>([])
	let wildcard = $state(false)

	function handleAllowedHosts(res: Sockets.AllowedHosts.Get.Response) {
		allowedHosts = res.hosts
		wildcard = res.wildcard
	}

	const SOURCE_LABELS: Record<string, string> = {
		builtin: "Built in",
		env: "ALLOWED_ORIGINS",
		tunnel: "Active tunnel"
	}

	// Form state, kept separate from the row so an unsaved edit is never
	// mistaken for saved configuration.
	let mode: "easy" | "custom" = $state("easy")
	let hostnameField = $state("")
	let tokenField = $state("")
	let autoStart = $state(false)
	let ttlEnabled = $state(true)
	/** Edited in hours — the unit people actually think in for this. */
	let ttlHours = $state(DEFAULT_TUNNEL_TTL_SECONDS / 3600)

	function stopPolling() {
		if (pollTimer) {
			clearInterval(pollTimer)
			pollTimer = null
		}
	}

	function handleGet(res: Sockets.Tunnels.Get.Response) {
		tunnel = res.tunnel
		available = res.available
		unavailableReason = res.unavailableReason
		accountsEnabled = res.accountsEnabled
		loading = false
		if (res.tunnel) {
			mode =
				res.tunnel.provider === TunnelProviders.CLOUDFLARE_QUICK
					? "easy"
					: "custom"
			hostnameField = res.tunnel.hostname ?? ""
			autoStart = res.tunnel.autoStart
			ttlEnabled = res.tunnel.ttlSeconds !== null
			if (res.tunnel.ttlSeconds !== null) {
				ttlHours = res.tunnel.ttlSeconds / 3600
			}
		} else {
			// 26 §13.1: Easy defaults TTL on, Custom defaults it off —
			// persistence is the entire reason to choose a named tunnel.
			ttlEnabled = true
		}
		// Never repopulated from the server: the token is write-only.
		tokenField = ""

		// The supervisor owns `status`, so it is the authority on whether a
		// start is still in progress — not the click that began it.
		if (res.tunnel?.status !== "starting") {
			starting = false
			stopPolling()
		}
	}

	function handleError(res: Sockets.ErrorResponse) {
		busy = false
		starting = false
		stopPolling()
		toaster.error({ title: res.error })
	}

	// One error event per operation, not a wildcard: the socket layer emits
	// `{event}:error`, and each of these carries a message worth showing
	// verbatim (accounts are off, the token was rejected, bad hostname).
	const ERROR_EVENTS = [
		"tunnels:get:error",
		"tunnels:updateConfig:error",
		"tunnels:enable:error",
		"tunnels:disable:error",
		"allowedHosts:get:error"
	] as const

	onMount(() => {
		socket.on("tunnels:get", handleGet)
		socket.on("allowedHosts:get", handleAllowedHosts)
		for (const e of ERROR_EVENTS) socket.on(e, handleError)
		socket.emit("tunnels:get", {})
		socket.emit("allowedHosts:get", {})
	})
	onDestroy(() => {
		stopPolling()
		socket.off("tunnels:get", handleGet)
		socket.off("allowedHosts:get", handleAllowedHosts)
		for (const e of ERROR_EVENTS) socket.off(e, handleError)
	})

	const ttlSecondsValue = $derived(Math.round((ttlHours || 0) * 3600))
	const ttlOutOfRange = $derived(
		ttlEnabled &&
			(ttlSecondsValue < MIN_TUNNEL_TTL_SECONDS ||
				ttlSecondsValue > MAX_TUNNEL_TTL_SECONDS)
	)

	const isRunning = $derived(
		tunnel?.status === "running" || tunnel?.status === "starting"
	)
	const publicUrl = $derived(
		tunnel?.hostname ? `https://${tunnel.hostname}` : null
	)

	/**
	 * The deadline of the *current run*, not the saved preference — a running
	 * tunnel should show when it actually stops rather than restating the
	 * setting. A deadline nobody can see is how a tunnel dies mid-session with
	 * no warning.
	 */
	const expiresAtLabel = $derived.by(() => {
		if (!tunnel?.expiresAt || !isRunning) return null
		return new Date(tunnel.expiresAt).toLocaleString()
	})

	// The one state plan 26 §5 makes unreachable, surfaced rather than hidden:
	// the switch explains itself instead of failing on click.
	const enableBlockedReason = $derived(
		!available
			? unavailableReason
			: !accountsEnabled
				? "User accounts must be enabled before a tunnel can start — a publicly reachable instance with no account boundary is not a state this app will put you in."
				: !tunnel
					? "Save the configuration first."
					: null
	)

	function saveConfig() {
		busy = true
		socket.emit("tunnels:updateConfig", {
			provider:
				mode === "easy"
					? TunnelProviders.CLOUDFLARE_QUICK
					: TunnelProviders.CLOUDFLARE_NAMED,
			mode: mode === "easy" ? "ephemeral" : "persistent",
			hostname: mode === "custom" ? hostnameField.trim() : null,
			ttlSeconds: ttlEnabled ? Math.round(ttlHours * 3600) : null,
			autoStart,
			// Omitted when blank so a save never wipes a stored token — the
			// field is write-only, so the client cannot round-trip it.
			...(tokenField.trim() ? { credential: tokenField.trim() } : {})
		})
		busy = false
	}

	function toggleTunnel(next: boolean) {
		busy = true
		if (next) {
			starting = true
			// The enable ack does not arrive until the tunnel is up or has
			// failed, so poll for the row's own status in the meantime — that
			// is what surfaces a restart or an error while waiting.
			stopPolling()
			pollTimer = setInterval(() => socket.emit("tunnels:get", {}), 2000)
		}
		socket.emit(next ? "tunnels:enable" : "tunnels:disable", {})
		busy = false
		// A tunnel coming up or going down changes which hostname this
		// instance answers on, so the list below is stale the moment it does.
		socket.emit("allowedHosts:get", {})
	}

	async function copyLink() {
		if (!publicUrl) return
		await navigator.clipboard.writeText(publicUrl)
		toaster.success({ title: "Link copied" })
	}
</script>

<div class="mb-4">
	<h2 class="flex items-center gap-2 text-lg font-semibold">
		<Icons.Server size={20} /> Servers
	</h2>
	<p class="text-surface-600-400 text-sm">
		How this instance is reached, and who it trusts.
	</p>
</div>

{#if wildcard}
	<!-- Deliberately above the tunnel card and outside the loading branch.
	     Letting an admin read a carefully attributed host list that is not
	     being consulted at all is worse than not showing the list. -->
	<div class="card preset-filled-warning-500 mb-4 flex items-start gap-3 p-4">
		<Icons.TriangleAlert size={20} class="mt-0.5 shrink-0" />
		<div class="text-sm">
			<p class="font-semibold">
				The origin allowlist is switched off entirely.
			</p>
			<p>
				<code>ALLOWED_ORIGINS=*</code>
				is set in this instance's environment, so every origin is accepted
				and the hosts listed below have no effect. This is a legitimate choice
				when a reverse proxy or Docker port mapping already decides what
				can reach this instance — but it is not the app's default, and nothing
				here will narrow it until that variable changes.
			</p>
		</div>
	</div>
{/if}

{#if loading}
	<div class="text-surface-600-400 p-8 text-center text-sm">Loading…</div>
{:else if !available}
	<div class="card preset-filled-surface-100-900 space-y-2 p-4">
		<h3 class="flex items-center gap-2 text-lg font-semibold">
			<Icons.Globe size={18} /> Tunnel
		</h3>
		<p class="text-surface-600-400 text-sm">{unavailableReason}</p>
	</div>
{:else}
	<div class="flex flex-col gap-6">
		<div class="card preset-filled-surface-100-900 space-y-4 p-4">
			<div class="flex items-start justify-between gap-4">
				<div>
					<h3 class="flex items-center gap-2 text-lg font-semibold">
						<Icons.Globe size={18} /> Tunnel
					</h3>
					<p class="text-surface-600-400 text-sm">
						Make this instance reachable from outside your network,
						without port forwarding.
					</p>
				</div>
				{#if tunnel}
					<span
						class="badge shrink-0 {tunnel.status === 'running'
							? 'preset-filled-success-500'
							: tunnel.status === 'error'
								? 'preset-filled-error-500'
								: 'preset-tonal'}"
					>
						{tunnel.status}
					</span>
				{/if}
			</div>

			{#if tunnel?.lastError}
				<p class="text-error-500 text-sm">{tunnel.lastError}</p>
			{/if}

			{#if publicUrl && tunnel?.status === "running"}
				<div class="flex items-center gap-2">
					<a
						href={publicUrl}
						target="_blank"
						rel="noreferrer"
						class="anchor truncate"
					>
						{publicUrl}
					</a>
					<button
						type="button"
						class="btn btn-sm preset-tonal shrink-0"
						onclick={copyLink}
					>
						<Icons.Copy size={14} /> Copy link
					</button>
				</div>
			{/if}

			<!-- Mode. Switching while something is running would orphan the
			     live process, so it is locked until the tunnel is stopped. -->
			<div class="flex gap-2">
				{#each [{ id: "easy", label: "Easy" }, { id: "custom", label: "Custom domain" }] as opt (opt.id)}
					<button
						type="button"
						disabled={isRunning}
						class="btn btn-sm {mode === opt.id
							? 'preset-filled-primary-500'
							: 'preset-tonal'}"
						onclick={() => (mode = opt.id as "easy" | "custom")}
					>
						{opt.label}
					</button>
				{/each}
			</div>

			{#if isRunning}
				<p class="text-surface-600-400 text-xs">
					Stop the tunnel to change its configuration.
				</p>
			{/if}

			{#if mode === "easy"}
				<p class="text-surface-600-400 text-sm">
					A free Cloudflare quick tunnel. No account, no domain — but
					the address is random and <strong>
						changes every time the tunnel restarts
					</strong>
					, so the link you share is good for this session only.
				</p>
			{:else}
				<div class="space-y-3">
					<p class="text-surface-600-400 text-sm">
						Your own domain on a free Cloudflare account. The
						address is stable across restarts. In the Cloudflare
						dashboard, point the tunnel's public hostname at
						<code>http://localhost:{"{PORT}"}</code>
						— the same port this page is served on.
					</p>
					<label class="label">
						<span class="label-text">Public hostname</span>
						<input
							type="text"
							class="input"
							placeholder="chat.example.com"
							disabled={isRunning}
							bind:value={hostnameField}
						/>
					</label>
					<label class="label">
						<span class="label-text">
							Connector token
							{#if tunnel?.credentialSet}
								<span class="text-success-500 text-xs">
									— saved; leave blank to keep it
								</span>
							{/if}
						</span>
						<input
							type="password"
							class="input"
							placeholder={tunnel?.credentialSet
								? "••••••••"
								: "Paste the connector token"}
							disabled={isRunning}
							bind:value={tokenField}
						/>
					</label>
				</div>
			{/if}

			<div class="space-y-2">
				<div class="flex items-center gap-2">
					<Switch
						name="tunnel-ttl"
						checked={ttlEnabled}
						disabled={isRunning}
						onCheckedChange={(e) => (ttlEnabled = e.checked)}
					>
						<Switch.Control
							class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
						>
							<Switch.Thumb />
						</Switch.Control>
						<Switch.HiddenInput />
						<Switch.Label>Stop automatically</Switch.Label>
					</Switch>
				</div>

				{#if ttlEnabled}
					<div class="flex flex-wrap items-center gap-2 pl-1">
						<input
							type="number"
							aria-label="Hours before the tunnel stops"
							class="input w-24"
							min={MIN_TUNNEL_TTL_SECONDS / 3600}
							max={MAX_TUNNEL_TTL_SECONDS / 3600}
							step="0.25"
							disabled={isRunning}
							bind:value={ttlHours}
						/>
						<span class="text-sm">hours after starting</span>
						{#each TUNNEL_TTL_PRESET_HOURS as preset (preset)}
							<button
								type="button"
								disabled={isRunning}
								class="btn btn-sm {ttlHours === preset
									? 'preset-filled-primary-500'
									: 'preset-tonal'}"
								onclick={() => (ttlHours = preset)}
							>
								{preset}h
							</button>
						{/each}
					</div>
					{#if ttlOutOfRange}
						<p class="text-error-500 pl-1 text-sm">
							Choose between {MIN_TUNNEL_TTL_SECONDS / 60} minutes
							and {MAX_TUNNEL_TTL_SECONDS / 86400} days — or turn this
							off for a tunnel that should stay up.
						</p>
					{/if}
					{#if expiresAtLabel}
						<p class="text-surface-600-400 pl-1 text-sm">
							This tunnel stops at {expiresAtLabel}.
						</p>
					{/if}
				{/if}
			</div>

			<div class="flex items-center gap-2">
				<Switch
					name="tunnel-autostart"
					checked={autoStart}
					disabled={isRunning}
					onCheckedChange={(e) => (autoStart = e.checked)}
				>
					<Switch.Control
						class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
					>
						<Switch.Thumb />
					</Switch.Control>
					<Switch.HiddenInput />
					<Switch.Label>
						Start automatically when the app starts
					</Switch.Label>
				</Switch>
			</div>
			{#if autoStart && mode === "easy"}
				<p class="text-surface-600-400 text-xs">
					On Easy mode this brings the tunnel back after a restart,
					but with a new address — the old link stops working.
				</p>
			{/if}

			<div class="flex flex-wrap items-center gap-2">
				<button
					type="button"
					class="btn preset-filled-primary-500"
					disabled={busy || isRunning || ttlOutOfRange}
					onclick={saveConfig}
				>
					Save configuration
				</button>
				<button
					type="button"
					class="btn {isRunning
						? 'preset-tonal-error'
						: 'preset-filled-success-500'}"
					disabled={busy ||
						starting ||
						(!isRunning && !!enableBlockedReason)}
					onclick={() => toggleTunnel(!isRunning)}
				>
					{#if starting}
						<Icons.LoaderCircle size={16} class="animate-spin" />
						Starting…
					{:else}
						{isRunning ? "Stop tunnel" : "Start tunnel"}
					{/if}
				</button>
			</div>

			{#if starting}
				<p class="text-surface-600-400 text-sm">
					Waiting for Cloudflare to assign an address. The first start
					also downloads <code>cloudflared</code>
					, so this can take up to a minute.
				</p>
			{/if}

			{#if !isRunning && enableBlockedReason}
				<p class="text-warning-600-400 text-sm">
					{enableBlockedReason}
				</p>
			{/if}
		</div>

		<div class="card preset-filled-surface-100-900 space-y-4 p-4">
			<div>
				<h3 class="flex items-center gap-2 text-lg font-semibold">
					<Icons.ShieldCheck size={18} /> Allowed hosts
				</h3>
				<p class="text-surface-600-400 text-sm">
					Which origins may open a realtime connection to this
					instance, and where each one comes from.
				</p>
			</div>

			<!-- Stated as a rule, not rendered as a list entry. An Origin
			     matching the request's own Host is allowed without appearing
			     anywhere, so inventing a row for it would name a hostname
			     nobody configured. -->
			<div
				class="border-surface-300-700 rounded-lg border border-dashed p-3 text-sm"
			>
				<p class="font-semibold">Any host you reach this app on</p>
				<p class="text-surface-600-400">
					A page and its realtime connection are served from the same
					address, so a browser tab is always allowed to connect back
					to wherever it loaded from — your LAN IP, a custom domain, a
					tunnel. This needs no configuration and covers almost every
					setup; the entries below are the additions on top.
				</p>
			</div>

			<ul class="space-y-2">
				{#each allowedHosts as host (host.hostname)}
					<li
						class="border-surface-300-700 flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
					>
						<code class="truncate text-sm">{host.hostname}</code>
						<span class="badge preset-tonal shrink-0 text-xs">
							{SOURCE_LABELS[host.source] ?? host.source}
						</span>
					</li>
				{/each}
			</ul>

			<p class="text-surface-600-400 text-xs">
				This list is read-only. Every entry is configured somewhere with
				more authority than this page — the process environment, or the
				tunnel that is currently running — so editing it here would only
				last until the next restart.
			</p>
		</div>
	</div>
{/if}
