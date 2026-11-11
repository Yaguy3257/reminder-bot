# ⏰ Reminder Bot

A Telegram bot that reminds you about upcoming events — running for free on **Cloudflare Workers** with a **D1** (SQLite) database and a cron trigger.

Interface is in Russian; times are in Tashkent (UTC+5).

## Features

- **Inline calendar & hour picker** — create an event in a few taps, past dates are disabled
- **Advance alerts** — by default 7 days and 1 day before, plus a notification at the event time; pick from presets or type any number of days (up to 5 alerts)
- **Day of week** everywhere: `12.11.2026 (четверг) 14:00`
- **Edit** date, alerts or title; **delete** with confirmation
- **Shared events** — members listed in `ALLOWED_IDS` can create events visible to everyone, and get notified when someone adds, changes or removes one
- **Private** — only allow-listed Telegram ids can use it; webhook protected with Telegram's secret token header

## How it works

```
Telegram ──webhook──▶ Worker (fetch)  ──▶ D1: reminders, pending
                       Worker (cron, every minute) ──▶ sends due alerts
```

Each reminder stores `next_at` — the next moment something has to be sent — so the cron job only reads rows that are due (`WHERE next_at <= now`, indexed).

## Deploy your own

```bash
npm i -g wrangler && wrangler login
wrangler d1 create reminder-bot-db
cp wrangler.example.jsonc wrangler.jsonc        # put your database_id and Telegram ids
wrangler d1 execute reminder-bot-db --remote --file schema.sql
wrangler deploy
wrangler secret put BOT_TOKEN                   # from @BotFather
wrangler secret put WEBHOOK_SECRET              # any random string
# register the webhook + command menu:
curl "https://reminder-bot.<your-subdomain>.workers.dev/setup?secret=<WEBHOOK_SECRET>"
```

## Commands

| Command | |
|---|---|
| *any text* | start creating a reminder with that title |
| `/list` | all reminders |
| `/edit` | change date, alerts, title, shared/personal |
| `/delete` | delete a reminder |
