/**
 * The event registry (01 §8 / F8, 13 §7 and §7g).
 *
 * Only core emits, from a closed core-owned set. Nodes have no emit API and plugins
 * cannot define events; they subscribe. This file is the registry's *shape*, built so
 * that reopening plugin-defined events later is a permission rather than a migration.
 *
 * Two things here are deliberate and both were rulings, not conveniences:
 *
 * 1. **`slug` is the stable reference, not the id.** The primary key differs between
 *    instances because it autoincrements; the slug is what lets a seeded row be
 *    identified, synced and updated across instances and upgrades. Same convention
 *    belongs on every core-seeded registry — types, surfaces, shapes — so there is
 *    one identity convention rather than four.
 *
 * 2. **Two families.** A *data* event says something changed and carries write-target
 *    mappings, so it participates in the write → event → subscription cycle check.
 *    An *action* event says someone asked — a click, a scheduler tick. It has no write
 *    targets, so it drops out of the cycle graph instead of needing an exception.
 *    Without the distinction, `ui-action` would either blur F8's "occurrences core
 *    observes" or need a special case in the CTE.
 */
export type EventFamily = 'data' | 'action';
export interface EventDef {
    /** Autoincrement in core; opaque here. Never the reference used to sync. */
    id: number;
    /** Unique, PK-agnostic, stable across instances and upgrades (13 §7g). */
    slug: string;
    version: number;
    family: EventFamily;
    /** Does firing this touch a user's account or assets? Drives consent (11 §4). */
    affectsUser: boolean;
    /** Data events only: the consumer targets whose writes cause this event. */
    causedBy?: string[];
    description: string;
    /** Reserved, always null in 0.6. Reopening is a permission, not a migration. */
    ownerPluginId?: null;
}
export declare function defineEvent(def: Omit<EventDef, 'id' | 'ownerPluginId'>): EventDef;
export declare const getEvent: (slug: string) => EventDef | undefined;
export declare const allEvents: () => EventDef[];
/**
 * The events the inter-spec cycle CTE reads (F9). Action events are excluded by
 * construction rather than by an exception someone has to remember.
 */
export declare const cycleRelevantEvents: () => EventDef[];
export declare function _clearEvents(): void;
export declare const CORE_EVENTS: {
    readonly messageCreated: EventDef;
    readonly chatCreated: EventDef;
    /**
     * A UI action asked for a run (13 §7). Carrying both users is what answers the
     * budget-owner question without a separate rule: **budget and quota attach to the
     * owner; the receipt's attribution records the trigger.** Group chats need no
     * special case.
     */
    readonly uiAction: EventDef;
    /**
     * The path for scheduled model work (13 §7c). No hook may call a Provider (F32),
     * and lifecycle hooks may not trigger pipelines, so nightly summarization
     * subscribes here instead — which also puts it on the consent screen, where a
     * lifecycle hook doing the same work would have been invisible.
     */
    readonly scheduleTick: EventDef;
};
export interface UiActionPayload {
    chatId: string;
    /** Budget and quota attach here. */
    ownerUserId: string;
    /** Attribution records this. May differ from the owner in a group chat. */
    triggeringUserId: string;
    action: string;
    chatType: string;
    input: unknown;
}
//# sourceMappingURL=events.d.ts.map