(function(){
  // submissions.js — lightweight submission UI that posts to the existing
  // public.submissions table in Supabase. This avoids changing core tables and
  // uses the project's existing "submissions inbox" workflow.
  // It reads SUPABASE_URL and ANON_KEY from config.js (window.UTAG_CONFIG).

  const cfg = window.UTAG_CONFIG || {};
  const SUPA = {
    url: cfg.SUPABASE_URL || '',
    key: cfg.ANON_KEY || ''
  };

  function el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    for (const k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    for (const c of children) e.appendChild(c);
    return e;
  }

  function esc(s){ return String(s == null ? '' : s); }

  function buildForm() {
    const wrap = el('div', { class: 'card' });
    wrap.appendChild(el('h2', { html: 'Submit artist / release / song' }));
    wrap.appendChild(el('p', { class: 'sub', html: 'Public submissions go into the review inbox. A curator or automated worker will process and integrate accepted submissions.' }));

    const form = el('form');

    const typeRow = el('div', { class: 'row' });
    typeRow.appendChild(el('label', { html: 'Type: ' }));
    const typeSelect = el('select');
    ['artist','release','track'].forEach(t => typeSelect.appendChild(el('option', { value: t, html: t.charAt(0).toUpperCase() + t.slice(1) })));
    typeRow.appendChild(typeSelect);
    form.appendChild(typeRow);

    // Artist fields
    const artistNameLabel = el('label', { html: 'Artist name' });
    const artistName = el('input', { type: 'text', id: 'sub-artist-name' });
    artistNameLabel.appendChild(artistName);
    form.appendChild(artistNameLabel);

    const artistBioLabel = el('label', { html: 'Bio / notes (optional)' });
    const artistBio = el('textarea', { id: 'sub-artist-bio' });
    artistBioLabel.appendChild(artistBio);
    form.appendChild(artistBioLabel);

    // Release fields
    const releaseTitleLabel = el('label', { html: 'Release title' });
    const releaseTitle = el('input', { type: 'text', id: 'sub-release-title' });
    releaseTitleLabel.appendChild(releaseTitle);
    form.appendChild(releaseTitleLabel);

    const releaseDateLabel = el('label', { html: 'Release date (YYYY-MM-DD)' });
    const releaseDate = el('input', { type: 'date', id: 'sub-release-date' });
    releaseDateLabel.appendChild(releaseDate);
    form.appendChild(releaseDateLabel);

    // Track fields
    const trackTitleLabel = el('label', { html: 'Track title' });
    const trackTitle = el('input', { type: 'text', id: 'sub-track-title' });
    trackTitleLabel.appendChild(trackTitle);
    form.appendChild(trackTitleLabel);

    const trackDurationLabel = el('label', { html: 'Duration (seconds, optional)' });
    const trackDuration = el('input', { type: 'number', id: 'sub-track-duration', min: '0' });
    trackDurationLabel.appendChild(trackDuration);
    form.appendChild(trackDurationLabel);

    const trackNumberLabel = el('label', { html: 'Track number (optional)' });
    const trackNumber = el('input', { type: 'number', id: 'sub-track-number', min: '1' });
    trackNumberLabel.appendChild(trackNumber);
    form.appendChild(trackNumberLabel);

    const submitBtn = el('button', { type: 'submit', class: 'primary' }, []);
    submitBtn.textContent = 'Submit';
    form.appendChild(submitBtn);

    const status = el('div', { id: 'sub-status' });
    form.appendChild(status);

    form.onsubmit = async (ev) => {
      ev.preventDefault();
      status.textContent = 'Submitting…';

      const type = typeSelect.value;
      const payload = { }; 
      if (type === 'artist') {
        const name = artistName.value.trim();
        if (!name) { status.textContent = 'Artist name is required'; return; }
        payload.entity = 'artist';
        payload.name = name;
        payload.bio = artistBio.value.trim() || null;
      } else if (type === 'release') {
        const title = releaseTitle.value.trim();
        const artist = artistName.value.trim() || null;
        if (!title) { status.textContent = 'Release title is required'; return; }
        payload.entity = 'release';
        payload.title = title;
        payload.artist = artist;
        payload.release_date = releaseDate.value || null;
      } else if (type === 'track') {
        const title = trackTitle.value.trim();
        if (!title) { status.textContent = 'Track title is required'; return; }
        payload.entity = 'track';
        payload.title = title;
        const artist = artistName.value.trim() || null;
        payload.artist = artist;
        const release = releaseTitle.value.trim() || null;
        payload.release = release;
        const dur = Number(trackDuration.value) || null;
        payload.duration_seconds = dur;
        const tn = Number(trackNumber.value) || null;
        payload.track_number = tn;
      }

      try {
        const res = await fetch(`${SUPA.url.replace(/\/+$/, '')}/rest/v1/submissions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'apikey': SUPA.key,
            'Authorization': 'Bearer ' + SUPA.key,
            'Prefer': 'return=representation'
          },
          body: JSON.stringify({ kind: 'manual_submission', payload })
        });
        if (!res.ok) {
          const text = await res.text();
          status.textContent = 'Submission failed: ' + res.status + ' ' + text;
          return;
        }
        const data = await res.json();
        status.textContent = 'Submitted — inbox id: ' + (data && data[0] && data[0].id ? data[0].id : '(ok)');
        // clear fields
        artistName.value = '';
        artistBio.value = '';
        releaseTitle.value = '';
        releaseDate.value = '';
        trackTitle.value = '';
        trackDuration.value = '';
        trackNumber.value = '';
      } catch (e) {
        status.textContent = 'Submission error: ' + (e && e.message);
      }
    };

    // Show/hide fields based on type
    const toggleFields = () => {
      const t = typeSelect.value;
      artistNameLabel.style.display = t === 'artist' || t === 'release' || t === 'track' ? '' : 'none';
      artistBioLabel.style.display = t === 'artist' ? '' : 'none';
      releaseTitleLabel.style.display = t === 'release' || t === 'track' ? '' : 'none';
      releaseDateLabel.style.display = t === 'release' ? '' : 'none';
      trackTitleLabel.style.display = t === 'track' ? '' : 'none';
      trackDurationLabel.style.display = t === 'track' ? '' : 'none';
      trackNumberLabel.style.display = t === 'track' ? '' : 'none';
    };
    typeSelect.onchange = toggleFields;
    toggleFields();

    wrap.appendChild(form);
    return wrap;
  }

  function showSubmitView() {
    const view = document.getElementById('view');
    if (!view) return;
    view.innerHTML = '';
    view.appendChild(buildForm());
    view.focus();
  }

  // Wire simple hash-based routing: when #/submit is active, show the form.
  function maybeRoute() {
    const h = location.hash.replace(/^#\/?/, '');
    if (h === 'submit') showSubmitView();
  }

  window.addEventListener('hashchange', maybeRoute);
  // Also run once on load
  maybeRoute();

  // Expose for console/testing
  window.UTAG_Submissions = { show: showSubmitView };
})();
