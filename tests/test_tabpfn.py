import unittest
from unittest.mock import patch

import numpy as np
from pydantic import ValidationError

from services import tabpfn_service as service


class OutcomePredictorTests(unittest.TestCase):
    def tearDown(self):
        service.CACHE.clear()

    def test_full_catalog_is_ranked_in_one_bounded_batch(self):
        quests = [{"id": str(i), "quest_type": "nature", "duration": 10} for i in range(120)]
        result = service.rank(service.RankRequest(context={"minutes": 15}, quests=quests))
        self.assertEqual(len(result["quests"]), 120)
        self.assertEqual(result["ranker"], "baseline")
        self.assertEqual([q["id"] for q in result["quests"]], [q["id"] for q in quests])
        with self.assertRaises(ValidationError):
            service.RankRequest(quests=[{"id": str(i)} for i in range(257)])

    def test_missing_enjoyment_is_not_a_negative_label(self):
        values, status = service.predict_probability([
            {"quest_type": "movement", "liked": None}, {"quest_type": "movement", "liked": True}
        ], [{"quest_type": "movement"}], "liked")
        self.assertEqual(status["rows"], 1)
        self.assertEqual(status["negative_labels"], 0)
        self.assertAlmostEqual(float(values[0]), 0.6, places=5)

    def test_model_failure_is_reported_as_baseline(self):
        rows = [{"quest_type": "movement", "completed": bool(i % 2)} for i in range(60)]
        with patch.object(service, "fitted_model", side_effect=RuntimeError("unavailable")):
            _, status = service.predict_probability(rows, [{"quest_type": "movement"}], "completed")
        self.assertEqual(status["mode"], "baseline")
        self.assertEqual(status["reason"], "model_failed")

    def test_validation_uses_earlier_rows_and_keeps_baseline_when_it_wins(self):
        rows = [{"quest_type": "movement", "completed": bool(i % 2), "minutes_available": i} for i in range(60)]
        with patch.object(service, "fitted_model", return_value=(object(), False)) as fit:
            with patch.object(service, "model_probabilities", return_value=np.zeros(12)):
                _, status = service.predict_probability(rows, [{"quest_type": "movement"}], "completed")
        self.assertEqual(fit.call_args.args[0], rows[:48])
        self.assertEqual(status["mode"], "baseline")
        self.assertFalse(status["evaluation"]["promoted"])

    def test_successful_validation_promotes_model_and_then_fits_all_history(self):
        rows = [{"quest_type": "movement", "completed": bool(i % 2)} for i in range(60)]
        labels = np.array([int(row["completed"]) for row in rows[-12:]])
        with patch.object(service, "fitted_model", return_value=(object(), True)) as fit:
            with patch.object(service, "model_probabilities", side_effect=[labels, np.array([0.8])]):
                values, status = service.predict_probability(rows, [{"quest_type": "movement"}], "completed")
        self.assertEqual(fit.call_args.args[0], rows)
        self.assertEqual(status["mode"], "tabpfn")
        self.assertEqual(values[0], 0.8)


if __name__ == "__main__":
    unittest.main()
