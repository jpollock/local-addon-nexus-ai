/**
 * Envelope validation (zod). Structural gate at the ledger boundary:
 * nothing enters the ledger without provenance, freshness, and access.
 */
import { z } from 'zod';
import { SOURCE_CLASSES, TRUST_CLASSES, EventEnvelope } from './types';

const ULID_BODY = /^[0-9A-HJKMNP-TV-Z]{16,26}$/;
const iso = z.string().datetime({ offset: true }).or(z.string().datetime());

export const envelopeSchema = z
  .object({
    id: z.string().regex(/^evt_[0-9A-HJKMNP-TV-Z]{16,26}$/),
    recorded_at: iso,
    observed_at: iso,
    topic: z
      .string()
      .regex(/^(state|semantic|procedure|policy|episodic|task|control)\.[a-z0-9_]+\.[a-z0-9_]+$/),
    schema: z.string().regex(/^[a-z0-9_.]+\/[0-9]+$/),
    entity: z.record(z.string().regex(/^ent_[a-z]+_[0-9A-HJKMNP-TV-Z]{16,26}$/)),
    actor: z.object({
      id: z.string().regex(/^act_[a-z0-9_-]+$/i),
      kind: z.enum(['human', 'agent', 'ability', 'system']),
      via: z.string().min(1),
    }),
    source: z.object({
      class: z.enum(SOURCE_CLASSES),
      system: z.string().min(1),
      trust: z.enum(TRUST_CLASSES),
    }),
    access: z.object({
      tenant: z.string().min(1),
      client: z.string().optional(),
      sensitivity: z.enum(['ops', 'content', 'client_confidential', 'security']).optional(),
    }),
    correlation: z
      .string()
      .refine((s) => s.startsWith('task_') && ULID_BODY.test(s.slice(5)), 'task_<ULID>')
      .optional(),
    causation: z
      .string()
      .refine((s) => s.startsWith('evt_') && ULID_BODY.test(s.slice(4)), 'evt_<ULID>')
      .optional(),
    payload: z.record(z.unknown()),
  })
  .strict();

export function validateEnvelope(e: unknown): EventEnvelope {
  return envelopeSchema.parse(e) as EventEnvelope;
}
