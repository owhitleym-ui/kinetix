"""
OCI Generative AI — plain-language multilingual correction cues.
Falls back to curated local cues when GenAI is not configured.
"""

from __future__ import annotations

import os
from typing import Optional

LOCAL_CUES = {
    "en": {
        "back_round": "Ease your chest up a little",
        "knee_cave": "Gently push your knees outward",
        "shallow": "Try sinking a bit deeper",
        "asymmetric": "Balance weight on both feet",
    },
    "es": {
        "back_round": "Sube un poco el pecho",
        "knee_cave": "Empuja suavemente las rodillas afuera",
        "shallow": "Baja un poco más",
        "asymmetric": "Equilibra el peso en ambos pies",
    },
}


def generate_correction_cue(
    error_type: str,
    baseline: float,
    current: float,
    language: str = "en",
) -> str:
    if os.getenv("OCI_GENAI_ENDPOINT") or os.getenv("OCI_GENAI_COMPARTMENT_ID"):
        cue = _call_oci_genai(error_type, baseline, current, language)
        if cue:
            return cue
    lang = language if language in LOCAL_CUES else "en"
    return LOCAL_CUES[lang].get(error_type) or LOCAL_CUES["en"].get(error_type, "Adjust your form")


def _call_oci_genai(
    error_type: str,
    baseline: float,
    current: float,
    language: str,
) -> Optional[str]:
    """
    Call OCI Generative AI (Cohere / Llama).
    Requires oci SDK + compartment/model OCID env vars.
    """
    try:
        import oci
    except ImportError:
        return None

    compartment = os.getenv("OCI_GENAI_COMPARTMENT_ID")
    model_id = os.getenv("OCI_GENAI_MODEL_ID")
    if not compartment or not model_id:
        return None

    prompt = (
        f"A patient is doing a squat. The detected error is: {error_type}.\n"
        f"Their baseline knee angle is {baseline}°, current is {current}°.\n"
        f"Write one short, encouraging correction in plain language (under 10 words).\n"
        f"Language: {language}."
    )

    config_file = os.getenv("OCI_CONFIG_FILE")
    if config_file:
        config = oci.config.from_file(config_file, os.getenv("OCI_CONFIG_PROFILE", "DEFAULT"))
        client = oci.generative_ai_inference.GenerativeAiInferenceClient(config)
    elif os.getenv("OCI_RESOURCE_PRINCIPAL"):
        signer = oci.auth.signers.get_resource_principals_signer()
        client = oci.generative_ai_inference.GenerativeAiInferenceClient(config={}, signer=signer)
    else:
        return None

    # Cohere-style chat; adjust if using Llama serving mode
    from oci.generative_ai_inference import models as gai_models

    content = gai_models.TextContent(text=prompt)
    message = gai_models.Message(role="USER", content=[content])
    chat_request = gai_models.GenericChatRequest(
        messages=[message],
        max_tokens=40,
        temperature=0.3,
    )
    details = gai_models.ChatDetails(
        compartment_id=compartment,
        serving_mode=gai_models.OnDemandServingMode(model_id=model_id),
        chat_request=chat_request,
    )
    resp = client.chat(details)
    # Best-effort extract
    try:
        choices = resp.data.chat_response.choices
        text = choices[0].message.content[0].text
        return text.strip().strip('"')
    except Exception:  # noqa: BLE001
        return None
