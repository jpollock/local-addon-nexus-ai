/**
 * WP-54 · ITEM 7 — THE PUNCTUATION APPENDER, FIXED AS A CLASS.
 *
 * The Now row's door shipped as **"Open where you are needed."** while every
 * ratified drawing of it carries no full stop. The designer's framing is the
 * one adopted, and it is better than the architect's: *the fixture has no full
 * stop, so the render is APPENDING one — which means it is appending one to
 * every door string.* The defect is the appender, not the string.
 *
 * WHERE THE APPENDER ACTUALLY IS, measured rather than assumed. Nothing at
 * render time adds a period. `generate-return-copy.ts` extracts the door out of
 * a markdown SENTENCE —
 *
 *     Door: *Open where you are needed.*
 *
 * — and the sentence's own terminator came through the capture with it. So the
 * appender is the extraction, and every control label either generator emits
 * now passes through this one function. A door added tomorrow, out of prose
 * written tomorrow, cannot reintroduce it.
 *
 * DELIBERATELY NARROW. It strips ONE trailing period and nothing else:
 *
 *  - an ellipsis is a control's own punctuation ("Choose a site…") and survives;
 *  - a label that is a whole sentence is a design defect, and trimming more
 *    would hide it rather than surface it;
 *  - nothing is trimmed from the front, and no other terminator is touched — a
 *    control ending in "?" is asking something, which is a different decision
 *    and belongs to whoever wrote it.
 *
 * It lives in its own module because it is ONE RULE and there are TWO
 * generators; a copy in each is the second place a rule can drift, which is the
 * class of defect this whole generator family exists to remove.
 */
export function controlLabel(value: string): string {
  if (value.endsWith('...') || value.endsWith('…')) return value;
  return value.replace(/\.$/, '');
}
