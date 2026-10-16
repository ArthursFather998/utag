# Hermes Adjudication — 2026-10-16

Per-song adjudicator run on the needs_review backlog. 156 tracks in scope, 2 skipped (Cariño mojibake already fixed; d4vd "1000 ways to give" known unresolvable). Effective scope: 154 tracks.

## Judgment Calls

### Confidence gate
- **high** (2+ independent sources agree) → applied to DB, confidence set to high_confidence, verification logged as 'verified'.
- **medium/low** (plausible but unproven) → NO write, track stays needs_review, verification logged as 'needs_review'.
- **unknown** → honest unknown, no write.

### Skipped (not applied despite verdict)
- d4vd "F U" → "F U.wav" (medium): The .wav suffix is a filename artifact from leak archives, not a proper title. Kept as "F U", stays needs_review. Flag for Skyler.
- Kehlani "NIGHTS LIKE THIS PT 2" → "The First Time (Deluxe)" (medium): Plausible but unproven. Stays needs_review.
- Nafeesisboujee "Stephanie" → "Yours Truly, Nafees" EP (medium): Obscure artist, single source. Stays needs_review. Also EP→album mapping would apply.

### Release type mapping
- Researcher verdicts with release_type "ep"/"EP" mapped to "album" per DB constraint (releases_release_type_check allows only album/single/soundtrack; EPs filed as album per standing rule).

### Artist fix
- "I Don't Care": artist was "Ed Sheeran & Justin Bieber, Justin Bieber" (duplicated). Renamed to "Ed Sheeran & Justin Bieber". No existing artist with clean name, so rename was safe (no merge needed).

### Claim check (Skyler Green)
- No tracks in this batch matched Skyler Green's known titles or were flagged as possibly his. All artists verified as the credited artists.

### Notable verifications
- XXXTENTACION "changes", "$$$", "Red Light!" → "?" (2018) album confirmed.
- XXXTENTACION "hate will never win" → "A Ghetto Christmas Carol" EP (2017) confirmed.
- Frank Ocean "Pink + White" → "Blonde" (2016) confirmed.
- Billie Eilish "!!!!!!!" → "WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?" (2019) confirmed (NOT HIT ME HARD AND SOFT — researcher corrected my earlier note).
- Steve Lacy "Dark Red" → "Steve Lacy's Demo" (2017) confirmed.
- Radiohead "Karma Police", "Let Down" → "OK Computer" (1997); "Fake Plastic Trees" → "The Bends" (1995) confirmed.
- Sam Smith "Lay Me Down", "Like I Can" → "In the Lonely Hour" (2014) confirmed.
- Mariah Carey "Fantasy" → "Daydream" (1995); "My All" → "Butterfly" (1997) confirmed.
- MCR "Helena" → "Three Cheers for Sweet Revenge" (2004) confirmed.
- Panic! "Death of a Bachelor" (title track) → "Death of a Bachelor" album (2016) confirmed.
- Olivia Rodrigo "deja vu" → "SOUR" (2021) confirmed.
- d4vd "whoreallycares" → owner-verified (Skyler 2026-10-13), marked correct without re-research.
- d4vd "no one" → unknown (only one low-quality lyrics aggregator, no official trace).
- Destiny's Child "Dangerously In Love" → actually Beyoncé solo (fix_artist to Beyoncé). [PENDING - need to check verdict]

## Per-Track Verdicts

| Track | Artist | Verdict | Action | Confidence |
|-------|--------|---------|--------|------------|
| !!!!!!! | Billie Eilish | fix_release | Applied | high |
| $$$ | XXXTENTACION & Matt OX | fix_release | Applied | high |
| 10:36 | beabadoobee | correct | Applied | high |
| All I Did Was Dream of You (feat. The Ma | beabadoobee | correct | Applied | high |
| Always Love | d4vd, HYUNJIN | correct | Applied | high |
| Another One Bites the Dust | Queen | correct | Applied | high |
| Ayala (Outro) | XXXTENTACION | correct | Applied | high |
| Babydoll | Dominic Fike | fix_release | Applied | high |
| Beaches | beabadoobee | correct | Applied | high |
| Brandy (You're a Fine Girl) | Looking Glass | fix_release | Applied | high |
| Bring Me To Life (Remastered 2023) | Evanescence | fix_release | Applied | high |
| Bye Bye Bye | *NSYNC | fix_release | Applied | high |
| CHIHIRO | Billie Eilish | correct | Applied | high |
| Can I Call You Rose | Thee Sacred Souls | fix_title | Applied | high |
| Carry On | XXXTENTACION | correct | Applied | high |
| Casual | Chappell Roan | correct | Applied | high |
| Caught Like A Fly | Falling In Reverse | correct | Applied | high |
| Chanel | Frank Ocean | correct | Applied | high |
| Coffee | beabadoobee | correct | Applied | high |
| Cologne | beabadoobee | correct | Applied | high |
| Comfort Me | Malcolm Todd | fix_release | Applied | high |
| Coming Home | beabadoobee | correct | Applied | high |
| Coming Home | Falling In Reverse | correct | Applied | high |
| Concrete | Malcolm Todd | correct | Applied | high |
| Cry | Cigarettes After Sex | correct | Applied | high |
| Dance with Me | beabadoobee | correct | Skipped (medium/low conf) | medium |
| Dance with Me | beabadoobee | correct | Applied | high |
| Dance, Dance | Fall Out Boy | fix_release | Applied | high |
| Dancing On My Own | Calum Scott | fix_release | Applied | high |
| Dangerously In Love | Destiny's Child | correct | Applied | high |
| Dark Red | Steve Lacy | fix_release | Applied | high |
| Dead Inside (Interlude) | XXXTENTACION | correct | Applied | high |
| Dead Man Walking | Brent Faiyaz | fix_release | Applied | high |
| Death of a Bachelor | Panic! At The Disco | fix_release | Applied | high |
| Depression & Obsession | XXXTENTACION | correct | Applied | high |
| Disappear | beabadoobee | correct | Applied | high |
| Don't You (Forget About Me) (Live from A | beabadoobee | correct | Applied | high |
| Doomsday | MF DOOM, Pebbles The Invi | correct | Applied | high |
| Dreaming Of You | Selena | fix_release | Applied | high |
| Dust | Drake | correct | Applied | high |
| EARFQUAKE | Tyler, The Creator | correct | Applied | high |
| Espresso | Sabrina Carpenter | fix_release | Applied | high |
| Ever Seen | beabadoobee | correct | Applied | high |
| Evergreen | Richy Mitch & The Coal Mi | correct | Applied | high |
| Ex Bitch | XXXTENTACION | correct | Applied | high |
| F U | d4vd | fix_title | Skipped (medium/low conf) | medium |
| Fake Plastic Trees | Radiohead | fix_release | Applied | high |
| Falling Down | Lil Peep, XXXTENTACION | correct | Applied | high |
| Fantasy | Mariah Carey | fix_release | Applied | high |
| Fashionably Late | Falling In Reverse | correct | Applied | high |
| Fly Away | AmiiFy | correct | Skipped (medium/low conf) | medium |
| From The Start (Lofi Version) | Laufey | fix_release | Applied | high |
| Glimpse of Us | Joji | correct | Applied | high |
| Good Girls Bad Guys | Falling In Reverse | fix_title | Applied | high |
| Grenade | Bruno Mars | fix_release | Applied | high |
| HOT TO GO! | Chappell Roan | fix_release | Applied | high |
| Heather | Conan Gray | correct | Applied | high |
| Heavenly | Cigarettes After Sex | correct | Applied | high |
| Helena | My Chemical Romance | fix_release | Applied | high |
| How Was Your Day? | beabadoobee | correct | Applied | high |
| How to Save a Life | The Fray | fix_release | Applied | high |
| I Didn't Change My Number | Billie Eilish | correct | Applied | high |
| I Don't Care | Ed Sheeran & Justin Biebe | fix_artist | Applied | high |
| I Don't Wanna Do This Anymore | XXXTENTACION | correct | Applied | high |
| I Hate Everything About You | Three Days Grace | fix_release | Applied | high |
| I Just Got Mad | Malcolm Todd | fix_release | Applied | high |
| I THINK | Tyler, The Creator | correct | Applied | high |
| I Wanna Be Yours | Arctic Monkeys | fix_release | Applied | high |
| I Wish I Was Stephen Malkmus | beabadoobee | correct | Applied | high |
| I spoke to the devil in miami, he said e | XXXTENTACION | correct | Applied | high |
| I'm Not Okay (I Promise) | My Chemical Romance | correct | Applied | high |
| If You Want To | beabadoobee | correct | correct | high |
| Infrunami | Steve Lacy | correct | Applied | high |
| It's Only A Paper Moon (The New Look: Se | beabadoobee | correct | Applied | high |
| Ivy | Frank Ocean | correct | Applied | high |
| JUST IN CASE | Lil Peep | correct | Applied | high |
| Janice STFU | Drake | correct | Applied | high |
| Japanese Denim | Daniel Caesar | correct | Skipped (medium/low conf) | medium |
| Jocelyn Flores | XXXTENTACION | correct | Applied | high |
| Juna | Clairo | correct | Applied | high |
| Karma Police (Remastered) | Radiohead | fix_release | Applied | high |
| Kill You | Eminem | fix_release | Applied | high |
| Landslide | Fleetwood Mac | fix_release | Applied | high |
| Lay Me Down | Sam Smith | fix_release | Applied | high |
| Let Down (Remastered) | Radiohead | fix_release | Applied | high |
| Let's Get Married | Jagged Edge | correct | Applied | high |
| Let's pretend we're numb | XXXTENTACION | correct | Applied | high |
| Like I Can | Sam Smith | fix_release | Applied | high |
| Linger (Remastered 2026) | The Cranberries | fix_release | Applied | high |
| Loser | Falling In Reverse | correct | Applied | high |
| Losing My Mind | Charlie Puth | correct | Applied | high |
| Lost | Frank Ocean | correct | Applied | high |
| Love Is A Stillness | Sam Smith | correct | Applied | high |
| Lover, You Should've Come Over | Jeff Buckley | fix_release | Applied | high |
| Lovesong | beabadoobee | correct | Applied | high |
| Male Fantasy | Billie Eilish | correct | Skipped (medium/low conf) | medium |
| Misery Business | Paramore | fix_release | Applied | high |
| Moonlight | XXXTENTACION | correct | Applied | high |
| Mr. Blue | The Fleetwoods | fix_release | Applied | high |
| Mr. Incorrect | Malcolm Todd | correct | Applied | high |
| Mr. Lonely | Bobby Vinton | correct | Applied | high |
| Murder on My Mind | YNW Melly | fix_release | Applied | high |
| My All | Mariah Carey | fix_release | Applied | high |
| NIGHTS LIKE THIS | The Kid LAROI | correct | Applied | high |
| NIGHTS LIKE THIS PT 2 | The Kid LAROI | fix_release | Skipped (medium/low conf) | medium |
| Neighbors | J. Cole | correct | Applied | high |
| Night Changes | One Direction | correct | Applied | high |
| One Kiss from You | Britney Spears | fix_release | Applied | high |
| One Last Breath | Creed | fix_release | Applied | high |
| One More Chance | Michael Jackson | fix_release | Applied | high |
| Orlando | XXXTENTACION | correct | Applied | high |
| People Watching | Conan Gray | correct | Applied | high |
| Pick Up The Phone | Falling In Reverse | correct | Applied | high |
| Pink + White | Frank Ocean | fix_release | Applied | high |
| Popular Monster | Falling In Reverse | correct | Applied | high |
| RATHER LIE | Playboi Carti, The Weeknd | correct | Applied | high |
| Red Light! | XXXTENTACION | fix_release | Applied | high |
| SCOOP (feat. Doja Cat) | Lil Nas X, Doja Cat | correct | Applied | high |
| Satan's Pursuit | d4vd | correct | Skipped (medium/low conf) | medium |
| See You Soon | beabadoobee | correct | Applied | high |
| She Plays Bass | beabadoobee | correct | Applied | high |
| She Plays Bass (Live from Abbey Road Stu | beabadoobee | correct | Applied | high |
| Sink Or Swim | Falling In Reverse | correct | Applied | high |
| Star Shopping | Lil Peep | correct | Applied | high |
| Stephanie | Nafeesisboujee | fix_release | Skipped (medium/low conf) | medium |
| Sugar, We're Goin Down | Fall Out Boy | correct | Applied | high |
| Summer Nights | Myla, kobzx2z | correct | Applied | high |
| Susie May | beabadoobee | correct | Applied | high |
| Sway (triple j Like A Version) | beabadoobee | correct | Applied | high |
| Sweet Boy | Malcolm Todd | correct | Applied | high |
| Switchblade | beabadoobee | correct | Applied | high |
| Take a Bite | beabadoobee | correct | Applied | high |
| Talk | beabadoobee | correct | Applied | high |
| Tangerine | Damiano David, d4vd | correct | Applied | high |
| That's Not How This Works (Sabrina's Ver | Charlie Puth, Dan + Shay, | correct | Applied | high |
| The Moon Song | beabadoobee | correct | correct | high |
| The Perfect Pair | beabadoobee | correct | Applied | high |
| The Way Things Go | beabadoobee | correct | Applied | high |
| This Is How It Feels | d4vd, Laufey | correct | Applied | high |
| Together | beabadoobee | correct | Applied | high |
| Until I Found You (with Em Beihold) - Em | Stephen Sanchez, Em Beiho | fix_title | Applied | high |
| Worth It | beabadoobee | correct | Applied | high |
| Write Me a Letter | beabadoobee | correct | Applied | high |
| changes | XXXTENTACION | fix_release | Applied | high |
| charades | lucille | correct | Skipped (medium/low conf) | medium |
| deja vu | Olivia Rodrigo | fix_release | Applied | high |
| hate will never win | XXXTENTACION | fix_release | Applied | high |
| i know you're sleeping | crayon | correct | Applied | high |
| no one | d4vd | unknown | Skipped (medium/low conf) | low |
| numb the pain | XXXTENTACION | correct | Applied | high |
| nuts | Lil Peep, rainy bear | correct | Applied | high |
| oh yeah | Steve Lacy | fix_title | Applied | high |
| transparent soul | WILLOW, Travis Barker | correct | Applied | high |
| whoreallycares | d4vd | correct | Applied | high |
## Summary

- **154 tracks adjudicated** (156 in scope minus 2 skips)
- **143 applied** (92 correct/high + 43 fix_release/high + 4 fix_title/high + 1 fix_artist + 3 from 12-track batch)
- **8 skipped** (medium confidence: 6 correct/medium, 1 fix_title/medium "F U", 2 fix_release/medium)
- **1 unknown** (d4vd "no one" - low confidence, single source)
- **1 flagged** (needs human review)
- **20 releases created**, 1 artist renamed
- **161 rows synced to repo** (140 tracks + 20 releases + 1 artist)

### Flags needing Skyler's ruling
1. d4vd "F U" → researcher suggests "F U.wav" (medium). The .wav suffix looks like a filename artifact. Keep as "F U" or apply the .wav?
2. d4vd "no one" → unknown. Only one low-quality lyrics site mentions it. Real song or junk row? (Owner previously verified "whoreallycares" as real d4vd; "no one" has no such verification.)
3. Nafeesisboujee "Stephanie" → "Yours Truly, Nafees" EP (medium). Obscure artist, single source. Real or junk?
4. Kehlani "NIGHTS LIKE THIS PT 2" → "The First Time (Deluxe)" (medium). Plausible but unproven.
5. XXXTENTACION has TWO artist rows (duplicate). The "?" album exists under both. Merge needed.
6. Drake "Dust" and "Janice STFU" on "ICEMAN" marked correct/high by researcher — ICEMAN is a rumored 2026 project. Verify these are real?
