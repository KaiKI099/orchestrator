import React from 'react';
import { ChevronDown, FileText } from 'lucide-react';

/**
 * Empty state placeholder showing available agents
 */
export function EmptyState({ mode }) {
  const marketingAgents = [
    ['🔍', 'Keywords'],
    ['🛒', 'Buy Intent'],
    ['📢', 'Ads'],
    ['🔗', 'Backlinks'],
    ['🎯', 'Competitors'],
    ['🌊', 'Funnels'],
    ['💡', 'Ideas'],
    ['🌍', 'Regions'],
    ['🔬', 'QA'],
  ];

  const coderAgents = [
    ['🏗️', 'Architect'],
    ['🎨', 'UX'],
    ['⬆️', 'Upgrade'],
    ['🟩', 'Node.js'],
    ['🐍', 'Python'],
    ['🌐', 'Fullstack'],
    ['🚀', 'DevOps'],
    ['🗄️', 'Database'],
    ['🧪', 'Tests'],
    ['🔒', 'Security'],
    ['🔬', 'Review'],
    ['✂️', 'Slimpro'],
    ['📝', 'Docs'],
  ];

  const agents = mode === 'marketing' ? marketingAgents : coderAgents;
  const icon = mode === 'marketing' ? '🤖' : '💻';
  const title = mode === 'marketing' ? 'Marketing Orchestrator' : 'ProCoder';
  const description =
    mode === 'marketing'
      ? '9 specialist agents ready. Ask about keywords, funnels, competitors or ideas.'
      : '14 specialist agents ready. Ask about architecture, code, tests, security or deployment.';

  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <h2>{title}</h2>
      <p>{description}</p>
      <div className="agent-pills">
        {agents.map(([emoji, name]) => (
          <span key={name} className="agent-pill">
            {emoji} {name}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Individual message bubble component
 */
export function MessageBubble({ msg, idx, copiedMsgIdx, onCopy }) {
  const ReactMarkdown = () => <span>Markdown content</span>;
  const mdComponents = {};

  return (
    <div className={`message-row ${msg.role}`}>
      <div className="message-bubble">
        {msg.role === 'assistant' && (
          <div className="agent-header">
            <span className="emoji">{msg.agent?.emoji ?? '🤖'}</span>
            <span>{msg.agent ? `routing to ${msg.agent.name}` : 'Orchestrator'}</span>
            {msg.stopped && <span className="stopped-badge">■ stopped</span>}
          </div>
        )}

        {/* Delegation timeline */}
        {msg.delegations?.length > 0 && (
          <div className="delegation-timeline">
            {msg.delegations.map((d, i) => (
              <div key={i} className={`delegation-item delegation-item--${d.status}`}>
                <span className="delegation-arrow">→</span>
                <span className="delegation-emoji">{d.emoji}</span>
                <span className="delegation-name">{d.name}</span>
                {d.model && (
                  <span className="delegation-model">{d.model.split('/').pop().split(':')[0]}</span>
                )}
                <span className="delegation-status">
                  {d.status === 'queued' && '⏳ queued'}
                  {d.status === 'running' && 'running…'}
                  {d.status === 'done' && `✓ ${(d.duration_ms / 1000).toFixed(1)}s`}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Tool calls */}
        {msg.toolCalls?.length > 0 && (
          <div className="tool-calls">
            {msg.toolCalls.map((tc, i) => (
              <div key={i} className="tool-call-chip">
                🔧 <span>{tc.name.replace('__', ' → ')}</span>
              </div>
            ))}
          </div>
        )}

        {/* Attachment previews */}
        {msg.role === 'user' && msg.attachments?.length > 0 && (
          <div className="msg-attachments">
            {msg.attachments.map((a, i) =>
              a.type === 'image' ? (
                <img
                  key={i}
                  src={a.preview}
                  alt={a.name}
                  className="msg-img-preview"
                  title={a.name}
                />
              ) : (
                <span key={i} className="msg-file-tag">
                  <FileText size={12} /> {a.name}
                </span>
              )
            )}
          </div>
        )}

        {/* Content or typing indicator */}
        {msg.isTyping && !msg.content ? (
          <div className="typing-indicator">
            <div className="dot" />
            <div className="dot" />
            <div className="dot" />
          </div>
        ) : (
          <div className="markdown-wrapper">
            <ReactMarkdown components={mdComponents}>
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
              onClick={() => onCopy(idx, msg.content)}
              title="Copy message"
            >
              {copiedMsgIdx === idx ? 'Copied' : 'Copy'}
            </button>
            <button className="msg-action-btn" onClick={() => {}} title="Download message">
              <ChevronDown size={12} /> Save
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Scroll to bottom button
 */
export function ScrollToBottomButton({ onClick }) {
  return (
    <button className="scroll-to-bottom" onClick={onClick} title="Scroll to bottom">
      <ChevronDown size={18} />
    </button>
  );
}

/**
 * Chat messages container with auto-scroll
 */
export function MessagesContainer({ messages, copiedMsgIdx, onCopy, scrollRef, endRef }) {
  return (
    <main className="chat-container" ref={scrollRef}>
      {messages.length === 0 ? (
        <EmptyState mode="marketing" />
      ) : (
        <>
          {messages.map((msg, idx) => (
            <MessageBubble
              key={idx}
              msg={msg}
              idx={idx}
              copiedMsgIdx={copiedMsgIdx}
              onCopy={onCopy}
            />
          ))}
          <div ref={endRef} />
        </>
      )}
    </main>
  );
}
