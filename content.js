(() => {
  // LinkedIn ships several feed DOMs; any of these holds a post's body text.
  const POST_TEXT_SELECTOR = [
    '.feed-shared-update-v2__description',
    '.update-components-update-v2__commentary',
    '.feed-shared-inline-show-more-text',
    '[data-view-name="feed-commentary"]',
    '[data-testid="expandable-text-box"]',
    '.attributed-text-segment-list__container',
    '.feed-shared-text',
    '.update-components-text',
  ].join(',');

  // Start summarizing well before the post scrolls into view so it's ready on arrival.
  const PREFETCH_MARGIN = '1500px 0px';
  // Straight horizontal card needs around 170px minimum height.
  const MIN_VEIL_HEIGHT = 170;
  // Header/footer lines ("see translation", "…more") are short; a bigger jump means we left the text block.
  const MAX_EXTRA_TEXT = 60;
  const MEDIA_SIBLING_LOOKAHEAD = 3;

  const STAMP_CSS = `
    :host {
      display: block;
      width: 100%;
    }
    .compact-card {
      box-sizing: border-box;
      width: 100%;
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px 16px;
      margin: 8px 0;
      background: var(--bg-card, #ffffff);
      border: 1.5px solid var(--theme, #0a66c2);
      border-radius: 12px;
      box-shadow: 0 3px 12px rgba(0, 0, 0, 0.06);
      cursor: pointer;
      font-family: -apple-system, system-ui, sans-serif;
      transition: box-shadow 0.2s ease, border-color 0.2s ease, padding 0.2s ease;
      color: var(--text-color, #1d2226);
    }
    .compact-card:hover {
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.1);
    }
    .avatar-col {
      flex-shrink: 0;
      width: 44px;
      height: 44px;
      margin-top: 2px;
    }
    .avatar-img {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      object-fit: cover;
      display: block;
      border: 1px solid rgba(0, 0, 0, 0.08);
    }
    .avatar-placeholder {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.06);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
    }
    .card-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
    }
    .author-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
    }
    .author-info {
      display: flex;
      align-items: baseline;
      gap: 6px;
      overflow: hidden;
      white-space: nowrap;
      min-width: 0;
      flex: 1;
    }
    .author-name {
      font-weight: 700;
      font-size: 13.5px;
      color: var(--text-color, #1d2226);
      flex-shrink: 0;
    }
    .author-headline {
      color: var(--meta-color, #666);
      font-size: 12px;
      font-weight: 400;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }
    .author-time {
      color: var(--hint-color, #888);
      font-size: 11.5px;
      flex-shrink: 0;
      white-space: nowrap;
    }
    .badge-bar {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }
    .badge {
      padding: 2px 7px;
      border-radius: 4px;
      background: var(--theme, #0a66c2);
      color: #fff;
      font-size: 10.5px;
      font-weight: 800;
      letter-spacing: 0.02em;
      white-space: nowrap;
    }
    .meta-tag {
      color: var(--meta-color, #5e6b75);
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
    }
    .summary-text {
      color: var(--text-color, #1d2226);
      font-size: 13.5px;
      font-weight: 500;
      line-height: 1.4;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .hint {
      color: var(--hint-color, #777);
      font-size: 11px;
      font-weight: 500;
    }
    .loading .summary-text {
      width: 100%;
      height: 14px;
      border-radius: 4px;
      background: linear-gradient(90deg, #e3e3e3 25%, #f5f5f5 50%, #e3e3e3 75%);
      background-size: 200% 100%;
      animation: shimmer 1s linear infinite;
    }
    .compact-card.revealed {
      padding: 6px 12px;
      background: rgba(0, 0, 0, 0.02);
      border-style: dashed;
      border-width: 1px;
      margin-bottom: 8px;
      box-shadow: none;
      align-items: center;
    }
    .compact-card.revealed .avatar-col { display: none; }
    .compact-card.revealed .summary-text { display: none; }
    .compact-card.revealed .author-headline { display: none; }
    .compact-card.revealed .author-time { display: none; }
    .error {
      border-color: #f5a623;
      background: #fff4e5;
    }
    .error .badge {
      background: #f5a623;
    }
    @keyframes shimmer { to { background-position: -200% 0; } }
  `;

  let minChars = 280;
  let noKeyShown = false;
  const posts = new WeakMap(); // section element -> post state

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

  const isPostCommentary = (el) => {
    // 1. Yorumların (comments) içindeki metinleri hariç tut
    if (el.closest('.comment, [class*="comment__"], .comments-comments-list, .comments-comment-item, section.comment')) {
      return false;
    }
    // 2. İç içe geçmiş post metinlerini ele
    if (el.parentElement?.closest(POST_TEXT_SELECTOR)) {
      return false;
    }
    return true;
  };

  function scan() {
    for (const el of document.querySelectorAll(POST_TEXT_SELECTOR)) {
      if (el.dataset.tldr || !isPostCommentary(el)) continue;
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
      '.feed-shared-update-v2, [data-urn], [data-id], [data-activity-urn], .main-feed-activity-card, .main-feed-activity-card-with-comments, .occludable-update, article, .feed-shared-update'
    ) || host.parentElement?.parentElement;
    if (!card) return { likes: 0, comments: 0, reposts: 0, score: 0 };

    let likes = 0, comments = 0, reposts = 0;

    // 1. Doğrudan data-num niteliklerinden oku (data-num-reactions, data-num-comments, data-num-reposts)
    const numRx = card.querySelector('[data-num-reactions]');
    if (numRx) likes = parseCount(numRx.getAttribute('data-num-reactions'));
    const numCm = card.querySelector('[data-num-comments]');
    if (numCm) comments = parseCount(numCm.getAttribute('data-num-comments'));
    const numRp = card.querySelector('[data-num-reposts]');
    if (numRp) reposts = parseCount(numRp.getAttribute('data-num-reposts'));

    // 2. data-test-id elemanlarından oku
    if (!likes) {
      const rxEl = card.querySelector('[data-test-id="social-actions__reaction-count"], .social-details-social-counts__reactions-count, [class*="reactions-count"]');
      if (rxEl) likes = parseCount(rxEl.textContent);
    }
    if (!comments) {
      const cmEl = card.querySelector('[data-test-id="social-actions__comments"], .social-details-social-counts__comments');
      if (cmEl) comments = parseCount(cmEl.textContent);
    }

    // 3. Sosyal sayaç barı metninden oku (.social-details-social-counts)
    const countsBar = card.querySelector('.social-details-social-counts, [class*="social-counts"], [class*="social-actions"]');
    if (countsBar) {
      const barText = countsBar.textContent || '';
      
      if (!comments) {
        const cmMatch = barText.match(/([\d.,]+(?:\s*[kmb])?)\s*(?:yorum|comment)/i);
        if (cmMatch) comments = parseCount(cmMatch[1]);
      }
      
      if (!reposts) {
        const rpMatch = barText.match(/([\d.,]+(?:\s*[kmb])?)\s*(?:yeniden paylaşım|paylaşım|repost)/i);
        if (rpMatch) reposts = parseCount(rpMatch[1]);
      }

      if (!likes) {
        const rxEl = countsBar.querySelector(
          '.social-details-social-counts__reactions-count, [class*="reactions-count"], [data-test-id*="reaction-count"]'
        );
        if (rxEl) likes = parseCount(rxEl.textContent);
        else {
          const rxMatch = barText.match(/([\d.,]+(?:\s*[kmb])?)\s*(?:tepki|reaction|beğeni|like)/i);
          if (rxMatch) likes = parseCount(rxMatch[1]);
        }
      }
    }

    // 4. Buton ve Linklerin aria-label / text içeriklerini tara
    if (!likes || !comments || !reposts) {
      for (const el of card.querySelectorAll('button, a')) {
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        const text = (el.textContent || '').trim().toLowerCase();
        const combined = aria + ' ' + text;

        if (!likes && (combined.includes('tepki') || combined.includes('reaction') || combined.includes('beğen') || combined.includes('like'))) {
          likes = parseCount(aria || text);
        }
        if (!comments && (combined.includes('yorum') || combined.includes('comment'))) {
          comments = parseCount(aria || text);
        }
        if (!reposts && (combined.includes('repost') || combined.includes('paylaşım'))) {
          reposts = parseCount(aria || text);
        }
      }
    }

    const score = (likes * 1) + (comments * 3) + (reposts * 5);
    return { likes, comments, reposts, score };
  }

  function classifyPost(metrics) {
    const { likes, comments, reposts, score } = metrics;

    // Gerçekçi eşikler (Kişisel akış ortamı için optimize edildi):
    // 🚀 VİRAL: 150+ beğeni veya 20+ yorum veya 250+ skor
    if (likes >= 150 || comments >= 20 || score >= 250) {
      return {
        level: 'VIRAL',
        badge: '🚀 VİRAL',
        themeColor: '#7c3aed',
        metaText: `${formatShort(likes)} beğeni · ${formatShort(comments)} yorum`,
      };
    }

    // 🔥 BAŞARILI: 30+ beğeni veya 5+ yorum veya 50+ skor
    if (likes >= 30 || comments >= 5 || score >= 50) {
      return {
        level: 'POPULAR',
        badge: '🔥 BAŞARILI',
        themeColor: '#ea580c',
        metaText: `${formatShort(likes)} beğeni · ${formatShort(comments)} yorum`,
      };
    }

    // 💬 TARTIŞMA: Yorum sayısı belirgin olanlar
    if (comments >= 5 && (comments / (likes || 1)) >= 0.10) {
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

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getPostAuthorInfo(card, section) {
    if (!card && !section) return null;

    // 1. Gönderi içindeki actor / gönderici bloğunu bul
    let actor = null;
    if (card) {
      actor = card.querySelector(
        '.feed-shared-update-v2__actor, .update-components-actor, .feed-shared-actor, [data-test-id*="entity-lockup"], .base-main-feed-card__entity-lockup, div[class*="actor"]'
      );
    }
    // Fallback: metin bölümünden önceki kardeş elemanları tara
    if (!actor && section && section.parentElement) {
      let prev = section.previousElementSibling;
      while (prev) {
        if (prev.querySelector('img') || (prev.className && typeof prev.className === 'string' && (prev.className.includes('actor') || prev.className.includes('header')))) {
          actor = prev;
          break;
        }
        prev = prev.previousElementSibling;
      }
    }

    if (!actor) return null;

    // 2. Hem yazar bilgilerini hem de sağ üstteki (...) ve (X) menüsünü içeren EN ÜST SATIRI bul
    let headerRow = actor;
    const controlMenu = card?.querySelector(
      '.feed-shared-control-menu, .feed-shared-update-v2__control-menu, [class*="control-menu"], button[aria-label*="Seçenekler"], button[aria-label*="More actions"], button[aria-label*="Options"]'
    );
    if (controlMenu && card) {
      let p = actor;
      while (p && p !== card && p !== document.body) {
        if (p.contains(controlMenu)) {
          headerRow = p;
          break;
        }
        p = p.parentElement;
      }
    } else {
      const parentRow = actor.closest(
        '.feed-shared-update-v2__actor, .update-components-actor, [class*="update__actor"], [class*="feed-shared-update-v2__actor"]'
      );
      if (parentRow) headerRow = parentRow;
    }

    // 3. Profil Resmi (Avatar)
    let avatarUrl = '';
    const avatarImg = headerRow.querySelector(
      '.update-components-actor__avatar-image, .feed-shared-actor__avatar-image, .presence-entity__image, img.evi-image, img:not([src*="data:image/svg"])'
    );
    if (avatarImg?.src && !avatarImg.src.startsWith('data:image/svg')) {
      avatarUrl = avatarImg.src;
    }

    // 4. Gönderen Kişi / Kurum Adı
    let name = '';
    const nameEl = headerRow.querySelector(
      '.update-components-actor__name, .feed-shared-actor__name, [class*="actor__name"], [class*="actor__title"], a[data-tracking-control-name*="actor"], a[href*="/in/"], a[href*="/company/"]'
    );
    if (nameEl) {
      const visual = nameEl.querySelector('[aria-hidden="true"]');
      name = (visual ? visual.innerText : nameEl.innerText || '').trim();
      name = name.split('\n')[0].replace(/•.*$/, '').trim();
    }

    // 5. Ünvan / Açıklama / Şirket
    let headline = '';
    const descEl = headerRow.querySelector(
      '.update-components-actor__description, .feed-shared-actor__description, [class*="actor__description"]'
    );
    if (descEl) {
      const visual = descEl.querySelector('[aria-hidden="true"]');
      headline = (visual ? visual.innerText : descEl.innerText || '').trim().replace(/\s+/g, ' ');
    }

    // 6. Gönderi Zamanı (kaç saat/gün önce: "4d", "1g", "3 sa" vb.)
    let timeAgo = '';
    const subDescEl = headerRow.querySelector(
      '.update-components-actor__sub-description, .feed-shared-actor__sub-description, [class*="actor__sub-description"], time'
    );
    if (subDescEl) {
      const visual = subDescEl.querySelector('[aria-hidden="true"]');
      const raw = (visual ? visual.innerText : subDescEl.innerText || '').trim();
      const parts = raw.split('•').map(p => p.trim()).filter(p => p && !p.includes('🌐') && !p.includes('Public') && !p.includes('Herkese açık') && !p.includes('Düzenlendi') && !p.includes('Edited'));
      timeAgo = parts[0] || '';
    }
    if (!timeAgo) {
      const timeMatch = headerRow.innerText.match(/\b\d+\s*(?:s[ah]|dk|g|h|ay|yıl|d|m|y|w|mo)\b/i);
      if (timeMatch) timeAgo = timeMatch[0];
    }

    // Fallback: spesifik sınıflar bulunamazsa satırlardan ayrıştır
    if (!name || !headline) {
      const lines = headerRow.innerText.split('\n').map(s => s.trim()).filter(Boolean);
      if (!name && lines[0]) name = lines[0].replace(/•.*$/, '').trim();
      if (!headline && lines[1] && !lines[1].includes('takipçi') && !lines[1].includes('followers')) {
        headline = lines[1];
      }
      if (!timeAgo && lines[2]) {
        timeAgo = lines[2].split('•')[0].trim();
      }
    }

    return { actor: headerRow, avatarUrl, name, headline, timeAgo };
  }

  function findPostMedia(card, section) {
    if (!card) return null;
    const media = card.querySelector(
      '.share-native-video, .feed-shared-image, .feed-shared-update-v2__content, .update-components-image, .update-components-video, .update-components-linkedin-video, .feed-shared-article'
    );
    if (media && !media.contains(section)) return media;
    return mediaSection(section);
  }

  function togglePost(post) {
    post.revealed = !post.revealed;
    post.compactCard.classList.toggle('revealed', post.revealed);
    const hintEl = post.shadow.querySelector('.hint');

    if (post.revealed) {
      if (post.actor) post.actor.classList.remove('tldr-post-hidden');
      post.section.classList.remove('tldr-post-hidden');
      if (post.media) post.media.classList.remove('tldr-post-hidden');
      if (hintEl) hintEl.textContent = 'Gönderiyi özet kartına daralt ▴';
    } else {
      if (post.actor) post.actor.classList.add('tldr-post-hidden');
      post.section.classList.add('tldr-post-hidden');
      if (post.media) post.media.classList.add('tldr-post-hidden');
      if (hintEl) hintEl.textContent = 'Orijinal gönderiyi açmak için tıkla ▾';
    }
  }

  function teardown(post) {
    if (post.actor) post.actor.classList.remove('tldr-post-hidden');
    post.section.classList.remove('tldr-post-hidden');
    if (post.media) post.media.classList.remove('tldr-post-hidden');
    post.container.remove();
    posts.delete(post.section);
  }

  const MIN_CLAMPED_CHARS = 100;

  function isClamped(el) {
    const more = el.querySelector(
      '[data-testid="expandable-text-button"], .attributed-text-segment-list__btn-truncation, button[class*="see-more"], button[class*="show-more"], button[class*="more"]'
    );
    return (more && more.getClientRects().length > 0) || el.scrollHeight > el.clientHeight + 2;
  }

  function renderViralBanner(host, info) {
    if (!host?.parentElement) return;
    let banner = host.parentElement.querySelector(':scope > .tldr-viral-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'tldr-viral-banner';
      host.before(banner);
    }
    banner.style.setProperty('--theme', info.themeColor);
    banner.innerHTML = `
      <span class="tldr-badge">${info.badge}</span>
      ${info.metaText ? `<span class="tldr-meta">${info.metaText}</span>` : ''}
    `;
  }

  async function process(host) {
    const text = postText(host);
    const pureText = extractPureText(text);

    const metrics = getPostMetrics(host);
    const info = classifyPost(metrics);
    const isHighInteraction = info.level !== 'NORMAL';

    const isLong = pureText.length >= minChars || (isClamped(host) && pureText.length >= MIN_CLAMPED_CHARS);

    // 1. Kısa ama Viral / Başarılı gönderiler:
    // Metin perdelenmez/gizlenmez, LLM'e özetletilmez ve ASLA "TL;DR" etiketi konmaz.
    // Orijinal metnin hemen üstüne şık bir Viral/Başarılı bilgi kutucuğu iliştirilir.
    if (!isLong) {
      if (isHighInteraction && pureText.length >= 40) {
        renderViralBanner(host, info);
      }
      return;
    }

    // 2. Uzun veya "daha fazla gör" ile kısaltılmış gönderiler:
    const card = host.closest(
      '.feed-shared-update-v2, [data-view-name*="feed"], [data-urn], [data-id], [data-activity-urn], .main-feed-activity-card, .main-feed-activity-card-with-comments, .occludable-update, article, .feed-shared-update'
    ) || host.parentElement?.parentElement;

    const section = textSection(host);
    const media = findPostMedia(card, section);

    const isDark = document.documentElement.classList.contains('theme--dark') ||
      document.body?.classList.contains('theme--dark') ||
      window.matchMedia('(prefers-color-scheme: dark)').matches;

    const bgCard = isDark ? '#1b1f23' : '#ffffff';
    const textColor = isDark ? '#e1e4e8' : '#1d2226';
    const metaColor = isDark ? '#8b949e' : '#5e6b75';
    const hintColor = isDark ? '#8b949e' : '#777777';

    const author = getPostAuthorInfo(card, section);
    const actorEl = author?.actor;

    const avatarHtml = author?.avatarUrl
      ? `<img class="avatar-img" src="${escapeHtml(author.avatarUrl)}" alt="${escapeHtml(author.name || '')}" />`
      : `<div class="avatar-placeholder">👤</div>`;

    const authorName = author?.name || 'LinkedIn Kullanıcısı';
    const headlineHtml = author?.headline
      ? `<span class="author-headline" title="${escapeHtml(author.headline)}">• ${escapeHtml(author.headline)}</span>`
      : '';
    const timeHtml = author?.timeAgo
      ? `<span class="author-time">• ${escapeHtml(author.timeAgo)}</span>`
      : '';

    const container = document.createElement('div');
    container.className = 'tldr-compact-host';
    const shadow = container.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${STAMP_CSS}</style>
      <div class="compact-card loading" style="--theme: ${info.themeColor}; --bg-card: ${bgCard}; --text-color: ${textColor}; --meta-color: ${metaColor}; --hint-color: ${hintColor};" title="Orijinal gönderiyi göster / gizle">
        <div class="avatar-col">${avatarHtml}</div>
        <div class="card-content">
          <div class="author-header">
            <div class="author-info">
              <span class="author-name">${escapeHtml(authorName)}</span>
              ${headlineHtml}
              ${timeHtml}
            </div>
            <div class="badge-bar">
              <span class="badge">${info.badge}</span>
              ${info.metaText ? `<span class="meta-tag">${info.metaText}</span>` : ''}
            </div>
          </div>
          <div class="summary-text"></div>
          <div class="hint">Orijinal gönderiyi açmak için tıkla ▾</div>
        </div>
      </div>
    `;

    const compactCard = shadow.querySelector('.compact-card');

    if (actorEl) {
      actorEl.before(container);
      actorEl.classList.add('tldr-post-hidden');
    } else {
      section.before(container);
    }

    // Orijinal metni ve medyayı gizle (yerine kompakt özet kartı geçer)
    section.classList.add('tldr-post-hidden');
    if (media) media.classList.add('tldr-post-hidden');

    const post = { section, media, actor: actorEl, container, compactCard, shadow, revealed: false };
    posts.set(section, post);

    compactCard.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (!compactCard.classList.contains('loading')) {
        togglePost(post);
      }
    };

    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'summarize', text });
    } catch (err) {
      res = { ok: false, error: String(err) };
    }

    compactCard.classList.remove('loading');
    if (res?.ok) {
      const summaryEl = shadow.querySelector('.summary-text');
      if (summaryEl) summaryEl.textContent = res.summary;

      // Gönderi ekrana yaklaştığında metrikleri tekrar tara ve rozeti güncelle
      const freshMetrics = getPostMetrics(host);
      const freshInfo = classifyPost(freshMetrics);
      compactCard.style.setProperty('--theme', freshInfo.themeColor);
      const badgeEl = shadow.querySelector('.badge');
      if (badgeEl) badgeEl.textContent = freshInfo.badge;

      const badgeBar = shadow.querySelector('.badge-bar');
      let metaEl = shadow.querySelector('.meta-tag');
      if (freshInfo.metaText) {
        if (!metaEl && badgeBar) {
          metaEl = document.createElement('span');
          metaEl.className = 'meta-tag';
          badgeBar.appendChild(metaEl);
        }
        if (metaEl) metaEl.textContent = freshInfo.metaText;
      } else if (metaEl) {
        metaEl.remove();
      }

      console.log('[LinkedIn TL;DR]', {
        pureLen: pureText.length,
        metrics: freshMetrics,
        level: freshInfo.level,
        badge: freshInfo.badge,
        hasThumb: !!thumbUrl,
      });
      return;
    }

    if (res?.code === 'NO_KEY' && !noKeyShown) {
      noKeyShown = true;
      togglePost(post);
      compactCard.classList.add('error');
      const summaryEl = shadow.querySelector('.summary-text');
      if (summaryEl) summaryEl.textContent = 'Configure LLM provider in settings';
      compactCard.onclick = (e) => {
        e.stopPropagation();
        chrome.runtime.sendMessage({ type: 'openOptions' });
      };
      return;
    }

    if (res?.code !== 'NO_KEY') console.warn('[LinkedIn TL;DR]', res?.error);
    teardown(post);
  }

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
