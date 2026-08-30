/**
 * The SP-core widget declarations (PLAN 25). Pure data — no component imports —
 * so the server-side style reconciler can read it at boot without pulling the
 * client bundle. The client maps a widget's `surface.component` key to a real
 * Svelte component separately (the native-surface registry).
 *
 * This is the source of truth for which style presets core ships. On boot (and
 * on version change in production) `syncWidgetStyles` seeds each preset as a
 * `source: "system"` row and prunes any system row whose preset is no longer
 * listed here — so removing a preset from this array removes it everywhere,
 * while a user's own styles built on the same widget are never touched.
 */
import type { WidgetDecl } from "./types"

/**
 * A widget ships at least one "default" style so a fresh layout always resolves
 * to something. Empty `css` means the base look (the widget's own styling with
 * no skin on top); it exists as a row so the layout's id+slug reference has a
 * concrete, reseed-stable target to point at.
 */
const DEFAULT_PRESET = {
	slug: "default",
	title: "Default",
	css: ""
}

export const CORE_WIDGETS: WidgetDecl[] = [
	{
		id: "messages",
		title: "Messages",
		role: "primary",
		surface: { kind: "native", component: "messages" },
		presets: [DEFAULT_PRESET]
	},
	{
		id: "composer",
		title: "Composer",
		role: "primary",
		surface: { kind: "native", component: "composer" },
		presets: [DEFAULT_PRESET]
	},
	{
		id: "scene-portraits",
		title: "Scene Portraits",
		surface: { kind: "native", component: "scene-portraits" },
		scopes: ["characters"],
		presets: [DEFAULT_PRESET]
	}
]
