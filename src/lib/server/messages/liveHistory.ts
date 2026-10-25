import { isNull, type SQL } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import * as schema from "$lib/server/db/schema"

/**
 * 🚧 **The live history** (RF fix 5, NOMENCLATURE §24 **rewound turn**): a
 * row Back took out (`rewind_ordinal` set) is not in it. Pass the
 * relational query's own column (`cm.rewindOrdinal`) where the table is
 * aliased, or the mirror's (`schema.messages.rewindOrdinal`, written on
 * every mirror of a legacy row). Every read of a
 * session's history ANDs this in — the page's log and its pages, the
 * newest message an anchor or a turn reads, the turn yield, the branch's
 * copy, retrieval — so a rewound row reaches no reader. The prompt's own
 * read needs nothing more: a rewound row is also `is_hidden`, which it
 * already leaves out.
 */
export const liveMessageWhere = (
	column: AnyPgColumn = schema.sessionMessages.rewindOrdinal
): SQL => isNull(column)
