export class GroupReplyStrategies {
	static MANUAL = "manual" // User manually selects persona for each reply
	static ORDERED = "ordered" // Replies follow the order of personas in the session
	// Round-robin, but grouped by which user owns each persona/character — one
	// user's own personas and characters complete a full turn before the next
	// user's do, rather than interleaving every user's cast together. Only
	// meaningful with multiple users in a session, so it's hidden in the UI when
	// user accounts are disabled (see EditSessionForm.svelte).
	static USER_SPLIT = "userSplit"
	// static NATURAL = "natural" // Replies are assigned based on natural conversation flow

	static options = [
		{ value: GroupReplyStrategies.ORDERED, label: "Ordered (Round-robin)" },
		{
			value: GroupReplyStrategies.USER_SPLIT,
			label: "User-Split (Round-robin by user)"
		},
		{ value: GroupReplyStrategies.MANUAL, label: "Manual (User selects)" }
		// [GroupReplyStrategies.NATURAL, "Natural (Conversation flow)"]
	]
}
