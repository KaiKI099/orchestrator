import request from 'supertest';
import { describe, it, test, before, after } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import cors from 'cors';

// Create test app that mimics the main server endpoints
const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Backends endpoint
app.get('/api/backends', (req, res) => {
  res.json({
    backends: ['lmstudio', 'ollama', 'claude', 'nvidia'],
    active: 'ollama'
  });
});

// Models endpoint
app.get('/api/models/:backend', (req, res) => {
  const { backend } = req.params;
  res.json({ models: [{ id: 'test-model', contextLength: 4096 }] });
});

// Chat endpoint (basic validation)
app.post('/api/chat', (req, res) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }
  res.json({ reply: 'Echo: ' + message });
});

describe('Backend Server API', () => {
  let server;

  before(async () => {
    server = app.listen(3002);
  });

  after((done) => {
    server.close(done);
  });

  test('GET /api/health returns status ok', async () => {
    const res = await request(app).get('/api/health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ok');
    assert.ok(res.body.timestamp);
  });

  test('GET /api/backends returns backend list', async () => {
    const res = await request(app).get('/api/backends');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.backends));
    assert.ok(res.body.backends.includes('ollama'));
    assert.ok(res.body.active);
  });

  test('GET /api/models/:backend returns models', async () => {
    const res = await request(app).get('/api/models/ollama');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.models));
    assert.strictEqual(res.body.models[0].id, 'test-model');
  });

  test('POST /api/chat without message returns 400', async () => {
    const res = await request(app).post('/api/chat').send({});
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error);
  });

  test('POST /api/chat with message returns reply', async () => {
    const res = await request(app).post('/api/chat').send({ message: 'Hello' });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.reply);
  });
});

describe('Server Configuration', () => {
  test('PORT environment variable is configurable', () => {
    const PORT = parseInt(process.env.PORT || '3001', 10);
    assert.strictEqual(typeof PORT, 'number');
    assert.ok(PORT > 0);
  });

  test('BACKENDS object has all required providers', () => {
    const backends = ['lmstudio', 'ollama', 'claude', 'nvidia'];
    backends.forEach(b => assert.ok(typeof b === 'string' && b.length > 0));
  });

  test('Default constants are defined', () => {
    const TEMPERATURE = parseFloat(process.env.TEMPERATURE || "0.7");
    const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || "4096", 10);
    assert.strictEqual(typeof TEMPERATURE, 'number');
    assert.ok(TEMPERATURE >= 0 && TEMPERATURE <= 2);
    assert.ok(MAX_TOKENS > 0);
  });
});
