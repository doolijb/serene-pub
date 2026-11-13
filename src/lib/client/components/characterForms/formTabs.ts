import type { Component } from "svelte"
import * as Icons from "@lucide/svelte"

/**
 * The groups a character form's fields belong to (the cast member form uses
 * them too, without Stats). A field is always open
 * inside its group: folding one away hides whether it is filled, which is
 * the question a character sheet answers at a glance.
 */
export type FormTab =
	| "profile"
	| "voice"
	| "speech"
	| "notes"
	| "likeness"
	| "stats"

export const FORM_TABS: Array<{
	value: FormTab
	label: string
	icon: Component<any>
}> = [
	{ value: "profile", label: "Profile", icon: Icons.UserRound },
	{ value: "voice", label: "Voice", icon: Icons.MessageSquareQuote },
	{ value: "notes", label: "Notes", icon: Icons.NotebookPen },
	{ value: "likeness", label: "Likeness", icon: Icons.ScanFace },
	{ value: "speech", label: "Speech", icon: Icons.Volume2 },
	{ value: "stats", label: "Stats", icon: Icons.HeartPulse }
]
