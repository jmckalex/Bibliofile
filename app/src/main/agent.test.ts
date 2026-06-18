/**
 * Agent turn-loop tests — drive {@link runAgentTurn} with a scripted fake model,
 * a fake tool executor, and a fake approver. No network, no Electron.
 */

import { describe, it, expect, vi } from 'vitest';
import { runAgentTurn, AGENT_TOOLS, type AgentDeps } from './agent.js';

function deps(partial: Partial<AgentDeps>): AgentDeps {
  return {
    model: 'test-model',
    callModel: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    executeTool: () => 'tool-result',
    approve: () => true,
    ...partial,
  };
}

describe('runAgentTurn', () => {
  it('returns the assistant text when no tools are used', async () => {
    const messages: unknown[] = [{ role: 'user', content: 'hi' }];
    const res = await runAgentTurn(messages, deps({ callModel: async () => ({ content: [{ type: 'text', text: 'hello there' }] }) }));
    expect(res.reply).toBe('hello there');
    expect(res.mutated).toBe(false);
    expect(res.toolLog).toEqual([]);
  });

  it('executes a read tool then returns the follow-up text', async () => {
    const messages: any[] = [{ role: 'user', content: 'list' }];
    let round = 0;
    const res = await runAgentTurn(messages, deps({
      callModel: async () => {
        round++;
        return round === 1
          ? { content: [{ type: 'tool_use', id: 't1', name: 'list_entries', input: {} }] }
          : { content: [{ type: 'text', text: 'there are 2 entries' }] };
      },
      executeTool: (name) => `executed ${name}`,
    }));
    expect(res.reply).toBe('there are 2 entries');
    expect(res.toolLog).toEqual(['• list_entries']);
    // the conversation captured the tool_result that was fed back to the model
    const toolResult = messages
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .find((c) => c?.type === 'tool_result');
    expect(toolResult).toMatchObject({ tool_use_id: 't1', content: 'executed list_entries' });
  });

  it('gates a mutating tool on approval — denied does not execute', async () => {
    const exec = vi.fn(() => 'done');
    let round = 0;
    const res = await runAgentTurn([{ role: 'user', content: 'delete x' }], deps({
      callModel: async () => {
        round++;
        return round === 1
          ? { content: [{ type: 'tool_use', id: 't1', name: 'delete_entry', input: { citeKey: 'x' } }] }
          : { content: [{ type: 'text', text: 'ok, left it alone' }] };
      },
      executeTool: exec,
      approve: () => false, // user denies
    }));
    expect(exec).not.toHaveBeenCalled();
    expect(res.mutated).toBe(false);
    expect(res.toolLog).toEqual(['✗ delete_entry (declined)']);
  });

  it('runs a mutating tool when approved and flags mutated', async () => {
    const exec = vi.fn(() => 'deleted x');
    let round = 0;
    const res = await runAgentTurn([{ role: 'user', content: 'delete x' }], deps({
      callModel: async () => {
        round++;
        return round === 1
          ? { content: [{ type: 'tool_use', id: 't1', name: 'delete_entry', input: { citeKey: 'x' } }] }
          : { content: [{ type: 'text', text: 'done' }] };
      },
      executeTool: exec,
      approve: () => true,
    }));
    expect(exec).toHaveBeenCalledOnce();
    expect(res.mutated).toBe(true);
    expect(res.toolLog).toEqual(['✓ delete_entry']);
  });

  it('surfaces a model error', async () => {
    const res = await runAgentTurn([{ role: 'user', content: 'hi' }], deps({
      callModel: async () => ({ error: { message: 'HTTP 401: bad key' } }),
    }));
    expect(res.error).toMatch(/401/);
  });

  it('every mutating tool is declared in the catalogue', () => {
    const mutating = AGENT_TOOLS.filter((t) => t.mutating).map((t) => t.name);
    expect(mutating).toEqual([
      'set_field',
      'add_entry',
      'delete_entry',
      'generate_cite_key',
      'regenerate_cite_keys',
      'batch_set_field',
    ]);
  });
});
