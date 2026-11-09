"""Unit tests for the DATUM fixer-before-upload hook in datum.py.

No network, no Mega, no secrets. The ssdb_fixer module is faked in
sys.modules; the utag-control `correct` calls and the Review queue
are mocked on the datum module.

Run: python -m unittest test_datum_fixer_hook -v
"""

import os
import sys
import types
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import datum


def make_fake_fx(audit_result, tags=None):
    fx = types.ModuleType("ssdb_fixer")
    fx.read_tags = mock.Mock(return_value=tags or {
        "title": "", "artist": "", "album": "",
        "genre": "", "year": "", "track_no": 0, "disc_no": 0})
    fx.audit_file = mock.Mock(return_value=audit_result)
    fx.write_tags = mock.Mock()
    fx.fetch_utag_track = mock.Mock(return_value={
        "track": {"id": "t1", "title": "505", "track_number": 1},
        "release": {"id": "r1", "title": "AM", "release_year": 2013},
        "artist": {"id": "a1", "canonical_name": "Arctic Monkeys"},
    })
    return fx


class TestFixMetadataBeforeUpload(unittest.TestCase):
    def setUp(self):
        self._orig = sys.modules.get("ssdb_fixer")

    def tearDown(self):
        if self._orig is None:
            sys.modules.pop("ssdb_fixer", None)
        else:
            sys.modules["ssdb_fixer"] = self._orig

    def test_fixed_applies_corrections_and_writes_tags(self):
        fx = make_fake_fx({
            "status": "fixed", "verified": True,
            "proposals": [{"field": "title", "from": "505", "to": "505 (Remastered)",
                           "confidence": 1.0, "source": "UTAG"}],
        })
        sys.modules["ssdb_fixer"] = fx
        with mock.patch.object(datum, "_utag_correct_field", return_value=True) as corr, \
             mock.patch.object(datum, "queue_fixer_review") as review:
            out = datum.fix_metadata_before_upload(
                "/tmp/505.mp3", "t1", "Arctic Monkeys", "AM", "505")
        self.assertEqual(out, ("Arctic Monkeys", "AM", "505 (Remastered)"))
        corr.assert_called_once()
        args = corr.call_args[0]
        self.assertEqual(args[0], "track")
        self.assertEqual(args[2], "title")
        self.assertEqual(args[3], "505 (Remastered)")
        review.assert_not_called()
        fx.write_tags.assert_called_once()
        written = fx.write_tags.call_args[0][1]
        self.assertEqual(written["title"], "505 (Remastered)")

    def test_no_change_still_writes_canonical_tags(self):
        fx = make_fake_fx({"status": "no_change", "verified": True, "proposals": []})
        sys.modules["ssdb_fixer"] = fx
        with mock.patch.object(datum, "_utag_correct_field") as corr, \
             mock.patch.object(datum, "queue_fixer_review") as review:
            out = datum.fix_metadata_before_upload(
                "/tmp/505.mp3", "t1", "Arctic Monkeys", "AM", "505")
        self.assertEqual(out, ("Arctic Monkeys", "AM", "505"))
        corr.assert_not_called()
        review.assert_not_called()
        fx.write_tags.assert_called_once()
        written = fx.write_tags.call_args[0][1]
        self.assertEqual(written["artist"], "Arctic Monkeys")
        self.assertEqual(written["album"], "AM")

    def test_review_queues_and_keeps_job_metadata_in_file(self):
        fx = make_fake_fx({
            "status": "review", "verified": False,
            "proposals": [{"field": "title", "from": "505", "to": "505?",
                           "confidence": 0.77, "source": "MusicBrainz"}],
        })
        sys.modules["ssdb_fixer"] = fx
        with mock.patch.object(datum, "_utag_correct_field") as corr, \
             mock.patch.object(datum, "queue_fixer_review") as review:
            out = datum.fix_metadata_before_upload(
                "/tmp/505.mp3", "t1", "Arctic Monkeys", "AM", "505")
        self.assertEqual(out, ("Arctic Monkeys", "AM", "505"))
        corr.assert_not_called()
        review.assert_called_once()
        fx.write_tags.assert_called_once()
        written = fx.write_tags.call_args[0][1]
        self.assertEqual(written["title"], "505")

    def test_audit_failure_uploads_with_job_metadata(self):
        fx = make_fake_fx({"status": "no_change", "proposals": []})
        fx.audit_file = mock.Mock(side_effect=RuntimeError("catalog down"))
        sys.modules["ssdb_fixer"] = fx
        with mock.patch.object(datum, "_utag_correct_field") as corr:
            out = datum.fix_metadata_before_upload(
                "/tmp/505.mp3", "t1", "Arctic Monkeys", "AM", "505")
        self.assertEqual(out, ("Arctic Monkeys", "AM", "505"))
        corr.assert_not_called()
        fx.write_tags.assert_not_called()

    def test_failed_db_correction_goes_to_review(self):
        fx = make_fake_fx({
            "status": "fixed", "verified": True,
            "proposals": [{"field": "title", "from": "505", "to": "505 (Remastered)",
                           "confidence": 1.0, "source": "UTAG"}],
        })
        sys.modules["ssdb_fixer"] = fx
        with mock.patch.object(datum, "_utag_correct_field", return_value=False), \
             mock.patch.object(datum, "queue_fixer_review") as review:
            datum.fix_metadata_before_upload(
                "/tmp/505.mp3", "t1", "Arctic Monkeys", "AM", "505")
        review.assert_called_once()

    def test_artist_collision_routes_everything_to_review(self):
        fx = make_fake_fx({
            "status": "fixed", "verified": True,
            "proposals": [
                {"field": "artist", "from": "Arctic Monkey", "to": "Arctic Monkeys",
                 "confidence": 0.95, "source": "library roster"},
                {"field": "title", "from": "505", "to": "505 (Remastered)",
                 "confidence": 1.0, "source": "UTAG"},
            ],
        })
        sys.modules["ssdb_fixer"] = fx
        # The DB row still carries the uncorrected artist name, so the
        # fixer proposes the rename and the collision check runs.
        fx.fetch_utag_track.return_value["artist"]["canonical_name"] = "Arctic Monkey"
        with mock.patch.object(datum, "_utag_correct_field") as corr, \
             mock.patch.object(datum, "_artist_name_taken", return_value=True), \
             mock.patch.object(datum, "queue_fixer_review") as review:
            out = datum.fix_metadata_before_upload(
                "/tmp/505.mp3", "t1", "Arctic Monkey", "AM", "505")
        # Nothing applied, file keeps the job's metadata, the original
        # proposals go to Review as-is.
        corr.assert_not_called()
        review.assert_called_once()
        self.assertEqual(review.call_args[0][3][0]["field"], "artist")
        self.assertEqual(out, ("Arctic Monkey", "AM", "505"))


class TestQueueFixerReview(unittest.TestCase):
    def _mock_post(self):
        resp = mock.Mock()
        resp.ok = True
        resp.json.return_value = [{"id": "p1"}]
        return mock.Mock(return_value=resp)

    def test_groups_proposals_per_entity_with_editable_fields(self):
        before = {"title": "505", "artist": "Arctic Monkeys", "album": "AM",
                  "year": "2013", "track_no": 1}
        proposals = [
            {"field": "title", "from": "505", "to": "505 (Remastered)",
             "confidence": 1.0, "source": "UTAG"},
            {"field": "year", "from": "2013", "to": "2013",
             "confidence": 0.85, "source": "Apple Music"},
        ]
        with mock.patch.object(datum, "_service_headers", return_value={"apikey": "x"}), \
             mock.patch.object(datum, "_admin_user_id", return_value="admin-1"), \
             mock.patch("datum.requests.post", self._mock_post()) as post:
            ok = datum.queue_fixer_review("t1", before, before, proposals)
        self.assertTrue(ok)
        # Only the changed title is queued; the identical year is dropped.
        # Two posts: the proposal insert + the Activity log row.
        self.assertEqual(post.call_count, 2)
        sent = post.call_args_list[0][1]["json"]
        self.assertEqual(sent["entity_type"], "track")
        self.assertEqual(sent["entity_id"], "t1")
        self.assertEqual(sent["proposer_id"], "admin-1")
        self.assertEqual(sent["fields"], {"title": "505 (Remastered)"})
        self.assertEqual(sent["status"], "pending")

    def test_no_admin_id_means_no_queue(self):
        with mock.patch.object(datum, "_service_headers", return_value={"apikey": "x"}), \
             mock.patch.object(datum, "_admin_user_id", return_value=None), \
             mock.patch("datum.requests.post") as post:
            ok = datum.queue_fixer_review("t1", {}, {}, [
                {"field": "title", "from": "a", "to": "b", "confidence": 0.8}])
        self.assertFalse(ok)
        post.assert_not_called()


if __name__ == "__main__":
    unittest.main()
