// context-status.cjs — called by Claude Code statusLine
// Reads .claude/context-status.json and renders a compact progress bar
//
// No stdin — just outputs a single line to stdout.

const fs = require("fs");
const path = require("path");

const STATUS_FILE = path.join(__dirname, "..", "context-status.json");

// Context pressure levels and their visual representation
// 0 compactions = cool, 1 = warm, 2 = getting full, 3+ = hot
const BAR_CHARS = ["▁", "▂", "▄", "▆", "█"];

function formatDuration(minutes) {
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${m > 0 ? m + "m" : ""}`;
}

try {
  if (!fs.existsSync(STATUS_FILE)) {
    console.log("▁ no session data yet");
    process.exit(0);
  }

  const state = JSON.parse(fs.readFileSync(STATUS_FILE, "utf-8"));
  const { turns, compactions, startedAt } = state;

  // Session duration
  const durationMin = Math.round(
    (Date.now() - new Date(startedAt).getTime()) / 60000
  );

  // Pressure: 0-4 scale based on compaction count
  const pressure = Math.min(compactions, BAR_CHARS.length - 1);
  const barChar = BAR_CHARS[pressure];

  // Build output
  const parts = [`${barChar} context`];

  if (turns > 0) parts.push(`${turns}t`);
  if (compactions > 0) parts.push(`compact×${compactions}`);
  if (durationMin >= 0) parts.push(formatDuration(durationMin));

  const output = parts.join(" · ");

  // Color hints via osc sequences (terminal-dependent, graceful fallback)
  // Green for low pressure, yellow for medium, red for high
  const colors = ["32", "33", "31", "31"]; // green, yellow, red, red
  const color = colors[pressure] || "32";

  // Output with optional color. Use plain text if no color support.
  // Check NO_COLOR and TERM
  if (process.env.NO_COLOR || process.env.TERM === "dumb") {
    console.log(output);
  } else {
    console.log(`\x1b[${color}m${output}\x1b[0m`);
  }
} catch (err) {
  // Silent failure — don't break Claude Code
  console.log("▁ err");
}
