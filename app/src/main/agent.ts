/**
 * The Claude scripting assistant — a Folio-style in-app agent whose tools are the
 * BibDesk data-model operations (the same surface as `@bibdesk/plugins-sdk`). The
 * model can read the library freely; every MUTATION is gated on explicit user
 * approval. This module holds the provider-agnostic turn loop + tool schema; the
 * Electron glue (the user's API key via `safeStorage`, the real HTTPS call, and
 * the approval dialog) lives in `index.ts` and is injected here so the loop stays
 * pure and unit-testable.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A tool the assistant can call. `mutating` tools require user approval. */
export interface AgentTool {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Record<string, any>;
  readonly mutating: boolean;
}

/** The tool catalogue exposed to the model (read freely; mutations need approval). */
export const AGENT_TOOLS: readonly AgentTool[] = [
  {
    name: 'list_entries',
    description: 'List all entries in the open library as "citeKey — title (type, year)" lines.',
    input_schema: { type: 'object', properties: {} },
    mutating: false,
  },
  {
    name: 'get_entry',
    description: 'Get all fields of one entry by its cite key.',
    input_schema: {
      type: 'object',
      properties: { citeKey: { type: 'string' } },
      required: ['citeKey'],
    },
    mutating: false,
  },
  {
    name: 'search',
    description: 'Full-text/substring search the library; returns matching cite keys + titles.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
    mutating: false,
  },
  {
    name: 'find_duplicates',
    description: 'Find duplicate entries (identical cite keys or equivalent content).',
    input_schema: { type: 'object', properties: {} },
    mutating: false,
  },
  {
    name: 'export',
    description: 'Serialize the library (or a list of cite keys) to text.',
    input_schema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['bibtex', 'ris', 'csv', 'html'] },
        citeKeys: { type: 'array', items: { type: 'string' } },
      },
      required: ['format'],
    },
    mutating: false,
  },
  {
    name: 'set_field',
    description: 'Set (or clear, with an empty value) a field on an entry. MUTATES the library.',
    input_schema: {
      type: 'object',
      properties: {
        citeKey: { type: 'string' },
        field: { type: 'string' },
        value: { type: 'string' },
      },
      required: ['citeKey', 'field', 'value'],
    },
    mutating: true,
  },
  {
    name: 'add_entry',
    description: 'Add a new entry of the given BibTeX type with the given fields. MUTATES.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        fields: { type: 'object', additionalProperties: { type: 'string' } },
      },
      required: ['type', 'fields'],
    },
    mutating: true,
  },
  {
    name: 'delete_entry',
    description: 'Delete the entry with the given cite key. MUTATES the library.',
    input_schema: {
      type: 'object',
      properties: { citeKey: { type: 'string' } },
      required: ['citeKey'],
    },
    mutating: true,
  },
  {
    name: 'generate_cite_key',
    description: "Regenerate one entry's cite key from the configured format. MUTATES.",
    input_schema: {
      type: 'object',
      properties: { citeKey: { type: 'string' } },
      required: ['citeKey'],
    },
    mutating: true,
  },
  {
    name: 'regenerate_cite_keys',
    description:
      'Bulk-regenerate cite keys from the configured format for MANY entries in ONE call ' +
      '(omit `citeKeys` to do the WHOLE library). One approval, one undo step. ' +
      'Always prefer this over calling generate_cite_key once per entry. MUTATES.',
    input_schema: {
      type: 'object',
      properties: { citeKeys: { type: 'array', items: { type: 'string' } } },
    },
    mutating: true,
  },
  {
    name: 'batch_set_field',
    description:
      'Set (or clear, with an empty value) a field on MANY entries in ONE call ' +
      '(omit `citeKeys` to do the WHOLE library). One approval, one undo step. ' +
      'Always prefer this over calling set_field once per entry. MUTATES.',
    input_schema: {
      type: 'object',
      properties: {
        field: { type: 'string' },
        value: { type: 'string' },
        citeKeys: { type: 'array', items: { type: 'string' } },
      },
      required: ['field'],
    },
    mutating: true,
  },
];

const MUTATING = new Set(AGENT_TOOLS.filter((t) => t.mutating).map((t) => t.name));

/** System prompt establishing the assistant's role + safety posture. */
export const AGENT_SYSTEM_PROMPT = [
  'You are the BibDesk Assistant, embedded in a BibTeX reference manager.',
  'You help the user inspect and tidy their bibliography and write small scripts.',
  'Use the provided tools to read the open library; prefer reading before acting.',
  'For any change that affects MANY entries, ALWAYS use the bulk tools',
  '(regenerate_cite_keys, batch_set_field) in a single call — do NOT loop the',
  'per-entry tools (set_field, generate_cite_key) across the whole library; that is',
  'slow and wastes tokens. Omit the citeKeys argument to act on every entry.',
  'Mutating tools require the user\'s approval, which the app will ask for — explain',
  'what you intend (and roughly how many entries it affects) before calling them.',
  'Be concise. When you change the library, summarize exactly what changed.',
].join(' ');

/** One assistant turn result returned to the renderer. */
export interface AgentResult {
  /** The assistant's final text reply. */
  readonly reply: string;
  /** A human-readable log of tool calls made this turn. */
  readonly toolLog: readonly string[];
  /** True if any approved mutation ran (so the renderer should reload). */
  readonly mutated: boolean;
  readonly error?: string;
}

/** Injected side-effects (kept out of this pure module). */
export interface AgentDeps {
  /** Call the model with a request body; resolve its JSON response. */
  callModel: (body: any) => Promise<any>;
  /** Execute a read/mutating tool; resolve a string result for the model. */
  executeTool: (name: string, input: any) => Promise<string> | string;
  /** Ask the user to approve a mutating tool call. */
  approve: (name: string, input: any) => Promise<boolean> | boolean;
  readonly model: string;
  /** Safety cap on tool-use rounds. */
  readonly maxRounds?: number;
}

/** Extract the concatenated text from an assistant content array. */
function textOf(content: any[]): string {
  return content
    .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n')
    .trim();
}

/**
 * Run one assistant turn: send the conversation, satisfy any tool calls (gating
 * mutations on approval), and loop until the model stops requesting tools.
 * `messages` is the running Anthropic-format history; it is mutated in place so
 * the caller can persist the full transcript.
 */
export async function runAgentTurn(messages: any[], deps: AgentDeps): Promise<AgentResult> {
  const toolLog: string[] = [];
  let mutated = false;
  const maxRounds = deps.maxRounds ?? 12;

  for (let round = 0; round < maxRounds; round++) {
    const resp = await deps.callModel({
      model: deps.model,
      max_tokens: 2048,
      system: AGENT_SYSTEM_PROMPT,
      tools: AGENT_TOOLS.map(({ name, description, input_schema }) => ({
        name,
        description,
        input_schema,
      })),
      messages,
    });

    if (resp?.type === 'error' || resp?.error) {
      return { reply: '', toolLog, mutated, error: resp.error?.message ?? 'Model error' };
    }

    const content: any[] = Array.isArray(resp?.content) ? resp.content : [];
    messages.push({ role: 'assistant', content });

    const toolUses = content.filter((c) => c && c.type === 'tool_use');
    if (toolUses.length === 0) {
      return { reply: textOf(content), toolLog, mutated };
    }

    const results: any[] = [];
    for (const tu of toolUses) {
      const { id, name, input } = tu;
      let result: string;
      if (MUTATING.has(name)) {
        const ok = await deps.approve(name, input);
        if (!ok) {
          result = 'The user declined this change.';
          toolLog.push(`✗ ${name} (declined)`);
        } else {
          result = await deps.executeTool(name, input);
          mutated = true;
          toolLog.push(`✓ ${name}`);
        }
      } else {
        result = await deps.executeTool(name, input);
        toolLog.push(`• ${name}`);
      }
      results.push({ type: 'tool_result', tool_use_id: id, content: result });
    }
    messages.push({ role: 'user', content: results });
  }

  return {
    reply: 'Stopped after the maximum number of tool rounds.',
    toolLog,
    mutated,
    error: 'max_rounds',
  };
}
