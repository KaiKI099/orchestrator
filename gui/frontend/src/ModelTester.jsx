import React, { useState, useRef, useCallback } from 'react';
import { X, Play, Loader, CheckCircle, XCircle, AlertCircle, SkipForward, Zap, Code, Wrench, MessageSquare, Shield, FileJson, Eye, AudioLines } from 'lucide-react';

const TEST_ICONS = {
  speed: Zap,
  json: FileJson,
  function_call: Code,
  tool_call: Wrench,
  mcp_call: MessageSquare,
  vision: Eye,
  audio: AudioLines,
  discipline: Shield,
  custom: MessageSquare,
};

const TEST_LABELS = {
  speed: 'Response Speed',
  json: 'JSON-only Output',
  function_call: 'Function Calling',
  tool_call: 'Tool Calling (multi)',
  mcp_call: 'MCP Tool Calling',
  vision: 'Vision (Image)',
  audio: 'Audio Input',
  discipline: 'Instruction Discipline',
  custom: 'Custom Message',
};

export default function ModelTester({ onClose, currentBackend, currentModel }) {
  const [running, setRunning] = useState(false);
  const [tests, setTests] = useState([]);
  const [currentTest, setCurrentTest] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [customMessage, setCustomMessage] = useState('');
  const abortRef = useRef(null);

  const runTests = useCallback(async () => {
    setRunning(true);
    setTests([]);
    setCurrentTest(null);
    setSummary(null);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('http://localhost:3001/api/model-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: currentModel,
          backend: currentBackend,
          customMessage: customMessage.trim() || undefined,
        }),
        signal: controller.signal,
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEventType = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEventType = line.slice(7).trim();
            continue;
          }
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (dataStr === '[DONE]') continue;

            try {
              const data = JSON.parse(dataStr);

              if (currentEventType === 'test_start') {
                setCurrentTest(data);
                setTests(prev => [...prev, { ...data, status: 'running' }]);
              } else if (currentEventType === 'test_done') {
                setCurrentTest(null);
                setTests(prev =>
                  prev.map(t =>
                    t.id === data.id ? { ...t, ...data, status: data.ok ? 'pass' : data.skipped ? 'skipped' : 'fail' } : t
                  )
                );
              } else if (currentEventType === 'summary') {
                setSummary(data);
              } else if (currentEventType === 'error') {
                setError(data.message);
              }
            } catch {}
          }
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        setError(e.message);
      }
    } finally {
      setRunning(false);
      setCurrentTest(null);
      abortRef.current = null;
    }
  }, [currentBackend, currentModel, customMessage]);

  const stopTests = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
  }, []);

  const getScoreColor = (score) => {
    if (score >= 90) return '#4ade80';
    if (score >= 70) return '#22d3ee';
    if (score >= 50) return '#facc15';
    if (score >= 30) return '#fb923c';
    return '#f87171';
  };

  const getScoreLabel = (score) => {
    if (score >= 90) return 'Excellent';
    if (score >= 70) return 'Good';
    if (score >= 50) return 'Usable';
    if (score >= 30) return 'Marginal';
    return 'Not Recommended';
  };

  return (
    <div className="mcp-overlay" onClick={onClose}>
      <div className="mcp-panel model-tester-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="mcp-panel-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>🧪</span>
            <span>Model Tester</span>
            {currentModel && (
              <span className="mcp-badge" style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {currentModel}
              </span>
            )}
          </div>
          <button className="mcp-close-btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="mcp-panel-body model-tester-body">
          {/* Model info */}
          <div className="model-tester-info">
            <span className="model-tester-backend">{currentBackend}</span>
            <span className="model-tester-model">{currentModel || '(auto)'}</span>
          </div>

          {/* Custom message input */}
          <div className="model-tester-custom">
            <input
              type="text"
              className="model-tester-input"
              placeholder="Optional: custom message to test..."
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              disabled={running}
            />
          </div>

          {/* Run button */}
          {!running && (
            <button className="model-tester-run-btn" onClick={runTests}>
              <Play size={14} />
              Run All Tests
            </button>
          )}
          {running && (
            <button className="model-tester-stop-btn" onClick={stopTests}>
              <Loader size={14} className="mcp-spin" />
              Stop Tests
            </button>
          )}

          {/* Progress indicator */}
          {running && currentTest && (
            <div className="model-tester-progress">
              <Loader size={14} className="mcp-spin" />
              Running: {TEST_LABELS[currentTest.id] || currentTest.name}
            </div>
          )}

          {/* Test results */}
          {tests.length > 0 && (
            <div className="model-tester-results">
              {tests.map((test) => {
                const Icon = TEST_ICONS[test.id] || MessageSquare;
                return (
                  <div key={test.id} className={`model-test-result ${test.status}`}>
                    <div className="model-test-result-icon">
                      {test.status === 'running' ? (
                        <Loader size={16} className="mcp-spin" />
                      ) : test.status === 'pass' ? (
                        <CheckCircle size={16} />
                      ) : test.status === 'skipped' ? (
                        <SkipForward size={16} />
                      ) : (
                        <XCircle size={16} />
                      )}
                    </div>
                    <div className="model-test-result-info">
                      <div className="model-test-result-name">
                        {TEST_LABELS[test.id] || test.name}
                        {test.elapsed != null && (
                          <span className="model-test-result-time">{test.elapsed.toFixed(1)}s</span>
                        )}
                      </div>
                      <div className="model-test-result-detail">{test.detail}</div>
                      {test.warning && (
                        <div className="model-test-result-warning">
                          <AlertCircle size={12} />
                          {test.warning}
                        </div>
                      )}
                    </div>
                    {test.weight != null && (
                      <div className="model-test-result-weight">{test.weight}%</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Summary */}
          {summary && (
            <div className="model-tester-summary">
              <div className="model-tester-score" style={{ color: getScoreColor(summary.score) }}>
                <div className="model-tester-score-value">{summary.score}</div>
                <div className="model-tester-score-label">/ 100</div>
              </div>
              <div className="model-tester-verdict" style={{ color: getScoreColor(summary.score) }}>
                {getScoreLabel(summary.score)}
              </div>
              <div className="model-tester-verdict-detail">{summary.verdict}</div>
              {summary.warnings.length > 0 && (
                <div className="model-tester-warnings">
                  {summary.warnings.map((w, i) => (
                    <div key={i} className="model-tester-warning">
                      <AlertCircle size={12} />
                      {w}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mcp-error">
              <XCircle size={14} />
              {error}
            </div>
          )}

          {/* Empty state */}
          {!running && tests.length === 0 && !error && (
            <div className="model-tester-empty">
              Click "Run All Tests" to test the selected model's capabilities including JSON output, function calling, tool calling, MCP integration, and instruction following.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mcp-panel-footer">
          Tests run against {currentBackend}/{currentModel || 'auto'} • Results are indicative, not definitive
        </div>
      </div>
    </div>
  );
}
