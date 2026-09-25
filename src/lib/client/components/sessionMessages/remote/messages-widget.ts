/**
 * The entry `serene-pub build` compiles core's messages widget from, as a
 * remote (C0b-4): the same source the page mounts natively.
 *
 * Mounted with the app's own Svelte rather than through
 * `@serene-pub/component-client/svelte`: the client is linked from the SDK,
 * whose Svelte is another copy, and importing it here put a second set of
 * Svelte's types into the app's check (every `Snippet` then mismatched).
 * The bundle resolves one Svelte from the package root either way.
 */
import { mount, unmount } from "svelte"
import type { ComponentMountFn } from "@serene-pub/sdk"
import RemoteMessagesWidget from "./RemoteMessagesWidget.svelte"

const mountMessagesWidget: ComponentMountFn = (root, ctx) => {
	const app = mount(RemoteMessagesWidget, { target: root, props: { ctx } })
	return () => {
		void unmount(app)
	}
}

export default mountMessagesWidget
