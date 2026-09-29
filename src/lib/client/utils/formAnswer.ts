/**
 * A form block's answer and staleness, as a reader sees them — declared with
 * core's conversation (C7), `@serene-pub/core-catalog/conversation`, and
 * re-exported where the app has always imported them.
 */
export {
	answeredChoiceLabel,
	answeredOf,
	canAnswerForm,
	channelHeadOf,
	staleOf,
	stalenessHeadOf,
	type AnsweredMark,
	type FormSession,
	type FormViewer,
	type StaleRow
} from "@serene-pub/core-catalog/conversation"
