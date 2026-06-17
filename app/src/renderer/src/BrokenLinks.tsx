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

export function BrokenLinks({ onClose }: { onClose: () => void }) {
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
        aria-label="Find broken links"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bd-modal__header">
          <span>
            Broken Links
            {links && links.length > 0 && (
              <span className="bd-dup__summary">
                {' '}
                — {links.length} missing file{links.length === 1 ? '' : 's'}
              </span>
            )}
          </span>
          <button type="button" className="bd-field__del" title="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="bd-modal__body">
          {!links ? (
            <p className="bd-modal__empty">Scanning…</p>
          ) : links.length === 0 ? (
            <p className="bd-modal__empty">No broken links — every attachment resolves. 🎉</p>
          ) : (
            <ul className="bd-broken__list">
              {links.map((link, i) => (
                <li className="bd-broken__row" key={`${link.itemId}:${link.field ?? link.path}:${i}`}>
                  <div className="bd-broken__info">
                    <button
                      type="button"
                      className="bd-broken__key"
                      title="Select this entry in the list"
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
                          title="Pick a replacement file for this attachment"
                          onClick={() => void locate(link)}
                        >
                          Locate…
                        </button>
                        <button
                          type="button"
                          className="bd-btn bd-btn--small"
                          title="Remove this attachment from the entry"
                          onClick={() => void remove(link)}
                        >
                          Remove
                        </button>
                      </>
                    ) : (
                      <span className="bd-broken__hint" title="Edit the field on the entry to fix this link">
                        field link
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
