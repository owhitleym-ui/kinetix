"""OCI Generative AI chat client with deterministic local fallbacks."""
from __future__ import annotations

import json
import os
import re
from typing import Any

from dotenv import load_dotenv

load_dotenv()

_MAX_CUE_WORDS = 10


def _configured() -> bool:
    return bool(os.getenv("OCI_GENAI_COMPARTMENT_ID") or os.getenv("OCI_GENAI_ENDPOINT"))


def _truncate_words(text: str, n: int = _MAX_CUE_WORDS) -> str:
    words = re.findall(r"\S+", (text or "").strip())
    if not words:
        return ""
    out = " ".join(words[:n])
    return out.rstrip(".,;:") + ("." if not out.endswith((".", "!", "?")) else "")


def local_cue(payload: dict[str, Any]) -> str:
    if payload.get("good"):
        return "Good form. Keep going."
    short = (payload.get("short") or payload.get("label") or "Fix your form").strip()
    return _truncate_words(short)


def _has_phrase(msg: str, *phrases: str) -> bool:
    return any(p in msg for p in phrases)


def _has_word(msg: str, *words: str) -> bool:
    return any(re.search(rf"\b{re.escape(w)}\b", msg) for w in words)


def local_chat(message: str, session_context: dict[str, Any] | None) -> str:
    ctx = session_context or {}
    msg = (message or "").lower().strip()
    reps_done = int(ctx.get("reps_done") or 0)
    reps_target = int(ctx.get("reps_target") or 0)
    reps_left = max(0, reps_target - reps_done)
    last = ctx.get("last_rep") or {}
    tallies = ctx.get("tallies") or {}

    # Last-rep / mistake questions first (before any "left" matching).
    if _has_phrase(
        msg,
        "last rep",
        "what was wrong",
        "what went wrong",
        "what happened",
        "why was",
        "my form",
        "fix tip",
        "fix cue",
        "fix check",
    ) or _has_word(msg, "wrong", "mistake", "mistakes", "issue", "problem", "fix"):
        if not last:
            return "No counted rep yet — finish one, then ask again."
        if last.get("good"):
            return "Your last rep looked good. Keep that depth and control."
        label = last.get("title") or last.get("label") or "a form issue"
        tip = last.get("cue") or last.get("short") or ""
        if tip:
            return f"Last rep: {label}. {tip}"
        return f"Last rep had: {label}."

    # Progress / score
    if _has_phrase(msg, "how am i", "how am i doing", "how am i doin") or _has_word(
        msg, "summary", "progress", "score", "tally", "stats"
    ):
        good = tallies.get("good", 0)
        bad = tallies.get("bad", 0)
        skip = tallies.get("skip", 0)
        return f"{good} good, {bad} to fix" + (f", {skip} not counted." if skip else ".")

    # Reps remaining — specific phrases only (never bare "left", which matched too much).
    if (
        _has_phrase(msg, "how many left", "how many more", "reps left", "reps remaining", "how many reps")
        or (_has_word(msg, "remaining", "left") and _has_word(msg, "rep", "reps"))
        or (_has_phrase(msg, "how many") and _has_word(msg, "rep", "reps", "more"))
    ):
        if reps_target:
            return f"You have {reps_left} of {reps_target} left."
        return f"You've done {reps_done} reps so far."

    # Default: useful from context, not always "reps left".
    if last and not last.get("good"):
        tip = last.get("cue") or last.get("short") or last.get("title") or "focus on form"
        return f"Focus on: {tip}"
    if last and last.get("good"):
        if reps_target:
            return f"Nice form on that last rep. {reps_left} left."
        return "Nice form on that last rep. Keep going."
    if reps_target and reps_done:
        return f"{reps_done} done, {reps_left} left. Ask about your last mistake anytime."
    return "Start a few reps, then ask about your last rep or how many are left."


def local_summary(session_context: dict[str, Any] | None) -> dict[str, Any]:
    """Detailed patient-facing summary used when OCI GenAI is unavailable."""
    ctx = session_context or {}
    exercise = ctx.get("exercise_title") or ctx.get("exercise") or "your exercise"
    tallies = ctx.get("tallies") or {}
    good = int(tallies.get("good") or 0)
    bad = int(tallies.get("bad") or 0)
    skip = int(tallies.get("skip") or 0)
    target = int(ctx.get("reps_target") or 0)
    done = int(ctx.get("reps_done") or (good + bad))
    reps = ctx.get("reps") or []
    mistake_counts: dict[str, int] = {}
    for r in reps:
        if r.get("good"):
            continue
        key = r.get("title") or r.get("label") or "Form issue"
        mistake_counts[key] = mistake_counts.get(key, 0) + 1
    top = sorted(mistake_counts.items(), key=lambda x: -x[1])[:3]
    accuracy = round(100 * good / done) if done else 0

    summary = (
        f"Patient completed {done} of {target or done} counted reps of {exercise}. "
        f"Form quality: {good} good ({accuracy}%), {bad} with corrections"
        + (f", {skip} not counted" if skip else "")
        + "."
    )
    if top:
        parts = [f"{n} ({c}×)" for n, c in top]
        summary += f" Primary form issues this session: {', '.join(parts)}."
    else:
        summary += " No recurring form issues detected — solid consistency."

    tips: list[str] = []
    for title, _ in top:
        cue = next(
            (
                r.get("cue")
                for r in reversed(reps)
                if (r.get("title") or r.get("label")) == title and r.get("cue")
            ),
            None,
        )
        tips.append(cue or f"Focus on correcting: {title}.")
    if not tips:
        tips = [
            "Keep the same depth and tempo.",
            "Stay facing the camera for reliable tracking.",
            "Reset fully between reps.",
        ]

    spoken = (
        f"Session complete. You finished {done} of {target or done} {exercise} reps. "
        f"{good} looked good"
        + (f", and {bad} need some work" if bad else "")
        + "."
    )
    if top:
        spoken += f" Focus next time on: {', '.join(n for n, _ in top)}."
    else:
        spoken += " Great consistency — keep that form going."

    return {
        "summary": summary,
        "tips": tips[:5],
        "spoken_summary": spoken,
        "highlights": {
            "exercise": exercise,
            "reps_done": done,
            "reps_target": target,
            "good": good,
            "bad": bad,
            "skip": skip,
            "accuracy_pct": accuracy,
            "top_issues": [{"name": n, "count": c} for n, c in top],
        },
    }


def _chat_oci(system: str, user: str, max_tokens: int = 256) -> str | None:
    if not _configured():
        return None
    try:
        import oci
        from oci.generative_ai_inference import GenerativeAiInferenceClient
        from oci.generative_ai_inference.models import (
            ChatDetails,
            CohereChatRequest,
            GenericChatRequest,
            Message,
            OnDemandServingMode,
            TextContent,
        )
    except Exception as e:  # noqa: BLE001
        print(f"[oci_genai] SDK unavailable: {e}")
        return None

    compartment = os.getenv("OCI_GENAI_COMPARTMENT_ID", "")
    model_id = os.getenv("OCI_GENAI_MODEL_ID", "")
    endpoint = os.getenv("OCI_GENAI_ENDPOINT")
    region = os.getenv("OCI_REGION", "us-chicago-1")
    config_file = os.getenv("OCI_CONFIG_FILE") or oci.config.DEFAULT_LOCATION
    profile = os.getenv("OCI_CONFIG_PROFILE", "DEFAULT")

    try:
        config = oci.config.from_file(config_file, profile)
        if region:
            config["region"] = region
        client_kwargs: dict[str, Any] = {"config": config}
        if endpoint:
            client_kwargs["service_endpoint"] = endpoint
        elif region:
            client_kwargs["service_endpoint"] = f"https://inference.generativeai.{region}.oci.oraclecloud.com"
        client = GenerativeAiInferenceClient(**client_kwargs)

        serving = OnDemandServingMode(model_id=model_id) if model_id else None
        # Prefer GenericChatRequest (Llama / OpenAI-compatible); fall back to Cohere shape.
        try:
            content = TextContent(text=f"{system}\n\n{user}")
            message = Message(role="USER", content=[content])
            chat_request = GenericChatRequest(
                messages=[message], max_tokens=max_tokens, temperature=0.2
            )
            details = ChatDetails(compartment_id=compartment, serving_mode=serving, chat_request=chat_request)
            resp = client.chat(details)
            data = resp.data
            # Generic response shapes vary by model; dig for text.
            text = _extract_text(data)
            if text:
                return text.strip()
        except Exception as e:  # noqa: BLE001
            print(f"[oci_genai] GenericChatRequest failed, trying Cohere: {e}")

        chat_request = CohereChatRequest(
            message=user,
            preamble_override=system,
            max_tokens=max_tokens,
            temperature=0.2,
            is_stream=False,
        )
        details = ChatDetails(compartment_id=compartment, serving_mode=serving, chat_request=chat_request)
        resp = client.chat(details)
        text = getattr(resp.data, "chat_response", None)
        if text is not None and hasattr(text, "text"):
            return (text.text or "").strip()
        return _extract_text(resp.data)
    except Exception as e:  # noqa: BLE001
        print(f"[oci_genai] chat failed: {e}")
        return None


def _extract_text(data: Any) -> str | None:
    if data is None:
        return None
    if isinstance(data, str):
        return data
    for attr in ("text", "content"):
        v = getattr(data, attr, None)
        if isinstance(v, str) and v.strip():
            return v
    chat = getattr(data, "chat_response", None) or getattr(data, "chatResponse", None)
    if chat is not None:
        t = _extract_text(chat)
        if t:
            return t
    choices = getattr(data, "choices", None)
    if choices:
        first = choices[0]
        msg = getattr(first, "message", None)
        if msg is not None:
            content = getattr(msg, "content", None)
            if isinstance(content, list) and content:
                part = content[0]
                text = getattr(part, "text", None)
                if text:
                    return text
            if isinstance(content, str):
                return content
    return None


def generate_cue(payload: dict[str, Any]) -> tuple[str, str]:
    """Return (text, source) where source is 'oci' or 'local'."""
    fallback = local_cue(payload)
    system = (
        "You are a concise physical therapy coach. Reply with ONE short spoken cue only. "
        f"Hard limit: {_MAX_CUE_WORDS} words. No markdown, no quotes, no numbering."
    )
    user = (
        f"Exercise: {payload.get('exercise')}\n"
        f"Rep: {payload.get('rep')} of {payload.get('reps_target')}\n"
        f"Good form: {payload.get('good')}\n"
        f"Label: {payload.get('label')}\n"
        f"Short: {payload.get('short')}\n"
        f"Fix cue: {payload.get('cue')}\n"
        "Write the spoken cue now."
    )
    text = _chat_oci(system, user)
    if text:
        return _truncate_words(text), "oci"
    return fallback, "local"


def generate_chat(
    message: str,
    history: list[dict[str, str]] | None,
    session_context: dict[str, Any] | None,
) -> tuple[str, str]:
    fallback = local_chat(message, session_context)
    ctx_json = json.dumps(session_context or {}, ensure_ascii=False)[:4000]
    hist = history or []
    hist_lines = "\n".join(f"{h.get('role', 'user')}: {h.get('content', '')}" for h in hist[-6:])
    system = (
        "You are Kinetix's PT coach. Answer ONLY using the session_context JSON. "
        "If the answer is not in the context, say you don't have that yet. "
        "Be brief (1-3 short sentences). Do not invent joint angles or diagnoses."
    )
    user = f"session_context:\n{ctx_json}\n\nrecent_chat:\n{hist_lines}\n\nuser: {message}"
    text = _chat_oci(system, user)
    if text:
        return text.strip(), "oci"
    return fallback, "local"


def generate_summary(session_context: dict[str, Any] | None) -> tuple[dict[str, Any], str]:
    """Detailed patient session report for the UI + a shorter spoken_summary for TTS."""
    fallback = local_summary(session_context)
    ctx_json = json.dumps(session_context or {}, ensure_ascii=False)[:8000]
    system = (
        "You are an experienced physical therapist writing a post-session patient report "
        "for home exercise (Kinetix app). Use ONLY the session_context JSON — do not invent "
        "diagnoses, medications, or data that is not present. "
        "Return strict JSON only (no markdown) with these keys:\n"
        "- summary: string, 4-7 sentences for the patient to read. Cover: what exercise, "
        "how many reps completed vs target, good vs needs-work counts, which form issues "
        "showed up most, what improved or stayed solid, and one encouraging close.\n"
        "- tips: array of 4-6 actionable coaching tips for the next session "
        "(specific to the mistakes seen).\n"
        "- spoken_summary: string, 3-5 short spoken sentences starting with "
        "'Session complete.' Suitable for text-to-speech (warm, clear, no bullets).\n"
        "- focus_areas: array of 1-3 short labels of the top form issues to practice."
    )
    user = (
        "Write the patient session report from this data.\n"
        f"session_context:\n{ctx_json}"
    )
    text = _chat_oci(system, user, max_tokens=900)
    if text:
        try:
            cleaned = text.strip()
            if cleaned.startswith("```"):
                cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
                cleaned = re.sub(r"\s*```$", "", cleaned)
            data = json.loads(cleaned)
            summary = str(data.get("summary") or fallback["summary"]).strip()
            tips = data.get("tips") or fallback["tips"]
            if not isinstance(tips, list):
                tips = fallback["tips"]
            tips = [str(t).strip() for t in tips if str(t).strip()][:6]
            spoken = str(data.get("spoken_summary") or fallback.get("spoken_summary") or summary).strip()
            if not spoken.lower().startswith("session complete"):
                spoken = f"Session complete. {spoken}"
            focus = data.get("focus_areas") or [
                x["name"] for x in (fallback.get("highlights") or {}).get("top_issues") or []
            ]
            if not isinstance(focus, list):
                focus = []
            focus = [str(f).strip() for f in focus if str(f).strip()][:3]
            return {
                "summary": summary,
                "tips": tips or fallback["tips"],
                "spoken_summary": spoken,
                "focus_areas": focus,
                "highlights": fallback.get("highlights"),
            }, "oci"
        except Exception as e:  # noqa: BLE001
            print(f"[oci_genai] summary JSON parse failed: {e}")
    return fallback, "local"


def generate_plan_phrasing(rules_result: dict[str, Any]) -> tuple[dict[str, Any], str]:
    """
    Keep deterministic rule suggestions; use OCI GenAI only to polish
    each suggestion's `why[]` and the patient_message (PT report wording).
    """
    out = dict(rules_result)
    suggestions = [dict(s) for s in (rules_result.get("suggestions") or [])]
    out["suggestions"] = suggestions
    if not _configured():
        out["source"] = "local"
        return out, "local"

    compact = {
        "since_last_plan": rules_result.get("since_last_plan"),
        "reason": rules_result.get("reason"),
        "patient_message": rules_result.get("patient_message"),
        "suggestions": [
            {
                "id": s.get("id"),
                "kind": s.get("kind"),
                "progress": s.get("progress"),
                "ex": s.get("ex"),
                "from": s.get("from"),
                "to": s.get("to"),
                "why": s.get("why"),
            }
            for s in suggestions
        ],
    }
    system = (
        "You are an experienced physical therapist writing short clinical rationale "
        "and a patient-facing message for a home-exercise plan review (Kinetix). "
        "Use ONLY the JSON provided — do not invent new exercises, doses, or diagnoses. "
        "Do not change suggestion ids, kinds, from/to doses, or add/remove suggestions. "
        "Return strict JSON only (no markdown) with:\n"
        "- patient_message: warm, clear message the PT can send (2-5 sentences).\n"
        "- why_by_id: object mapping suggestion id → array of 1-3 short evidence bullets "
        "(clinical but readable; keep facts from the input why[])."
    )
    user = (
        "Rewrite the patient message and polish each why[] for this plan draft.\n"
        f"{json.dumps(compact, ensure_ascii=False)[:10000]}"
    )
    text = _chat_oci(system, user, max_tokens=900)
    if not text:
        out["source"] = "local"
        return out, "local"
    try:
        cleaned = text.strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
            cleaned = re.sub(r"\s*```$", "", cleaned)
        data = json.loads(cleaned)
        msg = str(data.get("patient_message") or "").strip()
        if msg:
            out["patient_message"] = msg
        why_by_id = data.get("why_by_id") or {}
        if isinstance(why_by_id, dict):
            for s in suggestions:
                sid = s.get("id")
                polished = why_by_id.get(sid)
                if isinstance(polished, list) and polished:
                    s["why"] = [str(w).strip() for w in polished if str(w).strip()][:3]
        out["source"] = "oci"
        return out, "oci"
    except Exception as e:  # noqa: BLE001
        print(f"[oci_genai] plan phrasing JSON parse failed: {e}")
        out["source"] = "local"
        return out, "local"
