(() => {
  // LinkedIn ships several feed DOMs; any of these holds a post's body text.
  const POST_TEXT_SELECTOR = [
    '.feed-shared-update-v2__description',
    '.update-components-update-v2__commentary',
    '.feed-shared-inline-show-more-text',
    '[data-view-name="feed-commentary"]',
    '[data-testid="expandable-text-box"]',
  ].join(',');

  // Start summarizing well before the post scrolls into view so it's ready on arrival.
  const PREFETCH_MARGIN = '1500px 0px';
  // A 260px-wide stamp rotated -30deg needs roughly this much height.
  const MIN_VEIL_HEIGHT = 280;
  // Clamped posts shorter than this aren't worth a summary.
  const MIN_CLAMPED_CHARS = 80;
  // Header/footer lines ("see translation", "…more") are short; a bigger jump means we left the text block.
  const MAX_EXTRA_TEXT = 60;
  const MEDIA_SIBLING_LOOKAHEAD = 3;

  const STAMP_CSS = `
    .stamp {
      position: absolute; top: 50%; left: 50%; box-sizing: border-box;
      width: 260px; max-width: 85%;
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: 12px 14px; border: 3px solid #d0021b; outline: 1px solid #d0021b; outline-offset: 3px;
      border-radius: 6px; background: rgba(255, 255, 255, 0.85); color: #d0021b;
      font: 800 15px/1.3 -apple-system, system-ui, sans-serif; text-align: center;
      transform: translate(-50%, -50%) rotate(-30deg);
      cursor: pointer; pointer-events: auto;
    }
    .badge {
      padding: 1px 6px; border-radius: 4px; background: #d0021b; color: #fff;
      font-size: 11px; letter-spacing: 0.08em;
    }
    .loading { width: 140px; border-color: #c9c9c9; outline-color: #c9c9c9; transform: translate(-50%, -50%); }
    .loading .badge { background: #b5b5b5; }
    .loading .text {
      width: 100%; height: 10px; border-radius: 4px;
      background: linear-gradient(90deg, #e3e3e3 25%, #f5f5f5 50%, #e3e3e3 75%);
      background-size: 200% 100%; animation: shimmer 1s linear infinite;
    }
    .slam { animation: slam 0.38s cubic-bezier(0.2, 0.9, 0.3, 1.2) both; }
    .revealed, .error {
      top: 4px; right: 4px; left: auto; width: auto; max-width: none;
      padding: 0; border: 0; outline: 0; background: none; transform: none; animation: none;
    }
    .revealed .text { display: none; }
    .error { padding: 4px 8px; border: 1px solid #f5a623; background: #fff4e5; color: #1d2226; font-weight: 500; }
    .error .badge { background: #f5a623; }
    @keyframes shimmer { to { background-position: -200% 0; } }
    @keyframes slam {
      0% { opacity: 0; transform: translate(-50%, -180%) rotate(-30deg) scale(2.6); }
      60% { opacity: 1; transform: translate(-50%, -50%) rotate(-30deg) scale(0.92); }
      100% { transform: translate(-50%, -50%) rotate(-30deg) scale(1); }
    }
  `;

  let minChars = 280;
  let noKeyShown = false;
  const posts = new WeakMap(); // anchor element -> post state

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        io.unobserve(entry.target);
        process(entry.target);
      }
    },
    // New LinkedIn scrolls `main#workspace`, not the page; scrollMargin extends the prefetch zone into it.
    { rootMargin: PREFETCH_MARGIN, scrollMargin: PREFETCH_MARGIN },
  );

  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const post = posts.get(entry.target);
      if (post) layout(post);
    }
  });

  const isTopLevel = (el) => !el.parentElement?.closest(POST_TEXT_SELECTOR);

  function scan() {
    for (const el of document.querySelectorAll(POST_TEXT_SELECTOR)) {
      if (el.dataset.tldr || !isTopLevel(el)) continue;
      el.dataset.tldr = 'seen';
      io.observe(el);
    }
  }

  const clean = (s) => s.replace(/\s+/g, ' ').trim();

  function postText(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('button, .visually-hidden').forEach((n) => n.remove());
    return clean(clone.textContent);
  }

  // Climb out of LinkedIn's clamping wrappers to the block that holds only the post text.
  function textSection(host) {
    const base = clean(host.textContent).length;
    let section = host;
    for (let p = section.parentElement; p && p !== document.body; p = p.parentElement) {
      if (p.querySelector('img, video')) break;
      if (clean(p.textContent).length - base > MAX_EXTRA_TEXT) break;
      section = p;
    }
    return section;
  }

  function hasMedia(el) {
    for (const m of el.querySelectorAll('img, video')) {
      const r = m.getBoundingClientRect();
      if (r.width >= 150 && r.height >= 80) return true;
    }
    return false;
  }

  function mediaSection(section, spacer) {
    let sib = section.nextElementSibling;
    for (let i = 0; sib && i < MEDIA_SIBLING_LOOKAHEAD; sib = sib.nextElementSibling) {
      if (sib === spacer) continue;
      if (hasMedia(sib)) return sib;
      i++;
    }
    return null;
  }

  // Veil covers text section (+ media below it); a spacer grows short regions so the stamp fits.
  function layout(post) {
    const { section, anchor, spacer, veil } = post;
    if (!section.isConnected) return;
    const end = post.revealed ? section : (mediaSection(section, spacer) ?? section);
    if (end.nextElementSibling !== spacer) end.after(spacer);

    const a = anchor.getBoundingClientRect();
    const sectionTop = box(section).top;
    const top = sectionTop - a.top - anchor.clientTop;
    const contentHeight = box(end).bottom - sectionTop;
    const spacerHeight = post.revealed ? 0 : Math.max(0, Math.ceil(MIN_VEIL_HEIGHT - contentHeight));

    setPx(spacer, 'height', spacerHeight);
    setPx(veil, 'top', top);
    setPx(veil, 'height', post.revealed ? 0 : contentHeight + spacerHeight);
  }

  // LinkedIn wraps media in `display: contents` divs whose own rect is 0x0; measure their content instead.
  function box(el) {
    const r = el.getBoundingClientRect();
    if (r.height > 0) return r;
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect();
  }

  function setPx(el, prop, value) {
    const v = `${Math.round(value)}px`;
    if (el.style.getPropertyValue(prop) !== v) el.style.setProperty(prop, v, 'important');
  }

  function setRevealed(post, revealed) {
    post.revealed = revealed;
    post.veil.classList.toggle('tldr-revealed', revealed);
    post.stamp.classList.toggle('revealed', revealed);
    // Re-hiding replays the slam.
    post.stamp.classList.remove('slam');
    if (!revealed) {
      void post.stamp.offsetWidth;
      post.stamp.classList.add('slam');
    }
    layout(post);
  }

  function teardown(post) {
    ro.unobserve(post.anchor);
    posts.delete(post.anchor);
    post.veil.remove();
    post.spacer.remove();
    post.anchor.classList.remove('tldr-anchor');
  }

  function isClamped(el) {
    const more = el.querySelector('[data-testid="expandable-text-button"]');
    return (more && more.getClientRects().length > 0) || el.scrollHeight > el.clientHeight + 2;
  }

  async function process(host) {
    // LinkedIn clamps posts to ~3 lines behind "…more"; those count as long even if the full text is short.
    const text = postText(host);
    if (text.length < minChars && !(isClamped(host) && text.length >= MIN_CLAMPED_CHARS)) return;

    const section = textSection(host);
    const anchor = section.parentElement;
    if (!anchor) return;
    if (getComputedStyle(anchor).position === 'static') anchor.classList.add('tldr-anchor');

    const spacer = document.createElement('div');
    spacer.className = 'tldr-spacer';
    const veil = document.createElement('div');
    veil.className = 'tldr-veil';
    const shadow = veil.attachShadow({ mode: 'open' });
    shadow.innerHTML =
      `<style>${STAMP_CSS}</style>` +
      '<div class="stamp loading" title="Click to show / hide the original post">' +
      '<span class="badge">TL;DR</span><span class="text"></span></div>';
    const stamp = shadow.querySelector('.stamp');
    anchor.append(veil);

    const post = { section, anchor, spacer, veil, stamp, revealed: false };
    posts.set(anchor, post);
    veil.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (!stamp.classList.contains('loading')) setRevealed(post, !post.revealed);
    });
    layout(post);
    ro.observe(anchor);

    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'summarize', text });
    } catch (err) {
      res = { ok: false, error: String(err) };
    }

    stamp.classList.remove('loading');
    if (res?.ok) {
      stamp.querySelector('.text').textContent = res.summary;
      stamp.classList.add('slam');
      veil.classList.add('tldr-shake');
      return;
    }

    if (res?.code === 'NO_KEY' && !noKeyShown) {
      noKeyShown = true;
      post.revealed = true;
      veil.classList.add('tldr-revealed');
      stamp.classList.add('error');
      stamp.querySelector('.text').textContent = 'Add your AI Gateway API key in settings';
      veil.onclick = (e) => {
        e.stopPropagation();
        chrome.runtime.sendMessage({ type: 'openOptions' });
      };
      layout(post);
      return;
    }
    if (res?.code !== 'NO_KEY') console.warn('[LinkedIn TL;DR]', res?.error);
    teardown(post);
  }

  // Images load after we lay out; re-measure so the veil stretches over them.
  document.addEventListener(
    'load',
    (e) => {
      const anchor = e.target instanceof Element && e.target.closest('.tldr-anchor, :has(> .tldr-veil)');
      const post = anchor && posts.get(anchor);
      if (post) layout(post);
    },
    true,
  );

  function applySettings({ enabled = true, minChars: min = 280 }) {
    minChars = min;
    document.documentElement.classList.toggle('tldr-off', !enabled);
  }

  chrome.storage.local.get(['enabled', 'minChars']).then(applySettings);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    chrome.storage.local.get(['enabled', 'minChars']).then(applySettings);
    if (changes.apiKey?.newValue) noKeyShown = false;
  });

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      scan();
    });
  }).observe(document.body, { childList: true, subtree: true });
  scan();
})();
