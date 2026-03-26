import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { Send, Settings, Square, Download, Trash2, Copy, Check, ChevronDown, Loader, Paperclip, FileText, X as XIcon, SlidersHorizontal } from 'lucide-react';
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
  const [attachments, setAttachments] = useState([]);   // pending files for current prompt
  const [isVisionModel, setIsVisionModel] = useState(false);
  const [describingImage, setDescribingImage] = useState(false);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [customSystemPrompt, setCustomSystemPrompt] = useState('');
  const [promptDraft, setPromptDraft] = useState('');

  const messagesEndRef = useRef(null);
  const chatContainerRef = useRef(null);
  const abortControllerRef = useRef(null);
  const fileInputRef = useRef(null);

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

  // Load active MCP count + current model on mount; also check vision capability
  useEffect(() => {
    fetch('http://localhost:3001/api/mcp')
      .then(r => r.json())
      .then(cfg => setActiveMcpCount(Object.values(cfg.servers).filter(s => s.running).length))
      .catch(() => {});
    fetch('http://localhost:3001/api/models')
      .then(r => r.json())
      .then(d => {
        const backendNames = { lmstudio: 'LM Studio', ollama: 'Ollama', claude: 'Claude', nvidia: 'NVIDIA' };
        setActiveBackendLabel(backendNames[d.active.backend] ?? d.active.backend);
        setActiveModelLabel(d.active.model || '');
      })
      .catch(() => {});
    fetch('http://localhost:3001/api/vision-check')
      .then(r => r.json())
      .then(d => setIsVisionModel(d.isVision))
      .catch(() => {});
  }, []);

  // Quick-switch to a specific backend (uses its default model)
  async function quickSwitchBackend(backendKey, label) {
    try {
      const modelsRes = await fetch('http://localhost:3001/api/models');
      const modelsData = await modelsRes.json();
      const backend = modelsData.backends[backendKey];
      const defaultModel = backend?.models?.[0]?.id || '';

      const res = await fetch('http://localhost:3001/api/models/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backend: backendKey, model: defaultModel }),
      });
      const json = await res.json();
      const backendNames = { lmstudio: 'LM Studio', ollama: 'Ollama', claude: 'Claude', nvidia: 'NVIDIA' };
      setActiveBackendLabel(backendNames[json.active.backend] ?? json.active.backend);
      setActiveModelLabel(json.active.model || '');
      // Re-check vision capability
      fetch('http://localhost:3001/api/vision-check')
        .then(r => r.json())
        .then(d => setIsVisionModel(d.isVision))
        .catch(() => {});
    } catch (e) {
      console.error(`Failed to switch to ${label}:`, e);
    }
  }

  function handleMcpClose(updatedConfig) {
    if (updatedConfig?.servers) {
      setActiveMcpCount(Object.values(updatedConfig.servers).filter(s => s.running).length);
    }
    setShowMcp(false);
  }

  function handleModelClose(active) {
    if (active) {
      const backendNames = { lmstudio: 'LM Studio', ollama: 'Ollama', claude: 'Claude', nvidia: 'NVIDIA' };
      setActiveBackendLabel(backendNames[active.backend] ?? active.backend);
      setActiveModelLabel(active.model || '');
      // Re-check vision capability for the newly selected model
      fetch('http://localhost:3001/api/vision-check')
        .then(r => r.json())
        .then(d => setIsVisionModel(d.isVision))
        .catch(() => {});
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

  // ── File attachment helpers ────────────────────────────────────────────────

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result.split(',')[1]); // strip data: prefix
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    e.target.value = ''; // allow re-selecting the same file
    for (const file of files) {
      if (file.size > 20 * 1024 * 1024) { alert(`${file.name} is too large (max 20 MB)`); continue; }
      const isImage = file.type.startsWith('image/');
      const isText  = file.type.startsWith('text/') || /\.(md|txt)$/i.test(file.name);
      if (isImage) {
        const base64  = await fileToBase64(file);
        const preview = `data:${file.type};base64,${base64}`;
        setAttachments(prev => [...prev, { type: 'image', name: file.name, base64, mimeType: file.type, preview }]);
      } else if (isText) {
        const content = await file.text();
        setAttachments(prev => [...prev, { type: 'text', name: file.name, content }]);
      }
    }
  }

  function removeAttachment(idx) {
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = async (e) => {
    e.preventDefault();
    const hasText = inputMessage.trim().length > 0;
    if ((!hasText && attachments.length === 0) || isLoading || describingImage) return;

    const pendingAtts = [...attachments];
    setAttachments([]);

    const imageAtts = pendingAtts.filter(a => a.type === 'image');
    const textAtts  = pendingAtts.filter(a => a.type === 'text');

    // Build text prefix from uploaded text/md files
    const textPrefix = textAtts.map(ta =>
      `[File: ${ta.name}]\n\`\`\`\n${ta.content}\n\`\`\`\n\n`
    ).join('');

    let userContent;

    if (imageAtts.length > 0) {
      if (isVisionModel) {
        // Vision model — send images as multi-part content in one request
        const parts = [];
        const combinedText = (textPrefix + inputMessage).trim();
        if (combinedText) parts.push({ type: 'text', text: combinedText });
        for (const ia of imageAtts) {
          parts.push({ type: 'image_url', image_url: { url: `data:${ia.mimeType};base64,${ia.base64}` } });
        }
        userContent = parts;
      } else {
        // Non-vision model — describe each image via Qwen3vision first (sequential)
        setDescribingImage(true);
        try {
          const descParts = [];
          for (const ia of imageAtts) {
            const res = await fetch('http://localhost:3001/api/describe-image', {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({ base64: ia.base64, mimeType: ia.mimeType }),
            });
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            descParts.push(`[Image: ${ia.name}]\n${data.description}`);
          }
          userContent = descParts.join('\n\n') + '\n\n' + textPrefix + inputMessage.trim();
        } catch (err) {
          setDescribingImage(false);
          setAttachments(pendingAtts); // give attachments back on error
          setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ Image description failed: ${err.message}`, isError: true }]);
          return;
        }
        setDescribingImage(false);
      }
    } else {
      userContent = textPrefix + inputMessage.trim();
    }

    const userMessage = {
      role:        'user',
      content:     userContent,               // string or multi-part array (vision)
      displayText: inputMessage.trim(),        // always plain text for display
      attachments: pendingAtts.map(a => ({ type: a.type, name: a.name, preview: a.preview })),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputMessage('');
    setIsLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch('http://localhost:3001/api/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        signal:  controller.signal,
        body:    JSON.stringify({
          // content may be string (text) or array (vision) — both are valid OpenAI format
          messages: [...messages, userMessage].map(m => ({ role: m.role, content: m.content })),
          ...(customSystemPrompt ? { customSystemPrompt } : {}),
        })
      });

      if (!response.ok) throw new Error('Network response was not ok');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';
      let buffer = '';

      setMessages(prev => [...prev, { role: 'assistant', content: '', isTyping: true, toolCalls: [], delegations: [] }]);

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
                // Initial routing event — which agent/orchestrator is handling this
                setMessages(prev => {
                  const next = [...prev];
                  next[next.length - 1] = { ...next[next.length - 1], agent: parsed };
                  return next;
                });

              } else if (currentEvent === 'delegating') {
                // Orchestrator dispatched a sub-agent (queued or running immediately)
                setMessages(prev => {
                  const next = [...prev];
                  const last = next[next.length - 1];
                  const entry = {
                    agent_id: parsed.agent_id,
                    name:     parsed.name,
                    emoji:    parsed.emoji,
                    model:    parsed.model,
                    backend:  parsed.backend,
                    status:   parsed.queued ? 'queued' : 'running',
                  };
                  next[next.length - 1] = {
                    ...last,
                    delegations: [...(last.delegations || []), entry],
                  };
                  return next;
                });

              } else if (currentEvent === 'agent_start') {
                // A queued agent just got the model and started executing
                setMessages(prev => {
                  const next = [...prev];
                  const last = next[next.length - 1];
                  next[next.length - 1] = {
                    ...last,
                    delegations: (last.delegations || []).map(d =>
                      d.agent_id === parsed.agent_id && d.status === 'queued'
                        ? { ...d, status: 'running' }
                        : d
                    ),
                  };
                  return next;
                });

              } else if (currentEvent === 'agent_done') {
                // Sub-agent finished — record duration
                setMessages(prev => {
                  const next = [...prev];
                  const last = next[next.length - 1];
                  next[next.length - 1] = {
                    ...last,
                    delegations: (last.delegations || []).map(d =>
                      d.agent_id === parsed.agent_id && d.status === 'running'
                        ? { ...d, status: 'done', duration_ms: parsed.duration_ms }
                        : d
                    ),
                  };
                  return next;
                });

              } else if (currentEvent === 'tool') {
                // Only show top-level tool calls (sub-agent tools carry an agent_id — skip them)
                if (!parsed.agent_id) {
                  setMessages(prev => {
                    const next = [...prev];
                    const last = next[next.length - 1];
                    next[next.length - 1] = { ...last, toolCalls: [...(last.toolCalls || []), parsed] };
                    return next;
                  });
                }

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
          {/* Quick-switch backend buttons */}
          <button
            className={`backend-quick-btn ${activeBackendLabel === 'Claude' ? 'backend-quick-btn--active' : ''}`}
            onClick={() => quickSwitchBackend('claude', 'Claude')}
            title="Switch to Claude (Anthropic)"
          >
            <span className="backend-quick-icon">🟣</span>
            <span>Claude</span>
          </button>
          <button
            className={`backend-quick-btn ${activeBackendLabel === 'NVIDIA' ? 'backend-quick-btn--active' : ''}`}
            onClick={() => quickSwitchBackend('nvidia', 'NVIDIA')}
            title="Switch to NVIDIA (Kimi K2.5)"
          >
            <span className="backend-quick-icon">🟢</span>
            <span>NVIDIA</span>
          </button>
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

              {/* Delegation timeline — shown when orchestrator dispatches sub-agents */}
              {msg.delegations?.length > 0 && (
                <div className="delegation-timeline">
                  {msg.delegations.map((d, i) => (
                    <div key={i} className={`delegation-item delegation-item--${d.status}`}>
                      <span className="delegation-arrow">→</span>
                      <span className="delegation-emoji">{d.emoji}</span>
                      <span className="delegation-name">{d.name}</span>
                      {d.model && (
                        <span className="delegation-model">
                          {d.model.split('/').pop().split(':')[0]}
                        </span>
                      )}
                      <span className="delegation-status">
                        {d.status === 'queued'  && '⏳ queued'}
                        {d.status === 'running' && <><Loader size={11} className="mcp-spin" /> running…</>}
                        {d.status === 'done'    && `✓ ${(d.duration_ms / 1000).toFixed(1)}s`}
                      </span>
                    </div>
                  ))}
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

              {/* Attachment previews (user messages with uploaded files) */}
              {msg.role === 'user' && msg.attachments?.length > 0 && (
                <div className="msg-attachments">
                  {msg.attachments.map((a, i) => (
                    a.type === 'image'
                      ? <img key={i} src={a.preview} alt={a.name} className="msg-img-preview" title={a.name} />
                      : <span key={i} className="msg-file-tag"><FileText size={12} /> {a.name}</span>
                  ))}
                </div>
              )}

              {msg.isTyping && !msg.content ? (
                <div className="typing-indicator">
                  <div className="dot" /><div className="dot" /><div className="dot" />
                </div>
              ) : (
                <div className="markdown-wrapper">
                  <ReactMarkdown components={mdComponents}>
                    {/* For user messages: show displayText (avoids rendering raw base64 arrays) */}
                    {msg.role === 'user'
                      ? (msg.displayText ?? (typeof msg.content === 'string' ? msg.content : ''))
                      : msg.content}
                  </ReactMarkdown>
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
        {/* Attachment chips (pending files not yet sent) */}
        {attachments.length > 0 && (
          <div className="attachment-area">
            {attachments.map((a, i) => (
              <div key={i} className={`attachment-chip attachment-chip--${a.type}`}>
                {a.type === 'image'
                  ? <img src={a.preview} alt={a.name} className="attachment-thumb" />
                  : <FileText size={14} />}
                <span className="attachment-chip-name">{a.name}</span>
                {!isVisionModel && a.type === 'image' && (
                  <span className="attachment-chip-hint" title="Will be described by Qwen3vision">👁</span>
                )}
                <button className="attachment-chip-remove" onClick={() => removeAttachment(i)} title="Remove">
                  <XIcon size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="input-row">
          <form onSubmit={handleSubmit} className="input-box">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.txt,.md,text/plain,text/markdown"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileSelect}
            />
            {/* Upload button */}
            <button
              type="button"
              className="upload-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading || describingImage}
              title="Attach image or text file"
            >
              <Paperclip size={16} />
            </button>

            <input
              type="text"
              placeholder={
                describingImage ? 'Describing image with Qwen3vision…' :
                isLoading       ? 'Generating…' :
                customSystemPrompt ? 'Custom prompt active — type your message…' :
                                  'Type your marketing assignment here…'
              }
              value={inputMessage}
              onChange={e => setInputMessage(e.target.value)}
              disabled={isLoading || describingImage}
            />
            {isLoading || describingImage ? (
              <button type="button" className="stop-btn" onClick={handleStop} title="Stop generation"
                disabled={describingImage}>
                {describingImage
                  ? <Loader size={16} className="mcp-spin" />
                  : <Square size={16} fill="currentColor" />}
              </button>
            ) : (
              <button type="submit" disabled={!inputMessage.trim() && attachments.length === 0}>
                <Send size={18} />
              </button>
            )}
          </form>
          <button
            className={`prompt-config-btn ${customSystemPrompt ? 'prompt-config-btn--active' : ''}`}
            onClick={() => { setPromptDraft(customSystemPrompt); setShowPromptEditor(true); }}
            title={customSystemPrompt ? 'Custom system prompt active — click to edit' : 'Set custom system prompt'}
          >
            <SlidersHorizontal size={16} />
          </button>
        </div>
      </footer>

      {showMcp && <McpSettings onClose={handleMcpClose} />}
      {showModelSelector && <ModelSelector onClose={handleModelClose} />}

      {/* ── System Prompt Editor Modal ── */}
      {showPromptEditor && (
        <div className="mcp-overlay" onClick={() => setShowPromptEditor(false)}>
          <div className="mcp-panel prompt-panel" onClick={e => e.stopPropagation()}>
            <div className="mcp-panel-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <SlidersHorizontal size={15} />
                <span>System Prompt</span>
                {customSystemPrompt && <span className="mcp-badge">Custom</span>}
              </div>
              <button className="mcp-close-btn" onClick={() => setShowPromptEditor(false)}>
                <XIcon size={15} />
              </button>
            </div>
            <div className="mcp-panel-body prompt-editor-body">
              <textarea
                className="prompt-textarea"
                value={promptDraft}
                onChange={e => setPromptDraft(e.target.value)}
                placeholder="Leave empty to use the default Orchestrator prompt.&#10;&#10;Write a custom system prompt here to override it. MCP tools will be appended automatically."
                spellCheck={false}
              />
            </div>
            <div className="prompt-editor-footer">
              <span className="prompt-footer-hint">
                {promptDraft.trim()
                  ? `${promptDraft.trim().length} chars — replaces Orchestrator prompt`
                  : 'Empty — default Orchestrator prompt will be used'}
              </span>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {customSystemPrompt && (
                  <button
                    className="prompt-editor-btn prompt-editor-btn--reset"
                    onClick={() => { setCustomSystemPrompt(''); setPromptDraft(''); setShowPromptEditor(false); }}
                  >
                    Reset to Default
                  </button>
                )}
                <button
                  className="prompt-editor-btn prompt-editor-btn--save"
                  onClick={() => { setCustomSystemPrompt(promptDraft.trim()); setShowPromptEditor(false); }}
                >
                  {promptDraft.trim() ? 'Apply Prompt' : 'Use Default'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
