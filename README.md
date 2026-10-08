# UTAG

A growing database of verified music metadata — artists, releases, editions, artwork — checked against independent sources before it is stored. This site is the public ledger for that database: browse the catalog, see the confidence state of every record, and follow what is waiting on review.

Live at: https://arthursfather998.github.io/utag/

Static site, no build step. Data is read from the UTAG database (Supabase PostgREST) with a public read-only key; writes are locked to the service role by row-level security.
