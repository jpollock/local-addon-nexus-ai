/**
 * Emission middleware — the loop's write side, made structural.
 *
 * Producers (observers, gateway tool wrappers) hand over an EventDraft;
 * the emitter fills id, recorded_at, and actor.via from host ports, validates,
 * and appends. Agents never have to "remember" to emit — anything acting
 * through wrapped tooling emits by construction (model: closed loop).
 */
import { Ledger } from '../ledger/ledger';
import { EventDraft, EventEnvelope } from '../envelope/types';
import { eventId } from '../envelope/ulid';
import { ClockPort, IdentityPort } from '../host/ports';

export interface Emitter {
  emit<P extends Record<string, unknown>>(draft: EventDraft<P>): EventEnvelope<P>;
}

export function createEmitter(deps: {
  ledger: Ledger;
  clock: ClockPort;
  identity: IdentityPort;
}): Emitter {
  const { ledger, clock, identity } = deps;
  return {
    emit<P extends Record<string, unknown>>(draft: EventDraft<P>): EventEnvelope<P> {
      const now = clock.now();
      const envelope: EventEnvelope<P> = {
        ...draft,
        id: eventId(now.getTime()),
        recorded_at: now.toISOString(),
        actor: { ...draft.actor, via: draft.actor.via ?? identity.via() },
        access: { ...draft.access, tenant: draft.access?.tenant ?? identity.tenant() },
      };
      ledger.append(envelope as EventEnvelope);
      return envelope;
    },
  };
}
