"""Example content for trying the site out. Run with:  flask --app app seed-demo
Delete these posts from the admin panel before launch."""
from datetime import timedelta

from app import Comment, Like, Post, User, db, unique_slug, utcnow

EXAMPLES = [
    dict(category="update", featured=True, title="Welcome to the UC Irvine AI Lab blog",
         summary="A shared space for lab members and the wider community to post papers, "
                 "AI news and lab updates.",
         tags="announcement, community",
         body="""Welcome! This blog is where members of the **UC Irvine AI Lab** and the
wider community share what they are reading, building and thinking about.

## What you can post

- **Papers**: a paper you wrote or one you think others should read. Add the link and a short summary of why it matters.
- **AI News**: notable releases, results and announcements from across the field.
- **Lab Updates**: talks, new members, awards and milestones.
- **Events**: reading groups, seminars and workshops.
- **Tutorials**: how-tos, notebooks and explainers.

## A few ground rules

1. Be accurate and link your sources.
2. Be kind in the comments.
3. Credit authors when you summarise their work.

Posts support *Markdown*, so you can use headings, lists, `code` and links.
"""),
    dict(category="paper", title="Reading group pick: Attention Is All You Need",
         link="https://arxiv.org/abs/1706.03762",
         authors_line="Vaswani, Shazeer, Parmar, Uszkoreit, Jones, Gomez, Kaiser, Polosukhin (2017)",
         summary="The paper that introduced the Transformer. A good first pick for "
                 "anyone new to the reading group.",
         tags="transformers, nlp, reading group",
         body="""The Transformer replaced recurrence with **self-attention**, letting models
look at every token in a sequence at once. Almost every large language model since
builds on this architecture.

### Why read it

- It is short and clearly written.
- The ideas (multi-head attention, positional encodings) show up everywhere.

### Discussion questions

1. Why does scaled dot-product attention divide by the square root of the key dimension?
2. What are the trade-offs of attention's quadratic cost in sequence length?

```python
scores = (Q @ K.T) / d_k ** 0.5
weights = softmax(scores, dim=-1)
out = weights @ V
```
"""),
    dict(category="event", title="Example event: weekly paper reading group",
         summary="This is an example event post. Replace it with your real schedule.",
         tags="reading group, events",
         body="""*This is example content. Edit or delete it from the admin panel.*

Use event posts to share the **date, time, location** and what to read beforehand.

| | |
|---|---|
| **When** | Fridays, 3:00 PM |
| **Where** | Add the room here |
| **Reading** | Link the paper |
"""),
    dict(category="tutorial", title="How to write a great paper summary post",
         summary="A simple template for sharing a paper so readers get the key idea in "
                 "two minutes.",
         tags="guide, writing",
         body="""A good paper post answers four questions:

1. **What problem** does the paper tackle?
2. **What is the key idea** in one or two sentences?
3. **What are the results**, and how strong is the evidence?
4. **Why should we care**? Connect it to the lab's work.

Always put the arXiv or DOI link in the *Paper / source link* field so it shows as a
button at the top of your post.
"""),
    dict(category="news", title="Example news post: share AI updates here",
         summary="Use AI News posts for notable releases and results from across the field.",
         tags="news",
         body="""*This is example content.*

When you share news, link the primary source (the paper, the official blog post or the
release notes) rather than a secondhand article, and add a sentence on why it is
relevant to the lab.
"""),
]


def seed():
    demo = User.query.filter_by(email="demo.member@example.com").first()
    if not demo:
        demo = User(name="Demo Member", email="demo.member@example.com",
                    affiliation="Example account", role="member",
                    bio="An example account used for the demo content.")
        demo.set_password("demo-password-123")
        db.session.add(demo)
        db.session.flush()
    author = User.query.filter_by(role="admin").first() or demo
    now = utcnow()
    for i, ex in enumerate(EXAMPLES):
        if Post.query.filter_by(title=ex["title"]).first():
            continue
        p = Post(author_id=(author if i % 2 == 0 else demo).id, status="published",
                 created_at=now - timedelta(days=i * 2, hours=i), views=40 - i * 6, **ex)
        p.slug = unique_slug(p.title)
        db.session.add(p)
        db.session.flush()
        if i == 1:
            db.session.add(Comment(post_id=p.id, author_id=demo.id,
                                   body="Great pick to start with. Looking forward to the discussion!"))
            db.session.add(Like(post_id=p.id, user_id=demo.id))
    db.session.commit()
