# UTAG

UTAG is a verified song metadata database that grows over time. Hermes, an autonomous researcher, searches the open internet for each song, cross-references independent sources (official artist and label pages, Bandcamp, Wikipedia, Discogs, Genius, press), and writes only what he can verify. Everything else is a consumer of that database: this website, and Splotify on the phone.

Live site: https://arthursfather998.github.io/utag/

## The site

The website at the repo root is the human window into the database:

- **Home**: recent verified additions.
- **Catalog / Artists**: wiki-style pages for every release and artist Hermes has verified, with sources and verification as references.
- **Review**: anything marked `needs_review` or `conflicting`, with approve/correct controls behind the site password.
- **Hermes**: talk to Hermes directly, ask what is in the database, hand him a song to verify, or upload an audio file for the queue with the **+** button.

Data reads go straight to Supabase with the public read key (row-level security keeps writes off). Writes go through the `utag-control` Edge Function, gated by the site password.

## Layout

- `index.html`, `app.js`, `styles.css`, `config.js`: the site itself (no build step; GitHub Pages serves the repo root).
- `backend/`: the Supabase backend: schema migrations, the `utag-control` Edge Function, the knowledge import script.
- `legacy/`: the original UTAG Fixer matching engine (Apple/Deezer/MusicBrainz/fanart searchers). Kept for reference; Splotify no longer ships it and calls this database instead.

## Confidence states

`verified`, `high_confidence`, `needs_review`, `conflicting`, `unknown`. Hermes never guesses: a song he cannot verify stays in the review queue until a human ruling or better evidence lands. Human corrections outrank AI decisions permanently.

## Consumers

- **Splotify** looks up this database first, caches on-device for offline use, and submits unknown songs back so Hermes can verify them.
- Submissions and uploaded audio land in queue tables (`submissions`, `uploads`); Hermes works them with the service key.
