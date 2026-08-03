/**
 * CLI target parsing. Thin adapter over src/common/target.ts that defaults to
 * verbose, actionable error messages. The implementation lives in common/ so
 * the CLI and the GraphQL server cannot drift apart again.
 */
import {
  parseTarget as parseTargetShared,
  requireLocalTarget as requireLocalTargetShared,
  requireWpeTarget as requireWpeTargetShared,
  formatTarget,
} from '../../common/target';

export type { ParsedTarget, TargetEnvironment } from '../../common/target';
export { formatTarget };

export function parseTarget(target: string) {
  return parseTargetShared(target, { verboseErrors: true });
}

export function requireLocalTarget(target: string) {
  return requireLocalTargetShared(target, { verboseErrors: true });
}

export function requireWpeTarget(target: string) {
  return requireWpeTargetShared(target, { verboseErrors: true });
}
