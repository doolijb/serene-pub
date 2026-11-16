/**
 * The icon behind each admin nav item, as an explicit name → component map.
 *
 * `adminNav.ts` names icons as lucide kebab/Pascal strings and carries no
 * component imports. Resolving them with a computed lookup on
 * `import * as Icons from "@lucide/svelte"` defeats tree-shaking and ships the
 * whole icon set, so the readers (the admin shell and the Jump overlay) look
 * names up here instead. A new nav item needs its icon added below;
 * `adminNavIcons.test.ts` fails until it is.
 */

import {
	Activity,
	Blocks,
	Braces,
	Brackets,
	Cable,
	CircleArrowUp,
	Database,
	Gauge,
	Globe,
	History,
	LayoutTemplate,
	MessageSquareText,
	MessagesSquare,
	Package,
	Puzzle,
	Scale,
	Settings,
	Shapes,
	SlidersHorizontal,
	SquareCode,
	Target,
	Ticket,
	Users,
	Workflow,
	Zap
} from "@lucide/svelte"
import type { Component } from "svelte"

export const ADMIN_NAV_ICONS: Record<string, Component<any>> = {
	Activity,
	Blocks,
	Braces,
	Brackets,
	Cable,
	CircleArrowUp,
	Database,
	Gauge,
	Globe,
	History,
	LayoutTemplate,
	MessageSquareText,
	MessagesSquare,
	Package,
	Puzzle,
	Scale,
	Settings,
	Shapes,
	SlidersHorizontal,
	SquareCode,
	Target,
	Ticket,
	Users,
	Workflow,
	Zap
}
