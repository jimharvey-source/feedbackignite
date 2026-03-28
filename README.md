# Feedback Ignite

**Management Ignition Suite — Product 2**
Turn raw feedback notes into clear, constructive, motivating development conversations.

Built by Jim Harvey / The Message Business.

---

## Stack

- React / Vite frontend
- Vercel serverless functions
- OpenAI gpt-4o

---

## Local setup

```bash
cd /Users/admin/FeedbackIgnite
npm install
npm run dev
```

Create a `.env.local` file for local development:

```
OPENAI_API_KEY=sk-...
```

---

## Deploy to Vercel

### First deploy

```bash
git init
git add .
git commit -m "Initial commit — Feedback Ignite MVP"
git remote add origin https://github.com/jimharvey-source/feedbackignite.git
git push -u origin main
```

Then in Vercel dashboard:
1. Import the GitHub repo
2. Add environment variable: `OPENAI_API_KEY` = your key
3. Deploy

### Subsequent deploys

```bash
git add .
git commit -m "your message"
git push
```

Vercel auto-deploys on every push to main.

---

## DNS (Cloudflare → Vercel)

In Cloudflare DNS for themessagebusiness.com:

- Type: CNAME
- Name: feedbackignite
- Target: your-vercel-deployment.vercel-dns.com
- Proxy: OFF (grey cloud — DNS only)

In Vercel project settings → Domains:
Add: feedbackignite.themessagebusiness.com

---

## Environment variables (Vercel)

| Variable | Value |
|---|---|
| OPENAI_API_KEY | sk-... |

---

## File structure

```
FeedbackIgnite/
├── index.html
├── package.json
├── vite.config.js
├── vercel.json
├── api/
│   └── generate-feedback.js    ← serverless function
└── src/
    ├── main.jsx
    ├── App.jsx                  ← full frontend + logic
    └── index.css
```

---

## Phase 2 roadmap

- Stripe payments: Monthly £4.99 / Annual £59.99 / Lifetime £49.99
- Supabase auth (magic link)
- Email draft output
- Calendar ICS for scheduling the conversation
- Free usage limit: 3 (currently set to unlimited for testing)
