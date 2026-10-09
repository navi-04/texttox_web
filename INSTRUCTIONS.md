# Text to X: what you need to do

Text to X is an anonymous chat site with three ways to chat:

- **Specific chat**: choose to talk to a boy or a girl. One-to-one and private (two-sided matching, as before).
- **Random chat**: get paired with anyone else who picked random. No boy/girl filter, and no gender needed.
- **Public room**: one anonymous group chat. Every message disappears automatically (12, 24, 36 or 48 hours, your choice in the admin panel; 48 to start).

Anyone with any email address can create an account. The code, the tests (63 backend tests), a production build and a real HTTP walk-through (sign-up, sign-in by username and by email, admin sign-in, random chat, public room) all work on a laptop. What is left are the things only you can do: your accounts, secrets and the deploy.

---

## 1. Where it is hosted: Vercel, with the custom domain `texttox.fewinfos.com`

The site stays on **Vercel**; GitHub Pages is not used. GitHub Pages only serves static files, and this site needs a server (sign-in, the database, emailing codes, long-polling chat, the admin page), so it can't run there.

Point the domain at Vercel:

1. Vercel → your project → **Settings → Domains → Add** `texttox.fewinfos.com`.
2. Vercel shows the DNS record to create. At whoever hosts the DNS for `fewinfos.com`, add a **CNAME**: name `texttox`, value `cname.vercel-dns.com` (use exactly what Vercel shows; it may be a project-specific value).
3. Wait for Vercel to show the domain as valid (usually minutes). HTTPS is automatic.
4. Optional: make `texttox.fewinfos.com` the primary domain and redirect the `*.vercel.app` address to it (same Domains page).

The code already uses `https://texttox.fewinfos.com` for the page's metadata, and everything else (links in report emails, the same-origin check) follows whichever address the site is opened on, so nothing else needs changing.

## 2. Check `.env` (you said you updated it)

It needs: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `AUTH_SECRET`, the `SMTP_*` values, `ADMIN_USERNAME`, `ADMIN_PASSWORD` (10+ characters) and `REPORT_EMAIL`. See `.env.example` for what each is. Then confirm it connects (this also creates and upgrades the tables):

```
npm install
npm run db:init
```

You should see `Database ready. Tables: admin_log, chats, messages, otps, public_messages, queue, rate_limits, reports, sessions, users`.

Upgrading an existing database is automatic: the first request adds the new `username` column and the `public_messages` table. Accounts made before usernames existed keep working: they sign in with their email and show as the start of their email address until they reset their password and choose a username (see the notes in section 6).

If `REPORT_EMAIL` is empty, reports go to the address in `SMTP_FROM`.

## 3. Email (sends sign-up codes and report alerts)

People prove they own their email once, with a 6-digit code, when they create an account or reset a password. You also get an email for every report. Any SMTP service works; only the `SMTP_*` values change. **Brevo** is recommended (free plan: 300 emails a day, and it handles bounces properly).

Brevo setup: create a free account, add and verify a sender (a sender on a domain you own lands in spam far less often), then **SMTP & API → SMTP** gives the **Login** (looks like `a1b2c3001@smtp-brevo.com`, not your account email) and lets you generate an SMTP key (shown once):

```
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=a1b2c3001@smtp-brevo.com
SMTP_PASS=xsmtpsib-...
SMTP_FROM="Text to X <the-sender-you-verified@example.com>"
```

**Developing without sending real mail:** leave `SMTP_USER`/`SMTP_PASS` empty; codes and report emails are then printed in the terminal, and any email address works. To keep test users out of your real database, create `.env.local` containing `TURSO_DATABASE_URL=file:local.db` (git-ignored; overrides `.env` on your machine only). To try a chat, sign in as one user in a normal window and another in a private window.

## 4. Deploy

1. Push to GitHub (`git status` must **not** list `.env`; it is git-ignored, never commit it). Vercel redeploys by itself after every push to `main`.
2. In Vercel → **Settings → Environment Variables**, set the same values as your `.env`:

| Name | Value |
|---|---|
| `TURSO_DATABASE_URL` | `libsql://…turso.io` |
| `TURSO_AUTH_TOKEN` | your Turso token |
| `AUTH_SECRET` | the one from `.env` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | your mail service |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | from `.env` (password at least 10 characters) |
| `REPORT_EMAIL` | where report alerts go |

3. **Region (important for speed):** Settings → Functions → pick the region closest to your Turso database (`turso db show <name>` shows its location; for India, Mumbai `bom1`). Redeploy after changing it.
4. Check **Framework Preset** says **Next.js** (`vercel.json` already forces it).

## 5. Check the live site (5 min)

Use two devices, or a normal and a private window.

- [ ] **Create account** with any email (try a non-college one): a code arrives, you enter it, **choose a username and a password**, and you're in.
- [ ] The home screen shows **Specific chat / Random chat / Public room**.
- [ ] **Random chat** on two accounts: both land in the same chat within seconds, with no boy/girl question.
- [ ] **Specific chat**: the first time, it asks "Boy or Girl". One person picks "A girl" and the other "A boy" (matching their genders) and they connect.
- [ ] **Public room** on two accounts: messages appear on both sides within a couple of seconds, with no names anywhere.
- [ ] Log out, then sign in with the **username** and password; again with the **email** and password. No email is sent either time.
- [ ] **Forgot password?**: a code arrives, you choose a new password, and the old one stops working.
- [ ] In a chat, turn anonymity off on one side: the other side sees the **username**. Turn it on again: it disappears.
- [ ] **Report** a chat: an email arrives and the report shows in `/admin`.
- [ ] **Admin sign-in:** type the admin username and password in the **normal sign-in form**: you land on `/admin`. (`/admin` has its own sign-in form too.)
- [ ] Admin → **Public room** lists messages with **Delete** and **Block author**.

## 6. How it behaves (decisions I made; change them if you disagree)

- **Sign-up:** any valid email. Email → 6-digit code (10 minutes, 5 tries, once a minute, 5 an hour per email) → choose a **username** (3 to 20 letters, numbers or `_`, unique, not changeable) and a password (8+ characters). Passwords are stored only as salted scrypt hashes. A sign-in lasts 30 days.
- **Sign-in:** one field takes a **username or an email**. The two share one guess counter: 10 wrong passwords lock that account for 15 minutes (forgot password lifts it).
- **One mailbox = one account.** `+tags` are ignored (`me+x@…` is `me@…`), and for Gmail/Googlemail dots are ignored too, so one inbox can't make many accounts. Other providers' dots count as different addresses.
- **Reserved usernames:** `admin`, `administrator`, `moderator`, `support`, `texttox`, `anonymous`, `stranger`, `system`, and whatever `ADMIN_USERNAME` is.
- **The admin signs in with the same form** by typing the admin username. A wrong admin password shows the same "Wrong username, email or password" as everyone else, so nobody can tell which name is the admin's. (Admin limit: 8 tries per 15 minutes per address.)
- **What others can see:** only a **username**, and only if you turn anonymity off in a chat. Your email is never shown to other users. In a report, the admin sees both people's usernames and emails.
- **Nobody can find out who has an account.** "Create account" for an email that already has a password, and "Forgot password?" for an email with no account, look exactly like a normal request but send **no email**.
- **Matching:** *Specific chat* is two-sided by gender (boy→girl pairs with girl→boy; boy→boy with another boy→boy). *Random chat* pairs only with other random searchers. The two never mix. The longest-waiting person goes first, and two people who just talked aren't re-paired for 10 minutes. One person = one chat at a time.
- **Gender** is asked only the first time someone picks Specific chat, and can't be changed (you can clear or set it in the admin Users page). Random chat and the public room never ask.
- **Public room:** one shared room. Everyone sees the newest 100 messages that have not expired yet when they walk in, and new ones arrive within about 2 seconds. Messages up to 500 characters, 12 per minute per person. **Replies:** like a WhatsApp group, people swipe a message right on a phone (or press the arrow beside it on a desktop) to reply; the reply shows the quoted text, labelled only "You" or "Anonymous", and tapping the quote jumps to the original. If the original is deleted or expires, the reply stays and the quote says "This message was deleted". Others see only the text and the time. **The database stores who posted each message** so you can moderate; only the admin page shows it. Messages vanish from view after the lifetime you choose in the admin panel's **Public room** tab (12, 24, 36 or 48 hours; it starts at 48), and the stored rows are deleted by the periodic cleanup. Shortening it deletes the messages that are now too old straight away, and they can't come back if you lengthen it again.
- **Private chats are not saved:** messages are deleted when both people have left; an untouched unreported chat is deleted after 24 hours. Reported chats are kept until you dismiss or delete them.
- **Old accounts (made before this change):** they have no username yet, so they sign in with their **email**, and show to partners as the start of their email address. When they use **Forgot password?** they are not asked for a username, so they keep that. Tell me if you want a "choose a username" prompt for them.
- **Everyone is signed out once** by this update (the session cookies were renamed). They simply sign in again.
- **As database owner you can read live messages in Turso**; consider saying plainly on the site who can see what.

## 7. The admin page

Open **`https://texttox.fewinfos.com/admin`** (or sign in from the normal form with the admin username). A sign-in lasts 8 hours. To change the password, change it in `.env` and in Vercel and redeploy: that signs out every admin session.

| Section | What you can do |
|---|---|
| **Overview** | Counts (open reports, online now, searching, active chats, users, new in 24 h, blocked) and your recent actions. |
| **Reports** | *Open* and *Closed* lists. Open one to see who reported whom and the conversation; then **Block**, **Dismiss**, **Delete conversation** or **Delete** the reported user. |
| **Users** | Search by username or email; filter Everyone / Online / Blocked / Reported / Gender not set. A user's page has **Block / Unblock**, **Set / Change gender**, **Sign out everywhere**, **End their chat**, **Delete user**. |
| **Public room** | Choose how long messages live (**12 / 24 / 36 / 48 h**). The live public messages with their authors. **Delete** a message, **Block author** (signs them out and stops them signing in), or **Delete all** (type `DELETE`) to empty the room. |

The buttons do what they say; **Delete user** needs you to type `DELETE`, removes the account, their chats, reports and public messages, and they *can* sign up again, so use **Block** to keep someone out. The admin page deliberately **cannot** read other people's live private chats, only conversations that were reported.

## 8. Things to know now that anyone can sign up

- **Abuse risk is higher.** Before, only `@mkce.ac.in` addresses could join. Now anyone with a free email can, so expect throwaway accounts and spam in the public room. The tools you have are the admin **Delete / Block author** buttons and the per-person limits (12 public messages a minute, one code a minute). Watch the Public room tab at first. If it gets bad, the usual next steps are a "report this message" button in the public room, or requiring accounts to be a few minutes old before posting; ask and I'll add them.
- **Email bounces:** anyone can type an address that doesn't exist, and the code to it bounces; a high bounce rate can get a sender suspended. Watch **Brevo → Transactional → Logs**.
- **Brevo's free plan is 300 emails a day:** one email per sign-up (plus one per forgotten password and one per report). That's about 250 new accounts a day at most; a busy launch day could hit it.
- **Vercel Hobby** includes about 1 million function calls a month. Every open tab makes about 3 per minute; a tab in the public room makes about 3 per minute too (each request waits up to 20 seconds for news). Watch Vercel → Usage; Pro raises the limit. Hobby plans are for non-commercial use.
- **Turso** free limits apply to reads and writes. Each person in a chat, and each person in the public room, causes roughly one small read every 1 to 2 seconds. Hundreds of people at once may need a bigger plan.

## 9. If something goes wrong

| Symptom | Fix |
|---|---|
| Code never arrives, Vercel → Logs shows an SMTP error | Wrong `SMTP_*` values, or the sender isn't verified. With Brevo, `SMTP_USER` is the SMTP *login* (not your account email), `SMTP_PASS` is the SMTP *key*, and `SMTP_FROM` must be a verified sender. "SMTP account is not yet activated" means Brevo still has to approve the account. The site shows the same "Check your email" screen either way, so the log is where the real error is. |
| Code never arrives, no error | Check spam; wait the 60 s before re-sending; check the address. For **Create account**, nothing is sent if that email already has a password (use Sign in or Forgot password?); for **Forgot password?**, nothing is sent if there is no account. The screens look the same on purpose. |
| "Wrong username, email or password" | Same message for a wrong password, an unknown account, and an old account with no password. Use **Forgot password?** if unsure. |
| "That username is taken" | Pick another. Usernames are case-insensitive. |
| "Too many attempts" signing in | 10 wrong tries lock that account for 15 minutes. A password reset lifts it. |
| Admin sign-in says "Admin is not set up yet" | `ADMIN_USERNAME` / `ADMIN_PASSWORD` (10+ characters) are missing in Vercel or `.env` (restart `npm run dev`). Without them, the admin username is just an ordinary (and unreserved) username. |
| Reports show in admin but no email arrives | SMTP problem; Vercel → Logs → "Could not email report". Check spam. |
| "Something went wrong" everywhere | Vercel → project → **Logs** shows the real error. |
| Log says `SERVER_ERROR … 404` / `… 401` / "placeholder value" | `TURSO_DATABASE_URL` wrong / `TURSO_AUTH_TOKEN` wrong or expired / `.env` still has the placeholder. |
| Messages take 1–2+ seconds | The Vercel function region is far from the Turso database (section 4, step 3). |
| Stuck on "Looking for…" | Nobody online matches yet. *Specific*: a boy choosing "A girl" needs a girl choosing "A boy". *Random*: needs one other person who also chose Random. |
| `texttox.fewinfos.com` doesn't load | The CNAME isn't in place yet, or Vercel's Domains page still shows it as invalid. Re-check the record it asks for. |

## Commands

| | |
|---|---|
| `npm run dev` | run locally at http://localhost:3000 (admin at `/admin`) |
| `npm run build` / `npm start` | production build / run it |
| `npm test` | 63 backend tests; uses a temporary local file, never your Turso data |
| `npm run db:init` | check the Turso credentials and list the tables |

## Using it like a phone app

The public site is built mobile-first: full screen on a phone (it respects the notch and the home bar, and the message box stays above the keyboard), and a centred phone-sized app on a desktop. It is also installable: on a phone open `https://texttox.fewinfos.com`, then **Share → Add to Home Screen** (iPhone) or **menu → Install app** (Android). It then opens full screen with its own icon and no browser bars. The icons live in `public/` (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`) and `src/app/apple-icon.png`; the admin page keeps its own desktop style.
