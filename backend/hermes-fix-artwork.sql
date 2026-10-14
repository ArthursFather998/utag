-- Hermes: cover art for 24 releases (all verified against Apple/Deezer)
-- Run in Supabase SQL editor.

-- The Party Never Ends 2.0
INSERT INTO public.artwork (release_id, source_url, role, source, confidence, status)
SELECT '04cd2b7c-68cc-486c-a4ec-35e56f73cb9c', 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/56/d0/78/56d07815-71f2-5700-6514-db44613b00fa/24UM1IM10948.rgb.jpg/600x600bb.jpg', 'canonical', 'hermes-apple', 'high_confidence', 'high_confidence'
WHERE NOT EXISTS (SELECT 1 FROM public.artwork WHERE release_id = '04cd2b7c-68cc-486c-a4ec-35e56f73cb9c' AND role = 'canonical');

-- The Lo-Fis
INSERT INTO public.artwork (release_id, source_url, role, source, confidence, status)
SELECT '14ee13f6-16a4-4cb6-9c11-90dd055e8dcf', 'https://cdn-images.dzcdn.net/images/cover/aab27852a05351552e9dcacdbb14ec3a/1000x1000-000000-80-0-0.jpg', 'canonical', 'hermes-deezer', 'high_confidence', 'high_confidence'
WHERE NOT EXISTS (SELECT 1 FROM public.artwork WHERE release_id = '14ee13f6-16a4-4cb6-9c11-90dd055e8dcf' AND role = 'canonical');

-- Star Shopping (Live)
INSERT INTO public.artwork (release_id, source_url, role, source, confidence, status)
SELECT '2f6607f1-ba48-43f8-87ef-de9230b0f929', 'https://cdn-images.dzcdn.net/images/cover/e318144ad9a8155c025f24a511f08815/1000x1000-000000-80-0-0.jpg', 'canonical', 'hermes-deezer', 'high_confidence', 'high_confidence'
WHERE NOT EXISTS (SELECT 1 FROM public.artwork WHERE release_id = '2f6607f1-ba48-43f8-87ef-de9230b0f929' AND role = 'canonical');

-- Operation: Doomsday
INSERT INTO public.artwork (release_id, source_url, role, source, confidence, status)
SELECT '104e9d4c-04b6-4bcd-bc1d-1e10501dba94', 'https://cdn-images.dzcdn.net/images/cover/29ceae43498c58159d5afe95fde8b395/1000x1000-000000-80-0-0.jpg', 'canonical', 'hermes-deezer', 'high_confidence', 'high_confidence'
WHERE NOT EXISTS (SELECT 1 FROM public.artwork WHERE release_id = '104e9d4c-04b6-4bcd-bc1d-1e10501dba94' AND role = 'canonical');

-- Live Forever
INSERT INTO public.artwork (release_id, source_url, role, source, confidence, status)
SELECT '1b8f81b5-ef6a-410a-9dd3-5deaa191e3f1', 'https://cdn-images.dzcdn.net/images/cover/1cec367f43d884cb853c55e9d6fcaff9/1000x1000-000000-80-0-0.jpg', 'canonical', 'hermes-deezer', 'high_confidence', 'high_confidence'
WHERE NOT EXISTS (SELECT 1 FROM public.artwork WHERE release_id = '1b8f81b5-ef6a-410a-9dd3-5deaa191e3f1' AND role = 'canonical');

-- let's pretend we're numb
INSERT INTO public.artwork (release_id, source_url, role, source, confidence, status)
SELECT '1fe514a1-47dd-4418-b340-28fb8974426e', 'https://cdn-images.dzcdn.net/images/cover/ecc0d8db247f46e142b8614007751faa/1000x1000-000000-80-0-0.jpg', 'canonical', 'hermes-deezer', 'high_confidence', 'high_confidence'
WHERE NOT EXISTS (SELECT 1 FROM public.artwork WHERE release_id = '1fe514a1-47dd-4418-b340-28fb8974426e' AND role = 'canonical');

-- J.E. Heartbreak
INSERT INTO public.artwork (release_id, source_url, role, source, confidence, status)
SELECT '31b70502-5a98-4d8f-9159-8ee9b0954cd2', 'https://cdn-images.dzcdn.net/images/cover/5a7bedce12f57e199780c05afd7a6e0b/500x500-000000-80-0-0.jpg', 'canonical', 'hermes-deezer', 'high_confidence', 'high_confidence'
WHERE NOT EXISTS (SELECT 1 FROM public.artwork WHERE release_id = '31b70502-5a98-4d8f-9159-8ee9b0954cd2' AND role = 'canonical');

-- FUNNY little FEARS
INSERT INTO public.artwork (release_id, source_url, role, source, confidence, status)
SELECT '3deda100-f9e1-41f7-85c3-68b72741f356', 'https://cdn-images.dzcdn.net/images/cover/812582837d3006d43ab53535635e3bfb/500x500-000000-80-0-0.jpg', 'canonical', 'hermes-deezer', 'high_confidence', 'high_confidence'
WHERE NOT EXISTS (SELECT 1 FROM public.artwork WHERE release_id = '3deda100-f9e1-41f7-85c3-68b72741f356' AND role = 'canonical');

-- The Game (Deluxe Remastered Version)
INSERT INTO public.artwork (release_id, source_url, role, source, confidence, status)
SELECT '648a2394-ddb1-44b1-b6d3-2a263f5ee340', 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/08/ee/da/08eeda1f-d44d-aec1-ec9d-0c5b9f8c8536/602527717524.jpg/600x600bb.jpg', 'canonical', 'hermes-apple', 'high_confidence', 'high_confidence'
WHERE NOT EXISTS (SELECT 1 FROM public.artwork WHERE release_id = '648a2394-ddb1-44b1-b6d3-2a263f5ee340' AND role = 'canonical');

-- Come Over When You're Sober, Pt. 2
INSERT INTO public.artwork (release_id, source_url, role, source, confidence, status)
SELECT '7fd0fbb4-7e30-4f90-8283-8b2d2dd1fe45', 'https://cdn-images.dzcdn.net/images/cover/757870ddc1211505769e2be84d165351/500x500-000000-80-0-0.jpg', 'canonical', 'hermes-deezer', 'high_confidence', 'high_confidence'
WHERE NOT EXISTS (SELECT 1 FROM public.artwork WHERE release_id = '7fd0fbb4-7e30-4f90-8283-8b2d2dd1fe45' AND role = 'canonical');

-- From Under the Cork Tree
INSERT INTO public.artwork (release_id, source_url, role, source, confidence, status)
SELECT '86d1e28f-e3b2-4dcc-bfab-6996cbaff5f2', 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/ea/ff/60/eaff603f-d108-2815-3dce-db39b990635f/06UMGIM11830.rgb.jpg/600x600bb.jpg', 'canonical', 'hermes-apple', 'high_confidence', 'high_confidence'
WHERE NOT EXISTS (SELECT 1 FROM public.artwork WHERE release_id = '86d1e28f-e3b2-4dcc-bfab-6996cbaff5f2' AND role = 'canonical');

-- Apple Music Presents: Tyler, The Creator
INSERT INTO public.artwork (release_id, source_url, role, source, confidence, status)
SELECT '6b8d6c5b-94ac-42e4-a6dc-9ff4a55d15b9', 'https://cdn-images.dzcdn.net/images/cover/8848c366508735e513fed3e2c6f2a6d1/500x500-000000-80-0-0.jpg', 'canonical', 'hermes-deezer', 'high_confidence', 'high_confidence'
WHERE NOT EXISTS (SELECT 1 FROM public.artwork WHERE release_id = '6b8d6c5b-94ac-42e4-a6dc-9ff4a55d15b9' AND role = 'canonical');

-- Superclean Vol. II
INSERT INTO public.artwork (release_id, source_url, role, source, confidence, status)
SELECT '91eba2c6-2d2a-4c22-a757-a4f4774f4aa8', 'https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/71/5f/fc/715ffc50-c006-500b-ad3e-830a6a6bbc70/artwork.jpg/600x600bb.jpg', 'canonical', 'hermes-apple', 'high_confidence', 'high_confidence'
WHERE NOT EXISTS (SELECT 1 FROM public.artwork WHERE release_id = '91eba2c6-2d2a-4c22-a757-a4f4774f4aa8' AND role = 'canonical');

-- Petals to Thorns
INSERT INTO public.artwork (release_id, source_url, role, source, confidence, status)
SELECT 'da9e7a3b-a0d7-48fe-82ba-b4e3f77642a6', 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/d6/83/1a/d6831a94-4e8f-5b23-df44-a313eb358257/23UMGIM33457.rgb.jpg/600x600bb.jpg', 'canonical', 'hermes-apple', 'high_confidence', 'high_confidence'
WHERE NOT EXISTS (SELECT 1 FROM public.artwork WHERE release_id = 'da9e7a3b-a0d7-48fe-82ba-b4e3f77642a6' AND role = 'canonical');

-- No.6 Collaborations Project
INSERT INTO public.artwork (release_id, source_url, role, source, confidence, status)
SELECT '9de33b19-df90-411d-8936-55bddb56e171', 'https://cdn-images.dzcdn.net/images/cover/1d809f545fb9ecea849cf45fc8bcc681/1000x1000-000000-80-0-0.jpg', 'canonical', 'hermes-deezer', 'high_confidence', 'high_confidence'
WHERE NOT EXISTS (SELECT 1 FROM public.artwork WHERE release_id = '9de33b19-df90-411d-8936-55bddb56e171' AND role = 'canonical');

-- That's Not How This Works (Sabrina's Version)
INSERT INTO public.artwork (release_id, source_url, role, source, confidence, status)
SELECT 'b6d82d80-c0bb-441a-9274-e584f553dcdb', 'https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/28/f5/e3/28f5e341-bfc5-1289-b956-f2648676ab53/075679685957.jpg/600x600bb.jpg', 'canonical', 'hermes-apple', 'high_confidence', 'high_confidence'
WHERE NOT EXISTS (SELECT 1 FROM public.artwork WHERE release_id = 'b6d82d80-c0bb-441a-9274-e584f553dcdb' AND role = 'canonical');

-- Sick of Nostalgia
INSERT INTO public.artwork (release_id, source_url, role, source, confidence, status)
SELECT 'bf5bac0e-3c5e-4901-bfbe-7a3be0260795', 'https://cdn-images.dzcdn.net/images/cover/9dd15599c5bf46f344f85f32509dcabf/1000x1000-000000-80-0-0.jpg', 'canonical', 'hermes-deezer', 'high_confidence', 'high_confidence'
WHERE NOT EXISTS (SELECT 1 FROM public.artwork WHERE release_id = 'bf5bac0e-3c5e-4901-bfbe-7a3be0260795' AND role = 'canonical');

-- lately I feel EVERYTHING
INSERT INTO public.artwork (release_id, source_url, role, source, confidence, status)
SELECT 'df8be520-7504-405d-bd49-335742accca5', 'https://cdn-images.dzcdn.net/images/cover/1cc062f1fcda9ce9e8c09c7322aafb7a/1000x1000-000000-80-0-0.jpg', 'canonical', 'hermes-deezer', 'high_confidence', 'high_confidence'
WHERE NOT EXISTS (SELECT 1 FROM public.artwork WHERE release_id = 'df8be520-7504-405d-bd49-335742accca5' AND role = 'canonical');

-- The Lost Petals - EP
INSERT INTO public.artwork (release_id, source_url, role, source, confidence, status)
SELECT '82e3ce16-4a2a-495a-bdae-fa5ae63bdf13', 'https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/94/52/c2/9452c207-e879-3725-4a3d-90f04cc0429f/23UMGIM88184.rgb.jpg/600x600bb.jpg', 'canonical', 'hermes-apple', 'high_confidence', 'high_confidence'
WHERE NOT EXISTS (SELECT 1 FROM public.artwork WHERE release_id = '82e3ce16-4a2a-495a-bdae-fa5ae63bdf13' AND role = 'canonical');

-- Angel Face (Club Deluxe)
INSERT INTO public.artwork (release_id, source_url, role, source, confidence, status)
SELECT 'cfa53c63-518a-477d-8d8e-801bd70b5dcc', 'https://cdn-images.dzcdn.net/images/cover/abfe60bf50311c8d710f6e0fecafbb41/1000x1000-000000-80-0-0.jpg', 'canonical', 'hermes-deezer', 'high_confidence', 'high_confidence'
WHERE NOT EXISTS (SELECT 1 FROM public.artwork WHERE release_id = 'cfa53c63-518a-477d-8d8e-801bd70b5dcc' AND role = 'canonical');

-- HIT ME HARD AND SOFT
INSERT INTO public.artwork (release_id, source_url, role, source, confidence, status)
SELECT 'd6e70833-4f05-4eee-ad9f-064ea62af41b', 'https://cdn-images.dzcdn.net/images/cover/5d284b31cb9ddeb1a0c79aede5a94e1c/1000x1000-000000-80-0-0.jpg', 'canonical', 'hermes-deezer', 'high_confidence', 'high_confidence'
WHERE NOT EXISTS (SELECT 1 FROM public.artwork WHERE release_id = 'd6e70833-4f05-4eee-ad9f-064ea62af41b' AND role = 'canonical');

-- Happier Than Ever
INSERT INTO public.artwork (release_id, source_url, role, source, confidence, status)
SELECT 'cb784343-91f0-41e9-b2b8-0ee70c29d4e5', 'https://cdn-images.dzcdn.net/images/cover/9955047483278bd0f93420951226ac44/1000x1000-000000-80-0-0.jpg', 'canonical', 'hermes-deezer', 'high_confidence', 'high_confidence'
WHERE NOT EXISTS (SELECT 1 FROM public.artwork WHERE release_id = 'cb784343-91f0-41e9-b2b8-0ee70c29d4e5' AND role = 'canonical');

-- Purpose (Deluxe)
INSERT INTO public.artwork (release_id, source_url, role, source, confidence, status)
SELECT '76ba19e7-47bb-4098-8e8c-8f89a4d1911c', 'https://cdn-images.dzcdn.net/images/cover/340283aafac320864b207c420124ee46/1000x1000-000000-80-0-0.jpg', 'canonical', 'hermes-deezer', 'high_confidence', 'high_confidence'
WHERE NOT EXISTS (SELECT 1 FROM public.artwork WHERE release_id = '76ba19e7-47bb-4098-8e8c-8f89a4d1911c' AND role = 'canonical');

-- The Twilight Saga: Breaking Dawn - Pt. 1 (Original Motion Picture Soundtrack)
INSERT INTO public.artwork (release_id, source_url, role, source, confidence, status)
SELECT 'ee1ad0d8-b8c4-40bb-b1cf-170960ed5b52', 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/f5/2e/83/f52e8357-9cf4-e644-c365-3c21839f85ac/mzi.staekbjw.jpg/600x600bb.jpg', 'canonical', 'hermes-apple', 'high_confidence', 'high_confidence'
WHERE NOT EXISTS (SELECT 1 FROM public.artwork WHERE release_id = 'ee1ad0d8-b8c4-40bb-b1cf-170960ed5b52' AND role = 'canonical');

-- 17 (XXXTENTACION)
INSERT INTO public.artwork (release_id, source_url, role, source, confidence, status)
SELECT 'afe25542-4f3a-4c1c-af7e-8c18e3ccc5f8', 'https://cdn-images.dzcdn.net/images/cover/b7d770d1049a3d4742d5ac0759b501e9/1000x1000-000000-80-0-0.jpg', 'canonical', 'hermes-deezer', 'high_confidence', 'high_confidence'
WHERE NOT EXISTS (SELECT 1 FROM public.artwork WHERE release_id = 'afe25542-4f3a-4c1c-af7e-8c18e3ccc5f8' AND role = 'canonical');

-- Total: 25 inserts

-- NOT FOUND (no artwork exists):
-- - Internationale Pop-Hits Vol. 1 (not a real release; move 'Lost' to Channel Orange)
-- - Always Love single (d4vd, not indexed yet)
