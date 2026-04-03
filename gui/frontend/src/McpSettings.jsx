import React, { useState, useEffect, useCallback } from 'react';
import { X, Zap, Loader, RefreshCw } from 'lucide-react';

export default function McpSettings({ onClose }) {
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);
  const [toggling, setToggling] = useState({});
  const [refreshing, setRefreshing] = useState(false);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('http://localhost:3001/api/mcp');
      if (!res.ok) throw new Error('Backend unreachable');
      setConfig(await res.json());
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // Poll every 3 s while any enabled server is still connecting
  useEffect(() => {
    if (!config) return;
    const hasConnecting = Object.values(config.servers).some((s) => s.enabled && !s.running);
    if (!hasConnecting) return;
    const id = setTimeout(fetchConfig, 3000);
    return () => clearTimeout(id);
  }, [config, fetchConfig]);

  async function handleRefresh() {
    setRefreshing(true);
    await fetchConfig();
    setRefreshing(false);
  }

  async function handleToggle(name, currentEnabled) {
    setToggling((prev) => ({ ...prev, [name]: true }));
    try {
      const res = await fetch(`http://localhost:3001/api/mcp/toggle/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !currentEnabled }),
      });
      if (!res.ok) throw new Error('Toggle failed');
      setConfig(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setToggling((prev) => ({ ...prev, [name]: false }));
    }
  }

  // Reconnect: disable then re-enable to restart the process
  async function handleReconnect(name) {
    setToggling((prev) => ({ ...prev, [name]: true }));
    try {
      await fetch(`http://localhost:3001/api/mcp/toggle/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      const res = await fetch(`http://localhost:3001/api/mcp/toggle/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });
      if (!res.ok) throw new Error('Reconnect failed');
      setConfig(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setToggling((prev) => ({ ...prev, [name]: false }));
    }
  }

  const connectedCount = config ? Object.values(config.servers).filter((s) => s.running).length : 0;

  return (
    <div className="mcp-overlay" onClick={() => onClose(config)}>
      <div className="mcp-panel" onClick={(e) => e.stopPropagation()}>
        <div className="mcp-panel-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Zap size={15} style={{ color: 'var(--accent-color)' }} />
            <span>MCP Servers</span>
            {connectedCount > 0 && <span className="mcp-badge">{connectedCount} connected</span>}
          </div>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button
              className="mcp-close-btn"
              onClick={handleRefresh}
              title="Refresh status"
              disabled={refreshing}
            >
              <RefreshCw size={14} className={refreshing ? 'mcp-spin' : ''} />
            </button>
            <button className="mcp-close-btn" onClick={() => onClose(config)}>
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="mcp-panel-body">
          {error && <div className="mcp-error">⚠️ {error}</div>}
          {!config && !error && (
            <div className="mcp-loading">
              <Loader size={16} className="mcp-spin" /> Connecting to backend…
            </div>
          )}
          {config &&
            Object.entries(config.servers).map(([name, server]) => (
              <div key={name} className={`mcp-row ${server.enabled ? 'mcp-row--on' : ''}`}>
                <span className="mcp-row-icon">{server.icon}</span>
                <div className="mcp-row-info">
                  <div className="mcp-row-name">{name}</div>
                  <div className="mcp-row-desc">{server.description}</div>
                  {server.enabled && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div
                        className={`mcp-row-status ${server.running ? 'mcp-row-status--ok' : 'mcp-row-status--pending'}`}
                      >
                        {server.running ? '● connected' : '○ connecting…'}
                      </div>
                      {!server.running && (
                        <button
                          className="mcp-reconnect-btn"
                          onClick={() => handleReconnect(name)}
                          disabled={toggling[name]}
                          title="Restart connection"
                        >
                          {toggling[name] ? (
                            <Loader size={9} className="mcp-spin" />
                          ) : (
                            <RefreshCw size={9} />
                          )}
                          retry
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <button
                  className={`mcp-toggle ${server.enabled ? 'mcp-toggle--on' : 'mcp-toggle--off'}`}
                  onClick={() => handleToggle(name, server.enabled)}
                  disabled={toggling[name]}
                  title={server.enabled ? 'Disable' : 'Enable'}
                >
                  {toggling[name] ? (
                    <Loader size={10} className="mcp-spin" />
                  ) : (
                    <div className="mcp-toggle-thumb" />
                  )}
                </button>
              </div>
            ))}
        </div>

        <div className="mcp-panel-footer">
          Connected servers are injected as tools into every agent call
        </div>
      </div>
    </div>
  );
}
