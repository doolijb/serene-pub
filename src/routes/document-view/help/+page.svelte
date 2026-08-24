<script lang="ts">
	import { getContext } from "svelte"

	let userCtx: UserCtx = getContext("userCtx")
	let systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")
	let ollamaSettingsCtx: OllamaSettingsCtx = getContext("ollamaSettingsCtx")
	let koboldCppSettingsCtx: KoboldCppSettingsCtx = getContext(
		"koboldCppSettingsCtx"
	)

	let isAdmin = $derived(!!userCtx.user?.isAdmin)
	let isAccountsEnabled = $derived(
		!!systemSettingsCtx.settings?.isAccountsEnabled
	)

	interface PageLink {
		href: string
		label: string
		description: string
		show: boolean
	}
	interface PageGroup {
		title: string
		pages: PageLink[]
	}

	let pageGroups = $derived.by((): PageGroup[] => {
		const groups: PageGroup[] = [
			{
				title: "Home",
				pages: [
					{
						href: "/document-view",
						label: "Home",
						description:
							"Onboarding checklist, then your recent sessions and quick links.",
						show: true
					}
				]
			},
			{
				title: "Sessions",
				pages: [
					{
						href: "/document-view/sessions",
						label: "Sessions",
						description: "List of all your sessions.",
						show: true
					},
					{
						href: "/document-view/sessions/new",
						label: "Start a New Session",
						description:
							"Create a session with one or more characters and personas.",
						show: true
					}
				]
			},
			{
				title: "Characters",
				pages: [
					{
						href: "/document-view/characters",
						label: "Characters",
						description: "List of your characters.",
						show: true
					},
					{
						href: "/document-view/characters/new",
						label: "Create a New Character",
						description: "Simplified character creation.",
						show: true
					},
					{
						href: "/document-view/characters/browse",
						label: "Browse Character Library",
						description:
							"Search and download community characters.",
						show: true
					}
				]
			},
			{
				title: "Personas",
				pages: [
					{
						href: "/document-view/personas",
						label: "Personas",
						description: "List of your personas.",
						show: true
					},
					{
						href: "/document-view/personas/new",
						label: "Create a New Persona",
						description: "Simplified persona creation.",
						show: true
					},
					{
						href: "/document-view/personas/browse",
						label: "Browse Persona Library",
						description: "Search and download community personas.",
						show: true
					}
				]
			},
			{
				title: "Documentation",
				pages: [
					{
						href: "/document-view/docs",
						label: "Documentation",
						description: "Search or browse the full set of guides.",
						show: true
					}
				]
			},
			{
				title: "Administration",
				pages: [
					{
						href: "/document-view/connections",
						label: "Connections",
						description:
							"Manage AI provider connections and the system default.",
						show: isAdmin
					},
					{
						href: "/document-view/ollama",
						label: "Ollama Manager",
						description:
							"Browse, download, and connect Ollama models.",
						show:
							isAdmin &&
							!!ollamaSettingsCtx.settings?.ollamaManagerEnabled
					},
					{
						href: "/document-view/koboldcpp",
						label: "KoboldCPP Manager",
						description:
							"Browse, download, and connect KoboldCPP models.",
						show:
							isAdmin &&
							!!koboldCppSettingsCtx.settings
								?.koboldCppManagerEnabled
					},
					{
						href: "/document-view/settings/system",
						label: "System Settings",
						description:
							"Instance-wide settings: managers, accounts, summarization, and more.",
						show: isAdmin
					},
					{
						href: "/document-view/settings/users",
						label: "Users",
						description: "Manage user accounts.",
						show: isAdmin && isAccountsEnabled
					}
				]
			},
			{
				title: "Account & Reference",
				pages: [
					{
						href: "/document-view/settings",
						label: "Settings",
						description:
							"Your display name, passphrase, display preferences, and account actions.",
						show: true
					},
					{
						href: "/document-view/help",
						label: "Help",
						description: "This page.",
						show: true
					},
					{
						href: "/document-view/about",
						label: "About",
						description: "Version, links, and release notes.",
						show: true
					}
				]
			}
		]
		return groups
			.map((g) => ({ ...g, pages: g.pages.filter((p) => p.show) }))
			.filter((g) => g.pages.length > 0)
	})
</script>

<svelte:head>
	<title>Help — Document View — Serene Pub</title>
</svelte:head>

<h1>Help</h1>

<h2>Keyboard Shortcuts</h2>
<p>
	Every control in Document View is a plain link, button, or form field, so it
	already works with standard browser keyboard behavior — nothing to learn
	beyond what's below.
</p>
<ul class="a11y-list">
	<li class="a11y-list-item">
		<p>
			<kbd>Ctrl</kbd>
			+
			<kbd>Shift</kbd>
			+
			<kbd>Y</kbd>
		</p>
		<p>
			Switch between Document View and the standard site, from anywhere,
			including the login screen.
		</p>
	</li>
	<li class="a11y-list-item">
		<p>
			<kbd>Tab</kbd>
			/
			<kbd>Shift</kbd>
			+
			<kbd>Tab</kbd>
		</p>
		<p>Move to the next or previous link, button, or field.</p>
	</li>
	<li class="a11y-list-item">
		<p>
			<kbd>Enter</kbd>
			/
			<kbd>Space</kbd>
		</p>
		<p>Activate the focused link, button, or checkbox.</p>
	</li>
	<li class="a11y-list-item">
		<p>"Skip to main content" link</p>
		<p>
			The very first Tab stop on every page — jumps straight past the
			header and navigation.
		</p>
	</li>
	<li class="a11y-list-item">
		<p>"Skip to latest message" / "Skip to message box" links</p>
		<p>
			Appear at the top of every session, right below its title — jump
			straight past the message history instead of tabbing through it.
		</p>
	</li>
	<li class="a11y-list-item">
		<p>
			<kbd>Ctrl</kbd>
			+
			<kbd>Enter</kbd>
			(
			<kbd>Cmd</kbd>
			+
			<kbd>Enter</kbd>
			on macOS)
		</p>
		<p>
			Send a session message without leaving the message box. Plain Enter
			still just adds a new line.
		</p>
	</li>
</ul>
<p>
	Every page change also moves keyboard focus to the top of the new page's
	content and announces its title, so screen readers and keyboard users always
	land somewhere useful after following a link.
</p>

<h2>All Pages</h2>
<p>
	Every page currently available in Document View, grouped by area — only what
	your account can access is listed.
</p>
{#each pageGroups as group}
	<h3>{group.title}</h3>
	<ul class="a11y-list">
		{#each group.pages as p (p.href)}
			<li class="a11y-list-item">
				<a href={p.href}>{p.label}</a>
				<p>{p.description}</p>
			</li>
		{/each}
	</ul>
{/each}
