"""
Orchestrator Agent — routes user messages to 9 specialist marketing subagents.
Uses LM Studio as local model server (OpenAI-compatible API on localhost:1234).
"""

import os
import sys
import requests
from typing import Optional
from agents import AGENTS

# ── Config ────────────────────────────────────────────────────────────────────
LM_STUDIO_BASE = os.getenv("LM_STUDIO_URL", "http://localhost:1234/v1")
LM_STUDIO_MODEL = os.getenv("LM_STUDIO_MODEL", "")   # auto-detect if blank
TEMPERATURE = float(os.getenv("TEMPERATURE", "0.7"))
MAX_TOKENS = int(os.getenv("MAX_TOKENS", "4096"))
STREAM = os.getenv("STREAM", "true").lower() == "true"

ORCHESTRATOR_SYSTEM = """You are an Orchestrator — the master coordinator of 9 specialist marketing agents.

Your team:
  🔍 findkey         — broad keyword research (SEO)
  🛒 findbuykey      — buy-intent / transactional keywords
  📢 findadwords     — Google Ads, CPC, competitor ad analysis
  🔗 findbacklinks   — backlink opportunities, link building
  🎯 findcompetitors — competitor intelligence, tier analysis
  🔬 findcritics     — quality control, PASS/REVISE/REDO verdicts
  🌊 findfunnels     — sales funnel reverse engineering
  💡 findideas       — marketing ideas, 90-day roadmaps
  🌍 findregions     — regional sales intelligence

Your job:
1. Understand what the user needs
2. Decide which agent (or combination) is best suited
3. If the task spans multiple agents, coordinate them and synthesize outputs
4. Be transparent: always state which agent you are routing to
5. If the user names an agent directly, route there immediately

Routing format: start your reply with "→ Routing to [emoji] [agent name]..."
For general questions, answer directly without routing.
Keep your own framing concise — let the specialist agents do the heavy lifting.
"""

# ── LM Studio helpers ─────────────────────────────────────────────────────────

def get_model() -> str:
    """Auto-detect the first loaded model from LM Studio."""
    if LM_STUDIO_MODEL:
        return LM_STUDIO_MODEL
    try:
        r = requests.get(f"{LM_STUDIO_BASE}/models", timeout=5)
        models = r.json().get("data", [])
        if models:
            return models[0]["id"]
    except Exception:
        pass
    return "local-model"


def chat_completion(messages: list, system: Optional[str] = None) -> str:
    """Call LM Studio /v1/chat/completions. Streams output if STREAM=true."""
    payload_messages = []
    if system:
        payload_messages.append({"role": "system", "content": system})
    payload_messages.extend(messages)

    model = get_model()

    try:
        if STREAM:
            return _stream_completion(payload_messages, model)
        else:
            return _blocking_completion(payload_messages, model)
    except requests.exceptions.ConnectionError:
        return (
            "\n⚠️  Cannot connect to LM Studio.\n"
            f"   Start LM Studio → Local Server tab → Load a model → Start Server\n"
            f"   Expected URL: {LM_STUDIO_BASE}\n"
        )
    except Exception as e:
        return f"\n⚠️  LM Studio error: {e}\n"


def _blocking_completion(messages: list, model: str) -> str:
    r = requests.post(
        f"{LM_STUDIO_BASE}/chat/completions",
        json={"model": model, "messages": messages,
              "temperature": TEMPERATURE, "max_tokens": MAX_TOKENS, "stream": False},
        timeout=180,
    )
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]


def _stream_completion(messages: list, model: str) -> str:
    """Stream tokens to stdout as they arrive; return full text."""
    import json as _json
    r = requests.post(
        f"{LM_STUDIO_BASE}/chat/completions",
        json={"model": model, "messages": messages,
              "temperature": TEMPERATURE, "max_tokens": MAX_TOKENS, "stream": True},
        stream=True,
        timeout=180,
    )
    r.raise_for_status()
    full = []
    for line in r.iter_lines():
        if not line:
            continue
        raw = line.decode("utf-8")
        if raw.startswith("data: "):
            raw = raw[6:]
        if raw == "[DONE]":
            break
        try:
            chunk = _json.loads(raw)
            delta = chunk["choices"][0]["delta"].get("content", "")
            if delta:
                print(delta, end="", flush=True)
                full.append(delta)
        except Exception:
            pass
    print()   # newline after stream
    return "".join(full)


# ── Routing logic ─────────────────────────────────────────────────────────────

def detect_agent(msg: str) -> Optional[str]:
    """Fast keyword-based agent detection."""
    lower = msg.lower()
    for agent_id, agent in AGENTS.items():
        for trigger in agent["triggers"]:
            if trigger in lower:
                return agent_id
    return None


def call_agent(agent_id: str, user_message: str, history: list) -> str:
    agent = AGENTS[agent_id]
    print(f"\n  → {agent['emoji']} {agent['name']}\n", flush=True)
    messages = list(history[-6:]) + [{"role": "user", "content": user_message}]
    return chat_completion(messages, system=agent["system_prompt"])


def call_orchestrator(user_message: str, history: list) -> str:
    print("\n  → 🤖 Orchestrator\n", flush=True)
    messages = list(history[-10:]) + [{"role": "user", "content": user_message}]
    return chat_completion(messages, system=ORCHESTRATOR_SYSTEM)


# ── UI helpers ────────────────────────────────────────────────────────────────

def print_header():
    w = 64
    print("\n" + "═" * w)
    print("  🤖  MARKETING AGENT ORCHESTRATOR  ·  LM Studio local")
    print("═" * w)
    print("\n  Agents:")
    for a in AGENTS.values():
        desc = a["description"][:52]
        print(f"    {a['emoji']}  {a['name']:<18} {desc}")
    print("\n  Commands:  /agents  /agent <name> <query>  /model  /clear  /quit")
    print("  Just chat — routing is automatic.\n" + "═" * w + "\n")


def print_agents_table():
    print("\n┌─ Agents " + "─" * 56)
    for a in AGENTS.values():
        print(f"│  {a['emoji']}  {a['name']:<18} {a['description']}")
    print("└" + "─" * 65 + "\n")


# ── Main chat loop ────────────────────────────────────────────────────────────

def main():
    print_header()
    history = []

    while True:
        try:
            user_input = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n\nGoodbye! 👋")
            sys.exit(0)

        if not user_input:
            continue

        cmd = user_input.lower()

        if cmd == "/quit":
            print("Goodbye! 👋")
            break

        elif cmd == "/clear":
            history.clear()
            print("  ✅ History cleared.\n")
            continue

        elif cmd == "/agents":
            print_agents_table()
            continue

        elif cmd == "/model":
            print(f"  🖥️  Model: {get_model()}\n")
            continue

        elif cmd.startswith("/agent "):
            # /agent <name> <query>
            parts = user_input[7:].split(" ", 1)
            name = parts[0].lower()
            query = parts[1] if len(parts) > 1 else ""
            if name in AGENTS:
                resp = call_agent(name, query, history)
                if not STREAM:
                    print(f"\n{AGENTS[name]['emoji']} {AGENTS[name]['name']}:\n{resp}\n")
                else:
                    print()   # stream already printed above
                history.extend([
                    {"role": "user", "content": user_input},
                    {"role": "assistant", "content": resp},
                ])
            else:
                print(f"  ⚠️  Unknown agent '{name}'. Use /agents to list them.\n")
            continue

        # ── Auto-routing ──────────────────────────────────────────────
        detected = detect_agent(user_input)

        if detected:
            resp = call_agent(detected, user_input, history)
        else:
            resp = call_orchestrator(user_input, history)

        if not STREAM:
            label = (f"{AGENTS[detected]['emoji']} {AGENTS[detected]['name']}"
                     if detected else "🤖 Orchestrator")
            print(f"\n{label}:\n{resp}\n")
        else:
            print()

        history.extend([
            {"role": "user", "content": user_input},
            {"role": "assistant", "content": resp},
        ])


if __name__ == "__main__":
    main()
