-- Hermes fix: attribute Skyler Green's tracks (were filed under Unknown Artist)
-- 12 tracks, all confirmed as Skyler Green by release names

-- 'Actress'
UPDATE public.tracks SET artist_id = 'facc8bc9-a047-45a2-83d9-43c30b443ef2', updated_at = now() WHERE id = '004a5ab5-e99a-4fe7-bbc7-e80d2be98880';

-- 'SkylerGreen Harlot'
UPDATE public.tracks SET artist_id = 'facc8bc9-a047-45a2-83d9-43c30b443ef2', updated_at = now() WHERE id = '2fb376e0-54ec-49ad-aa92-74feaa58dae6';

-- 'I'm Not Fine'
UPDATE public.tracks SET artist_id = 'facc8bc9-a047-45a2-83d9-43c30b443ef2', updated_at = now() WHERE id = '363f81ae-8aa9-4e5c-a313-d4dd3425d115';

-- 'Phone Tag'
UPDATE public.tracks SET artist_id = 'facc8bc9-a047-45a2-83d9-43c30b443ef2', updated_at = now() WHERE id = '3f8e87aa-a5cc-4e00-b38f-af557d4ef64e';

-- 'Drain'
UPDATE public.tracks SET artist_id = 'facc8bc9-a047-45a2-83d9-43c30b443ef2', updated_at = now() WHERE id = '5ebb4cba-198a-467e-8297-7da3574f84d7';

-- 'home'
UPDATE public.tracks SET artist_id = 'facc8bc9-a047-45a2-83d9-43c30b443ef2', updated_at = now() WHERE id = '6b7cc54f-2164-4789-ac0d-220644ec1701';

-- 'Cloey'
UPDATE public.tracks SET artist_id = 'facc8bc9-a047-45a2-83d9-43c30b443ef2', updated_at = now() WHERE id = '6fbfeade-0be4-417d-b7d9-1ddb27c53120';

-- 'Tired'
UPDATE public.tracks SET artist_id = 'facc8bc9-a047-45a2-83d9-43c30b443ef2', updated_at = now() WHERE id = 'a609c758-9a03-4cef-ac04-393c015d83da';

-- 'Revived'
UPDATE public.tracks SET artist_id = 'facc8bc9-a047-45a2-83d9-43c30b443ef2', updated_at = now() WHERE id = 'b4891943-8e7e-4cdb-863c-06d89a51b089';

-- 'Hiraeth'
UPDATE public.tracks SET artist_id = 'facc8bc9-a047-45a2-83d9-43c30b443ef2', updated_at = now() WHERE id = 'b6f3742d-4eac-428b-865b-06b5f0aea943';

-- 'Feel'
UPDATE public.tracks SET artist_id = 'facc8bc9-a047-45a2-83d9-43c30b443ef2', updated_at = now() WHERE id = 'c40a90ef-9945-4d6d-bf04-502723a0a921';

-- 'Throwaway'
UPDATE public.tracks SET artist_id = 'facc8bc9-a047-45a2-83d9-43c30b443ef2', updated_at = now() WHERE id = 'ecf9e200-5be2-4f2f-95f8-83b2651c9e86';

-- ============================================================
-- Remaining 4: research results (2026-10-13)
-- ============================================================

-- 'COMPANY' -> Justin Bieber's "Company" from Purpose (Deluxe), 2015. High confidence.
-- Create clean Justin Bieber artist record
INSERT INTO public.artists (canonical_name, confidence, status)
VALUES ('Justin Bieber', 'high_confidence', 'high_confidence')
ON CONFLICT DO NOTHING
RETURNING id;
-- Copy the returned id into the statements below as BIEBER_ID

-- Point the Purpose (Deluxe) release at Justin Bieber
-- UPDATE public.releases SET artist_id = 'BIEBER_ID', updated_at = now() WHERE id = '76ba19e7-47bb-4098-8e8c-8f89a4d1911c';

-- Fix the track
-- UPDATE public.tracks SET artist_id = 'BIEBER_ID', title = 'Company', confidence = 'high_confidence', status = 'high_confidence', updated_at = now() WHERE id = '7a8aebaf-d743-4fa5-8fa1-d913c617b29b';

-- 'satan_s pursuit' -> d4vd unreleased leak. Medium confidence, stays needs_review.
UPDATE public.tracks SET artist_id = '12856560-3db2-4c3e-b0a4-e68a3f7de462', title = 'Satan''s Pursuit', updated_at = now() WHERE id = '29aec72f-8946-4600-a759-64152544e3d3';

-- 'F U.wav' -> d4vd unreleased leak. Medium confidence, stays needs_review.
UPDATE public.tracks SET artist_id = '12856560-3db2-4c3e-b0a4-e68a3f7de462', title = 'F U', updated_at = now() WHERE id = 'caa5f4b8-6ff2-4892-8dfe-3962e23aff93';

-- 'whoreallycares higher quality' -> d4vd unreleased "whoreallycares" (verified by Skyler himself).
UPDATE public.tracks SET artist_id = '12856560-3db2-4c3e-b0a4-e68a3f7de462', title = 'whoreallycares', updated_at = now() WHERE id = 'c3d3eac8-1974-4f5f-9be8-53cfb4fd73af';
