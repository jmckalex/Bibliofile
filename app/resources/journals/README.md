# Philosophy Journals Metadata Index

`philosophy.json` is a de-duplicated metadata index of philosophy journals, used as
the source of truth for the journal-thumbnail / cover-display feature.

**This file contains METADATA ONLY. Cover images are intentionally NOT included here**
and are sourced separately (a later cover-fetch step uses `homepageUrl` as a starting
point).

## Data sources

- **OpenAlex** (<https://openalex.org>) — primary source. Sources of `type:journal`
  matching `search=philosophy`. OpenAlex data is released under **CC0** (public domain).
  Captured fields: `display_name`, `issn_l`, `issn`, `host_organization_name`
  (publisher), `homepage_url`, and the OpenAlex source `id`.
- **Crossref** (<https://www.crossref.org>) — cross-check / supplement. The
  `/journals?query=philosophy` endpoint was used to catch journals OpenAlex labels
  differently and to enrich publisher/ISSN data. Records were merged into the OpenAlex
  set by shared ISSN (or title); Crossref-only journals were added as new entries.

Both APIs were queried via the "polite pool" (`mailto=jmckalex@gmail.com`).

## Date

Compiled 2026-06-17.

## Record schema

`philosophy.json` is a JSON array, sorted by `name` (case-insensitive). Each element:

```jsonc
{
  "name":        string,           // journal display name
  "issnL":       string | null,    // linking ISSN (ISSN-L); null if unknown
  "issn":        string[],         // all known ISSNs (print + electronic), upper-cased
  "publisher":   string | null,    // host organization / publisher name
  "homepageUrl": string | null,    // journal homepage, when known
  "openAlexId":  string | null     // OpenAlex source id (e.g. https://openalex.org/S123...)
}
```

De-duplication is by `issnL` where available, falling back to a lowercased `name` and
to any shared ISSN across the two sources.

## Regenerating

The index can be rebuilt by re-querying the two endpoints above:

- OpenAlex: `https://api.openalex.org/sources?search=philosophy&filter=type:journal&per_page=200&cursor=*&mailto=jmckalex@gmail.com`
  (paginate via `meta.next_cursor`).
- Crossref: `https://api.crossref.org/journals?query=philosophy&rows=100&offset=0&mailto=jmckalex@gmail.com`
  (paginate via `offset`).

Then merge by ISSN-L / ISSN / name and sort by name.
