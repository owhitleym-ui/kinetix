"""
OCI Object Storage read/write for session keypoint logs.
Falls back to local ./data/sessions when OCI credentials are not configured.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

LOCAL_DIR = Path(__file__).resolve().parent / "data" / "sessions"


def _oci_configured() -> bool:
    return bool(
        os.getenv("OCI_CONFIG_FILE")
        or os.getenv("OCI_RESOURCE_PRINCIPAL")
        or Path.home().joinpath(".oci", "config").exists()
    ) and bool(os.getenv("OCI_NAMESPACE") and os.getenv("OCI_BUCKET"))


def write_session(payload: dict[str, Any]) -> dict[str, Any]:
    patient = payload.get("patient_id", "unknown")
    ts = payload.get("timestamp") or datetime.now(timezone.utc).isoformat()
    object_name = f"sessions/{patient}/{ts.replace(':', '-')}_{uuid.uuid4().hex[:8]}.json"

    if _oci_configured():
        return _write_oci(object_name, payload)

    LOCAL_DIR.mkdir(parents=True, exist_ok=True)
    path = LOCAL_DIR / object_name.replace("/", "__")
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return {
        "storage": "local",
        "path": str(path),
        "object_name": object_name,
        "note": "OCI not configured — wrote local fallback. Keypoints only, never video.",
    }


def list_sessions(patient_id: Optional[str] = None) -> list[dict[str, Any]]:
    if _oci_configured():
        return _list_oci(patient_id)

    LOCAL_DIR.mkdir(parents=True, exist_ok=True)
    sessions: list[dict[str, Any]] = []
    for path in sorted(LOCAL_DIR.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if patient_id and data.get("patient_id") != patient_id:
            continue
        sessions.append(data)
    return sessions


def _get_object_client():
    import oci

    if os.getenv("OCI_RESOURCE_PRINCIPAL"):
        signer = oci.auth.signers.get_resource_principals_signer()
        return oci.object_storage.ObjectStorageClient(config={}, signer=signer)

    config_file = os.getenv("OCI_CONFIG_FILE", str(Path.home() / ".oci" / "config"))
    profile = os.getenv("OCI_CONFIG_PROFILE", "DEFAULT")
    config = oci.config.from_file(config_file, profile)
    return oci.object_storage.ObjectStorageClient(config)


def _write_oci(object_name: str, payload: dict[str, Any]) -> dict[str, Any]:
    client = _get_object_client()
    namespace = os.environ["OCI_NAMESPACE"]
    bucket = os.environ["OCI_BUCKET"]
    body = json.dumps(payload).encode("utf-8")
    client.put_object(namespace, bucket, object_name, body)
    return {
        "storage": "oci_object_storage",
        "namespace": namespace,
        "bucket": bucket,
        "object_name": object_name,
        "note": "Keypoints only — never video.",
    }


def _list_oci(patient_id: Optional[str]) -> list[dict[str, Any]]:
    client = _get_object_client()
    namespace = os.environ["OCI_NAMESPACE"]
    bucket = os.environ["OCI_BUCKET"]
    prefix = f"sessions/{patient_id}/" if patient_id else "sessions/"
    objects = client.list_objects(namespace, bucket, prefix=prefix).data.objects or []
    sessions: list[dict[str, Any]] = []
    for obj in objects:
        resp = client.get_object(namespace, bucket, obj.name)
        sessions.append(json.loads(resp.data.content.decode("utf-8")))
    return sessions
