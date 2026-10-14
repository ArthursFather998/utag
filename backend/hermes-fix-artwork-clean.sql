-- Hermes: cover art for 12 releases (verified Apple/Deezer)
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

-- Come Over When You're Sober, Pt. 2
INSERT INTO public.artwork (release_id, source_url, role, source, confidence, status)
SELECT '7fd0fbb4-7e30-4f90-8283-8b2d2dd1fe45', 'https://cdn-images.dzcdn.net/images/cover/757870ddc1211505769e2be84d165351/500x500-000000-80-0-0.jpg', 'canonical', 'hermes-deezer', 'high_confidence', 'high_confidence'
WHERE NOT EXISTS (SELECT 1 FROM public.artwork WHERE release_id = '7fd0fbb4-7e30-4f90-8283-8b2d2dd1fe45' AND role = 'canonical');

-- No.6 Collaborations Project
INSERT INTO public.artwork (release_id, source_url, role, source, confidence, status)
SELECT '9de33b19-df90-411d-8936-55bddb56e171', 'https://cdn-images.dzcdn.net/images/cover/1d809f545fb9ecea849cf45fc8bcc681/1000x1000-000000-80-0-0.jpg', 'canonical', 'hermes-deezer', 'high_confidence', 'high_confidence'
WHERE NOT EXISTS (SELECT 1 FROM public.artwork WHERE release_id = '9de33b19-df90-411d-8936-55bddb56e171' AND role = 'canonical');

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
