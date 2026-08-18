<script lang="ts">
	import { page } from "$app/state"
	import * as Icons from "@lucide/svelte"
	import { browser } from "$app/environment"

	/**
	 * The "a newer version is available" bar.
	 *
	 * INTERIM — superseded by the general notification system planned for
	 * 0.6.0. When that lands, this component and its localStorage dismissal
	 * key should be deleted outright rather than adapted: per-browser,
	 * single-purpose dismissal state is the wrong shape for a real
	 * notification centre. The part worth keeping is
	 * $lib/shared/utils/releaseChannel — deciding WHICH releases a given build
	 * should hear about is independent of how the notice is displayed.
	 *
	 * Three things it has to get right, none of which the previous inline
	 * version in +layout.svelte did:
	 *
	 *  1. Admins only. A non-admin cannot act on an update notice — they can't
	 *     upgrade the install — so it was pure noise for them.
	 *  2. Dismissal lasts a day, not forever and not zero seconds. It used to
	 *     be a plain `$state(true)`, which reset on every page load (so it
	 *     nagged constantly) yet could never return within a session (so a
	 *     dismissal on Monday hid it until the process restarted).
	 *  3. It lives inside the authenticated shell, so it never renders over
	 *     the login screen.
	 *
	 * Which releases reach here at all is decided server-side by the release
	 * channel rules — see $lib/shared/utils/releaseChannel.
	 */
	let { isAdmin = false }: { isAdmin?: boolean } = $props()

	const DISMISS_KEY = "serene-pub:update-notice-dismissed-until"
	const DISMISS_MS = 24 * 60 * 60 * 1000

	// Read once at init. A stored value in the past (or absent, or corrupt)
	// means "show it"; corrupt input must not permanently suppress the notice,
	// so anything unparseable is treated as not-dismissed.
	function readDismissedUntil(): number {
		if (!browser) return 0
		try {
			const raw = window.localStorage.getItem(DISMISS_KEY)
			if (!raw) return 0
			const parsed = Number(raw)
			return Number.isFinite(parsed) ? parsed : 0
		} catch {
			// localStorage can throw outright in private-mode//embedded
			// WebViews. Failing open (showing the bar) is the safe direction.
			return 0
		}
	}

	let dismissedUntil = $state(readDismissedUntil())
	// Captured at mount rather than read live: this only needs to gate the
	// initial render, and re-evaluating Date.now() in a $derived would make
	// the bar pop back mid-session at an arbitrary moment.
	const now = Date.now()

	let visible = $derived(
		isAdmin && !!page.data?.isNewerReleaseAvailable && dismissedUntil <= now
	)

	function dismiss() {
		const until = Date.now() + DISMISS_MS
		dismissedUntil = until
		try {
			window.localStorage.setItem(DISMISS_KEY, String(until))
		} catch {
			// Dismissal then lasts only for this page view. Acceptable — the
			// alternative is the button appearing to do nothing at all.
		}
	}
</script>

{#if visible}
	<div
		class="bg-surface-200-800 sticky right-0 bottom-0 left-0 z-100 p-4 text-center"
		role="status"
	>
		<span>
			A newer version of Serene Pub is available{page.data
				?.latestReleaseTag
				? ` (${page.data.latestReleaseTag})`
				: ""}!&nbsp;
			<a
				href="https://github.com/doolijb/serene-pub/releases"
				target="_blank"
				rel="noopener"
				class="btn preset-filled-success-500"
			>
				<Icons.Download size={16} />
				Download here
			</a>
		</span>
		<button
			onclick={dismiss}
			title="Dismiss for today"
			aria-label="Dismiss update notice for today"
			style="margin-left: 2rem; background: none; border: none; color: inherit; font-size: 1.5rem; cursor: pointer;"
		>
			<Icons.X size={16} />
		</button>
	</div>
{/if}
