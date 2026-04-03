import React from 'react';
import { Send, Square, Paperclip, Loader } from 'lucide-react';
import AttachmentArea from './AttachmentArea';

/**
 * Input form with file upload, text input, and send/stop buttons
 */
export default function ChatInput({
  inputMessage,
  setInputMessage,
  attachments,
  setAttachments,
  isLoading,
  describingImage,
  isVisionModel,
  customSystemPrompt,
  activeMode,
  onFileSelect,
  onSubmit,
  onStop,
  onRemoveAttachment,
}) {
  const fileInputRef = React.useRef(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <footer className="input-container">
      {/* Attachment chips (pending files not yet sent) */}
      <AttachmentArea
        attachments={attachments}
        isVisionModel={isVisionModel}
        onRemove={onRemoveAttachment}
      />

      <div className="input-row">
        <form onSubmit={handleSubmit} className="input-box">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.txt,.md,text/plain,text/markdown"
            multiple
            style={{ display: 'none' }}
            onChange={onFileSelect}
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
              describingImage
                ? 'Describing image with Qwen3vision…'
                : isLoading
                  ? 'Generating…'
                  : customSystemPrompt
                    ? 'Custom prompt active — type your message…'
                    : activeMode === 'coder'
                      ? 'Describe your coding task…'
                      : 'Type your marketing assignment here…'
            }
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            disabled={isLoading || describingImage}
          />

          {isLoading || describingImage ? (
            <button
              type="button"
              className="stop-btn"
              onClick={onStop}
              title="Stop generation"
              disabled={describingImage}
            >
              {describingImage ? (
                <Loader size={16} className="mcp-spin" />
              ) : (
                <Square size={16} fill="currentColor" />
              )}
            </button>
          ) : (
            <button type="submit" disabled={!inputMessage.trim() && attachments.length === 0}>
              <Send size={18} />
            </button>
          )}
        </form>
      </div>
    </footer>
  );
}
