/**
 * Every host sp element's implementation (§3.5, C1b), by tag — the one map the
 * native page registers custom elements from and the component host's
 * receiver (C2) mirrors a remote's `sp-*` elements into.
 *
 * ⚠ The boot gate (`registry.test.ts`) holds this map to the SDK's
 * vocabulary (its `sp-*` tags, `SP_ELEMENT_TAGS`) both ways: an sp element the vocabulary names and nothing here
 * implements is a remote element the page drops silently, and an
 * implementation for a tag the vocabulary does not name is one no receiver
 * will ever allow through. Same posture as R-2's unbound-definition gate.
 */

import { SP_HOST_ELEMENTS } from "@serene-pub/sdk"
import { makeSpElementClass, type SpElementDef } from "./spElement.svelte"
import SpAccordion from "./SpAccordion.svelte"
import SpAccordionItem from "./SpAccordionItem.svelte"
import SpAvatar from "./SpAvatar.svelte"
import SpBadge from "./SpBadge.svelte"
import SpCombobox from "./SpCombobox.svelte"
import SpComposerField from "./SpComposerField.svelte"
import SpData from "./SpData.svelte"
import SpDialog from "./SpDialog.svelte"
import SpDropZone from "./SpDropZone.svelte"
import SpFilePicker from "./SpFilePicker.svelte"
import SpFrame from "./SpFrame.svelte"
import SpHostView from "./SpHostView.svelte"
import SpIcon from "./SpIcon.svelte"
import SpMenu from "./SpMenu.svelte"
import SpMessageBody from "./SpMessageBody.svelte"
import SpPopover from "./SpPopover.svelte"
import SpProgress from "./SpProgress.svelte"
import SpScroll from "./SpScroll.svelte"
import SpSlider from "./SpSlider.svelte"
import SpSwitch from "./SpSwitch.svelte"
import SpTabPanel from "./SpTabPanel.svelte"
import SpTabs from "./SpTabs.svelte"
import SpTooltip from "./SpTooltip.svelte"

export const SP_ELEMENTS: Record<string, SpElementDef> = {
	"sp-avatar": { component: SpAvatar },
	"sp-icon": { component: SpIcon },
	"sp-host-view": { component: SpHostView },
	"sp-badge": { component: SpBadge },
	"sp-progress": { component: SpProgress },
	"sp-tooltip": { component: SpTooltip },
	"sp-popover": { component: SpPopover },
	"sp-menu": { component: SpMenu, dataChildren: ["sp-menu-item"] },
	"sp-menu-item": { component: SpData },
	"sp-dialog": { component: SpDialog },
	"sp-tabs": { component: SpTabs, dataChildren: ["sp-tab"], state: () => ({ value: null }) },
	"sp-tab": { component: SpData },
	"sp-tab-panel": { component: SpTabPanel },
	"sp-accordion": { component: SpAccordion, state: () => ({ open: [] }) },
	"sp-accordion-item": { component: SpAccordionItem },
	"sp-switch": { component: SpSwitch },
	"sp-slider": { component: SpSlider },
	"sp-combobox": { component: SpCombobox, dataChildren: ["sp-option"] },
	"sp-option": { component: SpData },
	"sp-message-body": { component: SpMessageBody },
	"sp-composer-field": { component: SpComposerField },
	"sp-scroll": { component: SpScroll },
	"sp-file-picker": { component: SpFilePicker },
	"sp-drop-zone": { component: SpDropZone },
	"sp-frame": { component: SpFrame }
}

/** The vocabulary's `sp-*` tags — the elements the host renders itself. */
export const spElementTags = (): string[] => Object.keys(SP_HOST_ELEMENTS).filter((t) => t.startsWith("sp-"))

/** The sp elements the vocabulary names and nothing here implements, and the reverse. */
export function spElementGaps(): { missing: string[]; unknown: string[] } {
	const named = new Set<string>(spElementTags())
	return {
		missing: [...named].filter((t) => !SP_ELEMENTS[t]),
		unknown: Object.keys(SP_ELEMENTS).filter((t) => !named.has(t))
	}
}

let registered: Map<string, CustomElementConstructor> | null = null

/**
 * Define every sp element as a custom element, once per page, and return the map
 * a receiver mirrors into. Browser only — the element classes extend
 * `HTMLElement`. A tag another script already defined is left alone.
 */
export function registerHostElements(): Map<string, CustomElementConstructor> {
	if (registered) return registered
	const out = new Map<string, CustomElementConstructor>()
	for (const [tag, def] of Object.entries(SP_ELEMENTS)) {
		const existing = customElements.get(tag)
		const ctor = existing ?? makeSpElementClass(tag, def)
		if (!existing) customElements.define(tag, ctor)
		out.set(tag, ctor)
	}
	registered = out
	return out
}
