# LifeDash — LemonSqueezy Store Setup

## Store

| Item | Value |
|------|-------|
| Store ID | `301928` |
| Store URL | `lifedash.lemonsqueezy.com` |
| Payment platform | LemonSqueezy |

## Products

| Product | Product ID | Type |
|---------|-----------|------|
| LifeDash Pro (Annual) | `855065` | Yearly subscription — $29/year |
| LifeDash Pro (Lifetime) | `855068` | One-time payment — $99 |

## Checkout URLs

**Pro Annual ($29/year):**
```
https://lifedash.lemonsqueezy.com/checkout/buy/a7c9d2dc-c9f1-4fd5-ba0c-4045e98d726c
```

**Pro Lifetime ($99 once):**
```
https://lifedash.lemonsqueezy.com/checkout/buy/9ada7049-fa58-4dae-a3cf-79c1fd3c4f7a
```

## Customer Portal

```
https://app.lemonsqueezy.com/my-orders
```

Customers manage subscriptions, view orders, and download invoices here.

## Licensing Model

### Free Tier — $0, Forever
Full-featured core product with no limits:
- Unlimited projects, boards, cards, drag-and-drop
- Meeting recording & transcription (local Whisper)
- AI brainstorming (multi-provider)
- Task structuring engine
- Idea repository
- Focus time tracking & Pomodoro
- Gamification (XP, levels, achievements, streaks)
- BYOK AI (bring your own OpenAI, Anthropic, Ollama keys)
- Fully offline, privacy-first (embedded database, no cloud)

### Pro Tier — Unlocks AI Automation + Data Portability

| Pro Feature | Description |
|-------------|-------------|
| Card AI Agent | Per-card AI assistant with tool-calling (reads context, suggests edits, takes actions) |
| AI Meeting → Cards | Auto-convert meeting action items into project cards with labels and descriptions |
| Billable Time Export | Export focus sessions as formatted CSV for client invoicing |
| Backup & Restore | Full database backup to a single file, restore on any machine |
| Data Export | Export all data (projects, cards, meetings, ideas) as JSON or CSV |

### Pricing

| Plan | Price | Renewal | What happens if cancelled |
|------|-------|---------|--------------------------|
| Pro Annual | $29/year | Yearly | Keep all Pro features at the version you have. No lockout. |
| Pro Lifetime | $99 once | Never | Pro forever. Every current and future feature. |

### Anti-Subscription Model (Key Messaging)
- **You keep what you paid for.** If a user stops renewing, Pro features stay unlocked at the version they had. Only new features/updates require renewal.
- **No hostage pricing.** Data is local, app is installed. Nothing to hold hostage.
- **No per-seat pricing.** One license, one machine, unlimited use.
- **No cloud costs.** Nothing to host, nothing to scale.

## License Mechanics (In-App)

| Setting | Value |
|---------|-------|
| Trial duration | 14 days (starts automatically on first launch) |
| Trial requires credit card | No |
| Trial requires signup | No |
| Activations per key | 1 machine at a time |
| Deactivation | User can release a machine and re-activate on another |
| Offline grace period | 7 days without internet before re-validation required |
| Perpetual fallback | If license expires, Pro stays unlocked on the version they paid for. Only locks if they update to a newer version without renewing. |

## License Flow (How It Works)

```
First launch → 14-day Pro trial starts (no action needed)
              ↓
Trial active → All Pro features unlocked
              ↓
Trial ends → Pro features lock, core app stays free
              ↓
User buys → Gets license key from LemonSqueezy email/receipt
              ↓
User enters key → Settings > License > Activate
              ↓
Key validated against LemonSqueezy API → Pro unlocked
              ↓
Every app start → Re-validate online (silent, background)
              ↓
If offline → 7-day grace period, then re-validation required
              ↓
If subscription expires → Perpetual fallback (keep current version's features)
```

## Website Integration Notes

### Checkout Buttons
Use the checkout URLs above. LemonSqueezy provides an embeddable JS widget:
```html
<!-- Pro Annual -->
<a href="https://lifedash.lemonsqueezy.com/checkout/buy/a7c9d2dc-c9f1-4fd5-ba0c-4045e98d726c" class="lemonsqueezy-button">
  Get Pro — $29/year
</a>

<!-- Pro Lifetime -->
<a href="https://lifedash.lemonsqueezy.com/checkout/buy/9ada7049-fa58-4dae-a3cf-79c1fd3c4f7a" class="lemonsqueezy-button">
  Get Pro Lifetime — $99
</a>

<script src="https://assets.lemonsqueezy.com/lemon.js" defer></script>
```

Adding `?embed=1` to checkout URLs enables the overlay checkout (stays on your site).

### Pricing Section Layout (Suggested)
Three columns: Free / Pro Annual / Pro Lifetime

- **Free:** "Download Free" → direct download link
- **Pro Annual:** "$29/year" → LemonSqueezy checkout (annual)
- **Pro Lifetime:** "$99 — Forever" → LemonSqueezy checkout (lifetime)
- Below: "Already have a key? Activate in Settings > License"
- Below pricing cards: competitor comparison table

### Trust Signals
- "Stop paying? Keep your Pro features. We don't hold your tools hostage."
- "14-day Pro trial, no credit card"
- "$29/year for updates, or $99 once forever"
- "Offline-first — your data stays on your machine"
- "Free forever — no bait-and-switch"

### Competitor Comparison
LifeDash replaces $300+/year in separate SaaS tools:

| Tool Stack | Annual Cost |
|-----------|-------------|
| Otter.ai Pro + Trello Premium + Toggl Starter | ~$280/yr |
| Fireflies.ai Business + ClickUp Unlimited + RescueTime | ~$310/yr |
| Fathom Pro + Notion Plus + Clockify Pro | ~$280/yr |

LifeDash Pro Annual: **$29/yr.** LifeDash Pro Lifetime: **$99 once.**

## Platform Availability

| Platform | Status |
|----------|--------|
| Windows 10+ (64-bit) | Available now |
| macOS | Coming soon |
| Linux | Not planned (yet) |
