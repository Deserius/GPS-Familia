function uiNotice(msg){
  if (window.f360 && typeof window.f360.notice === "function") return window.f360.notice(String(msg == null ? "" : msg));
  return Promise.resolve();
}
function uiAsk(msg){
  if (window.f360 && typeof window.f360.ask === "function") return window.f360.ask(String(msg == null ? "" : msg));
  return Promise.resolve(false);
}

export function relTime(ts) {
  const t = Number(ts) || 0;
  const d = Date.now() - t;
  if (d < 45000) return "Just now";
  if (d < 3600000) return Math.max(1, Math.floor(d / 60000)) + "m";
  if (d < 86400000) return Math.max(1, Math.floor(d / 3600000)) + "h";
  if (d < 604800000) return Math.max(1, Math.floor(d / 86400000)) + "d";
  try { return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
  catch (e) { return ""; }
}

function postMediaList(p) {
  if (Array.isArray(p.media) && p.media.length) return p.media.filter((m) => m && m.url);
  const out = [];
  if (p.image) out.push({ kind: "image", url: p.image });
  if (p.video) out.push({ kind: "video", url: p.video });
  return out;
}

export function openFeedLightbox(url, kind) {
  document.querySelectorAll(".feed-lightbox").forEach((n) => n.remove());
  const layer = document.createElement("div");
  layer.className = "feed-lightbox";
  layer.tabIndex = -1;
  const inner = document.createElement("div");
  inner.className = "feed-lightbox-inner";
  if (kind === "video") {
    const v = document.createElement("video");
    v.src = url;
    v.controls = true;
    v.autoplay = true;
    v.playsInline = true;
    inner.appendChild(v);
  } else {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    inner.appendChild(img);
  }
  const close = document.createElement("button");
  close.className = "feed-lightbox-x";
  close.type = "button";
  close.textContent = "✕";
  const done = () => { layer.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") done(); };
  close.onclick = done;
  layer.addEventListener("click", (e) => { if (e.target === layer) done(); });
  document.addEventListener("keydown", onKey);
  layer.append(close, inner);
  document.body.appendChild(layer);
  try { layer.focus(); } catch (e) {}
}

export async function mountCommunityFeed(H, root, opts) {
  const { make, api, apiTry, currentSession, getAvatarFor, getUserById, myFamilies } = H;
  const s = currentSession();
  if (!s) { root.innerHTML = ""; root.appendChild(make("div", { className: "small-muted" }, "Sign in to use the feed.")); return; }
  const me = getUserById(s.userId) || { id: s.userId, name: "You" };
  const highlight = (opts && (opts.postId || opts.highlight)) || null;
  const state = { posts: [], filter: "all", q: "", pending: [] };

  root.innerHTML = "";
  root.classList.add("feed-app");

  const head = make("div", { className: "feed-panel-head" });
  head.appendChild(make("div", {}, make("div", { className: "help-kicker" }, "Community"), make("h3", {}, "Feed")));
  const closeBtn = make("button", { className: "modal-close feed-panel-x", type: "button", title: "Close feed" }, "✕");
  closeBtn.onclick = () => { if (typeof H.closeFeedPanel === "function") H.closeFeedPanel(); };
  head.appendChild(closeBtn);
  root.appendChild(head);

  const composer = make("div", { className: "feed-composer" });
  const who = make("div", { className: "feed-composer-who" });
  const meAv = make("div", { className: "chat-avatar", style: "width:40px;height:40px;flex:0 0 40px;font-size:13px" });
  meAv.innerHTML = getAvatarFor(me);
  who.append(meAv, make("div", { style: "font-weight:800;min-width:0" }, me.name || "You"));
  const ta = make("textarea", { className: "input chat-input", placeholder: "What's on your mind, " + ((me.name || "family").split(" ")[0]) + "?", rows: 3 });
  const preview = make("div", { className: "feed-attach-preview" });
  const tools = make("div", { className: "feed-composer-tools" });
  const aud = make("select", { className: "input", style: "width:auto;min-width:150px;flex:1" });
  aud.appendChild(make("option", { value: "public" }, "🌍 Everyone"));
  const fams = myFamilies();
  fams.forEach((f) => aud.appendChild(make("option", { value: "family:" + f.id }, "👨‍👩‍👧‍👦 " + f.name)));
  if (fams.length > 1) aud.appendChild(make("option", { value: "family" }, "👨‍👩‍👧‍👦 All my families"));
  const photoInp = make("input", { type: "file", accept: "image/*", multiple: true, style: "display:none" });
  const videoInp = make("input", { type: "file", accept: "video/mp4,video/webm,video/quicktime,video/*", style: "display:none" });
  const photoBtn = make("button", { className: "feed-tool", type: "button", title: "Add photos" }, "🖼 Photo");
  const videoBtn = make("button", { className: "feed-tool", type: "button", title: "Add a video" }, "▶ Video");
  photoBtn.onclick = () => photoInp.click();
  videoBtn.onclick = () => videoInp.click();
  const postBtn = make("button", { className: "btn small", type: "button" }, "Post");
  tools.append(aud, photoBtn, videoBtn, postBtn);
  composer.append(who, ta, preview, tools, photoInp, videoInp);
  root.appendChild(composer);

  const filterRow = make("div", { className: "feed-filter-row" });
  const q = make("input", { className: "input", placeholder: "Search posts…", type: "search" });
  const filt = make("select", { className: "input", style: "width:auto" });
  [["all", "All"], ["public", "Everyone"], ["family", "Families"]].forEach(([v, l]) => filt.appendChild(make("option", { value: v }, l)));
  filterRow.append(q, filt);
  root.appendChild(filterRow);

  const stream = make("div", { className: "feed-stream" });
  root.appendChild(stream);

  function paintPreview() {
    preview.innerHTML = "";
    if (!state.pending.length) { preview.hidden = true; return; }
    preview.hidden = false;
    state.pending.forEach((m, i) => {
      const chip = make("div", { className: "feed-thumb" });
      if (m.kind === "video") {
        const v = make("video", { src: m.local || m.url, muted: true });
        v.setAttribute("playsinline", "");
        chip.appendChild(v);
        chip.appendChild(make("span", { className: "feed-thumb-tag" }, "VIDEO"));
      } else {
        chip.appendChild(make("img", { src: m.local || m.url, alt: "" }));
      }
      const x = make("button", { className: "feed-thumb-x", type: "button", title: "Remove" }, "✕");
      x.onclick = () => { state.pending.splice(i, 1); paintPreview(); };
      chip.appendChild(x);
      preview.appendChild(chip);
    });
  }

  async function addFiles(files, asVideo) {
    const list = Array.from(files || []).filter(Boolean);
    if (!list.length) return;
    try {
      for (const file of list) {
        const vid = asVideo || (file.type && file.type.startsWith("video/"));
        if (vid) {
          if (file.size > 12 * 1024 * 1024) { await uiNotice("Videos must be 12 MB or smaller."); continue; }
          if (!H.uploadMedia) { await uiNotice("Video upload is not available."); continue; }
          postBtn.disabled = true; postBtn.textContent = "Uploading…";
          const r = await H.uploadMedia(file, file.name || "clip.mp4");
          state.pending = [{ kind: "video", url: r.url, name: file.name, local: URL.createObjectURL(file) }];
        } else {
          if (state.pending.some((m) => m.kind === "video")) state.pending = [];
          if (state.pending.length >= 4) { await uiNotice("Up to 4 photos per post."); break; }
          let blob = file;
          if (typeof H.fileToCompressedBlob === "function") {
            try { blob = await H.fileToCompressedBlob(file); } catch (e) { blob = file; }
          }
          if (H.uploadMedia) {
            postBtn.disabled = true; postBtn.textContent = "Uploading…";
            const r = await H.uploadMedia(blob, (file.name || "photo").replace(/\.[^.]+$/, "") + ".jpg");
            const local = URL.createObjectURL(blob);
            state.pending.push({ kind: "image", url: r.url, name: file.name, local });
          } else if (typeof H.loadToDataUrlSafely === "function") {
            const dataUrl = await H.loadToDataUrlSafely(file);
            state.pending.push({ kind: "image", url: dataUrl, name: file.name, local: dataUrl });
          }
        }
      }
    } catch (e) {
      await uiNotice((e && e.message) || "Could not attach that file.");
    }
    postBtn.disabled = false; postBtn.textContent = "Post";
    paintPreview();
  }

  photoInp.onchange = () => { addFiles(photoInp.files, false); photoInp.value = ""; };
  videoInp.onchange = () => { addFiles(videoInp.files, true); videoInp.value = ""; };

  function hideShareMenus() {
    stream.querySelectorAll(".feed-share-pop").forEach((n) => n.remove());
  }

  function postCard(p) {
    const card = make("div", { className: "feed-card" });
    card.dataset.postId = p.id;
    if (highlight && p.id === highlight) card.classList.add("flash");
    const headEl = make("div", { className: "feed-head" });
    const av = make("div", { className: "chat-avatar", style: "width:40px;height:40px;flex:0 0 40px;font-size:12px" });
    av.innerHTML = getAvatarFor(getUserById(p.authorId) || { id: p.authorId, name: p.authorName, profileImage: p.authorAvatar });
    const meta = make("div", { style: "flex:1;min-width:0" });
    meta.appendChild(make("div", { style: "font-weight:800" }, p.authorName || "Member"));
    const audLabel = p.audience === "public" ? "Everyone" : (p.familyName ? p.familyName : "Family");
    meta.appendChild(make("div", { className: "small-muted" }, relTime(p.createdAt || p.ts) + " · " + audLabel));
    headEl.append(av, meta);
    if (p.canDelete) {
      const more = make("button", { className: "feed-more", type: "button", title: "Delete post" }, "⋯");
      more.onclick = async () => {
        if (!(await uiAsk("Delete this post?"))) return;
        const r = await apiTry("/api/posts/" + p.id, { method: "DELETE" });
        if (r && r.ok) card.remove();
      };
      headEl.appendChild(more);
    }
    card.appendChild(headEl);
    if (p.sharedFrom) {
      const sf = make("div", { className: "feed-shared-from" }, "Shared from " + (p.sharedFrom.authorName || "a member"));
      card.appendChild(sf);
    }
    if (p.text) card.appendChild(make("div", { className: "feed-text" }, p.text));
    const media = postMediaList(p);
    if (media.length) {
      const grid = make("div", { className: "feed-media" + (media.length > 1 ? " multi" : "") });
      media.forEach((m) => {
        if (m.kind === "video") {
          const v = make("video", { className: "feed-video", src: m.url, controls: true });
          v.setAttribute("playsinline", "");
          v.setAttribute("preload", "metadata");
          grid.appendChild(v);
        } else {
          const img = make("img", { className: "feed-img", src: m.url, alt: "" });
          img.onclick = () => openFeedLightbox(m.url, "image");
          grid.appendChild(img);
        }
      });
      card.appendChild(grid);
    }
    const counts = make("div", { className: "feed-counts" });
    const likeN = make("span", {}, (p.likes || 0) ? ("♥ " + p.likes) : "");
    const comN = make("span", {}, (p.comments || []).length ? ((p.comments || []).length + " comments") : "");
    const shN = make("span", {}, (p.shares || 0) ? ((p.shares || 0) + " shares") : "");
    counts.append(likeN, comN, shN);
    card.appendChild(counts);

    const actions = make("div", { className: "feed-actions" });
    const like = make("button", { className: "feed-act" + (p.liked ? " on" : ""), type: "button" }, p.liked ? "♥ Like" : "♡ Like");
    like.onclick = async () => {
      const r = await apiTry("/api/posts/" + p.id + "/like", { method: "POST", body: {} });
      if (r) {
        p.liked = r.liked; p.likes = r.likes;
        like.textContent = p.liked ? "♥ Like" : "♡ Like";
        like.classList.toggle("on", p.liked);
        likeN.textContent = p.likes ? ("♥ " + p.likes) : "";
      }
    };
    const cbtn = make("button", { className: "feed-act", type: "button" }, "💬 Comment");
    const sbtn = make("button", { className: "feed-act", type: "button" }, "↗ Share");
    actions.append(like, cbtn, sbtn);
    card.appendChild(actions);

    const cwrap = make("div", { className: "feed-comments" });
    cwrap.style.display = (p.comments && p.comments.length && highlight === p.id) ? "block" : "none";
    function paintComments() {
      cwrap.querySelectorAll(".feed-comment").forEach((n) => n.remove());
      const row = cwrap.querySelector(".feed-c-row");
      (p.comments || []).forEach((c) => {
        const line = make("div", { className: "feed-comment" });
        const cav = make("div", { className: "chat-avatar", style: "width:26px;height:26px;flex:0 0 26px;font-size:10px" });
        cav.innerHTML = getAvatarFor(getUserById(c.userId || c.authorId) || { id: c.userId || c.authorId, name: c.name });
        const body = make("div", { className: "feed-comment-body" });
        body.appendChild(make("div", { className: "feed-comment-name" }, c.name || "Member"));
        body.appendChild(make("div", {}, c.text || ""));
        line.append(cav, body);
        cwrap.insertBefore(line, row);
      });
      comN.textContent = (p.comments || []).length ? ((p.comments || []).length + " comments") : "";
    }
    const crow = make("div", { className: "row feed-c-row" });
    const cin = make("input", { className: "input", placeholder: "Write a comment…" });
    const csend = make("button", { className: "btn small", type: "button", style: "width:auto" }, "Send");
    const sendC = async () => {
      const text = (cin.value || "").trim();
      if (!text) return;
      const r = await apiTry("/api/posts/" + p.id + "/comments", { method: "POST", body: { text } });
      if (r && r.post) {
        p.comments = r.post.comments || p.comments;
        cin.value = "";
        paintComments();
      } else if (r && r.comment) {
        p.comments = p.comments || [];
        p.comments.push(r.comment);
        cin.value = "";
        paintComments();
      }
    };
    csend.onclick = sendC;
    cin.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sendC(); } });
    crow.append(cin, csend);
    cwrap.appendChild(crow);
    paintComments();
    cbtn.onclick = () => {
      const open = cwrap.style.display === "none";
      cwrap.style.display = open ? "block" : "none";
      if (open) setTimeout(() => cin.focus(), 40);
    };
    card.appendChild(cwrap);

    sbtn.onclick = (ev) => {
      ev.stopPropagation();
      hideShareMenus();
      const pop = make("div", { className: "feed-share-pop" });
      const copy = make("button", { type: "button" }, "Copy link");
      copy.onclick = async () => {
        const url = location.origin + "/?post=" + p.id;
        await apiTry("/api/posts/" + p.id + "/share", { method: "POST", body: {} });
        p.shares = (p.shares || 0) + 1;
        shN.textContent = p.shares + " shares";
        try { await navigator.clipboard.writeText(url); copy.textContent = "Copied"; }
        catch (e) { await uiNotice(url); }
        setTimeout(hideShareMenus, 700);
      };
      const repost = make("button", { type: "button" }, "Share to my feed");
      repost.onclick = async () => {
        const r = await apiTry("/api/posts/" + p.id + "/share", { method: "POST", body: { mode: "repost", audience: "public" } });
        hideShareMenus();
        if (r && r.post) { state.posts.unshift(r.post); paintStream(); }
        else load();
      };
      const native = make("button", { type: "button" }, "Share…");
      native.onclick = async () => {
        const url = location.origin + "/?post=" + p.id;
        await apiTry("/api/posts/" + p.id + "/share", { method: "POST", body: {} });
        hideShareMenus();
        if (navigator.share) {
          try { await navigator.share({ title: (p.authorName || "GPS FAMILIA") + " posted", text: p.text || "", url }); }
          catch (e) { if (e.name !== "AbortError") uiNotice(url); }
        } else {
          try { await navigator.clipboard.writeText(url); } catch (e) { uiNotice(url); }
        }
      };
      pop.append(copy, repost, native);
      card.appendChild(pop);
      const off = (e) => { if (!pop.contains(e.target) && e.target !== sbtn) { hideShareMenus(); document.removeEventListener("mousedown", off); } };
      setTimeout(() => document.addEventListener("mousedown", off), 0);
    };
    return card;
  }

  function paintStream() {
    stream.innerHTML = "";
    if (!state.posts.length) {
      stream.appendChild(make("div", { className: "feed-empty" }, "No posts yet. Share a photo, a clip, or a note with Everyone or a family."));
      return;
    }
    state.posts.forEach((p) => stream.appendChild(postCard(p)));
    if (highlight) {
      const el = stream.querySelector('[data-post-id="' + highlight + '"]');
      if (el) setTimeout(() => { try { el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) {} }, 80);
    }
  }

  async function load() {
    stream.innerHTML = "";
    stream.appendChild(make("div", { className: "small-muted" }, "Loading…"));
    const j = await apiTry("/api/feed?filter=" + encodeURIComponent(filt.value) + "&q=" + encodeURIComponent(q.value.trim()));
    state.posts = (j && j.posts) || [];
    paintStream();
  }

  postBtn.onclick = async () => {
    const text = (ta.value || "").trim();
    if (!text && !state.pending.length) return;
    const v = aud.value;
    let audience = "public", familyId = null;
    if (v.startsWith("family:")) { audience = "family"; familyId = v.slice(7); }
    else if (v === "family") audience = "family";
    const media = state.pending.map((m) => ({ kind: m.kind, url: m.url }));
    postBtn.disabled = true; postBtn.textContent = "Posting…";
    try {
      await api("/api/posts", { method: "POST", body: { text, audience, familyId, media, image: (media.find((m) => m.kind === "image") || {}).url || "", video: (media.find((m) => m.kind === "video") || {}).url || "" } });
      ta.value = "";
      state.pending = [];
      paintPreview();
      await load();
    } catch (e) { await uiNotice(e.message || "Could not post"); }
    postBtn.disabled = false; postBtn.textContent = "Post";
  };

  let t;
  q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(load, 220); });
  filt.onchange = load;

  window.__refreshFeed = (msg) => {
    if (!msg) return load();
    if (msg.action === "delete" && msg.id) {
      state.posts = state.posts.filter((p) => p.id !== msg.id);
      paintStream();
      return;
    }
    if (msg.post) {
      const i = state.posts.findIndex((p) => p.id === msg.post.id);
      if (i >= 0) state.posts[i] = msg.post;
      else if (msg.action === "new") state.posts.unshift(msg.post);
      paintStream();
      return;
    }
    load();
  };

  await load();
}
