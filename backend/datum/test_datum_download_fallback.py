"""Unit tests for download_track's retry fallbacks (no yt-dlp, no network).

Run: python -m unittest test_datum_download_fallback -v
"""

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import datum


BOT_CHECK = ("ERROR: [youtube] 0Necz5glI4I: Sign in to confirm you\u2019re not a bot. "
             "Use --cookies-from-browser or --cookies for the authentication.")
TRACK = {"title": "Where Do Broken Hearts Go", "url": "https://www.youtube.com/watch?v=0Necz5glI4I"}


class TestDownloadTrackFallback(unittest.TestCase):
    def test_bot_check_retries_without_cookies(self):
        """A stale-cookie bot check on attempt 1 retries cookie-free and succeeds."""
        calls = []

        def fake_try(track, download_dir, audio_format, format_str, player_clients, use_cookies=True):
            calls.append((format_str, tuple(player_clients) if player_clients else None, use_cookies))
            if use_cookies:
                raise RuntimeError(BOT_CHECK)
            return download_dir / "song.mp3"

        with mock.patch("datum._try_download_once", side_effect=fake_try):
            out = datum.download_track(TRACK, datum.Path("/tmp/dl"))
        self.assertEqual(str(out), "/tmp/dl/song.mp3")
        self.assertEqual(calls[0], ("bestaudio/best", ("android", "web"), True))
        self.assertEqual(calls[1], ("bestaudio/best", ("android", "web"), False))

    def test_bot_check_on_every_attempt_raises(self):
        """If even the cookie-free attempts hit the bot check, the error surfaces."""
        with mock.patch("datum._try_download_once", side_effect=RuntimeError(BOT_CHECK)):
            with self.assertRaises(RuntimeError) as ctx:
                datum.download_track(TRACK, datum.Path("/tmp/dl"))
        self.assertIn("Sign in to confirm you", str(ctx.exception))

    def test_bot_check_reaches_mweb_tv_web_safari_attempt(self):
        """After the android+web and web-only attempts bot-check, the
        alternate-clients attempt (mweb, tv, web_safari) runs next."""
        calls = []

        def fake_try(track, download_dir, audio_format, format_str, player_clients, use_cookies=True):
            calls.append((format_str, tuple(player_clients) if player_clients else None, use_cookies))
            if len(calls) < 4:
                raise RuntimeError(BOT_CHECK)
            return download_dir / "song.mp3"

        with mock.patch("datum._try_download_once", side_effect=fake_try):
            out = datum.download_track(TRACK, datum.Path("/tmp/dl"))
        self.assertEqual(str(out), "/tmp/dl/song.mp3")
        self.assertEqual(calls[2], ("best", ("web",), False))
        self.assertEqual(calls[3], ("best", ("mweb", "tv", "web_safari"), False))
        self.assertEqual(len(calls), 4)

    def test_format_fallback_still_works(self):
        """'Requested format is not available' still falls through to the next format."""
        calls = []

        def fake_try(track, download_dir, audio_format, format_str, player_clients, use_cookies=True):
            calls.append(use_cookies)
            if len(calls) == 1:
                raise RuntimeError("Requested format is not available")
            return download_dir / "song.mp3"

        with mock.patch("datum._try_download_once", side_effect=fake_try):
            out = datum.download_track(TRACK, datum.Path("/tmp/dl"))
        self.assertEqual(str(out), "/tmp/dl/song.mp3")
        self.assertEqual(len(calls), 2)

    def test_private_video_raises_immediately(self):
        """A real failure (private video) is not retried across fallbacks."""
        calls = []

        def fake_try(track, download_dir, audio_format, format_str, player_clients, use_cookies=True):
            calls.append(1)
            raise RuntimeError("ERROR: [youtube] abc: Private video")

        with mock.patch("datum._try_download_once", side_effect=fake_try):
            with self.assertRaises(RuntimeError):
                datum.download_track(TRACK, datum.Path("/tmp/dl"))
        self.assertEqual(len(calls), 1)

    def test_first_attempt_success_never_retries(self):
        """Fresh cookies, working download: exactly one attempt."""
        calls = []

        def fake_try(track, download_dir, audio_format, format_str, player_clients, use_cookies=True):
            calls.append(1)
            return download_dir / "song.mp3"

        with mock.patch("datum._try_download_once", side_effect=fake_try):
            out = datum.download_track(TRACK, datum.Path("/tmp/dl"))
        self.assertEqual(str(out), "/tmp/dl/song.mp3")
        self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()
