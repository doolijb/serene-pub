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
const bySlug = new Map();
let nextId = 1;
export function defineEvent(def) {
    if (bySlug.has(def.slug)) {
        throw new Error(`duplicate event slug '${def.slug}' — slugs are unique because they are the ` +
            `reference used to sync seeded rows across instances (13 §7g)`);
    }
    if (def.family === 'action' && def.causedBy?.length) {
        throw new Error(`action event '${def.slug}' declares causedBy. Action events are requests, not ` +
            `consequences of a write — that is what keeps them out of the cycle graph (13 §7)`);
    }
    const e = { ...def, id: nextId++, ownerPluginId: null };
    bySlug.set(def.slug, e);
    return e;
}
export const getEvent = (slug) => bySlug.get(slug);
export const allEvents = () => [...bySlug.values()];
/**
 * The events the inter-spec cycle CTE reads (F9). Action events are excluded by
 * construction rather than by an exception someone has to remember.
 */
export const cycleRelevantEvents = () => allEvents().filter((e) => e.family === 'data');
export function _clearEvents() {
    bySlug.clear();
    nextId = 1;
}
// ── The closed core set ─────────────────────────────────────────────────────
export const CORE_EVENTS = {
    messageCreated: defineEvent({
        slug: 'message-created',
        version: 1,
        family: 'data',
        affectsUser: true,
        causedBy: ['core:consumer/save-message'],
        description: 'A message was written to a chat.',
    }),
    chatCreated: defineEvent({
        slug: 'chat-created',
        version: 1,
        family: 'data',
        affectsUser: true,
        causedBy: ['core:consumer/create-chat'],
        description: 'A chat was created.',
    }),
    /**
     * A UI action asked for a run (13 §7). Carrying both users is what answers the
     * budget-owner question without a separate rule: **budget and quota attach to the
     * owner; the receipt's attribution records the trigger.** Group chats need no
     * special case.
     */
    uiAction: defineEvent({
        slug: 'ui-action',
        version: 1,
        family: 'action',
        affectsUser: true,
        description: 'Someone asked for a run from the interface — a composer action, a message action, ' +
            'a re-roll. Payload: chatId, ownerUserId, triggeringUserId, action, chatType, input.',
    }),
    /**
     * The path for scheduled model work (13 §7c). No hook may call a Provider (F32),
     * and lifecycle hooks may not trigger pipelines, so nightly summarization
     * subscribes here instead — which also puts it on the consent screen, where a
     * lifecycle hook doing the same work would have been invisible.
     */
    scheduleTick: defineEvent({
        slug: 'schedule-tick',
        version: 1,
        family: 'action',
        affectsUser: false,
        description: 'A declared cadence elapsed. Payload: cadence, scheduledFor, scope.',
    }),
};
//# sourceMappingURL=events.js.map