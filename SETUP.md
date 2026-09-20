# Running it yourself

Two ways to use this: the **CLI**, which needs nothing but a key, and the **Chrome
extension**, which runs against your own logged-in browser.

## 0. Once

```bash
cd ~/Dolze/jev-browser
pnpm install
pnpm exec playwright install chromium
cp .env.example .env        # then fill in OPENROUTER_API_KEY and JWT_SECRET
```

`JWT_SECRET` can be anything long and random: `openssl rand -hex 32`.

MongoDB is only needed for the extension (the CLI talks to the models directly):

```bash
mkdir -p .data/mongo
mongod --dbpath .data/mongo --port 27017 --bind_ip 127.0.0.1 --fork --logpath .data/mongo/mongod.log
```

Stop it later with `pkill mongod`.

## 1. The CLI — fastest way to see it work

```bash
pnpm run-task \
  --goal "Find the Wikipedia article about the Rosetta Stone and tell me what year it was discovered" \
  --url "https://en.wikipedia.org/wiki/Main_Page"
```

Add `--headed` to watch it. Useful flags:

| | |
|---|---|
| `--headed` | show the browser |
| `--profile p.json` | a profile to fill forms from (see below) |
| `--batch` | queue every irreversible step and review once at the end |
| `--no-ask` | never prompt for fields it cannot answer; leave them blank |
| `--max-steps N` | budget, default 120 |

**Authority comes from your goal, not these flags.** Say "do not submit" and it will
fill everything and finalise nothing, regardless of what you pass.

### A profile

Any subset of the keys in `packages/shared/src/profile.ts`:

```json
{
  "fullName": "Your Name",
  "email": "you@example.com",
  "phone": "+91 90000 00000",
  "linkedin": "https://www.linkedin.com/in/you",
  "resumeFile": "/absolute/path/to/resume.pdf"
}
```

`resumeFile` must be an absolute path. It is uploaded through the driver, never typed.

The real one:

```bash
pnpm run-task \
  --goal "Using my resume profile, open at least 10 engineering roles on this board and fill in each application, attaching my resume. Do not submit any application." \
  --url "https://job-boards.greenhouse.io/anthropic" \
  --profile ~/my-profile.json --max-steps 300
```

Anything it cannot answer from the profile it asks you once, then reuses for the rest
of the run. Pass `--no-ask` to leave those blank instead.

## 2. The extension

```bash
pnpm server            # leave running — holds the model key and meters credits
pnpm build:extension
```

Then in Chrome:

1. `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → choose `apps/jev-browser/apps/extension/dist`
4. Pin the extension and click it to open the side panel

Sign in, type a goal, press Run. It works on **the tab you are looking at**, and asks
permission for that site the first time.

### Sign-in

Google sign-in needs credentials the server does not have yet. Until then the panel
offers **Continue as dev user** — a local account with 500 credits, refused in
production and as soon as Google *is* configured.

To set Google up properly: Google Cloud Console → APIs & Services → Credentials →
Create OAuth client ID → Web application, with authorised redirect URI
`http://localhost:8787/auth/google/callback`. Put the id and secret in `.env` as
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and restart the server. The dev button
disappears on its own.

### Credits

1 credit = $0.001 of model spend. New accounts get 500, which is roughly 30 tasks.
Top up locally with:

```bash
curl -X POST localhost:8787/api/dev/topup \
  -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' \
  -d '{"credits": 1000}'
```

## What it will not do

Not limitations to work around — they are the design:

- **It never types a password, card number or other secret.** Hard-coded, not a model
  judgement, so it holds when the model is wrong.
- **It stops at a CAPTCHA, an account wall or a login** and hands the browser back.
  Roughly half of enterprise ATS postings hit one of these.
- **"Do not submit" in your goal outranks every flag**, including `--auto-approve`.

## If something breaks

```bash
pnpm typecheck && pnpm test     # 110 unit tests, no network
pnpm check:guards               # freshness and occlusion, real browser
pnpm check:executor             # new-tab following, re-render recovery
pnpm check:extension            # builds and loads the extension in Chrome
tail -f .data/server.log        # server
```

The extension's service worker has its own console: `chrome://extensions` → the
extension → **service worker**. The side panel has a normal DevTools (right-click →
Inspect).
