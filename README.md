# UC Irvine AI Lab Blog

A clean, simple community blog for the UC Irvine AI Lab. Anyone can create an account
and post **papers, AI news, lab updates, events and tutorials**; readers can like,
comment, search and filter. Admins get a full control panel.

Built with **Python + Flask + SQLite** (or PostgreSQL in production). No build step,
no JavaScript framework: one `app.py`, a folder of templates and one stylesheet.

## Features

**For everyone**
- Sign up / log in, profile page with bio and affiliation
- Write posts in Markdown with live preview, categories, tags, paper link and paper authors
- Home feed with featured post, category filters, search, tag cloud and "Most read"
- Likes, comments, copy-link sharing, related posts
- Works on phones and desktops

**Admin panel (`/admin`)**
- Dashboard: posts, pending approvals, members, comments, likes, posts by category
- Posts: approve, publish, hide, feature on the home page, edit, delete
- Comments: hide/restore or delete
- Users: change role (member / editor / admin), suspend, delete
- Settings: site name, tagline, announcement banner, open/close sign-ups,
  require approval for member posts, restrict sign-ups to an email domain (e.g. `uci.edu`)

**Roles**
| Role | Can do |
|---|---|
| Member | Post, comment, like; edit/delete their own posts |
| Editor | Everything a member can, plus approve/hide/feature any post and moderate comments |
| Admin | Everything, plus manage users and site settings |

**Defaults you may want to change (Admin → Settings)**
- Posts go live immediately. Turn on *Require approval* to review member posts first.
- Anyone can sign up. Set the domain to `uci.edu` to allow only UCI emails.

## Run it locally

Requires Python 3.10+.

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

flask --app app create-admin       # prompts for your email, name, password
flask --app app seed-demo          # optional: adds example posts to try things out
flask --app app run --debug        # open http://127.0.0.1:5000
```

The **first account that signs up** automatically becomes an admin, so you can also skip
`create-admin` and just sign up first. Data is stored in `instance/blog.db`.

Run the tests with `pip install pytest && pytest` (set `TEST_DATABASE_URL` to test against PostgreSQL).

> Delete the example posts and the "Demo Member" account (Admin → Users) before launch.

## Deploy

Set these environment variables in any host:

| Variable | Value |
|---|---|
| `SECRET_KEY` | a long random string (`python -c "import secrets; print(secrets.token_hex(32))"`) |
| `FLASK_ENV` | `production` (enables secure cookies; requires HTTPS) |
| `DATABASE_URL` | optional; a PostgreSQL URL. If unset, SQLite in `instance/blog.db` is used |

The start command is `gunicorn app:app`.

### Option A: Vercel (recommended, free, no credit card)
Vercel runs the app; a free **Neon** Postgres database stores the posts.

1. Sign in at [vercel.com](https://vercel.com) with GitHub (choose the free **Hobby** plan).
2. **Add New → Project**, import the `uciaiblog` repository. The Flask preset is picked up
   from `vercel.json`. Click **Deploy**. The first deploy shows an error page until steps 3–4
   are done; that is expected.
3. In the project, open **Storage → Create Database → Neon (Serverless Postgres)**, pick the
   free plan and connect it to the project. This adds `DATABASE_URL` automatically.
4. **Settings → Environment Variables**: add `SECRET_KEY` with a long random value
   (e.g. from `python -c "import secrets; print(secrets.token_hex(32))"`).
5. **Deployments → ⋯ → Redeploy**. Open the site and sign up: the first account becomes admin.

Every push to `main` redeploys automatically. Add a custom domain under Settings → Domains.

### Option A2: Render (uses `render.yaml`)
Render may ask for a card. **New → Blueprint**, pick the repo; it creates the web service
and a PostgreSQL database and generates `SECRET_KEY`.

### Option B: PythonAnywhere (simple, keeps SQLite)
1. Upload the folder, create a virtualenv and `pip install -r requirements.txt`.
2. Add a web app (manual config, Flask), point the WSGI file at `from app import app as application`.
3. Set `SECRET_KEY` and `FLASK_ENV=production` in the WSGI file, then reload.
   SQLite works here because the disk is persistent.

### Option C: University / any Linux server
Run `gunicorn -w 3 -b 127.0.0.1:8000 app:app` behind nginx with HTTPS, with the variables above.

> Hosts with temporary disks (Vercel, Render, Railway, Heroku-style) **must** use PostgreSQL via
> `DATABASE_URL`, otherwise posts are lost on every redeploy.

## Project layout

```
app.py              models, routes, admin, CLI commands
seed.py             optional example content
templates/          pages (Jinja2); templates/admin/ is the admin panel
static/style.css    all styling (UCI blue #0064A4 and gold #FFD200)
static/app.js       likes, preview, menus and small interactions
tests/              pytest end-to-end tests
```

## Security notes
- Passwords are hashed (Werkzeug/scrypt); all forms have CSRF protection.
- Post Markdown is sanitised (no scripts or unsafe HTML).
- Suspended users cannot log in; admins can't demote or delete themselves.
