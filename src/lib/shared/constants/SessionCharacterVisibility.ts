export class SessionCharacterVisibility {
	static VISIBLE = "visible" // Show full character information (default)
	static MINIMAL = "minimal" // Show only name/nickname when not responding
	static HIDDEN = "hidden" // Hide all character info when not responding

	// label/description describe what the model sees about this character in
	// turns where someone ELSE is speaking — a character's own information is
	// always fully included on their own turns, regardless of this setting.
	static options = [
		{
			value: SessionCharacterVisibility.VISIBLE,
			label: "Full Info",
			description:
				"Full character info is included even when they're not speaking"
		},
		{
			value: SessionCharacterVisibility.MINIMAL,
			label: "Name Only",
			description:
				"Only name/nickname is included when they're not speaking"
		},
		{
			value: SessionCharacterVisibility.HIDDEN,
			label: "Hidden",
			description:
				"No character info is included when they're not speaking"
		}
	]
}
