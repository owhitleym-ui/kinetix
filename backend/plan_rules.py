"""Deterministic AI plan rules (Python port of web/planRules.js). Always works offline."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

DAY_MS = 86_400_000
RECENT = 3

EX_NAMES = {
    "squat": "Bodyweight Squat",
    "arm_abduction": "Shoulder Abduction",
    "shoulder_extension": "Shoulder Extension",
    "shoulder_abduction_full": "Shoulder Abduction AROM",
    "shoulder_adduction": "Shoulder Horizontal Adduction",
    "shoulder_external_rotation": "External Rotation at 90° Abduction",
    "shoulder_internal_rotation": "Internal Rotation at 90° Abduction",
    "arm_circles": "Shoulder Circumduction",
}

CLINICAL = {
    "ERR_KNEES_INSIDE": "Knee valgus",
    "ERR_TORSO_TO_SIDE": "Lateral trunk lean",
    "ERR_SHALLOW_SQUAT": "Insufficient squat depth",
    "ERR_KNEES_FORWARD": "Excessive forward knee travel",
    "ERR_LIFTED_HEELS": "Heel rise",
    "ERR_ARM_FORWARD": "Forward arm drift",
    "ERR_ELEVATED_SHOULDER": "Scapular elevation (shrug)",
    "ERR_HEAD_TO_SIDE": "Lateral head tilt",
    "ERR_LOW_ABDUCTION": "Limited abduction range",
    "ERR_BENT_ARM": "Elbow not fully extended",
    "ERR_TORSO_FORWARD": "Forward trunk lean",
    "ERR_TORSO_ROTATION": "Trunk rotation",
    "ERR_ARM_TO_SIDE": "Arm drifting into abduction",
    "ERR_TRUNK_LEAN": "Lateral trunk lean",
    "ERR_LOW_RAISE": "Limited elevation range",
    "ERR_BENT_ELBOW": "Elbow not fully extended",
    "ERR_NOT_ACROSS": "Limited horizontal adduction",
    "ERR_LOW_ROTATION": "Limited rotation range",
    "ERR_ELBOW_ANGLE": "Elbow angle off 90°",
    "ERR_ELBOW_DROP": "Elbow dropping below shoulder",
    "ERR_ELBOW_HIGH": "Elbow above shoulder",
    "ERR_SMALL_CIRCLE": "Small circumduction arc",
    "TOO_FAST": "Moving too fast",
}

PLAIN_CUE = {
    "ERR_KNEES_INSIDE": "Push your knees out",
    "ERR_KNEES_FORWARD": "Sit back into your hips",
    "ERR_LIFTED_HEELS": "Keep your heels down",
    "ERR_SHALLOW_SQUAT": "Go a little lower",
    "ERR_TORSO_TO_SIDE": "Keep your body straight",
    "ERR_TRUNK_LEAN": "Keep your body straight",
    "ERR_ARM_FORWARD": "Lift out to the side",
    "ERR_BENT_ARM": "Keep your elbow straight",
    "ERR_BENT_ELBOW": "Keep your elbow straight",
    "ERR_ELEVATED_SHOULDER": "Keep your shoulder down",
    "ERR_HEAD_TO_SIDE": "Keep your head straight",
    "ERR_LOW_ABDUCTION": "Lift a little higher",
    "ERR_LOW_RAISE": "Lift a little higher",
    "ERR_ARM_TO_SIDE": "Move straight back",
    "ERR_TORSO_FORWARD": "Keep your chest up",
    "ERR_TORSO_ROTATION": "Keep your chest facing forward",
    "ERR_NOT_ACROSS": "Reach further across",
    "ERR_LOW_ROTATION": "Rotate a little further",
    "ERR_ELBOW_ANGLE": "Keep a right angle at your elbow",
    "ERR_ELBOW_DROP": "Keep your elbow up",
    "ERR_ELBOW_HIGH": "Lower your elbow a little",
    "ERR_SMALL_CIRCLE": "Make bigger circles",
    "TOO_FAST": "Slow down",
}


def _ex_name(ex: str) -> str:
    return EX_NAMES.get(ex, ex)


def _clinical(code: str, fallback: str = "") -> str:
    return CLINICAL.get(code) or fallback or code.replace("ERR_", "").replace("_", " ").lower()


def _plain_cue(code: str) -> str:
    return PLAIN_CUE.get(code, "Move slowly and with control")


def _alert_at(settings: dict[str, Any] | None) -> int:
    return int((settings or {}).get("painLimit", 4)) + 1


def _pct(good: float, done: float) -> float:
    return good / done if done else 0.0


def _avg(vals: list[float]) -> float:
    return sum(vals) / len(vals) if vals else 0.0


def _parse_ms(iso: str | None) -> float | None:
    if not iso:
        return None
    try:
        s = iso.replace("Z", "+00:00")
        return datetime.fromisoformat(s).timestamp() * 1000
    except Exception:  # noqa: BLE001
        return None


def _days_since(iso_date: str, now_ms: float) -> int:
    try:
        then = datetime.fromisoformat(iso_date.replace("Z", "+00:00"))
        now = datetime.fromtimestamp(now_ms / 1000, tz=timezone.utc)
        then_d = then.astimezone(timezone.utc).date()
        now_d = now.date()
        return (now_d - then_d).days
    except Exception:  # noqa: BLE001
        return 0


def _session_good(s: dict[str, Any]) -> float:
    exs = s.get("exercises") or []
    good = sum(int(e.get("good") or 0) for e in exs)
    done = sum(int(e.get("done") or 0) for e in exs)
    return _pct(good, done)


def _ex_good(s: dict[str, Any], ex: str) -> float | None:
    e = next((x for x in (s.get("exercises") or []) if x.get("ex") == ex), None)
    if not e or not e.get("done"):
        return None
    return e["good"] / e["done"]


def recent_mistakes(sessions: list[dict[str, Any]], n: int = RECENT) -> list[dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for s in sessions[-n:]:
        for e in s.get("exercises") or []:
            for m in e.get("mistakes") or []:
                code = m.get("code") or ""
                k = f"{e.get('ex')}|{code}"
                if k not in out:
                    out[k] = {
                        "code": code,
                        "title": _clinical(code, m.get("title") or ""),
                        "ex": e.get("ex"),
                        "n": 0,
                    }
                out[k]["n"] += int(m.get("n") or 0)
    return sorted(out.values(), key=lambda x: -x["n"])


def draft_message(
    suggestions: list[dict[str, Any]],
    since_last: dict[str, Any],
    alert_at: int,
) -> str:
    parts = [
        "Great consistency this week!"
        if since_last.get("sessions", 0) >= (since_last.get("expected") or 1) * 0.8
        else "Thanks for keeping up with your exercises."
    ]
    for s in suggestions:
        name = _ex_name(s.get("ex") or "").lower()
        if s.get("kind") == "keep":
            cue = (s.get("to") or {}).get("cue") or ""
            parts.append(
                f"Your {name} form looks solid. {cue[:1].upper()}{cue[1:]} as you go."
                if cue
                else f"Your {name} form looks solid."
            )
        elif s.get("kind") == "add":
            parts.append(f"I’ve added {name} to warm your shoulder up first.")
        elif s.get("progress"):
            parts.append(f"You’re ready for a little more on {name}.")
        else:
            parts.append(f"Let’s slow down {name} and do fewer reps while it’s sore.")
    parts.append(f"Message me if pain goes above {alert_at}.")
    return " ".join(parts)


def run_rules(
    *,
    plan: dict[str, Any] | None,
    sessions: list[dict[str, Any]] | None,
    settings: dict[str, Any] | None,
    patient_first: str = "",
    now_ms: float | None = None,
) -> dict[str, Any]:
    """Same contract as web/planRules.js `runRules`."""
    now = now_ms if now_ms is not None else datetime.now(tz=timezone.utc).timestamp() * 1000
    S = settings or {}
    L = int(S.get("painLimit", 4))
    A = _alert_at(S)
    items = list((plan or {}).get("items") or [])
    since = list(sessions or [])
    pains = [s.get("checkin", {}).get("pain") for s in since if (s.get("checkin") or {}).get("pain") is not None]
    last2 = pains[-2:]
    efforts = [s.get("checkin", {}).get("effort") for s in since if (s.get("checkin") or {}).get("effort")]
    suggestions: list[dict[str, Any]] = []
    last_at = since[-1].get("startedAt") if since else None
    missed = (_days_since(last_at, now) - 1) if last_at else 99
    created = _parse_ms((plan or {}).get("createdAt"))
    days_on_plan = max(1, (now - created) / DAY_MS) if created else 7
    expected = max(len(since), round(days_on_plan / 7 * 5))
    done_good = sum(sum(int(e.get("good") or 0) for e in (s.get("exercises") or [])) for s in since)
    done_all = sum(sum(int(e.get("done") or 0) for e in (s.get("exercises") or [])) for s in since)
    since_last = {
        "sessions": len(since),
        "expected": expected,
        "goodPct": round(100 * _pct(done_good, done_all)),
        "pain": pains[-1] if pains else None,
        "painFrom": min(pains[: max(1, len(pains) - 2)]) if pains else None,
        "effort": efforts[-1] if efforts else None,
        "checkins": sum(1 for s in since if s.get("checkin")),
    }

    if not since or len(since) < 5:
        return {
            "suggestions": [],
            "since_last_plan": since_last,
            "patient_message": "",
            "source": "local",
            "reason": "not_enough_data",
        }

    if missed >= int(S.get("missedDays", 3)):
        return {
            "suggestions": [],
            "since_last_plan": since_last,
            "source": "local",
            "reason": "missed",
            "patient_message": (
                f"Hi {patient_first}, I noticed you haven’t practised for {missed} days. "
                "Is everything okay? Let me know how your body is feeling and we’ll adjust if we need to."
            ),
        }

    pain_high = bool(last2) and max(last2) > L
    pain_rising = len(pains) >= 3 and pains[-1] > pains[0] + 1
    mistakes = recent_mistakes(since)

    def ex_mistakes(ex: str) -> list[dict[str, Any]]:
        return [m for m in mistakes if m.get("ex") == ex]

    def drop(ex: str) -> float:
        vals = [v for v in (_ex_good(s, ex) for s in since) if v is not None]
        if len(vals) < 4:
            return 0.0
        half = (len(vals) + 1) // 2
        return _avg(vals[:half]) - _avg(vals[-RECENT:])

    painful = None
    if pain_high and items:
        painful = sorted(
            items,
            key=lambda it: (
                -drop(it.get("ex")),
                -sum(m["n"] for m in ex_mistakes(it.get("ex"))),
            ),
        )[0].get("ex")

    for it in items:
        ex = it.get("ex")
        ms = ex_mistakes(ex)
        total = sum(m["n"] for m in ms)
        recent_good = [
            e
            for s in since[-5:]
            for e in [next((x for x in (s.get("exercises") or []) if x.get("ex") == ex), None)]
            if e
        ]
        good5 = _pct(
            sum(int(e.get("good") or 0) for e in recent_good),
            sum(int(e.get("done") or 0) for e in recent_good),
        )

        if pain_high and ex == painful:
            to = {
                **it,
                "sets": max(1, int(it.get("sets") or 1) - 1),
                "reps": max(5, int(it.get("reps") or 10) - 2),
                "tempo": "slow",
            }
            why = [
                f"Pain rose from {since_last['painFrom']} to {since_last['pain']} "
                f"over the last {min(len(pains), 4)} sessions (your limit is {L}/10)."
            ]
            if ms:
                bits = []
                for i, m in enumerate(ms[:2]):
                    title = m["title"] if i == 0 else m["title"].lower()
                    bits.append(f"{title} on {m['n']} reps")
                why.append(" and ".join(bits) + f" in the last {RECENT} sessions.")
            d = drop(ex)
            if d > 0.05:
                why.append(f"Good reps fell by {round(d * 100)} points.")
            suggestions.append(
                {"id": f"adj-{ex}", "kind": "adjust", "ex": ex, "from": it, "to": to, "why": why}
            )
            continue

        dominant = None
        if ms and total >= 5 and ms[0]["n"] / total >= 0.45 and ms[0]["n"] >= 5:
            dominant = ms[0]

        if (
            not pain_high
            and not pain_rising
            and good5 >= 0.85
            and last2
            and max(last2) <= 2
            and "too_hard" not in efforts[-2:]
            and len(recent_good) >= 5
        ):
            reps = int(it.get("reps") or 10)
            sets = int(it.get("sets") or 1)
            to = {**it, "reps": reps + 2} if reps + 2 <= 15 else {**it, "sets": min(4, sets + 1)}
            effort = (efforts[-1] if efforts else "just_right") or "just_right"
            suggestions.append(
                {
                    "id": f"adj-{ex}",
                    "kind": "adjust",
                    "progress": True,
                    "ex": ex,
                    "from": it,
                    "to": to,
                    "why": [
                        f"{round(good5 * 100)}% good reps over the last 5 sessions.",
                        f"Pain {max(last2)}/10 or lower and effort “{str(effort).replace('_', ' ')}”.",
                        f"Within your weekly cap ({S.get('weeklyCap') or '+2 reps or +1 set'}).",
                    ],
                }
            )
            continue

        if dominant and (pain_high or not pain_rising):
            cue = _plain_cue(dominant["code"])
            if it.get("cue") == cue:
                continue
            why = [
                f"Good reps down to {round(good5 * 100)}% over the last 5 sessions."
                if drop(ex) > 0.05
                else f"Form steady at {round(good5 * 100)}% good reps.",
                f"Most common error is {dominant['title'].lower()} ({dominant['n']} reps), "
                "so add a cue rather than more load.",
            ]
            suggestions.append(
                {
                    "id": f"keep-{ex}",
                    "kind": "keep",
                    "ex": ex,
                    "from": it,
                    "to": {**it, "cue": cue},
                    "why": why,
                }
            )

    tight = [
        s
        for s in since
        if re.search(r"tight|stiff", (s.get("checkin") or {}).get("note") or "", re.I)
    ]
    if len(tight) >= 2 and not any(i.get("ex") == "arm_circles" for i in items):
        note = ((tight[-1].get("checkin") or {}).get("note") or "").lower()
        suggestions.append(
            {
                "id": "add-arm_circles",
                "kind": "add",
                "ex": "arm_circles",
                "from": None,
                "warmup": True,
                "to": {
                    "ex": "arm_circles",
                    "sets": 1,
                    "reps": 10,
                    "tempo": "slow",
                    "cue": "Gentle circles to warm up",
                },
                "why": [
                    f'Patient noted “{note}” {len(tight)} times.',
                    "Gentle shoulder circles before the main exercises, within the available exercise list.",
                ],
            }
        )

    order = {"adjust": 0, "keep": 1, "add": 2}
    suggestions.sort(key=lambda s: order.get(s.get("kind"), 9))
    return {
        "suggestions": suggestions,
        "since_last_plan": since_last,
        "patient_message": draft_message(suggestions, since_last, A),
        "source": "local",
    }
