"""UC Irvine AI Lab blog.

A small Flask application: anyone can sign up and post papers, news and lab
updates; admins moderate posts, comments and users from /admin.
"""
import math
import os
import re
import secrets
import unicodedata
from datetime import datetime, timezone
from functools import wraps
from urllib.parse import urlparse

import bleach
import click
import markdown as md
from flask import (Flask, abort, flash, jsonify, redirect, render_template,
                   request, url_for)
from flask_login import (LoginManager, UserMixin, current_user, login_required,
                         login_user, logout_user)
from flask_sqlalchemy import SQLAlchemy
from flask_wtf.csrf import CSRFProtect
from markupsafe import Markup
from sqlalchemy import func, or_
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.abspath(os.path.dirname(__file__))

db = SQLAlchemy()
login_manager = LoginManager()
csrf = CSRFProtect()

CATEGORIES = {
    "paper": "Paper",
    "news": "AI News",
    "update": "Lab Update",
    "event": "Event",
    "tutorial": "Tutorial",
}
ROLES = ["member", "editor", "admin"]
DEFAULT_SETTINGS = {
    "site_name": "UC Irvine AI Lab",
    "tagline": "Research, papers and news from the UC Irvine AI Lab community.",
    "require_approval": "0",      # 1 = member posts wait for an editor/admin
    "allowed_domain": "",         # e.g. "uci.edu" to restrict sign-ups
    "signups_open": "1",
    "announcement": "",
}


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


# --------------------------------------------------------------------------
# Models
# --------------------------------------------------------------------------
class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), nullable=False)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), default="member", nullable=False)
    affiliation = db.Column(db.String(120), default="")
    bio = db.Column(db.Text, default="")
    is_banned = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow)

    posts = db.relationship("Post", backref="author", lazy="dynamic",
                            cascade="all, delete-orphan")
    comments = db.relationship("Comment", backref="author", lazy="dynamic",
                               cascade="all, delete-orphan")

    def set_password(self, pw):
        self.password_hash = generate_password_hash(pw)

    def check_password(self, pw):
        return check_password_hash(self.password_hash, pw)

    @property
    def is_admin(self):
        return self.role == "admin"

    @property
    def is_staff(self):  # editors and admins can moderate content
        return self.role in ("editor", "admin")

    @property
    def is_active(self):
        return not self.is_banned

    @property
    def initials(self):
        parts = [p for p in self.name.split() if p]
        return "".join(p[0] for p in parts[:2]).upper() or "?"

    @property
    def avatar_hue(self):
        return (self.id * 47) % 360


class Post(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    slug = db.Column(db.String(220), unique=True, nullable=False, index=True)
    category = db.Column(db.String(20), default="news", nullable=False)
    summary = db.Column(db.String(400), default="")
    body = db.Column(db.Text, nullable=False)
    link = db.Column(db.String(500), default="")       # paper / source URL
    authors_line = db.Column(db.String(300), default="")  # paper authors
    tags = db.Column(db.String(200), default="")
    status = db.Column(db.String(20), default="published", index=True)
    featured = db.Column(db.Boolean, default=False)
    views = db.Column(db.Integer, default=0)
    author_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow, index=True)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)

    comments = db.relationship("Comment", backref="post", lazy="dynamic",
                               cascade="all, delete-orphan")
    likes = db.relationship("Like", backref="post", lazy="dynamic",
                            cascade="all, delete-orphan")

    @property
    def tag_list(self):
        return [t.strip() for t in self.tags.split(",") if t.strip()]

    @property
    def category_label(self):
        return CATEGORIES.get(self.category, self.category.title())

    @property
    def html(self):
        return render_markdown(self.body)

    @property
    def excerpt(self):
        if self.summary:
            return self.summary
        text = re.sub(r"[#*_>`\[\]()!-]", "", self.body)
        text = " ".join(text.split())
        return text[:220] + ("…" if len(text) > 220 else "")

    @property
    def reading_minutes(self):
        return max(1, math.ceil(len(self.body.split()) / 220))

    @property
    def like_count(self):
        return self.likes.count()

    @property
    def comment_count(self):
        return self.comments.filter_by(is_hidden=False).count()

    def liked_by(self, user):
        if not user.is_authenticated:
            return False
        return self.likes.filter_by(user_id=user.id).first() is not None


class Comment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    body = db.Column(db.Text, nullable=False)
    is_hidden = db.Column(db.Boolean, default=False)
    post_id = db.Column(db.Integer, db.ForeignKey("post.id"), nullable=False)
    author_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow)


class Like(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    post_id = db.Column(db.Integer, db.ForeignKey("post.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    __table_args__ = (db.UniqueConstraint("post_id", "user_id"),)


class Setting(db.Model):
    key = db.Column(db.String(50), primary_key=True)
    value = db.Column(db.Text, default="")


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
ALLOWED_TAGS = list(bleach.sanitizer.ALLOWED_TAGS) + [
    "p", "pre", "code", "h1", "h2", "h3", "h4", "hr", "br", "img", "table",
    "thead", "tbody", "tr", "th", "td", "span", "del", "sup", "sub"]
ALLOWED_ATTRS = {"a": ["href", "title", "rel", "target"],
                 "img": ["src", "alt", "title"], "code": ["class"],
                 "span": ["class"], "th": ["align"], "td": ["align"]}


def render_markdown(text):
    html = md.markdown(text or "", extensions=["fenced_code", "tables", "sane_lists"])
    clean = bleach.clean(html, tags=ALLOWED_TAGS, attributes=ALLOWED_ATTRS,
                         protocols=["http", "https", "mailto"], strip=True)
    clean = bleach.linkify(clean, callbacks=[bleach.callbacks.nofollow,
                                             bleach.callbacks.target_blank])
    return Markup(clean)


def slugify(text):
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    text = re.sub(r"[^\w\s-]", "", text).strip().lower()
    return re.sub(r"[-\s]+", "-", text)[:80] or "post"


def unique_slug(title, exclude_id=None):
    base = slugify(title)
    slug, n = base, 2
    while True:
        q = Post.query.filter_by(slug=slug)
        if exclude_id:
            q = q.filter(Post.id != exclude_id)
        if not q.first():
            return slug
        slug, n = f"{base}-{n}", n + 1


def get_setting(key):
    s = db.session.get(Setting, key)
    return s.value if s else DEFAULT_SETTINGS.get(key, "")


def set_setting(key, value):
    s = db.session.get(Setting, key) or Setting(key=key)
    s.value = value
    db.session.add(s)


def is_safe_next(target):
    if not target:
        return False
    p = urlparse(target)
    return not p.netloc and not p.scheme and target.startswith("/")


def valid_url(u):
    if not u:
        return True
    p = urlparse(u)
    return p.scheme in ("http", "https") and bool(p.netloc)


def role_required(*roles):
    def deco(f):
        @wraps(f)
        @login_required
        def wrapper(*a, **kw):
            if current_user.role not in roles:
                abort(403)
            return f(*a, **kw)
        return wrapper
    return deco


staff_required = role_required("editor", "admin")
admin_required = role_required("admin")


def visible_posts():
    return Post.query.filter_by(status="published")


def paginate(query, per_page=9):
    page = request.args.get("page", 1, type=int)
    return query.paginate(page=page, per_page=per_page, error_out=False)


# --------------------------------------------------------------------------
# App factory
# --------------------------------------------------------------------------
def create_app(test_config=None):
    app = Flask(__name__)
    db_url = os.environ.get("DATABASE_URL",
                            "sqlite:///" + os.path.join(BASE_DIR, "instance", "blog.db"))
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql+psycopg://", 1)
    elif db_url.startswith("postgresql://"):
        db_url = db_url.replace("postgresql://", "postgresql+psycopg://", 1)
    app.config.update(
        SECRET_KEY=os.environ.get("SECRET_KEY") or secrets.token_hex(32),
        SQLALCHEMY_DATABASE_URI=db_url,
        SQLALCHEMY_ENGINE_OPTIONS={"pool_pre_ping": True},
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=os.environ.get("FLASK_ENV") == "production",
        REMEMBER_COOKIE_SECURE=os.environ.get("FLASK_ENV") == "production",
        MAX_CONTENT_LENGTH=2 * 1024 * 1024,
    )
    if test_config:
        app.config.update(test_config)
    os.makedirs(os.path.join(BASE_DIR, "instance"), exist_ok=True)

    db.init_app(app)
    csrf.init_app(app)
    login_manager.init_app(app)
    login_manager.login_view = "login"
    login_manager.login_message = "Please log in to continue."
    login_manager.login_message_category = "info"

    with app.app_context():
        db.create_all()

    register_routes(app)
    register_cli(app)
    return app


@login_manager.user_loader
def load_user(uid):
    return db.session.get(User, int(uid))


def register_routes(app):
    @app.context_processor
    def inject():
        pending = 0
        if current_user.is_authenticated and current_user.is_staff:
            pending = Post.query.filter_by(status="pending").count()
        return dict(CATEGORIES=CATEGORIES, site_name=get_setting("site_name"),
                    tagline=get_setting("tagline"),
                    announcement=get_setting("announcement"),
                    pending_count=pending, now=utcnow())

    @app.template_global()
    def page_url(page):
        args = request.args.to_dict()
        args.update(request.view_args or {})
        args["page"] = page
        return url_for(request.endpoint, **args)

    @app.template_filter("date")
    def fmt_date(d, fmt="%b %d, %Y"):
        return d.strftime(fmt) if d else ""

    @app.template_filter("ago")
    def ago(d):
        if not d:
            return ""
        s = (utcnow() - d).total_seconds()
        for unit, secs in (("year", 31536000), ("month", 2592000), ("day", 86400),
                           ("hour", 3600), ("minute", 60)):
            if s >= secs:
                n = int(s // secs)
                return f"{n} {unit}{'s' if n > 1 else ''} ago"
        return "just now"

    # ----------------------------------------------------------- public pages
    @app.route("/")
    def index():
        cat = request.args.get("c", "")
        q = request.args.get("q", "").strip()
        tag = request.args.get("tag", "").strip()
        query = visible_posts()
        if cat in CATEGORIES:
            query = query.filter_by(category=cat)
        if q:
            like = f"%{q}%"
            query = query.filter(or_(Post.title.ilike(like), Post.body.ilike(like),
                                     Post.tags.ilike(like), Post.summary.ilike(like)))
        if tag:
            query = query.filter(Post.tags.ilike(f"%{tag}%"))
        featured = None
        if not (cat or q or tag) and request.args.get("page", 1, type=int) == 1:
            featured = visible_posts().filter_by(featured=True)\
                .order_by(Post.created_at.desc()).first()
        if featured:
            query = query.filter(Post.id != featured.id)
        pagination = paginate(query.order_by(Post.created_at.desc()))
        stats = dict(posts=visible_posts().count(), members=User.query.count(),
                     papers=visible_posts().filter_by(category="paper").count())
        trending = visible_posts().order_by(Post.views.desc()).limit(5).all()
        tag_counts = {}
        for (tags,) in db.session.query(Post.tags).filter_by(status="published"):
            for t in (tags or "").split(","):
                t = t.strip().lower()
                if t:
                    tag_counts[t] = tag_counts.get(t, 0) + 1
        top_tags = sorted(tag_counts.items(), key=lambda kv: -kv[1])[:12]
        return render_template("index.html", pagination=pagination, featured=featured,
                               cat=cat, q=q, tag=tag, stats=stats, trending=trending,
                               top_tags=top_tags)

    @app.route("/about")
    def about():
        staff = User.query.filter(User.role.in_(["admin", "editor"]))\
            .order_by(User.role, User.name).all()
        return render_template("about.html", staff=staff)

    @app.route("/post/<slug>")
    def post_detail(slug):
        post = Post.query.filter_by(slug=slug).first_or_404()
        can_see = post.status == "published" or (
            current_user.is_authenticated and
            (current_user.id == post.author_id or current_user.is_staff))
        if not can_see:
            abort(404)
        if post.status == "published":
            post.views = (post.views or 0) + 1
            db.session.commit()
        comments = post.comments.order_by(Comment.created_at.asc())
        if not (current_user.is_authenticated and current_user.is_staff):
            comments = comments.filter_by(is_hidden=False)
        related = visible_posts().filter(Post.category == post.category,
                                         Post.id != post.id)\
            .order_by(Post.created_at.desc()).limit(3).all()
        return render_template("post.html", post=post, comments=comments.all(),
                               related=related)

    @app.route("/u/<int:uid>")
    def profile(uid):
        user = db.get_or_404(User, uid)
        posts = user.posts.filter_by(status="published")
        if current_user.is_authenticated and (current_user.id == uid or current_user.is_staff):
            posts = user.posts
        pagination = paginate(posts.order_by(Post.created_at.desc()))
        return render_template("profile.html", user=user, pagination=pagination)

    # ----------------------------------------------------------- auth
    @app.route("/signup", methods=["GET", "POST"])
    def signup():
        if current_user.is_authenticated:
            return redirect(url_for("index"))
        domain = get_setting("allowed_domain").strip().lower().lstrip("@")
        open_ = get_setting("signups_open") == "1"
        form = {}
        if request.method == "POST" and open_:
            form = request.form
            name = form.get("name", "").strip()
            email = form.get("email", "").strip().lower()
            pw = form.get("password", "")
            errors = []
            if len(name) < 2:
                errors.append("Please enter your full name.")
            if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
                errors.append("Please enter a valid email address.")
            elif domain and not (email.endswith("@" + domain) or email.endswith("." + domain)):
                errors.append(f"Sign-up is limited to @{domain} email addresses.")
            if len(pw) < 8:
                errors.append("Password must be at least 8 characters.")
            if pw != form.get("confirm", ""):
                errors.append("Passwords do not match.")
            if User.query.filter_by(email=email).first():
                errors.append("An account with that email already exists.")
            if errors:
                for e in errors:
                    flash(e, "error")
            else:
                first = User.query.count() == 0
                user = User(name=name, email=email,
                            affiliation=form.get("affiliation", "").strip()[:120],
                            role="admin" if first else "member")
                user.set_password(pw)
                db.session.add(user)
                db.session.commit()
                login_user(user)
                flash("Welcome! Your account is ready." +
                      (" You are the first user, so you have been made an admin." if first else ""),
                      "success")
                return redirect(url_for("index"))
        return render_template("auth.html", mode="signup", domain=domain,
                               signups_open=open_, form=form)

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if current_user.is_authenticated:
            return redirect(url_for("index"))
        form = {}
        if request.method == "POST":
            form = request.form
            user = User.query.filter_by(email=form.get("email", "").strip().lower()).first()
            if not user or not user.check_password(form.get("password", "")):
                flash("Incorrect email or password.", "error")
            elif user.is_banned:
                flash("This account has been suspended. Contact the lab admin.", "error")
            else:
                login_user(user, remember=bool(form.get("remember")))
                nxt = request.args.get("next")
                return redirect(nxt if is_safe_next(nxt) else url_for("index"))
        return render_template("auth.html", mode="login", form=form)

    @app.route("/logout", methods=["POST"])
    @login_required
    def logout():
        logout_user()
        flash("You have been logged out.", "info")
        return redirect(url_for("index"))

    @app.route("/account", methods=["GET", "POST"])
    @login_required
    def account():
        if request.method == "POST":
            f = request.form
            if f.get("action") == "profile":
                name = f.get("name", "").strip()
                if len(name) < 2:
                    flash("Name is too short.", "error")
                else:
                    current_user.name = name[:80]
                    current_user.affiliation = f.get("affiliation", "").strip()[:120]
                    current_user.bio = f.get("bio", "").strip()[:1000]
                    db.session.commit()
                    flash("Profile updated.", "success")
            elif f.get("action") == "password":
                if not current_user.check_password(f.get("current", "")):
                    flash("Current password is incorrect.", "error")
                elif len(f.get("new", "")) < 8:
                    flash("New password must be at least 8 characters.", "error")
                else:
                    current_user.set_password(f["new"])
                    db.session.commit()
                    flash("Password changed.", "success")
            return redirect(url_for("account"))
        return render_template("account.html")

    # ----------------------------------------------------------- posts
    def save_post_from_form(post):
        f = request.form
        errors = []
        title = f.get("title", "").strip()
        body = f.get("body", "").strip()
        category = f.get("category", "news")
        link = f.get("link", "").strip()
        if len(title) < 4:
            errors.append("Title must be at least 4 characters.")
        if len(body) < 20:
            errors.append("Post content must be at least 20 characters.")
        if category not in CATEGORIES:
            errors.append("Choose a valid category.")
        if not valid_url(link):
            errors.append("The link must start with http:// or https://")
        post.title = title[:200]
        post.body = body
        post.category = category
        post.summary = f.get("summary", "").strip()[:400]
        post.link = link[:500]
        post.authors_line = f.get("authors_line", "").strip()[:300]
        tags = [t.strip().lower() for t in f.get("tags", "").split(",") if t.strip()]
        post.tags = ", ".join(dict.fromkeys(tags))[:200]
        return errors

    @app.route("/post/new", methods=["GET", "POST"])
    @login_required
    def new_post():
        post = Post(category=request.args.get("c", "news"))
        if request.method == "POST":
            errors = save_post_from_form(post)
            if errors:
                for e in errors:
                    flash(e, "error")
            else:
                needs_review = (get_setting("require_approval") == "1"
                                and not current_user.is_staff)
                post.status = "pending" if needs_review else "published"
                post.slug = unique_slug(post.title)
                post.author_id = current_user.id
                db.session.add(post)
                db.session.commit()
                if needs_review:
                    flash("Thanks! Your post was submitted and will appear once an "
                          "editor approves it.", "info")
                else:
                    flash("Your post is live.", "success")
                return redirect(url_for("post_detail", slug=post.slug))
        return render_template("editor.html", post=post, is_new=True)

    @app.route("/post/<int:pid>/edit", methods=["GET", "POST"])
    @login_required
    def edit_post(pid):
        post = db.get_or_404(Post, pid)
        if post.author_id != current_user.id and not current_user.is_staff:
            abort(403)
        if request.method == "POST":
            old_title = post.title
            errors = save_post_from_form(post)
            if errors:
                for e in errors:
                    flash(e, "error")
            else:
                if post.title != old_title:
                    post.slug = unique_slug(post.title, exclude_id=post.id)
                db.session.commit()
                flash("Post updated.", "success")
                return redirect(url_for("post_detail", slug=post.slug))
        return render_template("editor.html", post=post, is_new=False)

    @app.route("/post/<int:pid>/delete", methods=["POST"])
    @login_required
    def delete_post(pid):
        post = db.get_or_404(Post, pid)
        if post.author_id != current_user.id and not current_user.is_staff:
            abort(403)
        db.session.delete(post)
        db.session.commit()
        flash("Post deleted.", "info")
        nxt = request.form.get("next")
        return redirect(nxt if is_safe_next(nxt) else url_for("index"))

    @app.route("/post/<int:pid>/like", methods=["POST"])
    @login_required
    def like_post(pid):
        post = db.get_or_404(Post, pid)
        existing = post.likes.filter_by(user_id=current_user.id).first()
        if existing:
            db.session.delete(existing)
            liked = False
        else:
            db.session.add(Like(post_id=post.id, user_id=current_user.id))
            liked = True
        db.session.commit()
        return jsonify(liked=liked, count=post.like_count)

    @app.route("/post/<int:pid>/comment", methods=["POST"])
    @login_required
    def add_comment(pid):
        post = db.get_or_404(Post, pid)
        body = request.form.get("body", "").strip()
        if post.status != "published":
            abort(403)
        if not body:
            flash("Comment cannot be empty.", "error")
        else:
            db.session.add(Comment(body=body[:3000], post_id=post.id,
                                   author_id=current_user.id))
            db.session.commit()
            flash("Comment posted.", "success")
        return redirect(url_for("post_detail", slug=post.slug) + "#comments")

    @app.route("/comment/<int:cid>/delete", methods=["POST"])
    @login_required
    def delete_comment(cid):
        c = db.get_or_404(Comment, cid)
        if c.author_id != current_user.id and not current_user.is_staff:
            abort(403)
        slug = c.post.slug
        db.session.delete(c)
        db.session.commit()
        flash("Comment removed.", "info")
        nxt = request.form.get("next")
        return redirect(nxt if is_safe_next(nxt) else url_for("post_detail", slug=slug) + "#comments")

    @app.route("/api/preview", methods=["POST"])
    @login_required
    def preview():
        return jsonify(html=str(render_markdown(request.form.get("body", ""))))

    # ----------------------------------------------------------- admin
    @app.route("/admin")
    @staff_required
    def admin_dashboard():
        counts = dict(
            users=User.query.count(),
            posts=Post.query.filter_by(status="published").count(),
            pending=Post.query.filter_by(status="pending").count(),
            hidden=Post.query.filter_by(status="hidden").count(),
            comments=Comment.query.count(),
            likes=Like.query.count(),
        )
        by_cat = dict(db.session.query(Post.category, func.count(Post.id))
                      .filter_by(status="published").group_by(Post.category).all())
        recent_posts = Post.query.order_by(Post.created_at.desc()).limit(6).all()
        recent_users = User.query.order_by(User.created_at.desc()).limit(6).all()
        return render_template("admin/dashboard.html", counts=counts, by_cat=by_cat,
                               recent_posts=recent_posts, recent_users=recent_users)

    @app.route("/admin/posts")
    @staff_required
    def admin_posts():
        status = request.args.get("status", "")
        q = request.args.get("q", "").strip()
        query = Post.query
        if status in ("published", "pending", "hidden"):
            query = query.filter_by(status=status)
        if q:
            query = query.filter(Post.title.ilike(f"%{q}%"))
        pagination = paginate(query.order_by(Post.created_at.desc()), per_page=20)
        return render_template("admin/posts.html", pagination=pagination,
                               status=status, q=q)

    @app.route("/admin/posts/<int:pid>/<action>", methods=["POST"])
    @staff_required
    def admin_post_action(pid, action):
        post = db.get_or_404(Post, pid)
        if action == "approve" or action == "publish":
            post.status = "published"
            msg = "Post published."
        elif action == "hide":
            post.status = "hidden"
            msg = "Post hidden from the public site."
        elif action == "feature":
            post.featured = not post.featured
            msg = "Post featured on the home page." if post.featured else "Post un-featured."
        elif action == "delete":
            db.session.delete(post)
            msg = "Post deleted."
        else:
            abort(400)
        db.session.commit()
        flash(msg, "success")
        nxt = request.form.get("next")
        return redirect(nxt if is_safe_next(nxt) else url_for("admin_posts"))

    @app.route("/admin/comments")
    @staff_required
    def admin_comments():
        pagination = paginate(Comment.query.order_by(Comment.created_at.desc()), per_page=25)
        return render_template("admin/comments.html", pagination=pagination)

    @app.route("/admin/comments/<int:cid>/toggle", methods=["POST"])
    @staff_required
    def admin_comment_toggle(cid):
        c = db.get_or_404(Comment, cid)
        c.is_hidden = not c.is_hidden
        db.session.commit()
        flash("Comment hidden." if c.is_hidden else "Comment restored.", "success")
        return redirect(request.referrer if is_safe_next(urlparse(request.referrer or "").path)
                        else url_for("admin_comments"))

    @app.route("/admin/users")
    @admin_required
    def admin_users():
        q = request.args.get("q", "").strip()
        role = request.args.get("role", "")
        query = User.query
        if q:
            query = query.filter(or_(User.name.ilike(f"%{q}%"), User.email.ilike(f"%{q}%")))
        if role in ROLES:
            query = query.filter_by(role=role)
        elif role == "banned":
            query = query.filter_by(is_banned=True)
        pagination = paginate(query.order_by(User.created_at.desc()), per_page=25)
        return render_template("admin/users.html", pagination=pagination, q=q,
                               role=role, ROLES=ROLES)

    @app.route("/admin/users/<int:uid>/<action>", methods=["POST"])
    @admin_required
    def admin_user_action(uid, action):
        user = db.get_or_404(User, uid)
        if user.id == current_user.id and action in ("role", "ban", "delete"):
            flash("You can't change your own role, suspend or delete yourself here.", "error")
            return redirect(url_for("admin_users"))
        if action == "role":
            role = request.form.get("role")
            if role not in ROLES:
                abort(400)
            user.role = role
            msg = f"{user.name} is now {'an' if role == 'admin' else 'a'} {role}."
        elif action == "ban":
            user.is_banned = not user.is_banned
            msg = f"{user.name} was {'suspended' if user.is_banned else 'reinstated'}."
        elif action == "delete":
            db.session.delete(user)
            msg = "User and their posts deleted."
        else:
            abort(400)
        db.session.commit()
        flash(msg, "success")
        return redirect(request.form.get("next") if is_safe_next(request.form.get("next"))
                        else url_for("admin_users"))

    @app.route("/admin/settings", methods=["GET", "POST"])
    @admin_required
    def admin_settings():
        if request.method == "POST":
            f = request.form
            set_setting("site_name", f.get("site_name", "").strip() or DEFAULT_SETTINGS["site_name"])
            set_setting("tagline", f.get("tagline", "").strip())
            set_setting("announcement", f.get("announcement", "").strip()[:300])
            set_setting("allowed_domain", f.get("allowed_domain", "").strip().lower().lstrip("@"))
            set_setting("require_approval", "1" if f.get("require_approval") else "0")
            set_setting("signups_open", "1" if f.get("signups_open") else "0")
            db.session.commit()
            flash("Settings saved.", "success")
            return redirect(url_for("admin_settings"))
        settings = {k: get_setting(k) for k in DEFAULT_SETTINGS}
        return render_template("admin/settings.html", settings=settings)

    # ----------------------------------------------------------- errors
    @app.errorhandler(403)
    def forbidden(e):
        return render_template("error.html", code=403,
                               message="You don't have permission to do that."), 403

    @app.errorhandler(404)
    def not_found(e):
        return render_template("error.html", code=404,
                               message="We couldn't find that page."), 404


def register_cli(app):
    @app.cli.command("create-admin")
    @click.option("--email", prompt=True)
    @click.option("--name", prompt=True)
    @click.option("--password", prompt=True, hide_input=True, confirmation_prompt=True)
    def create_admin(email, name, password):
        """Create an admin account, or promote an existing one."""
        email = email.strip().lower()
        user = User.query.filter_by(email=email).first()
        if user:
            user.role = "admin"
            user.is_banned = False
            click.echo(f"Promoted {email} to admin.")
        else:
            user = User(email=email, name=name, role="admin")
            user.set_password(password)
            db.session.add(user)
            click.echo(f"Created admin {email}.")
        db.session.commit()

    @app.cli.command("seed-demo")
    def seed_demo():
        """Add a few example posts so the site isn't empty while you try it out."""
        from seed import seed
        seed()
        click.echo("Example content added.")


app = create_app()

if __name__ == "__main__":
    app.run(debug=True)
