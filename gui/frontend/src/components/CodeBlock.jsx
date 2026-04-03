import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

/**
 * CodeBlock component with syntax highlighting wrapper and copy button
 */
export default function CodeBlock({ children, className }) {
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
          {copied ? (
            <>
              <Check size={11} /> Copied
            </>
          ) : (
            <>
              <Copy size={11} /> Copy
            </>
          )}
        </button>
      </div>
      <pre>
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}
