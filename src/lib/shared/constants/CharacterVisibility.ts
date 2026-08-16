/**
 * Character visibility options for optimizing context in group chats
 */
export const CharacterVisibility = {
	VISIBLE: "visible", // Show full character information (default)
	MINIMAL: "minimal", // Show only name/nickname when not responding
	HIDDEN: "hidden" // Hide all character info when not responding
} as const

export type CharacterVisibilityType =
	(typeof CharacterVisibility)[keyof typeof CharacterVisibility]

export const CharacterVisibilityLabels: Record<
	CharacterVisibilityType,
	string
> = {
	[CharacterVisibility.VISIBLE]: "Full Info",
	[CharacterVisibility.MINIMAL]: "Name Only",
	[CharacterVisibility.HIDDEN]: "Hidden"
}

export const CharacterVisibilityDescriptions: Record<
	CharacterVisibilityType,
	string
> = {
	[CharacterVisibility.VISIBLE]:
		"Show full character information including description, personality, and lore",
	[CharacterVisibility.MINIMAL]:
		"Show only character name/nickname when not responding",
	[CharacterVisibility.HIDDEN]:
		"Hide all character information when not responding"
}
