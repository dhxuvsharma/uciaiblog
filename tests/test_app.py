import os, re, tempfile
import pytest

@pytest.fixture()
def client():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.environ["DATABASE_URL"] = "sqlite:///" + path
    import importlib, app as appmod
    importlib.reload(appmod)
    a = appmod.create_app({"TESTING": True, "WTF_CSRF_ENABLED": False})
    with a.test_client() as c:
        c.appmod = appmod; c.flask_app = a
        yield c
    os.close(fd); os.unlink(path)

def signup(c, name, email, pw="password123"):
    return c.post("/signup", data=dict(name=name, email=email, password=pw, confirm=pw), follow_redirects=True)

def logout(c): c.post("/logout")

def login(c, email, pw="password123"):
    return c.post("/login", data=dict(email=email, password=pw), follow_redirects=True)

def test_full_flow(client):
    c = client
    r = signup(c, "Ada Admin", "ada@uci.edu")
    assert b"first user" in r.data and b"Admin" in r.data
    logout(c)
    r = signup(c, "Bob Member", "bob@uci.edu")
    assert b"Welcome" in r.data
    # member posts paper
    r = c.post("/post/new", data=dict(title="A great paper", category="paper", body="This is a summary of a very interesting paper. <script>alert(1)</script>",
                                      link="https://arxiv.org/abs/1706.03762", tags="LLMs, nlp, llms"), follow_redirects=True)
    assert b"Your post is live" in r.data and b"<script>alert" not in r.data
    assert b"arxiv.org" in r.data
    with c.flask_app.app_context():
        p = c.appmod.Post.query.first(); pid, slug = p.id, p.slug
        assert p.tags == "llms, nlp"
    # like + comment
    r = c.post(f"/post/{pid}/like"); assert r.json == {"liked": True, "count": 1}
    r = c.post(f"/post/{pid}/like"); assert r.json["liked"] is False
    r = c.post(f"/post/{pid}/comment", data=dict(body="Nice!"), follow_redirects=True); assert b"Nice!" in r.data
    # member cannot access admin
    assert c.get("/admin").status_code == 403
    assert c.get("/admin/users").status_code == 403
    # search/filter
    assert b"A great paper" in c.get("/?q=great").data
    assert b"A great paper" in c.get("/?tag=nlp").data
    assert b"card-title\">A great paper" not in c.get("/?c=news").data and b"card-title\">A great paper" in c.get("/?c=paper").data
    logout(c)
    # admin enables approval + domain restriction
    login(c, "ada@uci.edu")
    assert c.get("/admin").status_code == 200
    r = c.post("/admin/settings", data=dict(site_name="UC Irvine AI Lab", tagline="t", require_approval="1", signups_open="1", allowed_domain="uci.edu"), follow_redirects=True)
    assert b"Settings saved" in r.data
    logout(c)
    r = signup(c, "Eve", "eve@gmail.com"); assert b"limited to @uci.edu" in r.data
    r = signup(c, "Ics Person", "x@ics.uci.edu"); assert b"Welcome" in r.data
    r = c.post("/post/new", data=dict(title="Pending post", category="news", body="Some news that needs approval first."), follow_redirects=True)
    assert b"submitted" in r.data
    logout(c)
    assert b"Pending post" not in c.get("/").data
    with c.flask_app.app_context():
        pp = c.appmod.Post.query.filter_by(title="Pending post").first(); ppid, ppslug = pp.id, pp.slug
        bob = c.appmod.User.query.filter_by(email="bob@uci.edu").first().id
    assert c.get(f"/post/{ppslug}").status_code == 404
    login(c, "ada@uci.edu")
    assert b"Pending post" in c.get("/admin/posts?status=pending").data
    c.post(f"/admin/posts/{ppid}/approve"); c.post(f"/admin/posts/{ppid}/feature")
    # roles + ban
    c.post(f"/admin/users/{bob}/role", data=dict(role="editor"))
    c.post(f"/admin/users/{bob}/ban")
    for path in ["/admin", "/admin/posts", "/admin/comments", "/admin/users", "/admin/settings", "/about", f"/u/{bob}", "/account", "/post/new", f"/post/{pid}/edit"]:
        assert c.get(path).status_code == 200, path
    # cannot demote self
    r = c.post("/admin/users/1/role", data=dict(role="member"), follow_redirects=True); assert b"can&#39;t change your own" in r.data
    logout(c)
    assert b"Featured" in c.get("/").data
    r = login(c, "bob@uci.edu"); assert b"suspended" in r.data
    assert c.get("/nope").status_code == 404

def test_csrf_enforced(client):
    client.flask_app.config["WTF_CSRF_ENABLED"] = True
    r = client.post("/signup", data=dict(name="X Y", email="x@y.com", password="password123", confirm="password123"))
    assert r.status_code == 400

def test_open_redirect_blocked(client):
    signup(client, "Ada", "a@b.com"); logout(client)
    r = client.post("/login?next=https://evil.com", data=dict(email="a@b.com", password="password123"))
    assert r.headers["Location"] == "/"
