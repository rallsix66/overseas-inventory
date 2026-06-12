// context-tracker.cjs — called by Claude Code hooks
// Reads hook event JSON from stdin, updates .claude/context-status.json
//
// Usage in hooks:  node .claude/scripts/context-tracker.cjs <EventName>

const fs = require("fs");
const path = require("path");

const STATUS_FILE = path.join(__dirname, "..", "context-status.json");

function readState() {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      return JSON.parse(fs.readFileSync(STATUS_FILE, "utf-8"));
    }
  } catch {
    // corrupted file → reset
  }
  return {
    sessionId: "",
    startedAt: new Date().toISOString(),
    turns: 0,
    compactions: 0,
    lastCompaction: null,
    lastUpdated: new Date().toISOString(),
  };
}

function writeState(state) {
  state.lastUpdated = new Date().toISOString();
  // Ensure parent directory exists
  const dir = path.dirname(STATUS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATUS_FILE, JSON.stringify(state, null, 2));
}

// --- Main ---
let input = {};
try {
  const raw = fs.readFileSync(0, "utf-8");
  if (raw.trim()) input = JSON.parse(raw);
} catch {
  // no stdin — use defaults
}

const eventType = process.argv[2] || "unknown";
const state = readState();

switch (eventType) {
  case "SessionStart":
    // Fresh session — reset all counters
    state.sessionId = input.session_id || "";
    state.startedAt = new Date().toISOString();
    state.turns = 0;
    state.compactions = 0;
    state.lastCompaction = null;
    break;

  case "UserPromptSubmit":
    // Each user message = one "turn"
    state.turns += 1;
    break;

  case "PreCompact":
    // Context is about to be compacted — the most reliable "full" signal
    state.compactions += 1;
    state.lastCompaction = new Date().toISOString();
    break;

  default:
    // Unknown event — silently ignore (don't corrupt state)
    process.exit(0);
}

writeState(state);
