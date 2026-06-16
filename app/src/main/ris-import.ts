/**
 * Minimal RIS importer — parses `.ris` text (EndNote/Zotero/Mendeley/PubMed
 * export) into BibTeX-shaped records `{ entryType, fields }` ready for the
 * document store to add as entries. Mirrors {@link exportRis}'s tag mapping in
 * reverse; unknown tags are ignored. Multi-valued tags (AU/A2/KW) accumulate.
 */

/** RIS reference type (TY) → BibTeX entry type. */
const BIBTEX_TYPE: Record<string, string> = {
  JOUR: 'article',
  BOOK: 'book',
  CHAP: 'incollection',
  CPAPER: 'inproceedings',
  CONF: 'inproceedings',
  THES: 'phdthesis',
  RPRT: 'techreport',
  UNPB: 'unpublished',
  GEN: 'misc',
};

/** A parsed RIS record in BibTeX shape. */
export interface RisRecord {
  readonly entryType: string;
  readonly fields: Record<string, string>;
}

/**
 * Parse RIS text into records. A record starts at `TY  - ` and ends at `ER  - `.
 * Authors (AU/A1) join with ` and `; editors (A2/ED); keywords (KW) join with
 * `, `; start/end pages (SP/EP) combine into `Pages`.
 */
export function parseRis(text: string): RisRecord[] {
  const records: RisRecord[] = [];
  let cur: { type: string; authors: string[]; editors: string[]; keywords: string[]; fields: Record<string, string>; sp?: string; ep?: string } | null = null;

  const flush = (): void => {
    if (!cur) return;
    const fields = cur.fields;
    if (cur.authors.length) fields['Author'] = cur.authors.join(' and ');
    if (cur.editors.length) fields['Editor'] = cur.editors.join(' and ');
    if (cur.keywords.length) fields['Keywords'] = cur.keywords.join(', ');
    if (cur.sp && cur.ep) fields['Pages'] = `${cur.sp}--${cur.ep}`;
    else if (cur.sp) fields['Pages'] = cur.sp;
    records.push({ entryType: BIBTEX_TYPE[cur.type] ?? 'misc', fields });
    cur = null;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const m = rawLine.match(/^([A-Z][A-Z0-9])  - ?(.*)$/);
    if (!m) continue;
    const tag = m[1]!;
    const value = m[2]!.trim();
    if (tag === 'TY') {
      flush();
      cur = { type: value.toUpperCase(), authors: [], editors: [], keywords: [], fields: {} };
      continue;
    }
    if (!cur) continue;
    if (tag === 'ER') {
      flush();
      continue;
    }
    if (!value) continue;
    switch (tag) {
      case 'AU':
      case 'A1':
        cur.authors.push(value);
        break;
      case 'A2':
      case 'ED':
        cur.editors.push(value);
        break;
      case 'KW':
        cur.keywords.push(value);
        break;
      case 'TI':
      case 'T1':
        cur.fields['Title'] = value;
        break;
      case 'T2':
      case 'JO':
      case 'JF':
        // Journal for articles, Booktitle otherwise — decided at flush by type.
        cur.fields[cur.type === 'JOUR' ? 'Journal' : 'Booktitle'] = value;
        break;
      case 'PY':
      case 'Y1':
        cur.fields['Year'] = value.replace(/^(\d{4}).*/, '$1');
        break;
      case 'VL':
        cur.fields['Volume'] = value;
        break;
      case 'IS':
        cur.fields['Number'] = value;
        break;
      case 'SP':
        cur.sp = value;
        break;
      case 'EP':
        cur.ep = value;
        break;
      case 'PB':
        cur.fields['Publisher'] = value;
        break;
      case 'CY':
        cur.fields['Address'] = value;
        break;
      case 'SN':
        cur.fields['Isbn'] = value;
        break;
      case 'DO':
        cur.fields['Doi'] = value;
        break;
      case 'UR':
        cur.fields['Url'] = value;
        break;
      case 'AB':
      case 'N2':
        cur.fields['Abstract'] = value;
        break;
      default:
        break;
    }
  }
  flush(); // tolerate a missing final ER
  return records;
}
