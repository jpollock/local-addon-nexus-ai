/**
 * WP-26 · the approval card for a strict runbook's approval checkpoint.
 *
 * The card is the ONLY producer of `canary_policy`, so what it offers and how
 * it labels it is the whole contract. Four rules it must not break:
 *
 *  - **It computes nothing.** Every fact on it comes from the `procedure` block
 *    the platform emitted. A renderer that derived checkpoint state would be
 *    the exact failure `procedureView.ts` exists to prevent (P7).
 *  - **The default is LABELLED as the default.** Rendering "pause after the
 *    canary" as though the human had chosen it is fabricated consent — the
 *    same class of error as ticking a narrative checkpoint, on the field where
 *    the user's own decision is the subject.
 *  - **Deny is final, and the card says so** (`c.denial-is-final`).
 *  - **Controlled Vocabulary v1.1.** "runbook", "checkpoint", "canary"; and
 *    never the word *verified* about a checkpoint — verify belongs to the live
 *    check alone.
 */
import * as React from 'react';
import { ProcedureApprovalCard } from '../../../src/renderer/components/DockedPanel/ProcedureApprovalCard';
import { PanelChat } from '../../../src/renderer/components/DockedPanel/PanelChat';
import { serializeTree } from './helpers/serializeTree';

const PROCEDURE = {
  runbookId: 'rb.bulk-plugin-update',
  version: '1.0.0',
  strictness: 'strict' as const,
  checkpointId: 'cp.approval',
  offersCanaryPolicy: true,
};

function card(props: Record<string, unknown> = {}): any {
  return new (ProcedureApprovalCard as any)({
    title: 'Bulk Plugin Update',
    effect: 'Updates plugins on the sites in the plan.',
    warning: 'Runbook rb.bulk-plugin-update v1.0.0, marked strict — checkpoint cp.approval.',
    procedure: PROCEDURE,
    onApprove: jest.fn(),
    onDeny: jest.fn(),
    ...props,
  });
}

/** Every text node in a serialized tree, in order. */
function texts(node: any, out: string[] = []): string[] {
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  const children = Array.isArray(node) ? node : (node.children ?? node.props?.children);
  const kids = Array.isArray(children) ? children : [children];
  for (const k of kids) texts(k, out);
  return out;
}

const render = (instance: any) => texts(serializeTree(instance.render())).join(' ');

describe('the plan reference', () => {
  it('names the runbook, its version and that it is marked strict', () => {
    const text = render(card());
    expect(text).toContain('rb.bulk-plugin-update');
    expect(text).toContain('1.0.0');
    expect(text).toMatch(/marked strict/i);
  });

  it('names the checkpoint this approval attests', () => {
    expect(render(card())).toContain('cp.approval');
  });

  it('never says a checkpoint is verified — that word belongs to the live check', () => {
    expect(render(card())).not.toMatch(/verif/i);
  });
});

describe('the canary policy', () => {
  it('offers both values from the platform vocabulary', () => {
    const text = render(card());
    expect(text).toMatch(/canary/i);
    expect(text).toMatch(/pause/i);
    expect(text).toMatch(/continue/i);
  });

  it('labels the default AS the default, so the platform is not putting a choice in the user\'s mouth', () => {
    expect(render(card())).toMatch(/\(default\)/i);
  });

  it('starts on pause-after-canary', () => {
    expect(card().state.canaryPolicy).toBe('pause-after-canary');
  });

  it('approving hands back the policy that is selected', () => {
    const onApprove = jest.fn();
    const instance = card({ onApprove });
    instance.setState = (patch: any) => Object.assign(instance.state, patch);

    instance.choosePolicy('continue-if-clean');
    instance.approve();

    expect(onApprove).toHaveBeenCalledWith('continue-if-clean');
  });

  it('a runbook that declares no canary is offered no policy, and approving carries none', () => {
    const onApprove = jest.fn();
    const instance = card({
      procedure: { ...PROCEDURE, offersCanaryPolicy: false },
      onApprove,
    });

    expect(render(instance)).not.toMatch(/canary/i);
    instance.approve();
    expect(onApprove).toHaveBeenCalledWith(undefined);
  });
});

describe('denial', () => {
  it('says the denial is final for this chat', () => {
    const text = render(card());
    expect(text).toMatch(/deny/i);
    expect(text).toMatch(/won'?t be proposed again|ends this runbook/i);
  });

  it('denying carries no policy — there is no canary to have a policy about', () => {
    const onDeny = jest.fn();
    const instance = card({ onDeny });
    instance.deny();
    expect(onDeny).toHaveBeenCalledWith();
  });
});

// ---------------------------------------------------------------------------

describe('PanelChat routing — parity is the first requirement', () => {
  function chat(): any {
    return new (PanelChat as any)({
      electron: {
        ipcRenderer: { invoke: jest.fn().mockResolvedValue(null), on: jest.fn(), removeListener: jest.fn() },
      },
      sessionId: 's1',
      selectedSiteIds: [],
      visible: true,
      onSessionCreated: jest.fn(),
      onSessionSaved: jest.fn(),
      onStreamingStatusChange: jest.fn(),
    });
  }

  const message = (procedure?: unknown) => ({
    id: 'm1',
    role: 'assistant' as const,
    content: '',
    streaming: false,
    toolCalls: [
      { id: 't1', name: 'bulk_plugin_update', args: '', status: 'awaiting_approval', ...(procedure ? { procedure } : {}) },
    ],
  });

  it('an ordinary approval still renders the ActionCard it always did', () => {
    const tree = JSON.stringify(serializeTree(chat().renderMessage(message()) as any));
    expect(tree).toContain('ActionCard');
    expect(tree).not.toContain('ProcedureApprovalCard');
  });

  it('a procedure approval renders the procedure card instead', () => {
    const tree = JSON.stringify(serializeTree(chat().renderMessage(message(PROCEDURE)) as any));
    expect(tree).toContain('ProcedureApprovalCard');
  });

  it('the stream event carries the procedure block onto the tool call', () => {
    const instance = chat();
    instance.state = { ...instance.state, streamingId: 'm1', messages: [message()] };
    instance.setState = (fn: any) =>
      Object.assign(instance.state, typeof fn === 'function' ? fn(instance.state) : fn);

    instance.onStreamEvent({ type: 'tool_call_approval_needed', id: 't1', procedure: PROCEDURE });

    expect(instance.state.messages[0].toolCalls[0].procedure).toEqual(PROCEDURE);
  });

  it('approving sends the chosen policy through the approval channel', () => {
    const instance = chat();
    instance.state = { ...instance.state, activeSessionId: 's1' };

    instance.handleApprove('t1', 'continue-if-clean');

    const call = instance.props.electron.ipcRenderer.invoke.mock.calls.at(-1);
    expect(call.slice(1)).toEqual(['s1', 't1', true, 'continue-if-clean']);
  });

  it('an ordinary approval sends no policy — the argument stays absent', () => {
    const instance = chat();
    instance.state = { ...instance.state, activeSessionId: 's1' };

    instance.handleApprove('t1');

    const call = instance.props.electron.ipcRenderer.invoke.mock.calls.at(-1);
    expect(call.slice(1)).toEqual(['s1', 't1', true]);
  });
});
