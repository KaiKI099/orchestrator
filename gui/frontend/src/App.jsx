import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { Send, Settings, Square, Download, Trash2, Copy, Check, ChevronDown } from 'lucide-react';
import McpSettings from './McpSettings';
import ModelSelector from './ModelSelector';

// ── Code block with copy button ───────────────────────────────────────────────
function CodeBlock({ children, className }) {
  const [copied, setCopied] = useState(false);
  const code = String(children).trimEnd();
  const lang = (className || '').replace('language-', '') || 'code';

  async function copy() {
    await navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-lang">{lang}</span>
        <button className="code-copy-btn" onClick={copy} title="Copy code">
          {copied ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
        </button>
      </div>
      <pre><code className={className}>{children}</code></pre>
    </div>
  );
}

// ── Markdown components ───────────────────────────────────────────────────────
const mdComponents = {
  code({ node, inline, className, children, ...props }) {
    if (inline) return <code className={`inline-code`} {...props}>{children}</code>;
    return <CodeBlock className={className}>{children}</CodeBlock>;
  },
};

// ── Download helpers ──────────────────────────────────────────────────────────
function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function conversationToMarkdown(messages) {
  const lines = ['# Orchestrator Conversation\n', `_Exported ${new Date().toLocaleString()}_\n\n---\n`];
  for (const msg of messages) {
    if (msg.role === 'user') {
      lines.push(`## 👤 You\n${msg.content}\n`);
    } else if (msg.role === 'assistant') {
      const label = msg.agent ? `${msg.agent.emoji} ${msg.agent.name}` : '🤖 Orchestrator';
      lines.push(`## ${label}\n${msg.content}\n`);
    }
  }
  return lines.join('\n');
}

// ── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showMcp, setShowMcp] = useState(false);
  const [activeMcpCount, setActiveMcpCount] = useState(0);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [activeBackendLabel, setActiveBackendLabel] = useState('Ollama');
  const [activeModelLabel, setActiveModelLabel] = useState('');
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [copiedMsgIdx, setCopiedMsgIdx] = useState(null);

  const messagesEndRef = useRef(null);
  const chatContainerRef = useRef(null);
  const abortControllerRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (!isLoading) scrollToBottom();
  }, [messages, isLoading, scrollToBottom]);

  // Show scroll-to-bottom button when user scrolls up
  useEffect(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowScrollBtn(distFromBottom > 200);
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Load active MCP count + current model on mount
  useEffect(() => {
    fetch('http://localhost:3001/api/mcp')
      .then(r => r.json())
      .then(cfg => setActiveMcpCount(Object.values(cfg.servers).filter(s => s.running).length))
      .catch(() => {});
    fetch('http://localhost:3001/api/models')
      .then(r => r.json())
      .then(d => {
        const backendNames = { lmstudio: 'LM Studio', ollama: 'Ollama' };
        setActiveBackendLabel(backendNames[d.active.backend] ?? d.active.backend);
        setActiveModelLabel(d.active.model || '');
      })
      .catch(() => {});
  }, []);

  function handleMcpClose(updatedConfig) {
    if (updatedConfig?.servers) {
      setActiveMcpCount(Object.values(updatedConfig.servers).filter(s => s.running).length);
    }
    setShowMcp(false);
  }

  function handleModelClose(active) {
    if (active) {
      const backendNames = { lmstudio: 'LM Studio', ollama: 'Ollama' };
      setActiveBackendLabel(backendNames[active.backend] ?? active.backend);
      setActiveModelLabel(active.model || '');
    }
    setShowModelSelector(false);
  }

  function handleStop() {
    abortControllerRef.current?.abort();
  }

  function handleClear() {
    if (isLoading) handleStop();
    setMessages([]);
  }

  function handleDownload() {
    if (messages.length === 0) return;
    const ts = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
    downloadText(`orchestrator-${ts}.md`, conversationToMarkdown(messages));
  }

  async function copyMessage(idx, content) {
    await navigator.clipboard.writeText(content).catch(() => {});
    setCopiedMsgIdx(idx);
    setTimeout(() => setCopiedMsgIdx(null), 2000);
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!inputMessage.trim() || isLoading) return;

    const userMessage = { role: 'user', content: inputMessage };
    setMessages(prev => [...prev, userMessage]);
    setInputMessage('');
    setIsLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch('http://localhost:3001/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          messages: [...messages, userMessage].map(m => ({ role: m.role, content: m.content }))
        })
      });

      if (!response.ok) throw new Error('Network response was not ok');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';
      let buffer = '';

      setMessages(prev => [...prev, { role: 'assistant', content: '', isTyping: true, toolCalls: [] }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEvent = null;
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) { currentEvent = null; continue; }

          if (trimmed.startsWith('event: ')) {
            currentEvent = trimmed.slice(7);
            continue;
          }

          if (trimmed.startsWith('data: ')) {
            const payload = trimmed.slice(6);
            if (payload === '[DONE]') continue;

            try {
              const parsed = JSON.parse(payload);

              if (currentEvent === 'agent') {
                setMessages(prev => {
                  const next = [...prev];
                  next[next.length - 1] = { ...next[next.length - 1], agent: parsed };
                  return next;
                });
              } else if (currentEvent === 'tool') {
                setMessages(prev => {
                  const next = [...prev];
                  const last = next[next.length - 1];
                  next[next.length - 1] = { ...last, toolCalls: [...(last.toolCalls || []), parsed] };
                  return next;
                });
              } else if (parsed.choices?.[0]?.delta?.content) {
                assistantContent += parsed.choices[0].delta.content;
                setMessages(prev => {
                  const next = [...prev];
                  next[next.length - 1] = { ...next[next.length - 1], content: assistantContent, isTyping: false };
                  return next;
                });
              } else if (parsed.emoji !== undefined || parsed.id === 'orchestrator') {
                setMessages(prev => {
                  const next = [...prev];
                  next[next.length - 1] = { ...next[next.length - 1], agent: parsed };
                  return next;
                });
              }
            } catch { /* skip */ }
          }
        }
      }

    } catch (err) {
      if (err.name === 'AbortError') {
        // Mark last message as stopped (keep partial content)
        setMessages(prev => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === 'assistant') {
            next[next.length - 1] = { ...last, isTyping: false, stopped: true };
          }
          return next;
        });
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: '⚠️ Error: Cannot connect to Backend/LM Studio.',
          isError: true,
        }]);
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
      setMessages(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last) next[next.length - 1] = { ...last, isTyping: false };
        return next;
      });
    }
  };

  return (
    <div className="app-container">
      {/* ── Header ── */}
      <header className="header">
        <h1>🤖 <span>Orchestrator</span></h1>
        <div className="header-actions">
          {messages.length > 0 && (
            <>
              <button className="hdr-btn" onClick={handleDownload} title="Download conversation">
                <Download size={15} />
              </button>
              <button className="hdr-btn hdr-btn--danger" onClick={handleClear} title="Clear conversation">
                <Trash2 size={15} />
              </button>
            </>
          )}
          {/* Model / backend switcher */}
          <button
            className="model-btn"
            onClick={() => setShowModelSelector(true)}
            title="Switch model or backend"
          >
            <span className="model-btn-backend">{activeBackendLabel}</span>
            {activeModelLabel && (
              <span className="model-btn-name">{activeModelLabel.split(':')[0].split('/').pop()}</span>
            )}
            <ChevronDown size={12} style={{ opacity: 0.6 }} />
          </button>
          <button
            className={`mcp-settings-btn ${activeMcpCount > 0 ? 'mcp-settings-btn--active' : ''}`}
            onClick={() => setShowMcp(true)}
            title="MCP Servers"
          >
            <Settings size={15} />
            <span>MCP</span>
            {activeMcpCount > 0 && <span className="mcp-settings-badge">{activeMcpCount}</span>}
          </button>
        </div>
      </header>

      {/* ── Chat area ── */}
      <main className="chat-container" ref={chatContainerRef}>
        {messages.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon">🤖</div>
            <h2>Marketing Orchestrator</h2>
            <p>9 specialist agents ready. Ask about keywords, funnels, competitors or ideas.</p>
            <div className="agent-pills">
              {[['🔍','Keywords'],['🛒','Buy Intent'],['📢','Ads'],['🔗','Backlinks'],['🎯','Competitors'],['🌊','Funnels'],['💡','Ideas'],['🌍','Regions'],['🔬','QA']].map(([e,n]) => (
                <span key={n} className="agent-pill">{e} {n}</span>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div key={idx} className={`message-row ${msg.role}`}>
            <div className="message-bubble">
              {msg.role === 'assistant' && (
                <div className="agent-header">
                  <span className="emoji">{msg.agent?.emoji ?? '🤖'}</span>
                  <span>{msg.agent ? `routing to ${msg.agent.name}` : 'Orchestrator'}</span>
                  {msg.stopped && <span className="stopped-badge">■ stopped</span>}
                </div>
              )}

              {msg.toolCalls?.length > 0 && (
                <div className="tool-calls">
                  {msg.toolCalls.map((tc, i) => (
                    <div key={i} className="tool-call-chip">
                      🔧 <span>{tc.name.replace('__', ' → ')}</span>
                    </div>
                  ))}
                </div>
              )}

              {msg.isTyping && !msg.content ? (
                <div className="typing-indicator">
                  <div className="dot" /><div className="dot" /><div className="dot" />
                </div>
              ) : (
                <div className="markdown-wrapper">
                  <ReactMarkdown components={mdComponents}>{msg.content}</ReactMarkdown>
                </div>
              )}

              {/* Per-message action bar */}
              {!msg.isTyping && msg.content && (
                <div className="msg-actions">
                  <button
                    className="msg-action-btn"
                    onClick={() => copyMessage(idx, msg.content)}
                    title="Copy message"
                  >
                    {copiedMsgIdx === idx ? <Check size={12} /> : <Copy size={12} />}
                    {copiedMsgIdx === idx ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    className="msg-action-btn"
                    onClick={() => {
                      const label = msg.role === 'user' ? 'user' : (msg.agent?.name || 'orchestrator');
                      downloadText(`${label}-${idx}.md`, msg.content);
                    }}
                    title="Download message"
                  >
                    <Download size={12} /> Save
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </main>

      {/* ── Scroll to bottom button ── */}
      {showScrollBtn && (
        <button className="scroll-to-bottom" onClick={scrollToBottom} title="Scroll to bottom">
          <ChevronDown size={18} />
        </button>
      )}

      {/* ── Input ── */}
      <footer className="input-container">
        <form onSubmit={handleSubmit} className="input-box">
          <input
            type="text"
            placeholder={isLoading ? 'Generating…' : 'Type your marketing assignment here…'}
            value={inputMessage}
            onChange={e => setInputMessage(e.target.value)}
            disabled={isLoading}
          />
          {isLoading ? (
            <button type="button" className="stop-btn" onClick={handleStop} title="Stop generation">
              <Square size={16} fill="currentColor" />
            </button>
          ) : (
            <button type="submit" disabled={!inputMessage.trim()}>
              <Send size={18} />
            </button>
          )}
        </form>
      </footer>

      {showMcp && <McpSettings onClose={handleMcpClose} />}
      {showModelSelector && <ModelSelector onClose={handleModelClose} />}
    </div>
  );
}
