/**
 * Evaluates a Smart Search filter string against a document data object.
 * Supports: field:value, nested.field:value, AND, OR, NOT, quoted values.
 * Unknown fields → always true (don't reject docs we can't evaluate).
 */
export function matchesFilter(doc: Record<string, any>, filter: string | null | undefined): boolean {
  if (!filter || !filter.trim()) return true;
  try {
    return evaluateExpr(filter.trim(), doc);
  } catch {
    return true; // parse error → don't filter out
  }
}

function evaluateExpr(expr: string, doc: Record<string, any>): boolean {
  // Handle NOT prefix
  if (expr.startsWith('NOT ')) {
    return !evaluateExpr(expr.slice(4).trim(), doc);
  }

  // Split on top-level AND (not inside quotes)
  const andParts = splitTopLevel(expr, ' AND ');
  if (andParts.length > 1) {
    return andParts.every(p => evaluateExpr(p.trim(), doc));
  }

  // Split on top-level OR
  const orParts = splitTopLevel(expr, ' OR ');
  if (orParts.length > 1) {
    return orParts.some(p => evaluateExpr(p.trim(), doc));
  }

  // Base: field:value or field:"quoted value"
  const colonIdx = expr.indexOf(':');
  if (colonIdx === -1) return true;

  const field = expr.slice(0, colonIdx).trim();
  const value = expr.slice(colonIdx + 1).trim().replace(/^"(.*)"$/, '$1');

  const docValue = getNestedField(doc, field);
  if (docValue === undefined) return true; // unknown field → pass

  return fieldMatches(docValue, value);
}

function fieldMatches(docValue: any, filterValue: string): boolean {
  if (Array.isArray(docValue)) {
    return docValue.some(item =>
      typeof item === 'object'
        ? Object.values(item).some(v => String(v).toLowerCase() === filterValue.toLowerCase())
        : String(item).toLowerCase() === filterValue.toLowerCase(),
    );
  }
  return String(docValue).toLowerCase() === filterValue.toLowerCase();
}

function getNestedField(obj: Record<string, any>, path: string): any {
  const parts = path.split('.');
  let cur: any = obj;
  for (const part of parts) {
    if (cur === undefined || cur === null) return undefined;
    if (Array.isArray(cur)) {
      cur = cur.map(item => (typeof item === 'object' ? item[part] : undefined));
    } else {
      cur = cur[part];
    }
  }
  return cur;
}

function splitTopLevel(expr: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inQuote = false;
  let start = 0;

  for (let i = 0; i < expr.length; i++) {
    if (expr[i] === '"') inQuote = !inQuote;
    if (!inQuote && expr[i] === '(') depth++;
    if (!inQuote && expr[i] === ')') depth--;
    if (!inQuote && depth === 0 && expr.slice(i, i + separator.length) === separator) {
      parts.push(expr.slice(start, i));
      start = i + separator.length;
      i += separator.length - 1;
    }
  }
  parts.push(expr.slice(start));
  return parts;
}
