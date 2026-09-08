import { useEffect, useRef, useState } from 'react';
import { fetchChatHistory, sendChatMessage, clearChat, fetchAscendaiUsage } from '../lib/api.js';
import { registerAscendAiOpener } from '../lib/ascendai-bus.js';
import { IconSparkles, IconClose } from '../lib/icons.jsx';
import { Button } from './ui/primitives.jsx';

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
export default function AscendAiPanel({ initialOpen = false, initialMessages = null, initialUsage = null }) {
  const [open, setOpen] = useState(initialOpen);
  const [messages, setMessages] = useState(initialMessages || []);
  const [loadedHistory, setLoadedHistory] = useState(Boolean(initialMessages));
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [usage, setUsage] = useState(initialUsage);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  // Let a nav control elsewhere in the shell open the panel.
  useEffect(() => registerAscendAiOpener(() => setOpen(true)), []);

  // Feature state + today's count. If it comes back disabled the panel renders
  // nothing at all (no launcher).
  useEffect(() => {
    let cancelled = false;
    fetchAscendaiUsage()
      .then((u) => { if (!cancelled) setUsage(u); })
      .catch(() => { /* leave usage null -> panel behaves as before */ });
    return () => { cancelled = true; };
  }, []);

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

  // Modal behaviour: focus the input when it opens, close on Escape.
  useEffect(() => {
    if (!open) return undefined;
    inputRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

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

  // Disabled deployment-wide or by an owner for this org — no affordance at all.
  if (usage && usage.enabled === false) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ask AscendAI"
        className="adv-fade-up fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-transform duration-[140ms] ease-out hover:-translate-y-0.5"
        style={{ background: 'var(--accent)', color: 'var(--accent-contrast)', boxShadow: 'var(--shadow-md)' }}
      >
        <IconSparkles size={16} />
        Ask AscendAI
      </button>
    );
  }

  return (
    <>
      <div
        className="adv-fade-in fixed inset-0 z-40"
        style={{ background: 'rgba(4, 12, 10, 0.28)' }}
        onClick={() => setOpen(false)}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="AscendAI chat"
        className="adv-slide-in-right fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l"
        style={{ background: 'var(--surface-2)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)' }}
      >
      <header
        className="flex items-start justify-between gap-3 border-b p-4"
        style={{ borderColor: 'var(--border)' }}
      >
        <div>
          <div className="flex items-center gap-1.5">
            <span style={{ color: 'var(--series-1)' }}>
              <IconSparkles size={15} />
            </span>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              AscendAI
            </h2>
          </div>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
            Answers from this organization&rsquo;s dashboard data
          </p>
          {usage && usage.today && (
            <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              {usage.today.count} of {usage.today.limit} messages today
            </p>
          )}
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
            className="rounded-lg p-1.5 hover:bg-[var(--surface-hover)]"
            style={{ color: 'var(--text-muted)' }}
          >
            <IconClose size={16} />
          </button>
        </div>
      </header>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {loadedHistory && messages.length === 0 && !pending && (
          <div className="adv-fade-up mt-10 flex flex-col items-center px-6 text-center">
            <span
              className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}
            >
              <IconSparkles size={18} />
            </span>
            <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
              Ask about your health scores, KPIs, trends, or risks.
            </p>
            <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
              AscendAI only sees this organization&rsquo;s data.
            </p>
          </div>
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
          <div className="adv-fade-up w-full">
            <div
              className="mb-1 text-[10px] font-semibold uppercase tracking-wide"
              style={{ color: 'var(--text-muted)' }}
            >
              AscendAI
            </div>
            <div
              className="inline-flex items-center gap-1.5 rounded-2xl rounded-bl-sm border px-3 py-2.5"
              style={{ background: 'var(--page)', borderColor: 'var(--border)' }}
              aria-label="AscendAI is thinking"
            >
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  aria-hidden="true"
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{
                    background: 'var(--text-muted)',
                    animation: 'adv-typing 1.1s ease-in-out infinite',
                    animationDelay: `${i * 160}ms`,
                  }}
                />
              ))}
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
            className="max-h-32 flex-1 resize-none rounded-[10px] border px-3 py-2 text-sm outline-none transition-[border-color,box-shadow] duration-[120ms] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-weak)]"
            style={{ borderColor: 'var(--border-strong)', background: 'var(--surface-2)', color: 'var(--text-primary)' }}
          />
          <Button type="submit" disabled={!input.trim() || pending}>
            Send
          </Button>
        </div>
      </form>
      </section>
    </>
  );
}
