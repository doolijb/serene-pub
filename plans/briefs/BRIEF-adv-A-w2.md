# BRIEF — adv-A-w2: the advanced controls switch, client half (helper, hidden line, User tab card)

Repo: `/home/jody/github/serene-pub`. Supervisor: lane adv-A. You type; the supervisor checks your report against this brief. Use absolute paths in every command (your cwd resets between calls).

A sibling worker (adv-A-w1) is adding the server half at the same time: the `userSettings.showAdvancedControls: boolean` field on `userSettings:get`, and the new socket event **`userSettings:updateShowAdvancedControls`** with params `{ enabled: boolean }` and response `{ success: boolean; enabled: boolean }`, registered in `src/lib/client/sockets/typedSocket.ts` and `src/lib/shared/sockets/types.ts`. **Don't edit those files.** Write your code against that contract; if the typed map entry isn't there yet when you check types, that's expected. The supervisor runs `tsc` after both workers finish.

## Goal (owner-ruled 2026-11-10; copy is exact)

1. **Helper.** New `src/lib/client/advancedControls.ts`:
   ```ts
   /** 🚧 Advanced controls (2026-11-10): whether this person shows the less everyday controls on sessions, lorebooks and characters. A preference, never a permission. Off when the settings haven't arrived. */
   export function showsAdvancedControls(
   	settings: { showAdvancedControls?: boolean } | null | undefined
   ): boolean {
   	return settings?.showAdvancedControls ?? false
   }
   ```
   Plus a unit test `src/lib/client/advancedControls.test.ts`: true, false, missing field, `null`, `undefined`.

2. **`src/lib/client/components/AdvancedHiddenLine.svelte`** (new). One muted line at the foot of a form that hid something.
   - Markup: a `<p>` with `class="text-surface-600-400 text-xs {className}"` containing the text **`Some controls are hidden.`** then a space, then `<button type="button" class="anchor">Show advanced controls</button>`. (`anchor` is the house quiet text link, used as a button elsewhere, e.g. `AudioCppModelsTab.svelte:166`; STYLE-GUIDE §6.1: "Actions that would be clutter as buttons are quiet text links.") Copy is exact, sentence case, no icon, no count.
   - Props: an optional `class` only (`let { class: className = "" }: { class?: string } = $props()`).
   - Clicking the button emits `socket?.emit("userSettings:updateShowAdvancedControls", { enabled: true })`. Get the socket exactly as `src/lib/client/components/settingsTabs/UserSettingsTab.svelte` does: `import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"` and `const socket = useTypedSocket()` at component init. Copy the emit shape of its `onShowAllCharacterFieldsClick` (around line 461).
   - The component **never** imports or calls `toaster` or `notify`, and **never** registers a socket listener (`socket.on`, `useInterest`, `declareInterest`). The surface redraws when the shell's `userSettings:get` listener updates `userSettingsCtx`; errors are toasted by Layout's `:error` catch-all.
   - A short header comment: what it is, that it is static (counts nothing, ★C), and the no-listener/no-toast rule.
   - Dom test `src/lib/client/components/AdvancedHiddenLine.dom.test.svelte.ts`: renders the exact text, and clicking **Show advanced controls** calls `emit` once with `("userSettings:updateShowAdvancedControls", { enabled: true })`. Mock the socket the way `src/lib/client/admin/sections/data/castUpgradeCard.dom.test.svelte.ts` does (lines ~35-44), but mock **`$lib/client/sockets/loadSockets.client`**'s `useTypedSocket` (that's the module the component imports). Follow that file's render/cleanup pattern. Keep assertions simple and deterministic (no failing assert on a happy-dom element inside a loop).

3. **User tab**, `src/lib/client/components/settingsTabs/UserSettingsTab.svelte`:
   - Add a new `SettingCard` as the **first** child of the card column, before the Language card (around line 604), shaped exactly like the current *Show all character fields* card (around lines 735-756):
     ```svelte
     <SettingCard
     	title="Show advanced controls"
     	titleId="user-show-advanced-controls-heading"
     	help="More choices on sessions, lorebooks and characters. Off keeps the everyday ones."
     	layout="switch"
     >
     	<Switch
     		name="show-advanced-controls"
     		checked={showsAdvancedControls(userSettingsCtx.settings)}
     		onCheckedChange={onShowAdvancedControlsClick}
     	>
     		…same Switch.Control / Thumb / HiddenInput / sr-only Label as the show-all card, label "Show advanced controls"…
     	</Switch>
     </SettingCard>
     ```
     with `import { showsAdvancedControls } from "$lib/client/advancedControls"` and a handler `function onShowAdvancedControlsClick(event: { checked: boolean }) { socket?.emit("userSettings:updateShowAdvancedControls", { enabled: event.checked }) }` placed where `onShowAllCharacterFieldsClick` is now. Do **not** add a `useInterest` reply listener or any `notify` call for the new event (the switch shows the change; the shell's `userSettings:get` listener redraws it; Layout's `:error` catch-all toasts a failure).
   - **Remove** the *Show all character fields* card, its click handler `onShowAllCharacterFieldsClick`, its reply listener `handleUserSettingsUpdateShowAllCharacterFields` and the `useInterest<"userSettings:updateShowAllCharacterFields">(…)` registration that wires it (around lines 78-93 and 290-293), and any import that becomes unused. Keep the comment above the `useInterest` block accurate if it mentions the removed one.
   - Keep *Easy character creation* and every other card, handler and listener unchanged.

## Files owned (edit only these)

- new `src/lib/client/advancedControls.ts` and `src/lib/client/advancedControls.test.ts`
- new `src/lib/client/components/AdvancedHiddenLine.svelte` and `src/lib/client/components/AdvancedHiddenLine.dom.test.svelte.ts`
- `src/lib/client/components/settingsTabs/UserSettingsTab.svelte`

## Files readable

Anything. In particular `src/lib/client/components/settingsTabs/SettingCard.svelte`, `src/lib/client/components/settingsTabs/UserSettingsTab.svelte`, `src/lib/client/admin/sections/data/castUpgradeCard.dom.test.svelte.ts`.

## Out of scope (never build)

- Gating any surface (other lanes). Using `AdvancedHiddenLine` anywhere.
- `CharacterForm.svelte` and its inline show-all switch.
- Server code, socket types, `typedSocket.ts`, `interest.ts` (sibling worker).
- Docs, NOMENCLATURE, STYLE-GUIDE.
- Any other prop, setting, name, icon or copy.

## Stop and ask when

- You need a name, prop or copy not in this brief.
- A test outside your files breaks and the fix is not a one-line shape update.

## Rules (quoted from CLAUDE.md and STYLE-GUIDE)

- "**Sockets:** one domain context per event family (provided by both shells) is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`."
- "`socket.off(event)` with no handler removes **every** listener app-wide; always pass the handler."
- "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."
- "It is a **session**, never a *chat*."
- STYLE-GUIDE §10: "Sentence case everywhere" · "A card's title is its control's label: say the setting's name once" · "Help is one sentence."
- STYLE-GUIDE §6.21: "a change the control already shows (a switch flipping, a mode or a theme changing) is `silent` and raises nothing".

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (This task needs no `sdk:build`.)
- Never `git checkout`, `restore` or `clean` in either repo.
- Never pipe vitest into `head`. Run vitest inside a capped scope: `cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <files>; echo test-exit=$?'`.
- Scratch files start with `adv-A-w2-`.

## Done means

Run and report results for:
- `src/lib/client/advancedControls.test.ts`
- `src/lib/client/components/AdvancedHiddenLine.dom.test.svelte.ts`
- `src/lib/client/components/settingsTabs/displayNameField.ssr.test.ts` and `src/lib/client/components/settingsTabs/importCompletion.test.ts` (existing tests beside the tab; confirm still green)
- `npx prettier --check` on every file you edited.

Don't run the full suite or `tsc`.

## Report

Reply with (as your final message, not a file): changed files, tests run with pass/fail counts, any choice you made that the brief didn't dictate, and **Noticed, not done**.
