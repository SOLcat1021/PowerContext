import unittest

from tasks import list_tasks


DATA = [
    {"id": 1, "status": "open", "priority": "high"},
    {"id": 2, "status": "done", "priority": "low"},
    {"id": 3, "status": "open", "priority": "low"},
    {"id": 4, "status": "done", "priority": "high"},
]


class RegressionTests(unittest.TestCase):
    def test_all_tasks(self):
        self.assertEqual(list_tasks(DATA), DATA)

    def test_status(self):
        self.assertEqual([t["id"] for t in list_tasks(DATA, "open")], [1, 3])

    def test_empty(self):
        self.assertEqual(list_tasks([]), [])

    def test_no_alias(self):
        result = list_tasks(DATA)
        result[0]["status"] = "changed"
        self.assertEqual(DATA[0]["status"], "open")


class TargetTests(unittest.TestCase):
    def test_priority(self):
        self.assertEqual([t["id"] for t in list_tasks(DATA, priority="high")], [1, 4])

    def test_combined(self):
        self.assertEqual([t["id"] for t in list_tasks(DATA, "open", priority="low")], [3])

    def test_none(self):
        self.assertEqual(list_tasks(DATA, priority=None), DATA)

    def test_invalid(self):
        with self.assertRaises(ValueError):
            list_tasks(DATA, priority="urgent")

    def test_invalid_even_empty(self):
        with self.assertRaises(ValueError):
            list_tasks([], priority="urgent")

    def test_preserve_input(self):
        original = [dict(t) for t in DATA]
        result = list_tasks(DATA, priority="high")
        result[0]["priority"] = "low"
        self.assertEqual(DATA, original)


if __name__ == "__main__":
    unittest.main()
