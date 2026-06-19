/**
 * "Download Missing Journal Covers" review dialog (Tools menu). Scans the open
 * library for journals with no cover, fetches a candidate image from Wikipedia
 * for each, and shows them for approval. Wikipedia matching is fuzzy, so nothing
 * is saved until the user confirms; rejected/wrong ones are simply unchecked (and
 * can always be fixed later by dropping an image onto the cover).
 */
import { useEffect, useState } from 'react';
import type { JournalCoverProposal } from '@bibdesk/shared';
import { useStore } from './store.js';
import { useT } from './i18n.js';
import { Icon } from './icons.js';

interface Reviewable extends JournalCoverProposal {
  selected: boolean;
  /** Object URL for the proposal's image bytes (revoked on unmount). */
  url: string;
}

export function JournalCoverScan({ onClose }: { onClose: () => void }) {
  const t = useT();
  const documentId = useStore((s) => s.documentId);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<Reviewable[]>([]);
  const [missing, setMissing] = useState(0);
  const [capped, setCapped] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    void (async () => {
      if (!documentId) {
        setLoading(false);
        return;
      }
      const res = await window.bibdesk?.scanJournalCovers({ documentId });
      if (cancelled || !res) {
        setLoading(false);
        return;
      }
      setItems(
        res.proposals.map((p) => {
          const url = URL.createObjectURL(new Blob([p.data as BlobPart]));
          urls.push(url);
          return { ...p, selected: true, url };
        }),
      );
      setMissing(res.missing);
      setCapped(Boolean(res.capped));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [documentId]);

  const toggle = (i: number): void =>
    setItems((arr) => arr.map((p, j) => (j === i ? { ...p, selected: !p.selected } : p)));
  const selectedCount = items.filter((p) => p.selected).length;

  const save = async (): Promise<void> => {
    if (!documentId) return;
    setSaving(true);
    await window.bibdesk?.saveJournalCovers({
      documentId,
      covers: items
        .filter((p) => p.selected)
        .map((p) => ({
          journal: p.journal,
          ...(p.issn ? { issn: p.issn } : {}),
          data: p.data,
          ext: p.ext,
          sourceUrl: p.sourceUrl,
          wikiTitle: p.wikiTitle,
        })),
    });
    setSaving(false);
    onClose();
  };

  // Non-blocking: a floating panel with no backdrop, so the library stays usable
  // while the (network-bound) scan runs and during review.
  return (
    <div className="bd-modal bd-modal--wide bd-modal--float" role="dialog" aria-label={t('covers.title')}>
      <div className="bd-modal__header">
          <span>{t('covers.title')}</span>
          <button type="button" className="bd-field__del" title={t('common.close')} onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="bd-modal__body">
          {loading ? (
            <p className="bd-modal__empty">{t('covers.scanning')}</p>
          ) : items.length === 0 ? (
            <p className="bd-modal__empty">
              {missing === 0 ? t('covers.allHaveCovers') : t('covers.noneFound')}
            </p>
          ) : (
            <>
              <p className="bd-prefs__hint">
                {t('covers.found', { found: items.length, missing })}
                {capped ? ` ${t('covers.capped')}` : ''} {t('covers.reviewHint')}
              </p>
              <div className="bd-covers__grid">
                {items.map((p, i) => (
                  <label
                    key={p.journal}
                    className={'bd-covers__item' + (p.selected ? ' bd-covers__item--on' : '')}
                  >
                    <input type="checkbox" checked={p.selected} onChange={() => toggle(i)} />
                    <img className="bd-covers__img" src={p.url} alt="" />
                    <span className="bd-covers__journal" title={p.journal}>
                      {p.journal}
                    </span>
                    <span className="bd-covers__src" title={p.sourceUrl}>
                      {p.wikiTitle}
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
        {items.length > 0 && (
          <div className="bd-modal__footer">
            <button type="button" className="bd-btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="bd-btn bd-btn--primary"
              disabled={saving || selectedCount === 0}
              onClick={() => void save()}
            >
              {t('covers.save', { count: selectedCount })}
            </button>
          </div>
        )}
    </div>
  );
}
