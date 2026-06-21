/**
 * Welcome / empty-state screen shown when no bibliography is open (app launch, or
 * after closing one). Replaces the bare three-pane chrome with a centered panel
 * offering the two ways in — Open an existing `.bib` or create a new one — plus a
 * drag-and-drop hint. The buttons drive main via `window.bibdesk` (native dialogs).
 */
import { useT } from './i18n.js';

export function Welcome() {
  const t = useT();
  const open = (): void => void window.bibdesk?.openDialog();
  const create = (): void => void window.bibdesk?.newDocument();

  return (
    <div className="bd-welcome">
      <div className="bd-welcome__card">
        <div className="bd-welcome__logo" aria-hidden="true">
          📚
        </div>
        <h1 className="bd-welcome__title">Bibliophile</h1>
        <p className="bd-welcome__tagline">{t('welcome.tagline')}</p>
        <div className="bd-welcome__actions">
          <button type="button" className="bd-btn bd-btn--primary" onClick={open}>
            {t('welcome.open')}
          </button>
          <button type="button" className="bd-btn" onClick={create}>
            {t('welcome.new')}
          </button>
        </div>
        <p className="bd-welcome__hint">{t('welcome.hint')}</p>
      </div>
    </div>
  );
}
