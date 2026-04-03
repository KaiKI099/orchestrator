import React from 'react';
import CodeBlock from './CodeBlock';
import { Copy, Check, Download } from 'lucide-react';

/**
 * Custom components for ReactMarkdown rendering
 */
export function MarkdownComponents() {
  return {
    code({ node, inline, className, children, ...props }) {
      if (inline)
        return (
          <code className={`inline-code`} {...props}>
            {children}
          </code>
        );
      return <CodeBlock className={className}>{children}</CodeBlock>;
    },
  };
}

/**
 * Attachment preview for user messages with uploaded files
 */
export function MessageAttachments({ attachments }) {
  if (!attachments || attachments.length === 0) return null;

  const FileText = ({ size }) => <span style={{ fontSize: `${size}px` }}>📄</span>;

  return (
    <div className="msg-attachments">
      {attachments.map((a, i) =>
        a.type === 'image' ? (
          <img key={i} src={a.preview} alt={a.name} className="msg-img-preview" title={a.name} />
        ) : (
          <span key={i} className="msg-file-tag">
            <FileText size={12} /> {a.name}
          </span>
        )
      )}
    </div>
  );
}

/**
 * Delegation timeline showing sub-agent execution status
 */
export function DelegationTimeline({ delegations }) {
  if (!delegations || delegations.length === 0) return null;

  const Loader = ({ size, className }) => <span className={className}>⏳</span>;

  return (
    <div className="delegation-timeline">
      {delegations.map((d, i) => (
        <div key={i} className={`delegation-item delegation-item--${d.status}`}>
          <span className="delegation-arrow">→</span>
          <span className="delegation-emoji">{d.emoji}</span>
          <span className="delegation-name">{d.name}</span>
          {d.model && (
            <span className="delegation-model">{d.model.split('/').pop().split(':')[0]}</span>
          )}
          <span className="delegation-status">
            {d.status === 'queued' && '⏳ queued'}
            {d.status === 'running' && (
              <>
                <Loader size={11} className="mcp-spin" /> running…
              </>
            )}
            {d.status === 'done' && `✓ ${(d.duration_ms / 1000).toFixed(1)}s`}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Tool calls chip display
 */
export function ToolCallsDisplay({ toolCalls }) {
  if (!toolCalls || toolCalls.length === 0) return null;

  return (
    <div className="tool-calls">
      {toolCalls.map((tc, i) => (
        <div key={i} className="tool-call-chip">
          🔧 <span>{tc.name.replace('__', ' → ')}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Per-message action bar (copy, download)
 */
export function MessageActions({ idx, content, copiedMsgIdx, onCopy }) {
  return (
    <div className="msg-actions">
      <button className="msg-action-btn" onClick={() => onCopy(idx, content)} title="Copy message">
        {copiedMsgIdx === idx ? <Check size={12} /> : <Copy size={12} />}
        {copiedMsgIdx === idx ? 'Copied' : 'Copy'}
      </button>
      <button
        className="msg-action-btn"
        onClick={() => {
          const label = typeof content === 'string' ? 'message' : 'response';
          const blob = new Blob([content], { type: 'text/markdown' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${label}-${idx}.md`;
          a.click();
          URL.revokeObjectURL(url);
        }}
        title="Download message"
      >
        <Download size={12} /> Save
      </button>
    </div>
  );
}

/**
 * Typing indicator with animated dots
 */
export function TypingIndicator() {
  return (
    <div className="typing-indicator">
      <div className="dot" />
      <div className="dot" />
      <div className="dot" />
    </div>
  );
}
