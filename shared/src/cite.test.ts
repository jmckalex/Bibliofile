import { describe, it, expect } from 'vitest';
import { formatCiteCommand } from './cite.js';

describe('formatCiteCommand', () => {
  it('expands %K to the comma-joined keys', () => {
    expect(formatCiteCommand('\\cite{%K}', ['a'])).toBe('\\cite{a}');
    expect(formatCiteCommand('\\cite{%K}', ['a', 'b'])).toBe('\\cite{a,b}');
    expect(formatCiteCommand('\\citep{%K}', ['knuth1984'])).toBe('\\citep{knuth1984}');
  });

  it('treats %% as a literal percent and never collides with %K', () => {
    expect(formatCiteCommand('100%% [%K]', ['x'])).toBe('100% [x]');
  });

  it('returns the template unchanged when it has no placeholders', () => {
    expect(formatCiteCommand('\\nocite{*}', ['x'])).toBe('\\nocite{*}');
  });
});
