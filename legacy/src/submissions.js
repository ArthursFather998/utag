(function(){
  // submissions.js — enhanced submission UI: artist / release / track
  // - Uses the repository-exposed library export (data/views/catalog.json) to
  //   provide relation-aware suggestions (artist -> releases).
  // - Posts a structured payload into public.submissions so Hermes / backend can
  //   process it. Keeps anonymous submissions possible while encouraging users
  //   to pick existing records when appropriate.
  
  const cfg = window.UTAG_CONFIG || {};
  const SUPA = {
    url: (cfg.SUPABASE_URL || '').replace(/\/+$/, ''),
    key: cfg.ANON_KEY || ''
  };

  // Simple DOM helpers
  function el(tag, attrs = {}, children = []){
    const e = document.createElement(tag);
    for (const k in attrs){
      if (k === 'class') e.className = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    for (const c of children) if (c) e.appendChild(c);
    return e;
  }

  function byId(id){ return document.getElementById(id); }

  // Catalog caching
  let CATALOG = null;
  async function loadCatalog(){
    if (CATALOG) return CATALOG;
    try {
      const res = await fetch('data/views/catalog.json');
      if (!res.ok) throw new Error('Catalog read failed');
      CATALOG = await res.json();
      return CATALOG;
    } catch (e){
      CATALOG = { artists: [], releases: [] };
      return CATALOG;
    }
  }

  function findArtistByName(name){
    if (!name) return null;
    const n = name.trim().toLowerCase();
    const a = (CATALOG && CATALOG.artists) || [];
    const found = a.find(x => (x.canonical_name || '').trim().toLowerCase() === n);
    return found ? found.id : null;
  }

  function findReleaseByTitleAndArtist(title, artistId){
    if (!title) return null;
    const t = title.trim().toLowerCase();
    const r = (CATALOG && CATALOG.releases) || [];
    return (r.find(x => (x.title || '').trim().toLowerCase() === t && (!artistId || x.artist_id === artistId)) || null);
  }

  function formatOptionLabelArtist(a){ return `${a.canonical_name}${a.release_count ? ' · ' + a.release_count + ' releases' : ''}`; }
  function formatOptionLabelRelease(r){ return `${r.title}${r.release_year ? ' · ' + r.release_year : ''}`; }

  // Build the enhanced form
  function buildForm(){
    const wrap = el('div', { class: 'card' });
    wrap.appendChild(el('h2', { text: 'Submit artist / release / track' }));
    wrap.appendChild(el('p', { class: 'sub', text: 'Pick an existing artist/release when possible — or provide new values. Submissions go into the review inbox.' }));

    const form = el('form', { id: 'sub-form' });

    // Type
    const typeRow = el('div', { class: 'row' });
    typeRow.appendChild(el('label', { html: 'Type: ' }));
    const typeSelect = el('select', { id: 'sub-type' });
    ['artist','release','track'].forEach(t => typeSelect.appendChild(el('option', { value: t, text: t.charAt(0).toUpperCase() + t.slice(1) })));
    typeRow.appendChild(typeSelect);
    form.appendChild(typeRow);

    // Artist chooser / new artist
    const artistBlock = el('div', { id: 'artist-block' });
    const artistChooseLabel = el('label', { html: 'Artist (pick existing or type a new name)' });
    const artistInput = el('input', { type: 'text', id: 'sub-artist', placeholder: 'Artist name' });
    artistChooseLabel.appendChild(artistInput);
    artistBlock.appendChild(artistChooseLabel);

    const artistBioLabel = el('label', { html: 'Bio / notes (optional)' });
    const artistBio = el('textarea', { id: 'sub-artist-bio', rows: 3 });
    artistBioLabel.appendChild(artistBio);
    artistBlock.appendChild(artistBioLabel);

    form.appendChild(artistBlock);

    // Release block
    const releaseBlock = el('div', { id: 'release-block' });
    const releaseChooseLabel = el('label', { html: 'Release (pick existing or enter a new title)' });
    const releaseInput = el('input', { type: 'text', id: 'sub-release', placeholder: 'Release title' });
    releaseChooseLabel.appendChild(releaseInput);
    releaseBlock.appendChild(releaseChooseLabel);

    const releaseDateLabel = el('label', { html: 'Release date (YYYY-MM-DD, optional)' });
    const releaseDate = el('input', { type: 'date', id: 'sub-release-date' });
    releaseDateLabel.appendChild(releaseDate);
    releaseBlock.appendChild(releaseDateLabel);

    const releaseTypeLabel = el('label', { html: 'Release type' });
    const releaseType = el('select', { id: 'sub-release-type' });
    ['album','ep','single','compilation','soundtrack','other'].forEach(v => releaseType.appendChild(el('option', { value: v, text: v })));
    releaseTypeLabel.appendChild(releaseType);
    releaseBlock.appendChild(releaseTypeLabel);

    form.appendChild(releaseBlock);

    // Track block
    const trackBlock = el('div', { id: 'track-block' });
    const trackTitleLabel = el('label', { html: 'Track title' });
    const trackTitle = el('input', { type: 'text', id: 'sub-track', placeholder: 'Song title' });
    trackTitleLabel.appendChild(trackTitle);
    trackBlock.appendChild(trackTitleLabel);

    const trackNumberLabel = el('label', { html: 'Track number (optional)' });
    const trackNumber = el('input', { type: 'number', id: 'sub-track-number', min: '1' });
    trackNumberLabel.appendChild(trackNumber);
    trackBlock.appendChild(trackNumberLabel);

    const trackDurationLabel = el('label', { html: 'Duration (seconds, optional)' });
    const trackDuration = el('input', { type: 'number', id: 'sub-track-duration', min: '0' });
    trackDurationLabel.appendChild(trackDuration);
    trackBlock.appendChild(trackDurationLabel);

    form.appendChild(trackBlock);

    // Helpful hints area with existing matches
    const hint = el('div', { id: 'sub-hint', class: 'note' });
    form.appendChild(hint);

    // Submit
    const submitRow = el('div', { class: 'row' });
    const submitBtn = el('button', { type: 'submit', class: 'primary' });
    submitBtn.textContent = 'Submit';
    submitRow.appendChild(submitBtn);
    const status = el('div', { id: 'sub-status' });
    submitRow.appendChild(status);
    form.appendChild(submitRow);

    // Wire autocomplete behaviour: simple suggestion lists updated from the cached catalog
    async function wireCatalog() {
      await loadCatalog();
      // build datalists
      const dlA = el('datalist', { id: 'dl-artists' });
      (CATALOG.artists || []).forEach(a => dlA.appendChild(el('option', { value: a.canonical_name })));
      const dlR = el('datalist', { id: 'dl-releases' });
      (CATALOG.releases || []).forEach(r => dlR.appendChild(el('option', { value: r.title })));
      document.body.appendChild(dlA);
      document.body.appendChild(dlR);
      artistInput.setAttribute('list', 'dl-artists');
      releaseInput.setAttribute('list', 'dl-releases');

      // show contextual release suggestions when artist is chosen
      artistInput.addEventListener('input', () => {
        const aid = findArtistByName(artistInput.value.trim());
        if (aid) {
          const rels = (CATALOG.releases || []).filter(r => r.artist_id === aid).slice(0, 40);
          hint.innerHTML = rels.length ? `Found ${rels.length} releases for that artist — choose one or enter a new title.` : 'That artist exists but has no releases in the export.';
        } else {
          hint.textContent = 'New or unknown artist — you are creating a new artist record.';
        }
      });

      releaseInput.addEventListener('input', () => {
        const title = releaseInput.value.trim();
        const aid = findArtistByName(artistInput.value.trim());
        const found = findReleaseByTitleAndArtist(title, aid);
        if (found) hint.textContent = `That release exists: ${formatOptionLabelRelease(found)} (it will be linked).`;
      });

      trackTitle.addEventListener('input', () => {
        const t = trackTitle.value.trim();
        if (t.length > 3) hint.textContent = 'Tip: pick an existing artist/release above to link the track instead of creating duplicates.';
      });
    }

    wireCatalog();

    // Show / hide blocks based on type
    function toggleBlocks(){
      const t = typeSelect.value;
      artistBlock.style.display = (t === 'artist' || t === 'release' || t === 'track') ? '' : 'none';
      artistBio.style.display = (t === 'artist') ? '' : 'none';
      releaseBlock.style.display = (t === 'release' || t === 'track') ? '' : 'none';
      trackBlock.style.display = (t === 'track') ? '' : 'none';
    }
    typeSelect.addEventListener('change', toggleBlocks);
    toggleBlocks();

    // Submission
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      status.textContent = 'Submitting…';
      submitBtn.disabled = true;

      const type = typeSelect.value;
      await loadCatalog(); // ensure available

      let payload = { entity: type, data: {}, links: {} };

      try {
        // determine artist linkage
        const artistName = artistInput.value.trim() || null;
        const artistId = artistName ? findArtistByName(artistName) : null;
        if (artistId) payload.links.artist_id = artistId;
        else if (artistName) payload.data.artist_name = artistName;
        if (artistBio.value && type === 'artist') payload.data.bio = artistBio.value.trim();

        if (type === 'release' || type === 'track'){
          const relTitle = releaseInput.value.trim() || null;
          const rel = relTitle ? findReleaseByTitleAndArtist(relTitle, payload.links.artist_id || null) : null;
          if (rel) payload.links.release_id = rel.id;
          else if (relTitle) payload.data.release_title = relTitle;
          if (releaseDate.value) payload.data.release_date = releaseDate.value;
          payload.data.release_type = releaseType.value;
        }

        if (type === 'track'){
          const ttitle = trackTitle.value.trim();
          if (!ttitle) throw new Error('Track title is required');
          payload.data.title = ttitle;
          const tn = Number(trackNumber.value) || null; if (tn) payload.data.track_number = tn;
          const dur = Number(trackDuration.value) || null; if (dur) payload.data.duration_seconds = dur;
        }

        if (type === 'artist'){
          const an = artistName || null;
          if (!an) throw new Error('Artist name is required');
          payload.data.name = an;
        }

        if (type === 'release'){
          const rt = releaseInput.value.trim(); if (!rt) throw new Error('Release title is required');
          payload.data.title = rt;
        }

        // final payload shape: include a small 'meta' header so the backend knows this came from the public UI
        const envelope = {
          submitted_via: 'site_manual_form',
          submitted_at: new Date().toISOString(),
          payload
        };

        const res = await fetch(`${SUPA.url}/rest/v1/submissions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'apikey': SUPA.key,
            'Authorization': 'Bearer ' + SUPA.key,
            'Prefer': 'return=representation'
          },
          body: JSON.stringify({ kind: 'manual_submission', payload: envelope })
        });

        if (!res.ok){
          const txt = await res.text().catch(() => res.statusText);
          throw new Error(`Database rejected the submission (${res.status}): ${txt}`);
        }
        const data = await res.json().catch(() => null);
        const id = data && data[0] && data[0].id ? data[0].id : null;
        status.textContent = id ? `Submitted — inbox id: ${id}` : 'Submitted successfully';

        // clear some fields for convenience
        if (type === 'artist') { artistInput.value = ''; artistBio.value = ''; }
        if (type === 'release') { releaseInput.value = ''; releaseDate.value = ''; }
        if (type === 'track') { trackTitle.value = ''; trackNumber.value = ''; trackDuration.value = ''; }

      } catch (e){
        status.textContent = 'Submission failed: ' + (e && e.message);
      } finally {
        submitBtn.disabled = false;
      }
    });

    wrap.appendChild(form);
    return wrap;
  }

  function showSubmitView(){
    const view = document.getElementById('view');
    if (!view) return;
    view.innerHTML = '';
    view.appendChild(buildForm());
    view.focus();
  }

  // Route hook: when #/submit is active show the enhanced form
  function maybeRoute(){
    const h = location.hash.replace(/^#\/?/, '');
    if (h === 'submit') showSubmitView();
  }
  window.addEventListener('hashchange', maybeRoute);
  maybeRoute();

  // Expose for manual invocation
  window.UTAG_Submissions = { show: showSubmitView };
})();
