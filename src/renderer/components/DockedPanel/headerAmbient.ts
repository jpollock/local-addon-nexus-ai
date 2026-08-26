/**
 * The needs-you count's only home (new-chat sheet, 16:09 ruling).
 *
 * The queue verdict was removed from the chat's opening — the count stays
 * "available as a door at ambient weight in the header, where it cannot be
 * mistaken for the subject". This module derives that door for the container;
 * DockedPanel only renders what arrives.
 *
 * Null is the common and honest case:
 *  - zero waiting — an ambient line for zero is noise;
 *  - count unknown — withheld, never guessed;
 *  - a conversation in progress — board C's header carries the conversation,
 *    not the queue; the subject has arrived and the count would compete with it.
 */
import { NEW_CHAT_AMBIENT } from './newChatCopy.generated';

export interface HeaderAmbient {
  /** "9 things need you" — rendered at stage width only. */
  line: string;
  /** The ratified door label ("Open Now"), rendered at every width. */
  door: string;
  onOpen: () => void;
}

export function deriveAmbient(
  needsYou: number | null,
  activeSessionId: string | null,
  onOpen: () => void,
): HeaderAmbient | null {
  if (needsYou == null || needsYou <= 0) return null;
  if (activeSessionId !== null) return null;
  return {
    line: needsYou === 1 ? '1 thing needs you' : `${needsYou} things need you`,
    door: NEW_CHAT_AMBIENT.door,
    onOpen,
  };
}
