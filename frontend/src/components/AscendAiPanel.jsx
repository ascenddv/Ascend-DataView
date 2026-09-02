import { useEffect, useRef, useState } from 'react';
import { fetchChatHistory, sendChatMessage, clearChat } from '../lib/api.js';

/**
 * AscendAI — a slide-out chat panel available from every dashboard view.
 *
 * Answers come from the tool-grounded backend (Phase 18/19). The two degraded
 * server states are rendered as inline notices using the backend's own copy:
 *   - status 'unavailable'  -> the friendly `reason` string
 *   - status 'rate_limited' -> the friendly `reply` string
 * Neither is persisted server-side, so they are UI-only and vanish on reload.
 *
 * Visual language matches CardChrome / CardShell: --surface-1 panels, --border,
 * the --series-1 accent, rounded-xl, soft shadow — not a generic chat widget.
 */
export default function AscendAiPanel({ initialOpen = false, initialMessages = null }) {
  const [open, setOpen] = useState(initialOpen);
  const [messages, setMessages] = useState(initialMessages || []);
  const [loadedHistory, setLoadedHistory] = useState(Boolean(initialMessages));
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open || loadedHistory) return undefined;
    let cancelled = false;
    fetchChatHistory()
      .then((d) => {
        if (cancelled) return;
        setMessages((d.messages || []).map((m) => ({ role: m.role, content: m.content })));
        setLoadedHistory(true);
      })
      .catch(() => {
        if (!cancelled) setLoadedHistory(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, loadedHistory]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, pending, open]);

  async function submit(e) {
    if (e) e.preventDefault();
    const text = input.trim();
    if (!text || pending) return;
    setInput('');
    setConfirmClear(false);
    setMessages((m) => [...m, { role: 'user', content: text }]);
    setPending(true);
    try {
      const res = await sendChatMessage(text);
      if (res.status === 'ok') {
        setMessages((m) => [...m, { role: 'assistant', content: res.reply }]);
      } else if (res.status === 'rate_limited') {
        setMessages((m) => [...m, { role: 'notice', kind: 'rate_limited', content: res.reply }]);
      } else {
        setMessages((m) => [
          ...m,
          { role: 'notice', kind: 'unavailable', content: res.reason || 'AscendAI is temporarily unavailable.' },
        ]);
      }
    } catch {
      setMessages((m) => [
        ...m,
        { role: 'notice', kind: 'unavailable', content: "Couldn't reach AscendAI just now. Please try again in a moment." },
      ]);
    } finally {
      setPending(false);
    }
  }

  async function onClear() {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    try {
      await clearChat();
    } catch {
      /* clearing is best-effort; the list is cleared locally regardless */
    }
    setMessages([]);
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ask AscendAI"
        className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-white shadow-lg"
        style={{ background: 'var(--series-1)' }}
      >
        <span aria-hidden="true">✦</span>
        Ask AscendAI
      </button>
    );
  }

  return (
    <section
      role="dialog"
      aria-label="AscendAI chat"
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l shadow-2xl"
      style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}
    >
      <header
        className="flex items-start justify-between gap-3 border-b p-4"
        style={{ borderColor: 'var(--border)' }}
      >
        <div>
          <div className="flex items-center gap-1.5">
            <span aria-hidden="true" style={{ color: 'var(--series-1)' }}>
              ✦
            </span>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              AscendAI
            </h2>
          </div>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
            Answers from this organization&rsquo;s dashboard data
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClear}
            className="rounded-lg border px-2 py-1 text-xs"
            style={{
              borderColor: confirmClear ? 'var(--status-warning)' : 'var(--border)',
              color: confirmClear ? 'var(--status-warning)' : 'var(--text-muted)',
            }}
          >
            {confirmClear ? 'Clear conversation?' : 'Clear'}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close AscendAI"
            className="rounded-lg px-2 py-1 text-sm"
            style={{ color: 'var(--text-muted)' }}
          >
            ✕
          </button>
        </div>
      </header>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {loadedHistory && messages.length === 0 && !pending && (
          <p className="mt-6 text-center text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            Ask about your health scores, KPIs, trends, or risks.
            <br />
            AscendAI only sees this organization&rsquo;s data.
          </p>
        )}

        {messages.map((m, i) => {
          if (m.role === 'notice') {
            return (
              <div
                key={i}
                className="rounded-lg border-l-2 p-3 text-xs leading-relaxed"
                style={{
                  borderColor: 'var(--status-warning)',
                  background: 'color-mix(in srgb, var(--status-warning) 7%, var(--surface-1))',
                  color: 'var(--text-secondary)',
                }}
              >
                <span aria-hidden="true" style={{ color: 'var(--status-warning)' }}>
                  ▲{' '}
                </span>
                {m.content}
              </div>
            );
          }
          const isUser = m.role === 'user';
          return (
            <div key={i} className={isUser ? 'flex justify-end' : ''}>
              <div className={isUser ? 'max-w-[85%]' : 'w-full'}>
                {!isUser && (
                  <div
                    className="mb-1 text-[10px] font-semibold uppercase tracking-wide"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    AscendAI
                  </div>
                )}
                <div
                  className={`whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                    isUser ? 'rounded-br-sm' : 'rounded-bl-sm border'
                  }`}
                  style={
                    isUser
                      ? {
                          background: 'color-mix(in srgb, var(--series-1) 14%, var(--surface-1))',
                          color: 'var(--text-primary)',
                        }
                      : { background: 'var(--page)', borderColor: 'var(--border)', color: 'var(--text-primary)' }
                  }
                >
                  {m.content}
                </div>
              </div>
            </div>
          );
        })}

        {pending && (
          <div className="w-full">
            <div
              className="mb-1 text-[10px] font-semibold uppercase tracking-wide"
              style={{ color: 'var(--text-muted)' }}
            >
              AscendAI
            </div>
            <div className="inline-flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
              <span
                className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
                aria-hidden="true"
              />
              Thinking&hellip;
            </div>
          </div>
        )}
      </div>

      <form onSubmit={submit} className="border-t p-3" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask about your data…"
            className="max-h-32 flex-1 resize-none rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ borderColor: 'var(--border)', background: 'var(--page)', color: 'var(--text-primary)' }}
          />
          <button
            type="submit"
            disabled={!input.trim() || pending}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--series-1)' }}
          >
            Send
          </button>
        </div>
      </form>
    </section>
  );
}
