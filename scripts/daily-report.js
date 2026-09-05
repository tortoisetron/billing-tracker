// daily-report.js
// Fetches Anthropic usage + cost data and posts to Slack

const ADMIN_API_KEY = process.env.ANTHROPIC_ADMIN_KEY;
const SLACK_WEBHOOK  = process.env.SLACK_WEBHOOK_URL;

// ── CONFIG ────────────────────────────────────────────────────────────────────
// Set a monthly budget per workspace (workspace_id → budget in $)
// If a workspace isn't listed here it will show without a budget limit
const WORKSPACE_BUDGETS = {
  // "wrkspc_XXXX": 500,   // Client A  → $500/mo
  // "wrkspc_YYYY": 300,   // Client B  → $300/mo
  default: 2000,            // Overall org budget
};
// ─────────────────────────────────────────────────────────────────────────────

function getMonthRange() {
  const now   = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const end   = now.toISOString();
  return { start, end };
}

function progressBar(percent, width = 20) {
  const filled = Math.round((percent / 100) * width);
  const empty  = width - filled;
  const bar    = "█".repeat(filled) + "░".repeat(empty);
  const emoji  = percent >= 95 ? "🔴" : percent >= 80 ? "🟠" : "🟢";
  return `${emoji} [${bar}] ${percent.toFixed(1)}%`;
}

function burnRate(spent, daysElapsed) {
  const daily = spent / daysElapsed;
  const daysInMonth = new Date(
    new Date().getFullYear(), new Date().getMonth() + 1, 0
  ).getDate();
  const projected = daily * daysInMonth;
  return { daily, projected };
}

async function fetchCostReport(start, end, groupByWorkspace = false) {
  const params = new URLSearchParams({
    starting_at: start,
    ending_at:   end,
  });
  if (groupByWorkspace) {
    params.append("group_by[]", "workspace_id");
  }

  const res = await fetch(
    `https://api.anthropic.com/v1/organizations/cost_report?${params}`,
    {
      headers: {
        "anthropic-version": "2023-06-01",
        "x-api-key": ADMIN_API_KEY,
      },
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Cost API error ${res.status}: ${err}`);
  }
  return res.json();
}

async function fetchWorkspaces() {
  const res = await fetch("https://api.anthropic.com/v1/workspaces?limit=100", {
    headers: {
      "anthropic-version": "2023-06-01",
      "x-api-key": ADMIN_API_KEY,
    },
  });
  if (!res.ok) return {};
  const data = await res.json();
  // Return a map of id → name
  return Object.fromEntries((data.data || []).map(w => [w.id, w.name]));
}

function formatSection(label, spent, budget, daysElapsed, isWorkspace = false) {
  const percent   = budget ? Math.min((spent / budget) * 100, 100) : null;
  const { daily, projected } = burnRate(spent, daysElapsed);
  const daysLeft  = budget ? Math.max((budget - spent) / daily, 0) : null;

  const lines = [];

  if (isWorkspace) {
    lines.push(`\n*📁 ${label}*`);
  } else {
    lines.push(`\n*📊 ${label}*`);
  }

  if (budget && percent !== null) {
    lines.push(progressBar(percent));
    lines.push(`• Spent: *$${spent.toFixed(2)}* of *$${budget.toFixed(2)}*`);
    lines.push(`• Remaining: *$${(budget - spent).toFixed(2)}*`);
  } else {
    lines.push(`• Spent: *$${spent.toFixed(2)}* (no budget set)`);
  }

  lines.push(`• Avg burn: *$${daily.toFixed(2)}/day*`);
  lines.push(`• Projected month total: *$${projected.toFixed(2)}*`);

  if (daysLeft !== null) {
    const projectedDate = new Date();
    projectedDate.setDate(projectedDate.getDate() + daysLeft);
    lines.push(
      `• Budget lasts: *${daysLeft.toFixed(1)} more days* (to ${projectedDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })})`
    );
  }

  return lines.join("\n");
}

async function main() {
  const { start, end } = getMonthRange();

  const now         = new Date();
  const daysElapsed = now.getDate(); // day of month
  const monthLabel  = now.toLocaleString("en-US", { month: "long", year: "numeric" });

  // Fetch data in parallel
  const [overallData, workspaceData, workspaceNames] = await Promise.all([
    fetchCostReport(start, end, false),
    fetchCostReport(start, end, true),
    fetchWorkspaces(),
  ]);

  // ── Overall total ──────────────────────────────────────────────────────────
  const totalSpent = (overallData.data || []).reduce(
    (sum, row) => sum + (row.cost_usd ?? 0), 0
  );

  const orgBudget  = WORKSPACE_BUDGETS.default;
  const orgPercent = (totalSpent / orgBudget) * 100;

  // ── Per-workspace breakdown ────────────────────────────────────────────────
  // Group rows by workspace_id
  const byWorkspace = {};
  for (const row of workspaceData.data || []) {
    const wsId = row.workspace_id || "unknown";
    byWorkspace[wsId] = (byWorkspace[wsId] || 0) + (row.cost_usd ?? 0);
  }

  // ── Build Slack message ────────────────────────────────────────────────────
  const today = now.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  let message = `*🤖 Claude API — Daily Cost Report — ${today}*\n`;
  message += `_${monthLabel} · Day ${daysElapsed} of month_\n`;
  message += "─".repeat(36);

  // Overall section
  message += formatSection(
    "Organisation Total",
    totalSpent,
    orgBudget,
    daysElapsed,
    false
  );

  // Workspace sections
  if (Object.keys(byWorkspace).length > 0) {
    message += "\n\n" + "─".repeat(36);
    message += "\n*Per Workspace Breakdown*";

    for (const [wsId, spent] of Object.entries(byWorkspace)) {
      const name   = workspaceNames[wsId] || wsId;
      const budget = WORKSPACE_BUDGETS[wsId] ?? null;
      message += formatSection(name, spent, budget, daysElapsed, true);
    }
  }

  // ── Threshold alert footer ─────────────────────────────────────────────────
  if (orgPercent >= 95) {
    message += "\n\n🚨 *CRITICAL: Organisation spend is at 95%+ of budget!*";
  } else if (orgPercent >= 80) {
    message += "\n\n⚠️ *WARNING: Organisation spend has crossed 80% of budget.*";
  }

  message += `\n\n_Sent by daily-report.js · data from Anthropic Admin API_`;

  // ── Post to Slack ──────────────────────────────────────────────────────────
  const slackRes = await fetch(SLACK_WEBHOOK, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ text: message }),
  });

  if (!slackRes.ok) {
    throw new Error(`Slack webhook failed: ${slackRes.status}`);
  }

  console.log("✅ Report sent to Slack successfully");
}

main().catch(err => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
