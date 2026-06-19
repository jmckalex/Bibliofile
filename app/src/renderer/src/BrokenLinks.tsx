/**
 * Broken Links modal — scans the document on mount and lists every file
 * attachment whose target is missing on disk. For managed attachments
 * (`Bdsk-File-N`) it offers **Locate…** (point the link at a replacement file)
 * and **Remove**; any broken link can be opened in the table via its cite key.
 * Re-scans after each repair so the list reflects what is still broken.
 */

import { useCallback, useEffect, useState } from 'react';
import type { BrokenLink } from '@bibdesk/shared';
import { useStore } from './store.js';
import { useT } from './i18n.js';
import { Icon } from './icons.js';

export function BrokenLinks({ onClose }: { onClose: () => void }) {
  const t = useT();
  const findBrokenLinks = useStore((s) => s.findBrokenLinks);
  const relocateAttachment = useStore((s) => s.relocateAttachment);
  const removeAttachment = useStore((s) => s.removeAttachment);
  const selectItem = useStore((s) => s.selectItem);
  const [links, setLinks] = useState<BrokenLink[] | undefined>();

  const scan = useCallback(async (): Promise<void> => {
    setLinks(await findBrokenLinks());
  }, [findBrokenLinks]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await findBrokenLinks();
      if (!cancelled) setLinks(res);
    })();
    return () => {
      cancelled = true;
    };
  }, [findBrokenLinks]);

  const reveal = (itemId: string): void => {
    void selectItem(itemId);
    onClose();
  };
  const locate = async (link: BrokenLink): Promise<void> => {
    if (!link.field) return;
    await relocateAttachment(link.itemId, link.field);
    await scan();
  };
  const remove = async (link: BrokenLink): Promise<void> => {
    if (!link.field) return;
    await removeAttachment(link.itemId, link.field);
    await scan();
  };

  return (
    <div className="bd-modal-backdrop" onClick={onClose}>
      <div
        className="bd-modal bd-modal--wide"
        role="dialog"
        aria-label={t('broken.ariaLabel')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bd-modal__header">
          <span>
            {t('broken.title')}
            {links && links.length > 0 && (
              <span className="bd-dup__summary">
                {' '}
                {t(links.length === 1 ? 'broken.summary' : 'broken.summaryPlural', {
                  count: links.length,
                })}
              </span>
            )}
          </span>
          <button type="button" className="bd-field__del" title={t('common.close')} onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="bd-modal__body">
          {!links ? (
            <p className="bd-modal__empty">{t('common.scanning')}</p>
          ) : links.length === 0 ? (
            <p className="bd-modal__empty">{t('broken.none')}</p>
          ) : (
            <ul className="bd-broken__list">
              {links.map((link, i) => (
                <li className="bd-broken__row" key={`${link.itemId}:${link.field ?? link.path}:${i}`}>
                  <div className="bd-broken__info">
                    <button
                      type="button"
                      className="bd-broken__key"
                      title={t('broken.selectEntry')}
                      onClick={() => reveal(link.itemId)}
                    >
                      <code>{link.citeKey}</code>
                    </button>
                    <span className="bd-broken__name">{link.displayName}</span>
                    <span className="bd-broken__path" title={link.path}>
                      {link.path}
                    </span>
                  </div>
                  <div className="bd-broken__actions">
                    {link.field ? (
                      <>
                        <button
                          type="button"
                          className="bd-btn bd-btn--small"
                          title={t('broken.locateTitle')}
                          onClick={() => void locate(link)}
                        >
                          {t('broken.locate')}
                        </button>
                        <button
                          type="button"
                          className="bd-btn bd-btn--small"
                          title={t('broken.removeTitle')}
                          onClick={() => void remove(link)}
                        >
                          {t('common.remove')}
                        </button>
                      </>
                    ) : (
                      <span className="bd-broken__hint" title={t('broken.fieldLinkTitle')}>
                        {t('broken.fieldLink')}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
