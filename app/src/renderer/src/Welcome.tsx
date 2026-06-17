/**
 * Welcome / empty-state screen shown when no bibliography is open (app launch, or
 * after closing one). Replaces the bare three-pane chrome with a centered panel
 * offering the two ways in — Open an existing `.bib` or create a new one — plus a
 * drag-and-drop hint. The buttons drive main via `window.bibdesk` (native dialogs).
 */

export function Welcome() {
  const open = (): void => void window.bibdesk?.openDialog();
  const create = (): void => void window.bibdesk?.newDocument();

  return (
    <div className="bd-welcome">
      <div className="bd-welcome__card">
        <div className="bd-welcome__logo" aria-hidden="true">
          📚
        </div>
        <h1 className="bd-welcome__title">BibDesk</h1>
        <p className="bd-welcome__tagline">A bibliography manager for BibTeX libraries.</p>
        <div className="bd-welcome__actions">
          <button type="button" className="bd-btn bd-btn--primary" onClick={open}>
            Open a Bibliography…
          </button>
          <button type="button" className="bd-btn" onClick={create}>
            New Bibliography
          </button>
        </div>
        <p className="bd-welcome__hint">
          or drag a <code>.bib</code> file onto the window (<kbd>⌘O</kbd> also opens one).
        </p>
      </div>
    </div>
  );
}
