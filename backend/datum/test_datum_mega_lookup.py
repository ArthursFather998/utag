"""Unit tests for find_mega_file's folder scan (no rclone, no network).

Run: python -m unittest test_datum_mega_lookup -v
"""

import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import datum


class FakeRun:
    def __init__(self, returncode, stdout):
        self.returncode, self.stdout, self.stderr = returncode, stdout, ""


def _make_run(existing_ls, lsjson_map):
    def _run(cmd, **kwargs):
        # cmd: ["rclone", "ls"|"lsjson", "remote:path"]
        path = cmd[2].split(":", 1)[1]
        if cmd[1] == "ls":
            if path in existing_ls:
                return FakeRun(0, " 6098369 505.mp3\n")
            return FakeRun(1, "")
        if cmd[1] == "lsjson":
            return FakeRun(0, json.dumps(lsjson_map.get(path, [])))
        return FakeRun(1, "")
    return _run


class TestFindMegaFile(unittest.TestCase):
    def test_finds_albumless_file_under_artist_folder(self):
        # The approved-layout path does NOT exist; the file sits
        # directly under the artist folder (the old no-album layout).
        run = _make_run(set(), {
            "DATUM/SSDB/Arctic Monkeys": [{"Name": "505.mp3", "Size": 6098369}],
        })
        with mock.patch("datum.shutil.which", return_value="/usr/bin/rclone"), \
             mock.patch("datum.subprocess.run", side_effect=run):
            self.assertEqual(
                datum.find_mega_file("Arctic Monkeys", "AM", "505"),
                "DATUM/SSDB/Arctic Monkeys/505.mp3")

    def test_exact_layout_path_still_wins(self):
        run = _make_run({"DATUM/SSDB/Arctic Monkeys/AM/505.mp3"}, {})
        with mock.patch("datum.shutil.which", return_value="/usr/bin/rclone"), \
             mock.patch("datum.subprocess.run", side_effect=run):
            self.assertEqual(
                datum.find_mega_file("Arctic Monkeys", "AM", "505"),
                "DATUM/SSDB/Arctic Monkeys/AM/505.mp3")

    def test_no_match_returns_none(self):
        run = _make_run(set(), {})
        with mock.patch("datum.shutil.which", return_value="/usr/bin/rclone"), \
             mock.patch("datum.subprocess.run", side_effect=run):
            self.assertIsNone(datum.find_mega_file("Nobody", "Nothing", "Nope"))


if __name__ == "__main__":
    unittest.main()
