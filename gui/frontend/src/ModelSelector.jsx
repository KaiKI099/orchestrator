import React, { useState, useEffect, useCallback } from 'react';
import { X, RefreshCw, Check, ChevronDown, Loader } from 'lucide-react';

export default function ModelSelector({ onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selecting, setSelecting] = useState(null); // "backendKey/modelId"

  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch('http://localhost:3001/api/models');
      if (!res.ok) throw new Error('Backend unreachable');
      setData(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchModels(); }, [fetchModels]);

  async function handleRefresh() {
    setRefreshing(true);
    await fetchModels();
  }

  async function selectModel(backendKey, modelId) {
    const key = `${backendKey}/${modelId}`;
    setSelecting(key);
    try {
      const res = await fetch('http://localhost:3001/api/models/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backend: backendKey, model: modelId }),
      });
      const json = await res.json();
      setData(prev => prev ? { ...prev, active: json.active } : prev);
    } catch (e) {
      console.error(e);
    } finally {
      setSelecting(null);
    }
  }

  const isActive = (backendKey, modelId) =>
    data?.active.backend === backendKey && data?.active.model === modelId;

  return (
    <div className="mcp-overlay" onClick={() => onClose(data?.active)}>
      <div className="mcp-panel model-panel" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="mcp-panel-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>🤖</span>
            <span>Model Selection</span>
            {data?.active.model && (
              <span className="mcp-badge" style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {data.active.model}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button className="mcp-close-btn" onClick={handleRefresh} title="Refresh model lists" disabled={refreshing}>
              <RefreshCw size={14} className={refreshing ? 'mcp-spin' : ''} />
            </button>
            <button className="mcp-close-btn" onClick={() => onClose(data?.active)}>
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="mcp-panel-body">
          {loading && (
            <div className="mcp-loading"><Loader size={16} className="mcp-spin" /> Loading backends…</div>
          )}

          {!loading && data && Object.entries(data.backends).map(([key, backend]) => (
            <div key={key} className="model-backend-section">
              {/* Backend header */}
              <div className={`model-backend-header ${data.active.backend === key ? 'model-backend-header--active' : ''}`}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span>{backend.icon}</span>
                  <span className="model-backend-name">{backend.name}</span>
                  <span className={`model-online-dot ${backend.online ? 'dot--online' : 'dot--offline'}`}>
                    {backend.online ? '● online' : '● offline'}
                  </span>
                </div>
                <span className="model-backend-url">{backend.url}</span>
              </div>

              {/* Model list */}
              {!backend.online && (
                <div className="model-offline-msg">
                  {backend.error || 'Cannot reach server'}
                </div>
              )}

              {backend.online && backend.models.length === 0 && (
                <div className="model-offline-msg">No models loaded</div>
              )}

              {backend.online && (
                <div className="model-list-scroll">
                  {backend.models.map(modelId => {
                    const active = isActive(key, modelId);
                    const busy = selecting === `${key}/${modelId}`;
                    return (
                      <button
                        key={modelId}
                        className={`model-item ${active ? 'model-item--active' : ''}`}
                        onClick={() => selectModel(key, modelId)}
                        disabled={!!selecting}
                      >
                        <span className="model-item-name">{modelId}</span>
                        <span className="model-item-right">
                          {busy && <Loader size={12} className="mcp-spin" />}
                          {active && !busy && <Check size={13} style={{ color: '#4ade80' }} />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mcp-panel-footer">
          Selected model is used for all agent calls • Changes take effect immediately
        </div>
      </div>
    </div>
  );
}
