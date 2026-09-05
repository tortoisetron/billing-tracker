# Claude API Daily Cost Report → Slack

Posts a daily cost report to Slack every weekday morning, showing:
- Overall org spend with progress bar
- Per-workspace breakdown
- Burn rate and projected end-of-month total
- Alerts at 80% and 95% of budget

---

## Setup (5 steps)

### 1. Get your Anthropic Admin API Key
- Go to [console.anthropic.com](https://console.anthropic.com)
- Settings → API Keys → create a key with **Admin** permissions

### 2. Get your Slack Webhook URL
- Go to [api.slack.com/apps](https://api.slack.com/apps)
- Create an app → Incoming Webhooks → Activate → Add New Webhook
- Copy the webhook URL (looks like `https://hooks.slack.com/services/XXX/YYY/ZZZ`)

### 3. Add secrets to your GitHub repo
- Go to your repo → Settings → Secrets and variables → Actions
- Add two secrets:
  - `ANTHROPIC_ADMIN_KEY` → your Anthropic admin key
  - `SLACK_WEBHOOK_URL`   → your Slack webhook URL

### 4. Set your budgets
Open `scripts/daily-report.js` and edit the `WORKSPACE_BUDGETS` object:

```js
const WORKSPACE_BUDGETS = {
  "wrkspc_XXXX": 500,   // Client A workspace ID → $500/mo budget
  "wrkspc_YYYY": 300,   // Client B workspace ID → $300/mo budget
  default: 2000,        // Overall org budget
};
```

To find your workspace IDs:
```bash
curl https://api.anthropic.com/v1/workspaces \
  -H "x-api-key: YOUR_ADMIN_KEY" \
  -H "anthropic-version: 2023-06-01"
```

### 5. Push to GitHub
The workflow runs automatically every weekday at 9:00 AM IST.
You can also trigger it manually from the Actions tab.

---

## Example Slack Output

```
🤖 Claude API — Daily Cost Report — Sep 5

📊 Organisation Total
🟠 [████████████░░░░░░░░] 62.3%
• Spent: $1,247.50 of $2,000.00
• Remaining: $752.50
• Avg burn: $147.94/day
• Projected month total: $1,921.22
• Budget lasts: 5.1 more days (to Sep 10)

────────────────────────────────────
Per Workspace Breakdown

📁 Client A
🟢 [██████░░░░░░░░░░░░░░] 34.2%
• Spent: $171.00 of $500.00
• Remaining: $329.00
• Avg burn: $20.24/day

📁 Client B
🔴 [████████████████████] 97.1%
• Spent: $291.30 of $300.00
• Remaining: $8.70
• Avg burn: $34.44/day

🚨 WARNING: Client B is at 97% of budget!
```
