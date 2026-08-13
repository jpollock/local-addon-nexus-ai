/**
 * Outbound-to-LLM PII scrubber (P1-6).
 *
 * DISTINCT from the audit redactor (mcp/audit.ts), which protects secrets on the path to disk.
 * This masks personal data — emails and IP addresses — on the path OUT to a third-party LLM,
 * so a tool result cannot hand fleet-wide admin/user emails to the model (and a prompt-injected
 * model cannot exfiltrate them). Apply to tool RESULTS that may carry PII (fleet_sql, user
 * lists) before they enter the model context.
 *
 * Masking is intentionally aggressive by default: the model almost never needs a literal email
 * or client IP — it needs counts and presence. A workflow that genuinely needs a real address
 * should be an explicit, scoped opt-in rather than the default.
 */

// Local-part @ domain.tld — deliberately broad; a false positive (masking a non-email token that
// looks like one) is harmless here, a miss is not.
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// Dotted-quad IPv4 with each octet 0–255, so version strings like "8.3.33" (three parts) are not
// matched. A four-part version ("1.2.3.4") is a rare, low-harm false positive.
const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;

/** Replace emails and IPv4 addresses in a string with redaction placeholders. */
export function maskPii(text: string): string {
  if (!text) return text;
  return text
    .replace(EMAIL_RE, '[email redacted]')
    .replace(IPV4_RE, '[ip redacted]');
}

/**
 * Global backstop for the tool-result → LLM path (P0-5). Per-handler masking (fleet_sql,
 * get_account_users, …) is whack-a-mole: any tool NOT hand-instrumented sends its output verbatim
 * to the provider. Instead, apply maskPii to the content of every `tool` message in one place — at
 * the single provider-send site of ChatService and AgentAIClient — so no tool can hand emails/IPs
 * to Anthropic/OpenAI/Google regardless of which handler produced it.
 *
 * Returns a COPY: only the provider-bound messages are masked, so the stored chat session and the
 * agent transcript keep real values (the user still sees an email they explicitly asked for; the
 * provider never receives it). User/assistant/system messages are left untouched — user-typed
 * content is the user's own choice, not harvested site data.
 */
export function maskToolResultsForProvider<M extends { role: string; content?: string | null }>(
  messages: M[],
): M[] {
  return messages.map((m) =>
    m.role === 'tool' && typeof m.content === 'string'
      ? { ...m, content: maskPii(m.content) }
      : m,
  );
}
