import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useTasks } from '../hooks/useTasks';
import { parseStreamBuffer, StreamEvent } from '../api/stream';
import { errorMessage } from '../api/client';
import { Markdown } from '../components/Markdown';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  usage?: {
    total: number;
  };
}

export function Dashboard() {
  const { isConnected } = useTasks();
  const { toast } = useToast();
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  
  const [inputText, setInputText] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [streamUsage, setStreamUsage] = useState<{ total: number } | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const chatThreadRef = useRef<HTMLDivElement | null>(null);

  const fetchChatHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/chat');
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch (err) {
      console.error('Gagal memuat riwayat percakapan:', err);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    fetchChatHistory();
  }, [fetchChatHistory]);

  // Scroll to bottom when messages or streamContent updates
  const scrollToBottom = useCallback(() => {
    if (chatThreadRef.current) {
      chatThreadRef.current.scrollTop = chatThreadRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamContent, streaming, scrollToBottom]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputText.trim();
    if (!text || streaming) return;

    setInputText('');
    setStreaming(true);
    setStreamContent('');
    setStreamUsage(null);

    // Append user message immediately
    const userMsg: Message = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    let accumulatedText = '';
    let accumulatedUsage: { total: number } | null = null;

    try {
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error('Stream tidak tersedia');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const { events, remaining } = parseStreamBuffer(buffer);
        buffer = remaining;

        for (const ev of events) {
          if (ev.delta) {
            accumulatedText += ev.delta;
            setStreamContent(accumulatedText);
          }
          if (ev.usage) {
            accumulatedUsage = ev.usage;
            setStreamUsage(accumulatedUsage);
          }
          if (ev.error) {
            throw new Error(ev.error);
          }
        }
      }

      // Finish streaming and push assistant message
      const assistantMsg: Message = {
        role: 'assistant',
        content: accumulatedText || '(tidak ada balasan)',
        usage: accumulatedUsage || undefined,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        const assistantMsg: Message = {
          role: 'assistant',
          content: accumulatedText || '(dihentikan oleh operator)',
          usage: { total: 0 }, // Sentinel for aborted
        };
        setMessages((prev) => [...prev, assistantMsg]);
        toast('Aliran chat dihentikan', 'warn');
      } else {
        toast(errorMessage(err, 'Gagal mengirim pesan'), 'err');
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `**Error:** ${errorMessage(err, 'Koneksi gagal.')}` },
        ]);
      }
    } finally {
      setStreaming(false);
      setStreamContent('');
      setStreamUsage(null);
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleReset = async () => {
    if (!window.confirm('Hapus seluruh percakapan?')) return;
    try {
      const res = await fetch('/api/chat/reset', { method: 'POST' });
      if (res.ok) {
        setMessages([]);
        toast('Percakapan telah di-reset', 'ok');
      }
    } catch (err) {
      toast('Gagal me-reset percakapan', 'err');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      {/* Reconnect Warning Bar */}
      {!isConnected && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            backgroundColor: 'var(--warn)',
            color: 'var(--surface-0)',
            padding: '8px 16px',
            textAlign: 'center',
            fontWeight: '600',
            fontSize: 'var(--t-sm)',
            zIndex: 10,
            boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
          }}
        >
          ⚠️ Koneksi terputus. Mencoba menghubungkan kembali...
        </div>
      )}

      {/* Main chat layout */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', paddingBottom: '80px' }}>
        <header className="page-header" style={{ flexShrink: 0, marginTop: !isConnected ? '40px' : '0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h1 className="page-title">Live Chat & Dashboard</h1>
              <p className="page-subtitle">Instruksikan asisten AI Hermes untuk melakukan tugas kustom</p>
            </div>
            <Button variant="secondary" onClick={handleReset} disabled={streaming || messages.length === 0}>
              Reset Chat
            </Button>
          </div>
        </header>

        {/* Messages list */}
        <div
          ref={chatThreadRef}
          className="chat-thread"
          style={{
            flex: 1,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            padding: '16px',
            backgroundColor: 'var(--surface-1)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            minHeight: '200px',
          }}
        >
          {loadingHistory ? (
            <div style={{ color: 'var(--text-dim)', textAlign: 'center', margin: 'auto' }}>Memuat riwayat chat...</div>
          ) : messages.length === 0 && !streaming ? (
            <div style={{ color: 'var(--text-faint)', textAlign: 'center', margin: 'auto', maxWidth: '400px' }}>
              <span style={{ fontSize: '2rem', display: 'block', marginBottom: '8px' }}>🤖</span>
              Halo! Saya adalah <strong>Lail Hermes Agent</strong>.<br />
              Ketik instruksi di bawah (mis. <code>buat counter app dengan Flutter</code> atau <code>jalankan test</code>) untuk memulai.
            </div>
          ) : (
            <>
              {messages.map((m, idx) => (
                <div
                  key={idx}
                  style={{
                    alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                    maxWidth: '80%',
                    backgroundColor: m.role === 'user' ? 'var(--surface-2)' : 'transparent',
                    border: m.role === 'user' ? '1px solid var(--border-strong)' : 'none',
                    borderRadius: 'var(--r-lg)',
                    padding: m.role === 'user' ? '12px 16px' : '0',
                    color: 'var(--text)',
                  }}
                >
                  {m.role === 'user' ? (
                    <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
                  ) : (
                    <div
                      style={{
                        backgroundColor: 'var(--surface-0)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--r-lg)',
                        padding: '16px',
                      }}
                    >
                      <Markdown content={m.content} />
                      {m.usage && m.usage.total > 0 && (
                        <div style={{ fontSize: 'var(--t-xs)', color: 'var(--text-faint)', marginTop: '8px', borderTop: '1px dashed var(--border)', paddingTop: '6px' }}>
                          💡 Total token: {m.usage.total}
                        </div>
                      )}
                      {m.usage && m.usage.total === 0 && (
                        <div style={{ fontSize: 'var(--t-xs)', color: 'var(--text-faint)', marginTop: '8px', fontStyle: 'italic' }}>
                          (Dihentikan oleh operator)
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {/* Streaming Content */}
              {streaming && (
                <div
                  style={{
                    alignSelf: 'flex-start',
                    maxWidth: '85%',
                    backgroundColor: 'var(--surface-0)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r-lg)',
                    padding: '16px',
                  }}
                >
                  {streamContent ? (
                    <Markdown content={streamContent} />
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ opacity: 0.55, fontSize: 'var(--t-sm)', color: 'var(--text-dim)' }}>Hermes sedang berpikir</span>
                      <div className="typing-indicator">
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                    </div>
                  )}
                  {streamUsage && (
                    <div style={{ fontSize: 'var(--t-xs)', color: 'var(--text-faint)', marginTop: '8px', borderTop: '1px dashed var(--border)', paddingTop: '6px' }}>
                      💡 Total token: {streamUsage.total}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Input box bottom bar */}
      <form
        onSubmit={handleSend}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: 'var(--surface-0)',
          padding: '12px 0',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          gap: '12px',
          alignItems: 'center',
        }}
      >
        <input
          type="text"
          className="field-input"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Kirim tugas ke Hermes... (mis. @myproj jalankan test)"
          style={{ flex: 1, minHeight: '44px' }}
          disabled={streaming}
        />
        {streaming ? (
          <Button variant="danger" type="button" onClick={handleStop} style={{ height: '44px', width: '90px' }}>
            Stop
          </Button>
        ) : (
          <Button variant="primary" type="submit" disabled={!inputText.trim()} style={{ height: '44px', width: '90px' }}>
            Send
          </Button>
        )}
      </form>
    </div>
  );
}
