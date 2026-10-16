# Unreleased-flag fix — research notes (2026-10-15)

Skyler reported most songs showing "Unreleased" when they aren't. Diagnosis: the
app.js `releaseStatus()` auto-flags any release with no `release_date` AND no
`release_year`. Live data (2026-10-16 03:12Z export): 297 releases, 66 auto-flagged
+ 2 manual overrides. Research per release below; high-confidence dates are written
to the DB via PostgREST (service key), read back, logged in `verifications`, then
the repo is re-exported and pushed.

Manual overrides left untouched:
- `8b19ac11-eb09-4aff-aa3b-349e9b6ca0c4` "Past Love (w SSGKobe)" — d4vd single, manual unreleased
- `d4046365-0b32-47b8-a254-0c27409a2e81` "home" — d4vd single, manual unreleased

## Batch 1 — d4vd singles (all genuinely unreleased; flag was CORRECT)

Research found every named item is a genuine d4vd unreleased leak, not an official
release. `release_status` set to manual `unreleased` on all six (verified via
read-back); verifications rows logged (`created_by: utag-adjudicator`).

| release | verdict | action |
|---|---|---|
| Celeste (9afc6f2d) | genuinely unreleased — demo "Celeste_Demo unfin" leaked Dec 2023 (hotnewhiphop, primetimer) | status → manual unreleased |
| Cold In The Summer (b21b1a4d) | genuinely unreleased leak; absent from full official discography | status → manual unreleased |
| Dancing Through The End Of The World (0afa0de7) | genuinely unreleased; 3 sources label it unreleased | status → manual unreleased |
| Forever (65b084b4) | unreleased stream snippet; no official single exists | status → manual unreleased |
| Im In Love (6eab752c) | unreleased; uploads tagged (Unreleased) | status → manual unreleased |
| listen before i go (Cover) (2f31b4b2) | d4vd cover of Billie Eilish; unreleased archive uploads only | status → manual unreleased |
| Unknown Album (4fc02009) | placeholder row, nothing to research | left alone |

Note: all six carry `release_type = single`, which misrepresents leaks as official
singles. `releases_release_type_check` only allows album/single/soundtrack, so no
better type exists today — flagged for Skyler, not changed.

## Batch 4 — compilations / promos / live comps (14 dated, 3 left alone)

All written with read-back verification; verifications rows logged.

| release | verdict | action |
|---|---|---|
| 2010s RAP HITS : 2014-2020 Era (9d02ec47) | released 2023-05-26 (UMe Digital Various comp; MusicBrainz + AllMusic) | year+date set |
| Hit Mania Spring 2015 (77ea53be) | released 2015 (rodny.cz/Discogs 2xCD; exact day single-source) | year only |
| Hot Party Winter 2017 (bbd2b722) | released 2016-11-11 (Discogs itemdata + webdisk; Fishpond says 17 Nov) | year+date set |
| Indie/Rock Playlist: June 2007 (3b50a0d1) | released 2007-06-01 (MusicBrainz label page + Last.fm) | year+date set |
| Promo Only: Modern Rock Radio, February 2017 (d1d49f30) | released 2017-02 (dj-compilations.com; month precision) | year only |
| Promo Only: Modern Rock Radio, November 2017 (014892d7) | released 2017-11 (Spinitron/WFNP + Chordify; month precision) | year only |
| 1995-05-28: Le Spectrum, Montreal (093afdc5) | Jeff Buckley live bootleg 1995-05-28 (title date corroborated) | year+date set |
| Now That's What I Call Music! 123 (e53d3512) | released 2026-04-17 (Discogs + nowmusic.com official + HMV + Wikipedia) | year+date set |
| The Radio Essential Series (b70df264) | released 2000 (Last.fm + Discogs; 1,197-track Various comp) | year only |
| Live at the World Cafe Volume 22 (328165dc) | released 2006 (Discogs + eBay; WXPN Various live comp) | year only |
| Warped Tour '05: Bootleg Series (e340b22d) | released 2005 (3 sources; exact 07-19 single-source, Gaana's 2009 is a re-ingest) | year only |
| Vans Warped Tour: 2012 Tour Compilation (e63c5871) | released 2012 (TheAudioDB + acharts; SideOneDummy Various comp) | year only |
| KlangCafé II (72cf4347) | released 2015-06-23 (AllMusic + rodny.cz + kworb chart run) | year+date set |
| Hazel Eyes (6735ac63) | Sam Smith 5th studio album, released 2026-08-21 (3 sources) | year+date set |
| 2024 MegaMix (37f7b93f) | unknown — no official release by that name; looks like a user playlist | left flagged |
| WYEP New Music Sampler: Swingin' Tunes (53fbf8ab) | unknown — station promo exists but no dated source anywhere | left flagged |
| Club R&B 2 (a6f7ecd8) | needs_review — series is real (unofficial DJ-promo 12"s) but vol 2 undated | left flagged |

Attribution note: 12 of the 14 are Various-artist comps filed under a single featured
artist (Sam Smith x3, XXXTENTACION, Calum Scott, Paramore, Panic!, Steve Lacy,
Dominic Fike, Mariah Carey, Bruno Mars, The Fray, Falling In Reverse). Dates fix the
flag; re-attribution to Various Artists is Skyler's call, not made here.

## Batch 5 — singles / sessions / misc (11 dated, all applied)

All written with read-back verification; verifications rows logged.

| release | verdict | action |
|---|---|---|
| Comfort Me — Malcolm Todd (304b3473) | released 2024-11-01 (AllMusic + Deezer + Tunebat) | year+date set |
| I Just Got Mad — Malcolm Todd (ea098971) | released 2026-07-09 (Tunebat + iHeart + The Musical Hype) | year+date set |
| Malcolm Todd — Malcolm Todd (9b29befd) | released 2025-04-04 (Wikipedia album article + State Hornet) | year+date set |
| The Lo-Fis — Steve Lacy (14ee13f6) | released 2020-12-04 (AllMusic + NME + Discogs) | year+date set |
| Star Shopping (Live) — Lil Peep (2f6607f1) | released 2024-06-14 (Apple Music 3-song single + Gaana + Last.fm) | year+date set |
| JUST IN CASE — Lil Peep (e5f5fc49) | released 2025-03-28 (AllMusic + Deezer + elyrics) | year+date set |
| ICEMAN — Drake (befb217e) | released 2026-05-15 (Billboard triple-release reporting via Geneva Times, Variety India, StupidDope, music-world.es; independently re-verified) | year+date set |
| Apple Music Presents: Tyler, The Creator (6b8d6c5b) | released 2019-08-13 (Discogs ISRC data; fan wiki says 08-14, timezone) | year+date set |
| 2025-01-30: FireAid — Olivia Rodrigo (f14d5335) | concert 2025-01-30 (AP, Fast Company, Noise11); row is a stream capture, date = concert date | year+date set |
| NPR Music Tiny Desk Concert — Sabrina Carpenter (91ff9eda) | video premiered 2024-12-20 (NME + Billboard); row = that session recording | year+date set |
| Heartstopper: Official Mixtape — beabadoobee (9d72c94e) | released 2022-04-22 (Spotify mixtape for Netflix premiere; Last.fm + whats-on-netflix) | year+date set |

Notes: FireAid has no official album under that name (concert capture); Sabrina's Tiny
Desk exists as the NPR video (Discogs entries are bootleg vinyl rips); Heartstopper
mixtape is a Various playlist filed under beabadoobee. Type misfires noted (several
1-track singles filed as "album") — not changed, Skyler's call.

## Batch 6 — obscure releases (5 dated, 3 left alone)

All written with read-back verification; verifications rows logged.

| release | verdict | action |
|---|---|---|
| SHATTER — lucille (eefa944f) | released 2025 (albumoftheyear.org + Anghami; not the Polish metal band) | year only |
| b sides and demos — crayon (f74b6636) | released 2025-05-02 (Qobuz + YouTube topic video agree) | year+date set |
| Hott2death Sega 21 — Michael Jackson (f615fbc8) | released 2004 (AllMusic: "Hott 2 Death: R&B Central Saga, Vol. 21", UK DJ-mixtape comp) | year only |
| RMCM — Richy Mitch & The Coal Miners (4d380295) | released 2017-05-17 (band's Bandcamp + AllMusic + albumblitz; debut album) | year+date set |
| brilliant hits billion bangers — YNW Melly (511cb30f) | released 2024-12-19 (two MusicBrainz pages agree; X5 Music Group Various comp) | year+date set |
| Indie Winter's Day — Nafeesisboujee (e0319b2f) | unknown — Deezer auto-generated Various editorial comp; no honest year; likely mis-ingested | left flagged |
| TM Century: GoldDisc 303 — Looking Glass (d6662819) | year unverifiable (promo-only radio GoldDisc series; no dated source) | left flagged |
| Musik um uns: Sekundarbereich II — Lesley Gore (9a35f2a6) | NOT a Lesley Gore release at all — German school music textbook (+ audio companion); no edition pinnable | left flagged |

Attribution problems surfaced (not changed — owner's call): Hott2death is Various
Artists (not Michael Jackson); brilliant hits billion bangers is Various Artists (not
a YNW Melly album); Musik um uns is a textbook (not Lesley Gore); TM Century GoldDisc
is Various Artists (Looking Glass is one track of 26); the "crayon" and "lucille"
artist rows should be checked against the correct artists; Indie Winter's Day needs
its track attachments audited.

## Batch 2 — major albums (11 dated, 1 left for owner review)

All written with read-back verification; verifications rows logged.

| release | verdict | action |
|---|---|---|
| Blond — Frank Ocean (4d0e81d2) | released 2016-08-20 (Wikipedia + okayplayer + jazz-jazz) | year+date set |
| Chanel — Frank Ocean (c551def0) | released 2017-03-10 (Wikipedia song article + Discogs + Variance) | year+date set |
| Four — One Direction (26963212) | released 2014-11-17 (Wikipedia + Spin) | year+date set |
| 4 Your Eyez Only — J. Cole (b9fd8c31) | released 2016-12-09 (Wikipedia + vinyljunkies + music-tracker) | year+date set |
| ? — XXXTENTACION (dccfa943) | released 2018-03-16 (Wikipedia + XXL + nationaltoday) | year+date set |
| 17 — XXXTENTACION (afe25542) | released 2017-08-25 (Wikipedia + Hypebeast + music-tracker) | year+date set |
| LOOK AT ME: THE ALBUM — XXXTENTACION (3e7c6ba6) | released 2022-06-10 (Wikipedia + Discogs + music-tracker; posthumous comp) | year+date set |
| SMITHEREENS — Joji (ae48c2d3) | released 2022-11-04 (Wikipedia + Discogs + fandom; not the single date) | year+date set |
| Kid Krow — Conan Gray (78c846e2) | released 2020-03-20 (Wikipedia + Discogs) | year+date set |
| The Rise and Fall of a Midwest Princess — Chappell Roan (2c54318d) | released 2023-09-22 (Wikipedia + Discogs; original, not 2024 reissues) | year+date set |
| Happier Than Ever: Acapellas — Billie Eilish (94918d70) | UNOFFICIAL bootleg acapella comp circulating since 2021 (MusicBrainz status Bootleg + Last.fm) | year 2021 only |
| Hopeless Romantic — Conan Gray (ee03aa33) | CANNOT VERIFY — no such Conan Gray release exists anywhere; only trace is a fan-made concept LP short | left flagged for owner |

Type note: "Chanel" is a standalone single filed as `album` — date fixed, type left for
owner (consistent with the rest of this run: dates/status only, structural changes are
the owner's call).

## Batch 3 — major albums B (11 dated, all applied)

All written with read-back verification; verifications rows logged.

| release | verdict | action |
|---|---|---|
| Survivor — Destiny's Child (26a8570b) | released 2001-04-25 (Wikipedia intl date; US 2001-05-01; Hot97) | year+date set |
| Greatest Hits — Selena (aed11512) | released 2003-06-24 (Wikipedia + AllMusic + Discogs; the 2003 English comp, matches library track) | year+date set |
| Greatest Hits: Believers Never Die Vol. 2 — Fall Out Boy (5dfe8267) | released 2019-11-15 (Wikipedia + Beatport + udiscovermusic) | year+date set |
| Piece of Mind — Eminem (93bf700d) | UNOFFICIAL bootleg comp, 2006 (CritiqueBrainz + famousfix + musify; one weak 2004 claim) | year only |
| Popular Monster — Falling In Reverse (a27640db) | released 2024-08-16 (Wikipedia + Proper Music Group; 5th studio album) | year+date set |
| Japanese Denim — Daniel Caesar (da75018e) | released 2016-10-21 (Discogs + Shazam + Wikipedia discography; standalone single) | year+date set |
| Dead Man Walking — Brent Faiyaz (a9a59e9d) | released 2020-09-18 (Wikipedia song article + Apple Music + Shazam; Wasteland lead single) | year+date set |
| Mr. Lonely — Bobby Vinton (77d0f033) | released December 1964 (Wikipedia album + song articles; 10th studio album) | year only |
| Thee Sacred Souls — Thee Sacred Souls (f769983d) | released 2022-08-26 (Wikipedia + Shorefire + Darkside; debut, track match confirmed) | year+date set |
| Life on the Murder Scene — MCR (2970b4c9) | released 2006-03-21 (Wikipedia + Revolver; original 2DVD+CD) | year+date set |
| Best of Creed 2002 — Creed (1a7e2d69) | UNOFFICIAL fan comp; title says 2002, TagTuner agrees (thin sourcing) | year only |

Type notes (not changed — owner's call): "Japanese Denim" and "Dead Man Walking" are
singles filed as albums; "Piece of Mind" is a compilation filed as album.

---

## Run totals

66 releases researched. 58 updated in the DB (51 with full dates, 7 year-only, 6 set to
manual unreleased after verification they are genuine d4vd leaks). 8 left flagged as
unreleased: 1 placeholder ("Unknown Album"), 1 unverifiable ("Hopeless Romantic" —
no such Conan Gray release exists), 2 undatable obscure items (WYEP sampler, 2024
MegaMix), 1 needs_review (Club R&B 2), 3 misattributed/undatable (Indie Winter's Day,
TM Century GoldDisc 303, Musik um uns textbook). Attribution and type problems found
along the way are listed above per batch — none changed, all flagged for Skyler.
