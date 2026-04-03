import React from 'react';
import { FileText, X as XIcon } from 'lucide-react';

/**
 * Attachment chip for pending files before sending
 */
export default function AttachmentArea({ attachments, isVisionModel, onRemove }) {
  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="attachment-area">
      {attachments.map((a, i) => (
        <div key={i} className={`attachment-chip attachment-chip--${a.type}`}>
          {a.type === 'image' ? (
            <img src={a.preview} alt={a.name} className="attachment-thumb" />
          ) : (
            <FileText size={14} />
          )}
          <span className="attachment-chip-name">{a.name}</span>
          {!isVisionModel && a.type === 'image' && (
            <span className="attachment-chip-hint" title="Will be described by Qwen3vision">
              👁
            </span>
          )}
          <button className="attachment-chip-remove" onClick={() => onRemove(i)} title="Remove">
            <XIcon size={11} />
          </button>
        </div>
      ))}
    </div>
  );
}
