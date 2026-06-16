/**
 * A minimal port of the subset of `NSScanner` behavior `BDSKFormatParser` uses,
 * with `charactersToBeSkipped` set to nil (no auto-skip), matching the parser.
 */
export class Scanner {
  private readonly s: string;
  private loc = 0;

  constructor(s: string) {
    this.s = s;
  }

  get location(): number {
    return this.loc;
  }
  set location(n: number) {
    this.loc = n;
  }
  get length(): number {
    return this.s.length;
  }
  isAtEnd(): boolean {
    return this.loc >= this.s.length;
  }

  /** Peek the next code unit without advancing; returns -1 at end. */
  peek(): number {
    return this.loc < this.s.length ? this.s.charCodeAt(this.loc) : -1;
  }

  /** Scan one code unit; returns it (as number) or undefined at end. */
  scanCharacter(): number | undefined {
    if (this.isAtEnd()) return undefined;
    return this.s.charCodeAt(this.loc++);
  }

  /** If the upcoming text equals `literal`, consume it and return true. */
  scanString(literal: string): boolean {
    if (this.s.startsWith(literal, this.loc)) {
      this.loc += literal.length;
      return true;
    }
    return false;
  }

  /**
   * Scan up to (but not including) the first occurrence of `literal`. Returns
   * the scanned text, or undefined if nothing was scanned (cursor already at the
   * literal or at end). The cursor stops before `literal` (or at end).
   */
  scanUpToString(literal: string): string | undefined {
    const idx = this.s.indexOf(literal, this.loc);
    const end = idx === -1 ? this.s.length : idx;
    if (end === this.loc) return undefined;
    const out = this.s.slice(this.loc, end);
    this.loc = end;
    return out;
  }

  /**
   * Scan up to the first code unit for which `pred` is true. Returns the scanned
   * text, or undefined if nothing was scanned.
   */
  scanUpToCharacters(pred: (c: number) => boolean): string | undefined {
    const start = this.loc;
    while (this.loc < this.s.length && !pred(this.s.charCodeAt(this.loc))) {
      this.loc++;
    }
    return this.loc === start ? undefined : this.s.slice(start, this.loc);
  }

  /** Scan a run of characters for which `pred` is true. Undefined if none. */
  scanCharactersFromSet(pred: (c: number) => boolean): string | undefined {
    const start = this.loc;
    while (this.loc < this.s.length && pred(this.s.charCodeAt(this.loc))) {
      this.loc++;
    }
    return this.loc === start ? undefined : this.s.slice(start, this.loc);
  }

  /**
   * Scan a non-negative integer. On success returns the value and advances;
   * otherwise returns undefined and does not advance. Mirrors
   * `scanUnsignedInteger:` (no sign, leading digits only).
   */
  scanUnsignedInteger(): number | undefined {
    let i = this.loc;
    let digits = '';
    while (i < this.s.length && isDigit(this.s.charCodeAt(i))) {
      digits += this.s[i];
      i++;
    }
    if (digits.length === 0) return undefined;
    this.loc = i;
    return parseInt(digits, 10);
  }
}

export function isDigit(c: number): boolean {
  return c >= 0x30 && c <= 0x39;
}
