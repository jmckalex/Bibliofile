/**
 * Claude Assistant panel — a chat over the open library. The model reads the
 * library freely via tools; every mutation pops a native approval dialog (handled
 * in main). On first use it prompts for the user's Anthropic API key, which is
 * stored encrypted via Electron `safeStorage`. The conversation lives in main
 * (so tool round-trips persist); this panel shows the user/assistant turns.
 */

import { useEffect, useRef, useState } from 'react';
import { useStore } from './store.js';
import { useT } from './i18n.js';
import { Icon } from './icons.js';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  toolLog?: readonly string[];
  error?: boolean;
}

export function Assistant({ onClose }: { onClose: () => void }) {
  const t = useT();
  const agentSend = useStore((s) => s.agentSend);
  const documentId = useStore((s) => s.documentId);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [encryptionOk, setEncryptionOk] = useState(true);
  const [keyInput, setKeyInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void window.bibdesk?.agentKeyStatus().then((s) => {
      setHasKey(s.hasKey);
      setEncryptionOk(s.encryptionAvailable);
    });
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy]);

  const saveKey = async (): Promise<void> => {
    const s = await window.bibdesk!.agentSetKey({ key: keyInput.trim() });
    setHasKey(s.hasKey);
    setKeyInput('');
  };

  const send = async (): Promise<void> => {
    const msg = input.trim();
    if (!msg || busy) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text: msg }]);
    setBusy(true);
    try {
      const res = await agentSend(msg);
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          text: res.error ? res.error : res.reply || t('assistant.noReply'),
          toolLog: res.toolLog,
          error: !!res.error,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const resetChat = (): void => {
    if (documentId) void window.bibdesk?.agentReset({ documentId });
    setMessages([]);
  };

  return (
    <div className="bd-assistant" role="complementary" aria-label={t('assistant.aria')}>
      <div className="bd-assistant__bar">
        <span className="bd-assistant__title"><Icon name="assistant" /> {t('assistant.titleBar')}</span>
        <span className="bd-toolbar__spacer" />
        {hasKey && (
          <button type="button" className="bd-btn bd-btn--small" onClick={resetChat} title={t('assistant.newChatTitle')}>
            {t('assistant.newChat')}
          </button>
        )}
        <button type="button" className="bd-field__del" title={t('common.close')} onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>

      {hasKey === false ? (
        <div className="bd-assistant__setup">
          <p>
            {t('assistant.connectKey', {
              suffix: encryptionOk ? '' : t('assistant.encryptionUnavailable'),
            })}
          </p>
          <input
            className="bd-input"
            type="password"
            placeholder="sk-ant-…"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveKey();
            }}
          />
          <button type="button" className="bd-btn bd-btn--primary" disabled={!keyInput.trim() || !encryptionOk} onClick={() => void saveKey()}>
            {t('assistant.saveKey')}
          </button>
        </div>
      ) : (
        <>
          <div className="bd-assistant__log" ref={scrollRef}>
            {messages.length === 0 && (
              <p className="bd-assistant__hint">{t('assistant.hint')}</p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`bd-msg bd-msg--${m.role}${m.error ? ' bd-msg--error' : ''}`}>
                {m.toolLog && m.toolLog.length > 0 && (
                  <div className="bd-msg__tools">{m.toolLog.join('  ')}</div>
                )}
                <div className="bd-msg__text">{m.text}</div>
              </div>
            ))}
            {busy && <div className="bd-msg bd-msg--assistant bd-msg--pending">{t('assistant.thinking')}</div>}
          </div>
          <div className="bd-assistant__compose">
            <textarea
              className="bd-input bd-input--area"
              rows={2}
              placeholder={t('assistant.composePlaceholder')}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button type="button" className="bd-btn bd-btn--primary" disabled={busy || !input.trim()} onClick={() => void send()}>
              {t('assistant.send')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
