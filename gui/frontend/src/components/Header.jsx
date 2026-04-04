import React from 'react';
import { Download, Trash2, Settings, ChevronDown, FlaskConical } from 'lucide-react';

/**
 * Header component with mode tabs, quick-switch buttons, and settings
 */
export default function Header({
  activeMode,
  setActiveMode,
  onClear,
  onDownload,
  messages,
  activeBackendLabel,
  activeModelLabel,
  activeMcpCount,
  onQuickSwitchBackend,
  onOpenModelSelector,
  onOpenMcpSettings,
  onOpenModelTester,
}) {
  const backendNames = {
    lmstudio: 'LM Studio',
    ollama: 'Ollama',
    claude: 'Claude',
    nvidia: 'NVIDIA',
  };

  return (
    <header className="header">
      <div className="mode-tabs">
        <button
          className={`mode-tab ${activeMode === 'marketing' ? 'mode-tab--active' : ''}`}
          onClick={() => {
            setActiveMode('marketing');
            onClear();
          }}
        >
          🤖 <span>Orchestrator</span>
        </button>
        <button
          className={`mode-tab ${activeMode === 'coder' ? 'mode-tab--active' : ''}`}
          onClick={() => {
            setActiveMode('coder');
            onClear();
          }}
        >
          💻 <span>ProCoder</span>
        </button>
      </div>

      <div className="header-actions">
        {messages.length > 0 && (
          <>
            <button className="hdr-btn" onClick={onDownload} title="Download conversation">
              <Download size={15} />
            </button>
            <button
              className="hdr-btn hdr-btn--danger"
              onClick={onClear}
              title="Clear conversation"
            >
              <Trash2 size={15} />
            </button>
          </>
        )}

        {/* Quick-switch backend buttons */}
        <button
          className={`backend-quick-btn ${activeBackendLabel === 'Claude' ? 'backend-quick-btn--active' : ''}`}
          onClick={() => onQuickSwitchBackend('claude', 'Claude')}
          title="Switch to Claude (Anthropic)"
        >
          <span className="backend-quick-icon">🟣</span>
          <span>Claude</span>
        </button>

        <button
          className={`backend-quick-btn ${activeBackendLabel === 'NVIDIA' ? 'backend-quick-btn--active' : ''}`}
          onClick={() => onQuickSwitchBackend('nvidia', 'NVIDIA')}
          title="Switch to NVIDIA (Kimi K2.5)"
        >
          <span className="backend-quick-icon">🟢</span>
          <span>NVIDIA</span>
        </button>

        {/* Model / backend switcher */}
        <button className="model-btn" onClick={onOpenModelSelector} title="Switch model or backend">
          <span className="model-btn-backend">{activeBackendLabel}</span>
          {activeModelLabel && (
            <span className="model-btn-name">
              {activeModelLabel.split(':')[0].split('/').pop()}
            </span>
          )}
          <ChevronDown size={12} style={{ opacity: 0.6 }} />
        </button>

        <button
          className={`mcp-settings-btn ${activeMcpCount > 0 ? 'mcp-settings-btn--active' : ''}`}
          onClick={onOpenMcpSettings}
          title="MCP Servers"
        >
          <Settings size={15} />
          <span>MCP</span>
          {activeMcpCount > 0 && <span className="mcp-settings-badge">{activeMcpCount}</span>}
        </button>

        <button
          className="model-tester-btn"
          onClick={onOpenModelTester}
          title="Test current model"
        >
          <FlaskConical size={15} />
          <span>Test</span>
        </button>
      </div>
    </header>
  );
}
