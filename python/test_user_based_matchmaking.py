import unittest
from user_based_matchmaking import run_user_based_matchmaking


class TestUserBasedMatchmaking(unittest.TestCase):
    def setUp(self):
        self.subjects = ["subject-1", "subject-2", "subject-3", "subject-4", "subject-5"]

    def test_diagram_scenario_8_red_1_green(self):
        """
        8 red on Subject 1, 1 green on Subject 2.
        teamSizeMin = 3, teamSizeMax = 4.
        Result: exactly 3 teams of 3, all on Subject 1, green user integrated!
        """
        participants = [
            {"id": f"red-{i+1}", "school": "School A", "favoriteSubjectIds": ["subject-1"]}
            for i in range(8)
        ] + [
            {"id": "green-1", "school": "School B", "favoriteSubjectIds": ["subject-2"]}
        ]

        data = {
            "participants": participants,
            "activeSubjectIds": self.subjects,
            "settings": {
                "teamSizeMin": 3,
                "teamSizeMax": 4,
            }
        }

        result = run_user_based_matchmaking(data)
        teams = result["teams"]

        self.assertEqual(len(teams), 3)
        self.assertEqual(len(result["unassigned_user_ids"]), 0)

        all_assigned = []
        for t in teams:
            self.assertGreaterEqual(len(t["members"]), 3)
            self.assertLessEqual(len(t["members"]), 4)
            self.assertEqual(t["subject_id"], "subject-1")
            for m in t["members"]:
                all_assigned.append(m["user_id"])

        self.assertEqual(len(all_assigned), 9)
        self.assertIn("green-1", all_assigned)

    def test_school_min_constraint(self):
        """
        Every team must have at least 1 student from School A.
        """
        participants = [
            {"id": "a-1", "school": "School A", "favoriteSubjectIds": ["subject-1"]},
            {"id": "a-2", "school": "School A", "favoriteSubjectIds": ["subject-1"]},
            {"id": "b-1", "school": "School B", "favoriteSubjectIds": ["subject-1"]},
            {"id": "b-2", "school": "School B", "favoriteSubjectIds": ["subject-1"]},
            {"id": "b-3", "school": "School B", "favoriteSubjectIds": ["subject-1"]},
            {"id": "b-4", "school": "School B", "favoriteSubjectIds": ["subject-1"]},
        ]

        data = {
            "participants": participants,
            "activeSubjectIds": self.subjects,
            "settings": {
                "teamSizeMin": 3,
                "teamSizeMax": 3,
                "constraints": [
                    {
                        "rule": "MIN",
                        "schools": ["School A"],
                        "value": 1,
                        "multiple": False,
                    }
                ]
            }
        }

        result = run_user_based_matchmaking(data)
        teams = result["teams"]

        self.assertEqual(len(teams), 2)
        self.assertEqual(len(result["unassigned_user_ids"]), 0)

        for t in teams:
            school_a_count = sum(1 for m in t["members"] if m["school"] == "School A")
            self.assertGreaterEqual(school_a_count, 1)

    def test_school_max_constraint(self):
        """
        No team can have more than 1 student from School A.
        """
        participants = [
            {"id": "a-1", "school": "School A", "favoriteSubjectIds": ["subject-1"]},
            {"id": "a-2", "school": "School A", "favoriteSubjectIds": ["subject-1"]},
            {"id": "b-1", "school": "School B", "favoriteSubjectIds": ["subject-1"]},
            {"id": "b-2", "school": "School B", "favoriteSubjectIds": ["subject-1"]},
            {"id": "b-3", "school": "School B", "favoriteSubjectIds": ["subject-1"]},
            {"id": "b-4", "school": "School B", "favoriteSubjectIds": ["subject-1"]},
        ]

        data = {
            "participants": participants,
            "activeSubjectIds": self.subjects,
            "settings": {
                "teamSizeMin": 3,
                "teamSizeMax": 3,
                "constraints": [
                    {
                        "rule": "MAX",
                        "schools": ["School A"],
                        "value": 1,
                        "multiple": False,
                    }
                ]
            }
        }

        result = run_user_based_matchmaking(data)
        teams = result["teams"]

        self.assertEqual(len(teams), 2)
        for t in teams:
            school_a_count = sum(1 for m in t["members"] if m["school"] == "School A")
            self.assertLessEqual(school_a_count, 1)

    def test_school_equal_constraint(self):
        """
        Every team must have exactly 1 student from School A.
        """
        participants = [
            {"id": "a-1", "school": "School A", "favoriteSubjectIds": ["subject-1"]},
            {"id": "a-2", "school": "School A", "favoriteSubjectIds": ["subject-1"]},
            {"id": "b-1", "school": "School B", "favoriteSubjectIds": ["subject-1"]},
            {"id": "b-2", "school": "School B", "favoriteSubjectIds": ["subject-1"]},
            {"id": "b-3", "school": "School B", "favoriteSubjectIds": ["subject-1"]},
            {"id": "b-4", "school": "School B", "favoriteSubjectIds": ["subject-1"]},
        ]

        data = {
            "participants": participants,
            "activeSubjectIds": self.subjects,
            "settings": {
                "teamSizeMin": 3,
                "teamSizeMax": 3,
                "constraints": [
                    {
                        "rule": "EQUAL",
                        "schools": ["School A"],
                        "value": 1,
                        "multiple": False,
                    }
                ]
            }
        }

        result = run_user_based_matchmaking(data)
        teams = result["teams"]

        self.assertEqual(len(teams), 2)
        for t in teams:
            school_a_count = sum(1 for m in t["members"] if m["school"] == "School A")
            self.assertEqual(school_a_count, 1)

    def test_preference_cascading(self):
        """
        Participants unable to form a team on 1st choice cascade to 2nd choice.
        """
        participants = [
            {"id": "u1", "school": "S1", "favoriteSubjectIds": ["subject-2", "subject-3"]},
            {"id": "u2", "school": "S1", "favoriteSubjectIds": ["subject-2", "subject-3"]},
            {"id": "u3", "school": "S2", "favoriteSubjectIds": ["subject-3", "subject-2"]},
            {"id": "u4", "school": "S2", "favoriteSubjectIds": ["subject-3", "subject-2"]},
        ]

        data = {
            "participants": participants,
            "activeSubjectIds": self.subjects,
            "settings": {
                "teamSizeMin": 3,
                "teamSizeMax": 4,
            }
        }

        result = run_user_based_matchmaking(data)
        teams = result["teams"]

        self.assertEqual(len(teams), 1)
        self.assertEqual(len(result["unassigned_user_ids"]), 0)
        self.assertEqual(len(teams[0]["members"]), 4)
        self.assertIn(teams[0]["subject_id"], ["subject-2", "subject-3"])

    def test_realistic_40_participants(self):
        """
        40 participants, 5 subjects, min 3 max 5, max teams per subject = 3, school constraints.
        """
        participants = []
        for i in range(40):
            p1 = self.subjects[i % 5]
            p2 = self.subjects[(i + 1) % 5]
            p3 = self.subjects[(i + 2) % 5]
            school = f"School-{(i % 4) + 1}"
            participants.append({
                "id": f"student-{i+1}",
                "school": school,
                "favoriteSubjectIds": [p1, p2, p3]
            })

        data = {
            "participants": participants,
            "activeSubjectIds": self.subjects,
            "settings": {
                "teamSizeMin": 3,
                "teamSizeMax": 5,
                "maxTeamsPerSubject": 3,
            }
        }

        result = run_user_based_matchmaking(data)
        teams = result["teams"]

        self.assertEqual(len(result["unassigned_user_ids"]), 0)
        all_members = [m["user_id"] for t in teams for m in t["members"]]
        self.assertEqual(len(all_members), 40)
        self.assertEqual(len(set(all_members)), 40)

        for t in teams:
            self.assertGreaterEqual(len(t["members"]), 3)
            self.assertLessEqual(len(t["members"]), 5)
            self.assertIn(t["subject_id"], self.subjects)

        # Verify maxTeamsPerSubject
        counts = {}
        for t in teams:
            s = t["subject_id"]
            counts[s] = counts.get(s, 0) + 1
            self.assertLessEqual(counts[s], 3)


if __name__ == "__main__":
    unittest.main()
