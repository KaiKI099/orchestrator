import React from 'react';
import { SlidersHorizontal, X as XIcon } from 'lucide-react';

/**
 * System Prompt Editor Modal
 */
export default function PromptEditor({
  show,
  onClose,
  draft,
  setDraft,
  customSystemPrompt,
  onSave,
}) {
  if (!show) return null;

  return (
    <div className="mcp-overlay" onClick={onClose}>
      <div className="mcp-panel prompt-panel" onClick={(e) => e.stopPropagation()}>
        <div className="mcp-panel-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <SlidersHorizontal size={15} />
            <span>System Prompt</span>
            {customSystemPrompt && <span className="mcp-badge">Custom</span>}
          </div>
          <button className="mcp-close-btn" onClick={onClose}>
            <XIcon size={15} />
          </button>
        </div>

        <div className="mcp-panel-body prompt-editor-body">
          <textarea
            className="prompt-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Leave empty to use the default Orchestrator prompt.&#10;&#10;Write a custom system prompt here to override it. MCP tools will be appended automatically."
            spellCheck={false}
          />
        </div>

        <div className="prompt-editor-footer">
          <span className="prompt-footer-hint">
            {draft.trim()
              ? `${draft.trim().length} chars — replaces Orchestrator prompt`
              : 'Empty — default Orchestrator prompt will be used'}
          </span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {customSystemPrompt && (
              <button
                className="prompt-editor-btn prompt-editor-btn--reset"
                onClick={() => {
                  onSave('');
                  onClose();
                }}
              >
                Reset to Default
              </button>
            )}
            <button
              className="prompt-editor-btn prompt-editor-btn--save"
              onClick={() => {
                onSave(draft.trim());
                onClose();
              }}
            >
              {draft.trim() ? 'Apply Prompt' : 'Use Default'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
