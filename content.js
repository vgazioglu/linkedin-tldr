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
  // Straight horizontal card needs around 170px minimum height.
  const MIN_VEIL_HEIGHT = 170;
  // Header/footer lines ("see translation", "…more") are short; a bigger jump means we left the text block.
  const MAX_EXTRA_TEXT = 60;
  const MEDIA_SIBLING_LOOKAHEAD = 3;

  const STAMP_CSS = `
    .stamp {
      position: absolute; top: 50%; left: 50%; box-sizing: border-box;
      width: 400px; max-width: 90%;
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      padding: 14px 18px; border: 2px solid var(--theme, #0a66c2);
      border-radius: 10px; background: rgba(255, 255, 255, 0.97); color: #1d2226;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
      font: 500 14px/1.45 -apple-system, system-ui, sans-serif; text-align: center;
      transform: translate(-50%, -50%);
      cursor: pointer; pointer-events: auto;
      transition: box-shadow 0.2s ease, border-color 0.2s ease;
    }
    .stamp:hover {
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
    }
    .badge-bar {
      display: flex; gap: 8px; align-items: center; justify-content: center;
    }
    .badge {
      padding: 3px 9px; border-radius: 4px; background: var(--theme, #0a66c2); color: #fff;
      font-size: 11px; font-weight: 800; letter-spacing: 0.04em;
    }
    .meta-tag {
      font-size: 11px; font-weight: 600; color: #5e6b75;
    }
    .summary-text {
      color: #1d2226; font-size: 14px; font-weight: 600; line-height: 1.45;
    }
    .hint {
      font-size: 11px; color: #777; font-weight: 400; margin-top: 2px;
    }
    .loading { width: 180px; border-color: #c9c9c9; }
    .loading .badge { background: #b5b5b5; }
    .loading .hint { display: none; }
    .loading .summary-text {
      width: 100%; height: 10px; border-radius: 4px;
      background: linear-gradient(90deg, #e3e3e3 25%, #f5f5f5 50%, #e3e3e3 75%);
      background-size: 200% 100%; animation: shimmer 1s linear infinite;
    }
    .slam { animation: slam 0.32s cubic-bezier(0.16, 1, 0.3, 1) both; }
    .revealed, .error {
      top: 6px; right: 8px; left: auto; width: auto; max-width: none;
      padding: 0; border: 0; background: none; box-shadow: none; transform: none; animation: none;
    }
    .revealed .summary-text, .revealed .meta-tag, .revealed .hint { display: none; }
    .revealed .badge { opacity: 0.85; }
    .revealed .badge:hover { opacity: 1; }
    .error { padding: 4px 8px; border: 1px solid #f5a623; background: #fff4e5; color: #1d2226; font-weight: 500; border-radius: 4px; }
    .error .badge { background: #f5a623; }
    @keyframes shimmer { to { background-position: -200% 0; } }
    @keyframes slam {
      0% { opacity: 0; transform: translate(-50%, -68%) scale(0.95); }
      100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    }
  `;

  let minChars = 400;
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

  // URL'ler, hashtag'ler ve emojilerden arındırılmış saf okunabilir metin
  function extractPureText(text) {
    return text
      .replace(/https?:\/\/\S+|www\.\S+|lnkd\.in\/\S+/gi, '')
      .replace(/#[^\s#]+/gu, '')
      .replace(/\p{Extended_Pictographic}/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseCount(str) {
    if (!str) return 0;
    const match = str.toLowerCase().match(/([\d.,]+)\s*([kmb])?/);
    if (!match) return 0;
    let numStr = match[1];
    if (numStr.includes('.') && numStr.includes(',')) {
      numStr = numStr.replace(/\./g, '').replace(',', '.');
    } else if (numStr.includes('.') && !match[2]) {
      if (/\.\d{3}$/.test(numStr)) numStr = numStr.replace(/\./g, '');
    } else if (numStr.includes(',') && !match[2]) {
      if (/,\d{3}$/.test(numStr)) numStr = numStr.replace(/,/g, '');
      else numStr = numStr.replace(',', '.');
    } else {
      numStr = numStr.replace(',', '.');
    }
    const num = parseFloat(numStr);
    if (isNaN(num)) return 0;
    const unit = match[2];
    if (unit === 'k' || unit === 'b') return Math.round(num * 1000);
    if (unit === 'm') return Math.round(num * 1000000);
    return Math.round(num);
  }

  function formatShort(num) {
    if (!num) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(1).replace('.0', '') + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1).replace('.0', '') + 'B';
    return String(num);
  }

  function getPostMetrics(host) {
    const card = host.closest(
      '.feed-shared-update-v2, [data-urn], [data-id], [data-activity-urn], .main-feed-activity-card-with-comments, .occludable-update, article'
    ) || host.parentElement;
    if (!card) return { likes: 0, comments: 0, reposts: 0, score: 0 };

    const rxEl = card.querySelector(
      '[data-num-reactions], .social-details-social-counts__reactions-count, [data-test-id="social-actions__reaction-count"], [data-test-id="social-actions__reactions"], button[aria-label*="tepki"], button[aria-label*="reaction"], button[aria-label*="beğeni"], button[aria-label*="like"]'
    );
    const cmEl = card.querySelector(
      '[data-num-comments], .social-details-social-counts__comments, [data-test-id="social-actions__comments"], button[aria-label*="yorum"], button[aria-label*="comment"]'
    );
    const rpEl = card.querySelector(
      '[data-num-reposts], button[aria-label*="yeniden paylaşım"], button[aria-label*="repost"], [data-test-id*="repost"]'
    );

    const likes = parseCount(rxEl?.getAttribute('data-num-reactions') || rxEl?.textContent || rxEl?.getAttribute('aria-label') || '');
    const comments = parseCount(cmEl?.getAttribute('data-num-comments') || cmEl?.textContent || cmEl?.getAttribute('aria-label') || '');
    const reposts = parseCount(rpEl?.getAttribute('data-num-reposts') || rpEl?.textContent || rpEl?.getAttribute('aria-label') || '');
    const score = (likes * 1) + (comments * 3) + (reposts * 5);

    return { likes, comments, reposts, score };
  }

  function classifyPost(metrics) {
    const { likes, comments, reposts, score } = metrics;

    if (likes >= 1000 || comments >= 100 || score >= 1500) {
      return {
        level: 'VIRAL',
        badge: '🚀 VİRAL',
        themeColor: '#7c3aed',
        metaText: `${formatShort(likes)} beğeni · ${formatShort(comments)} yorum`,
      };
    }

    if (likes >= 150 || comments >= 20 || score >= 300) {
      return {
        level: 'POPULAR',
        badge: '🔥 BAŞARILI',
        themeColor: '#ea580c',
        metaText: `${formatShort(likes)} beğeni · ${formatShort(comments)} yorum`,
      };
    }

    if (comments >= 15 && (comments / (likes || 1)) >= 0.15) {
      return {
        level: 'DISCUSSION',
        badge: '💬 TARTIŞMA',
        themeColor: '#0284c7',
        metaText: `${formatShort(comments)} yorum`,
      };
    }

    return {
      level: 'NORMAL',
      badge: 'TL;DR',
      themeColor: '#0a66c2',
      metaText: likes > 0 ? `${formatShort(likes)} beğeni` : '',
    };
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
    const text = postText(host);
    const pureText = extractPureText(text);

    // Kriter: Saf metin (linkler, hashtagler ve emojiler hariç) en az minChars (400) karakter olmalı
    if (pureText.length < minChars) return;

    const metrics = getPostMetrics(host);
    const info = classifyPost(metrics);

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
      `<div class="stamp loading" style="--theme: ${info.themeColor};" title="Orijinal gönderiyi göster / gizle">` +
        `<div class="badge-bar">` +
          `<span class="badge">${info.badge}</span>` +
          (info.metaText ? `<span class="meta-tag">${info.metaText}</span>` : '') +
        `</div>` +
        `<div class="summary-text"></div>` +
        `<div class="hint">Orijinal metni açmak için tıkla</div>` +
      `</div>`;
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
      const summaryEl = stamp.querySelector('.summary-text');
      if (summaryEl) summaryEl.textContent = res.summary;
      stamp.classList.add('slam');
      veil.classList.add('tldr-shake');
      return;
    }

    if (res?.code === 'NO_KEY' && !noKeyShown) {
      noKeyShown = true;
      post.revealed = true;
      veil.classList.add('tldr-revealed');
      stamp.classList.add('error');
      const summaryEl = stamp.querySelector('.summary-text');
      if (summaryEl) summaryEl.textContent = 'Configure LLM provider in settings';
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

  function applySettings({ enabled = true, minChars: min = 400 }) {
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
