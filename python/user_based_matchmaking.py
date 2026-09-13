import json
import sys
from typing import List, Dict, Any, Optional
from ortools.sat.python import cp_model


def run_user_based_matchmaking(input_data: Dict[str, Any]) -> Dict[str, Any]:
    participants = input_data.get("participants", [])
    active_subject_ids = input_data.get("activeSubjectIds", [])
    settings = input_data.get("settings", {})

    team_size_min = int(settings.get("teamSizeMin", 3))
    team_size_max = int(settings.get("teamSizeMax", 5))
    max_teams_per_subject = settings.get("maxTeamsPerSubject")
    if max_teams_per_subject is not None:
        max_teams_per_subject = int(max_teams_per_subject)

    ignore_constraints = bool(settings.get("ignoreConstraints", False))
    constraints = settings.get("constraints", [])

    num_users = len(participants)
    num_subjects = len(active_subject_ids)

    # Edge case: not enough participants to form a single team
    if num_users < team_size_min or num_subjects == 0:
        return {
            "teams": [],
            "unassigned_user_ids": [u["id"] for u in participants],
        }

    # Theoretical maximum number of teams
    max_teams = num_users // team_size_min
    if max_teams_per_subject is not None and max_teams_per_subject > 0:
        max_teams = min(max_teams, num_subjects * max_teams_per_subject)

    if max_teams == 0:
        return {
            "teams": [],
            "unassigned_user_ids": [u["id"] for u in participants],
        }

    subject_to_idx = {subj_id: idx for idx, subj_id in enumerate(active_subject_ids)}

    model = cp_model.CpModel()

    # 1. Team used variable
    team_used = [model.NewBoolVar(f"team_used_{t}") for t in range(max_teams)]

    # Symmetry breaking: compact teams to the front
    for t in range(max_teams - 1):
        model.Add(team_used[t] >= team_used[t + 1])

    # 2. Team subject assignment
    team_subj = [
        [model.NewBoolVar(f"team_{t}_subj_{s}") for s in range(num_subjects)]
        for t in range(max_teams)
    ]

    for t in range(max_teams):
        # A used team has exactly 1 subject; an unused team has 0
        model.Add(sum(team_subj[t][s] for s in range(num_subjects)) == team_used[t])

    # Max teams per subject constraint
    if max_teams_per_subject is not None and max_teams_per_subject > 0:
        for s in range(num_subjects):
            model.Add(
                sum(team_subj[t][s] for t in range(max_teams)) <= max_teams_per_subject
            )

    # 3. User team assignment
    user_in_team = [
        [model.NewBoolVar(f"user_{u}_team_{t}") for t in range(max_teams)]
        for u in range(num_users)
    ]
    user_assigned = [model.NewBoolVar(f"user_assigned_{u}") for u in range(num_users)]

    for u in range(num_users):
        # Each user assigned to at most 1 team
        model.Add(sum(user_in_team[u][t] for t in range(max_teams)) == user_assigned[u])
        for t in range(max_teams):
            model.AddImplication(user_in_team[u][t], team_used[t])

    # 4. Team size bounds
    for t in range(max_teams):
        team_size = sum(user_in_team[u][t] for u in range(num_users))
        model.Add(team_size >= team_size_min).OnlyEnforceIf(team_used[t])
        model.Add(team_size <= team_size_max).OnlyEnforceIf(team_used[t])
        model.Add(team_size == 0).OnlyEnforceIf(team_used[t].Not())

    # 5. School Constraints
    if not ignore_constraints and constraints:
        for constraint in constraints:
            rule = constraint.get("rule")
            c_schools = set(constraint.get("schools", []))
            value = int(constraint.get("value", 0))
            multiple = bool(constraint.get("multiple", False))

            for t in range(max_teams):
                relevant_members = []
                for u_idx, u in enumerate(participants):
                    school = u.get("school") or ""
                    in_group = False
                    if multiple and school in c_schools:
                        in_group = True
                    elif not multiple and c_schools and school == list(c_schools)[0]:
                        in_group = True
                    if in_group:
                        relevant_members.append(user_in_team[u_idx][t])

                if relevant_members:
                    count_var = sum(relevant_members)
                    if rule == "MIN":
                        model.Add(count_var >= value).OnlyEnforceIf(team_used[t])
                    elif rule == "MAX":
                        model.Add(count_var <= value).OnlyEnforceIf(team_used[t])
                    elif rule == "EQUAL":
                        model.Add(count_var == value).OnlyEnforceIf(team_used[t])
                else:
                    if rule == "MIN" and value > 0:
                        model.Add(0 >= value).OnlyEnforceIf(team_used[t])
                    elif rule == "EQUAL" and value != 0:
                        model.Add(0 == value).OnlyEnforceIf(team_used[t])

    # 6. User preference satisfaction terms
    preference_terms = []
    for u_idx, u in enumerate(participants):
        prefs = u.get("favoriteSubjectIds") or []
        for rank, subj_id in enumerate(prefs):
            if subj_id in subject_to_idx:
                s_idx = subject_to_idx[subj_id]
                # Weights: 1st choice = 1000, 2nd choice = 200, 3rd choice = 50, ...
                weight = max(1, 1000 // (5 ** rank))
                for t in range(max_teams):
                    pair_b = model.NewBoolVar(f"u_{u_idx}_t_{t}_s_{s_idx}")
                    model.AddBoolAnd(
                        [user_in_team[u_idx][t], team_subj[t][s_idx]]
                    ).OnlyEnforceIf(pair_b)
                    model.AddImplication(pair_b, user_in_team[u_idx][t])
                    model.AddImplication(pair_b, team_subj[t][s_idx])
                    preference_terms.append(pair_b * weight)

    # 7. Objective Function
    # - Maximizing assigned users (highest priority: 100,000 per user)
    # - Maximizing preference satisfaction
    # - Small penalty to avoid creating unnecessary extra teams
    model.Maximize(
        sum(user_assigned) * 100000
        + sum(preference_terms)
        - sum(team_used) * 10
    )

    # 8. Solve
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 15.0
    solver.parameters.num_workers = 4
    status = solver.Solve(model)

    if status == cp_model.OPTIMAL or status == cp_model.FEASIBLE:
        assigned_ids = set()
        teams = []
        for t in range(max_teams):
            if solver.Value(team_used[t]):
                chosen_subject_id = None
                for s_idx, s_id in enumerate(active_subject_ids):
                    if solver.Value(team_subj[t][s_idx]):
                        chosen_subject_id = s_id
                        break

                members = []
                for u_idx, u in enumerate(participants):
                    if solver.Value(user_in_team[u_idx][t]):
                        members.append({
                            "user_id": u["id"],
                            "school": u.get("school"),
                        })
                        assigned_ids.add(u["id"])

                teams.append({
                    "team_id": t,
                    "subject_id": chosen_subject_id,
                    "members": members,
                })

        unassigned = [u["id"] for u in participants if u["id"] not in assigned_ids]
        return {
            "teams": teams,
            "unassigned_user_ids": unassigned,
        }
    else:
        return {
            "teams": [],
            "unassigned_user_ids": [u["id"] for u in participants],
        }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing input file argument"}))
        sys.exit(1)

    input_file_path = sys.argv[1]
    with open(input_file_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    result = run_user_based_matchmaking(data)
    output_json = json.dumps(result, ensure_ascii=False, indent=2)

    if len(sys.argv) > 2:
        output_file_path = sys.argv[2]
        with open(output_file_path, "w", encoding="utf-8") as f:
            f.write(output_json)

    print(output_json)


if __name__ == "__main__":
    main()
