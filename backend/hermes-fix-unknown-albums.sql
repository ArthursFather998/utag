-- Hermes fix: Unknown Album releases -> correct albums
-- Generated 2026-10-13. Run in Supabase SQL editor.

UPDATE public.releases SET title = 'Operation: Doomsday', release_year = 1999, release_type = 'album', confidence = 'high_confidence', status = 'high_confidence', updated_at = now() WHERE id = '104e9d4c-04b6-4bcd-bc1d-1e10501dba94';
UPDATE public.releases SET title = 'Live Forever', release_year = 2015, release_type = 'album', confidence = 'high_confidence', status = 'high_confidence', updated_at = now() WHERE id = '1b8f81b5-ef6a-410a-9dd3-5deaa191e3f1';
UPDATE public.releases SET title = 'let''s pretend we''re numb', release_year = 2015, release_type = 'single', confidence = 'high_confidence', status = 'high_confidence', updated_at = now() WHERE id = '1fe514a1-47dd-4418-b340-28fb8974426e';
UPDATE public.releases SET title = 'J.E. Heartbreak', release_year = 1999, release_type = 'album', confidence = 'high_confidence', status = 'high_confidence', updated_at = now() WHERE id = '31b70502-5a98-4d8f-9159-8ee9b0954cd2';
UPDATE public.releases SET title = 'FUNNY little FEARS', release_year = 2025, release_type = 'album', confidence = 'high_confidence', status = 'high_confidence', updated_at = now() WHERE id = '3deda100-f9e1-41f7-85c3-68b72741f356';
UPDATE public.releases SET title = 'Always Love', release_year = 2025, release_type = 'single', confidence = 'high_confidence', status = 'high_confidence', updated_at = now() WHERE id = '56412f0a-c8b1-4066-868e-32f14e14cbda';
UPDATE public.releases SET title = 'The Game (Deluxe Remastered Version)', release_year = 2011, release_type = 'album', confidence = 'high_confidence', status = 'high_confidence', updated_at = now() WHERE id = '648a2394-ddb1-44b1-b6d3-2a263f5ee340';
UPDATE public.releases SET title = 'Come Over When You''re Sober, Pt. 2', release_year = 2018, release_type = 'album', confidence = 'high_confidence', status = 'high_confidence', updated_at = now() WHERE id = '7fd0fbb4-7e30-4f90-8283-8b2d2dd1fe45';
UPDATE public.releases SET title = 'From Under the Cork Tree', release_year = 2005, release_type = 'album', confidence = 'high_confidence', status = 'high_confidence', updated_at = now() WHERE id = '86d1e28f-e3b2-4dcc-bfab-6996cbaff5f2';
UPDATE public.releases SET title = 'MUSIC', release_year = 2025, release_type = 'album', confidence = 'high_confidence', status = 'high_confidence', updated_at = now() WHERE id = '87b9ad53-fa96-4369-8b08-ef73595f4ba0';
UPDATE public.releases SET title = 'Superclean Vol. II', release_year = 2018, release_type = 'album', confidence = 'high_confidence', status = 'high_confidence', updated_at = now() WHERE id = '91eba2c6-2d2a-4c22-a757-a4f4774f4aa8';
UPDATE public.releases SET title = 'Petals to Thorns', release_year = 2023, release_type = 'album', confidence = 'high_confidence', status = 'high_confidence', updated_at = now() WHERE id = '9b301704-2c48-432f-95d4-f1b5d387f02e';
UPDATE public.releases SET title = 'No.6 Collaborations Project', release_year = 2019, release_type = 'album', confidence = 'high_confidence', status = 'high_confidence', updated_at = now() WHERE id = '9de33b19-df90-411d-8936-55bddb56e171';
UPDATE public.releases SET title = 'Sick of Nostalgia', release_year = 2026, release_type = 'album', confidence = 'high_confidence', status = 'high_confidence', updated_at = now() WHERE id = 'bf5bac0e-3c5e-4901-bfbe-7a3be0260795';
UPDATE public.releases SET title = 'Angel Face (Club Deluxe)', release_year = 2024, release_type = 'album', confidence = 'high_confidence', status = 'high_confidence', updated_at = now() WHERE id = 'cfa53c63-518a-477d-8d8e-801bd70b5dcc';
UPDATE public.releases SET title = 'lately I feel EVERYTHING', release_year = 2021, release_type = 'album', confidence = 'high_confidence', status = 'high_confidence', updated_at = now() WHERE id = 'df8be520-7504-405d-bd49-335742accca5';
UPDATE public.releases SET title = 'HIT ME HARD AND SOFT', release_year = 2024, release_type = 'album', confidence = 'high_confidence', status = 'high_confidence', updated_at = now() WHERE id = '41aaaccb-bda0-48c5-baf4-b70f61e8495a';

-- Track title corrections
UPDATE public.tracks SET title = 'Let''s pretend we''re numb', updated_at = now() WHERE id = '9dc43c18-f7a5-4144-86c4-ed2f71c889a0';
UPDATE public.tracks SET title = 'Let''s Get Married', updated_at = now() WHERE id = 'dc008838-a205-4040-bfc2-60782c9c80e5';
UPDATE public.tracks SET title = 'Tangerine', updated_at = now() WHERE id = 'eece786e-9791-4e0b-aafa-8fe668c4db21';
UPDATE public.tracks SET title = 'Always Love', updated_at = now() WHERE id = 'f7a9b22e-2806-4b3c-afac-be5188055d80';
UPDATE public.tracks SET title = 'Another One Bites the Dust', updated_at = now() WHERE id = 'fb6844f8-b5f7-43d7-ae9e-36f0bab26cbf';
UPDATE public.tracks SET title = 'Falling Down', updated_at = now() WHERE id = '93a95a1a-84ac-4f3d-934d-8fa21a61cec3';
UPDATE public.tracks SET title = 'Sugar, We''re Goin Down', updated_at = now() WHERE id = '0f35f298-6914-4054-9fef-a5c1f185f139';
UPDATE public.tracks SET title = 'RATHER LIE', updated_at = now() WHERE id = 'a83d5bf1-e3e0-4f29-bc29-a89377ee3142';
UPDATE public.tracks SET title = 'I Don''t Care', updated_at = now() WHERE id = '38d0f615-0433-4afe-a00a-9e564707cc74';
UPDATE public.tracks SET title = 'transparent soul', updated_at = now() WHERE id = 'e2ad4848-305b-41a7-8b64-2effe5cfba0d';
UPDATE public.tracks SET title = 'no one', updated_at = now() WHERE id = '94c51047-cd60-43ff-ad73-3b5f7d20a1e1';
UPDATE public.tracks SET title = 'L''AMOUR DE MA VIE', updated_at = now() WHERE id = '3b055fbc-880c-416b-ad98-720eb10f6930'; -- was: LтАЩAMOUR DE MA VIE
UPDATE public.tracks SET title = 'I Didn''t Change My Number', updated_at = now() WHERE id = 'defaae22-d08f-4f45-be5f-4a8cb1d2ee00'; -- was: I Didn t Change My Number
UPDATE public.tracks SET title = 'That''s Not How This Works (Sabrina''s Version)', updated_at = now() WHERE id = '1104af2b-8578-4554-b4e9-daeebb24e30f';
UPDATE public.releases SET title = 'That''s Not How This Works (Sabrina''s Version)', release_year = 2023, release_type = 'single', confidence = 'high_confidence', status = 'high_confidence', updated_at = now() WHERE id = 'b6d82d80-c0bb-441a-9274-e584f553dcdb';
UPDATE public.artists SET canonical_name = 'The Marías', updated_at = now() WHERE id = '4d5d69bc-fdf2-4e88-b6a7-51eacb78e3e4'; -- was: The Mar├нas

-- Billie Eilish split: move I Didn't Change My Number to Happier Than Ever
-- Step 1: create the release, copy the returned id
INSERT INTO public.releases (artist_id, title, release_type, release_year, confidence, status)
VALUES ('3822a1bf-edfb-4730-a144-d51b7a0ddfb4', 'Happier Than Ever', 'album', 2021, 'high_confidence', 'high_confidence')
RETURNING id;
-- Step 2: move the track (replace NEW_ID with the id from above)
-- UPDATE public.tracks SET release_id = 'NEW_ID', updated_at = now() WHERE id = 'defaae22-d08f-4f45-be5f-4a8cb1d2ee00';
