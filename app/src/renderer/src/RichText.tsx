/**
 * Renders the tiny inline markup that translatable hint strings are allowed to
 * carry: `**bold**`, `*italic*` and `` `code` ``.
 *
 * Why this exists (audit rpt-03 MED-7 / LOW-8): the Preferences hints document
 * format mini-languages — `%p[/][/etal1]2:%Y%u0`, `{{#each entries}}`, `%p1/%T5`
 * — so they genuinely need `<code>` runs. The two obvious ways to keep them are
 * both wrong: leaving the paragraphs as literal JSX keeps them out of the locale
 * system entirely, and splitting a sentence into one key per formatted run makes
 * it untranslatable, since word order differs per language. One key per sentence
 * plus this three-marker convention keeps the formatting AND the translatability.
 *
 * Builds React elements and never uses `dangerouslySetInnerHTML`, so a catalog
 * string cannot inject markup.
 *
 * Deliberately not Markdown: a lone `*` in prose ("a * b") is left alone because
 * both markers require a matching pair, but a sentence with two stray asterisks
 * would italicise between them. That is fine for strings we control; do not point
 * this at user data.
 */

/** Bold / italic / code runs, matched longest-marker-first. */
const RUN = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;

/** Render a translated string, honouring `**bold**`, `*italic*` and `` `code` ``. */
export function Rich({ text }: { text: string }) {
  // String.split with a capturing group keeps the delimiters, so the result
  // alternates plain text and marked runs.
  const parts = text.split(RUN);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={i}>{part.slice(1, -1)}</code>;
        }
        if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) {
          return <em key={i}>{part.slice(1, -1)}</em>;
        }
        return part;
      })}
    </>
  );
}
