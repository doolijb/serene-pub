<script lang="ts">
	import { getContext } from "svelte"
	import { page } from "$app/state"
	import {
		appVersion,
		appVersionDisplay
	} from "$lib/shared/constants/version"

	// Admin-only, matching UpdateNoticeBar and the settings sidebar: only an
	// admin can act on an update notice. AccessibleShell provides userCtx.
	const userCtx: UserCtx | undefined = getContext("userCtx")
</script>

<svelte:head>
	<title>About — Document View — Serene Pub</title>
</svelte:head>

<h1>About Serene Pub</h1>

<p>Version: {appVersionDisplay}</p>
<p>Build: {appVersion}</p>

{#if page.data?.isNewerReleaseAvailable && userCtx?.user?.isAdmin}
	<div class="a11y-status">
		<p>A newer version of Serene Pub is available.</p>
		<p>
			<a
				href="https://github.com/doolijb/serene-pub/releases"
				target="_blank"
				rel="noopener"
			>
				Download the latest release
			</a>
		</p>
	</div>
{/if}

<ul class="a11y-list">
	<li class="a11y-list-item">
		<a
			href="https://serenepub.com"
			target="_blank"
			rel="noopener noreferrer"
		>
			Website
		</a>
	</li>
	<li class="a11y-list-item">
		<a
			href="https://github.com/doolijb/serene-pub"
			target="_blank"
			rel="noopener noreferrer"
		>
			Repository
		</a>
	</li>
	<li class="a11y-list-item">
		<a
			href="https://github.com/doolijb/serene-pub/milestones"
			target="_blank"
			rel="noopener noreferrer"
		>
			Milestones
		</a>
	</li>
	<li class="a11y-list-item">
		<a
			href="https://github.com/doolijb/serene-pub/issues"
			target="_blank"
			rel="noopener noreferrer"
		>
			Report an Issue
		</a>
	</li>
</ul>

<p>
	Document View is a simplified, high-contrast, keyboard- and
	screen-reader-friendly alternative to the standard Serene Pub interface.
	Press Ctrl+Shift+Y at any time to switch between them.
</p>
<p>
	<a href="/document-view/help">
		See the Keyboard Shortcuts and full page list on the Help page.
	</a>
</p>
