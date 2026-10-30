"""Unit tests for ssdb_fixer.py — no Mega, no network, no secrets.

Run: python -m unittest test_ssdb_fixer -v
Mocks: requests.get for UTAG/Apple/Deezer/MusicBrainz. mutagen is
not required: read_tags() falls back to filename parsing.
"""

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ssdb_fixer as fx


class FakeResp:
    def __init__(self, data, ok=True, status=200):
        self._data, self.ok, self.status_code = data, ok, status

    def json(self):
        return self._data


class TestHelpers(unittest.TestCase):
    def test_norm_and_sim(self):
        self.assertEqual(fx.norm("Light Switch (feat. X)"), "light switch feat x")
        self.assertEqual(fx.str_sim("Charlie Puth", "Charlie Puth"), 1.0)
        self.assertGreater(fx.str_sim("Charli Puth", "Charlie Puth"), 0.8)

    def test_roster_proposal(self):
        p = fx.roster_proposal("Charli Puth", ["Charlie Puth", "Aaliyah"])
        self.assertIsNotNone(p)
        self.assertEqual(p["to"], "Charlie Puth")
        self.assertEqual(p["source"], "library roster")
        self.assertIsNone(fx.roster_proposal("Charlie Puth", ["Charlie Puth"]))
        self.assertIsNone(fx.roster_proposal("Unknown Artist", ["Charlie Puth"]))

    def test_read_tags_filename_fallback(self):
        info = fx.read_tags("/tmp/Charlie Puth - Light Switch.mp3", album_folder="Light Switch")
        self.assertEqual(info["artist"], "Charlie Puth")
        self.assertEqual(info["title"], "Light Switch")
        self.assertEqual(info["album"], "Light Switch")

    def test_decide(self):
        chosen, status = fx.decide([{"field": "title", "confidence": 0.92}], verified=True)
        self.assertEqual(status, "fixed")
        chosen, status = fx.decide([{"field": "title", "confidence": 0.95}], verified=False)
        self.assertEqual(status, "fixed")
        chosen, status = fx.decide([{"field": "title", "confidence": 0.85}], verified=False)
        self.assertEqual(status, "review")
        chosen, status = fx.decide([], verified=False)
        self.assertEqual(status, "no_change")

    def test_looks_like_skyler(self):
        self.assertTrue(fx.looks_like_skyler("Skyler Green"))
        self.assertFalse(fx.looks_like_skyler("Charlie Puth"))


class TestUtagPass(unittest.TestCase):
    def _fake_get(self, url, params=None, **kw):
        if "/tracks" in url:
            return FakeResp([{"id": "t1", "title": "Light Switch", "artist_id": "a1",
                              "release_id": "r1", "confidence": "verified",
                              "track_number": 1, "disc_number": 1}])
        if "/releases" in url:
            return FakeResp([{"id": "r1", "title": "Light Switch", "release_year": 2022}])
        if "/artists" in url:
            return FakeResp([{"id": "a1", "canonical_name": "Charlie Puth"}])
        return FakeResp([])

    @mock.patch.dict(os.environ, {"UTAG_SUPABASE_ANON_KEY": "test"})
    @mock.patch("ssdb_fixer.requests.get")
    def test_verified_utag_corrects_filename(self, mock_get):
        mock_get.side_effect = self._fake_get
        embedded = {"title": "Light Switch", "artist": "Charli Puth", "album": "Light Switch", "year": "", "genre": "", "track_no": 0, "disc_no": 0}
        result = fx.audit_file(embedded, track_id="t1", roster=["Charlie Puth"], mode="utag-only")
        self.assertEqual(result["status"], "fixed")
        fields = {p["field"]: p["to"] for p in result["proposals"]}
        self.assertEqual(fields["artist"], "Charlie Puth")
        self.assertEqual(result["utag_confidence"], "verified")

    @mock.patch.dict(os.environ, {"UTAG_SUPABASE_ANON_KEY": "test"})
    @mock.patch("ssdb_fixer.requests.get")
    def test_needs_review_utag_proposes_nothing(self, mock_get):
        def fake(url, params=None, **kw):
            if "/tracks" in url:
                return FakeResp([{"id": "t1", "title": "Song", "artist_id": "a1",
                                  "release_id": "r1", "confidence": "needs_review"}])
            if "/releases" in url:
                return FakeResp([{"id": "r1", "title": "Album", "release_year": 2020}])
            if "/artists" in url:
                return FakeResp([{"id": "a1", "canonical_name": "Artist"}])
            return FakeResp([])
        mock_get.side_effect = fake
        embedded = {"title": "Song", "artist": "Wrong Artist", "album": "Album", "year": "", "genre": "", "track_no": 0, "disc_no": 0}
        result = fx.audit_file(embedded, track_id="t1", mode="utag-only")
        self.assertEqual(result["status"], "no_change")
        self.assertFalse(any(p["source"] == "UTAG" for p in result["proposals"]))


if __name__ == "__main__":
    unittest.main()


class TestBackupParsing(unittest.TestCase):
    def test_parse_backup_filename(self):
        # Verified example: album folder AM, file "Arctic Monkeys - I Wanna Be Yours.mp3"
        got = fx.parse_backup_filename("Arctic Monkeys - I Wanna Be Yours.mp3", "AM")
        self.assertEqual(got, {"file_name": "Arctic Monkeys - I Wanna Be Yours.mp3",
                               "artist": "Arctic Monkeys", "title": "I Wanna Be Yours", "album": "AM"})

    def test_parse_first_separator_only(self):
        got = fx.parse_backup_filename("Artist - Song - Live.mp3", "Album")
        self.assertEqual(got["artist"], "Artist")
        self.assertEqual(got["title"], "Song - Live")

    def test_parse_no_separator_never_invents_artist(self):
        got = fx.parse_backup_filename("LonelySong.mp3", "Album")
        self.assertEqual(got["artist"], "")
        self.assertEqual(got["title"], "LonelySong")

    def test_parse_mega_link_listing(self):
        entries = [
            {"path": "AM/Arctic Monkeys - I Wanna Be Yours.mp3", "size": 6000000},
            {"path": "AM/cover.jpg", "size": 12345},
            {"path": "Notes.txt", "size": 10},
            {"path": "EmptyFolder", "is_dir": True},
        ]
        parsed, other = fx.parse_mega_link_listing(entries)
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0]["artist"], "Arctic Monkeys")
        self.assertEqual(parsed[0]["title"], "I Wanna Be Yours")
        self.assertEqual(parsed[0]["album"], "AM")
        self.assertEqual(other, 3)

    def test_parse_listing_ignores_non_audio(self):
        parsed, other = fx.parse_mega_link_listing([
            {"path": "Album/Artist - Song.flac", "size": 100},
            {"path": "Album/Artist - Song.mp3", "size": 100},
        ])
        self.assertEqual(len(parsed), 2)
        self.assertEqual(other, 0)
