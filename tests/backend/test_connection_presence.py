import hashlib
import re
import secrets
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier

import pytest
from easyresume.models import Credential
from sqlalchemy import func, select, update


def pair_reader(client):
    pairing = client.post("/api/v1/pairing").json()
    assert re.fullmatch(r"\d{5}(?:-\d{5}){4}", pairing["connection_code"])
    assert pairing["connection_code"].replace("-", "")[5:] == pairing["code"]
    result = client.post("/api/v1/pair", json={"code": pairing["code"]}).json()
    return (
        pairing,
        result,
        {"Authorization": "Bearer " + result["token"], "Origin": "chrome-extension://synthetic"},
    )


def test_numeric_code_single_use(client):
    pairing, reader, headers = pair_reader(client)
    assert client.post("/api/v1/pair", json={"code": pairing["code"]}).status_code == 403
    assert (
        client.get("/api/v1/connection", headers=headers).json()["installation_id"]
        == reader["installation_id"]
    )


def test_expired_pairing_code_is_rejected(client):
    pairing = client.post("/api/v1/pairing").json()
    code_digest = hashlib.sha256(pairing["code"].encode()).hexdigest()
    with client.app.state.sessions.begin() as session:
        session.execute(
            update(Credential)
            .where(Credential.digest == code_digest)
            .values(expires_at=(datetime.now(UTC) - timedelta(seconds=1)).isoformat())
        )

    response = client.post("/api/v1/pair", json={"code": pairing["code"]})

    assert response.status_code == 403
    assert response.json()["detail"] == "配对码已过期或已使用"
    with client.app.state.sessions() as session:
        assert session.scalar(select(func.count()).where(Credential.role == "reader")) == 0


def test_concurrent_pairing_consumes_code_once(client):
    pairing = client.post("/api/v1/pairing").json()
    start = Barrier(2)

    def redeem():
        start.wait(timeout=5)
        return client.post("/api/v1/pair", json={"code": pairing["code"]})

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(redeem) for _ in range(2)]
        results = [future.result(timeout=10) for future in futures]

    assert sorted(result.status_code for result in results) == [200, 403]
    accepted = next(result.json() for result in results if result.status_code == 200)
    with client.app.state.sessions() as session:
        readers = list(session.scalars(select(Credential).where(Credential.role == "reader")))
        assert [reader.id for reader in readers] == [accepted["installation_id"]]


@pytest.mark.parametrize("port", [8765, 18765])
def test_connection_code_contains_non_default_port(client, port):
    base = f"http://127.0.0.1:{port}"
    response = client.post(base + "/api/v1/pairing", headers={"Origin": base})

    assert response.status_code == 200
    pairing = response.json()
    assert pairing["connection_code"].split("-")[0] == f"{port:05d}"
    assert "".join(pairing["connection_code"].split("-")[1:]) == pairing["code"]


def test_legacy_pairing_code_remains_compatible(client):
    code = secrets.token_urlsafe(24)
    with client.app.state.sessions.begin() as session:
        session.add(
            Credential(
                digest=hashlib.sha256(code.encode()).hexdigest(),
                role="pairing",
                expires_at=(datetime.now(UTC) + timedelta(minutes=1)).isoformat(),
            )
        )

    response = client.post("/api/v1/pair", json={"code": code})

    assert response.status_code == 200
    headers = {"Authorization": "Bearer " + response.json()["token"]}
    assert (
        client.get("/api/v1/connection", headers=headers).json()["installation_id"]
        == response.json()["installation_id"]
    )
    assert client.post("/api/v1/pair", json={"code": code}).status_code == 403


def test_presence_and_self_disconnect(client, monkeypatch):
    _, reader, headers = pair_reader(client)
    status = client.get("/api/v1/connections/status").json()["connections"]
    assert status[0]["state"] == "connected"
    assert status[0]["last_seen_at"]
    import easyresume.api as api

    clock = api.time.monotonic()
    monkeypatch.setattr(api.time, "monotonic", lambda: clock + 21)
    assert client.get("/api/v1/connections/status").json()["connections"][0]["state"] == "idle"
    assert client.get("/api/v1/connection", headers=headers).status_code == 200
    assert client.get("/api/v1/connections/status").json()["connections"][0]["state"] == "connected"
    assert client.delete("/api/v1/connection", headers=headers).json() == {"revoked": True}
    assert client.get("/api/v1/connections/status").json()["connections"] == []
    assert client.get("/api/v1/connection", headers=headers).status_code == 401


def test_reader_cannot_list_or_revoke_other_connections(client):
    _, first, headers = pair_reader(client)
    _, second, second_headers = pair_reader(client)
    assert client.get("/api/v1/connections/status", headers=headers).status_code == 403
    assert (
        client.delete("/api/v1/connections/" + second["installation_id"], headers=headers).status_code == 403
    )
    assert client.delete("/api/v1/connection", headers=headers).status_code == 200
    assert client.get("/api/v1/connection", headers=second_headers).status_code == 200


def test_same_origin_reader_is_rejected_by_role_check(client):
    _, first, headers = pair_reader(client)
    _, second, second_headers = pair_reader(client)
    headers["Origin"] = str(client.base_url).rstrip("/")

    for response in (
        client.get("/api/v1/connections/status", headers=headers),
        client.delete("/api/v1/connections/" + second["installation_id"], headers=headers),
    ):
        assert response.status_code == 403
        assert response.json()["detail"] == "只读扩展无权执行此操作"

    assert (
        client.get("/api/v1/connection", headers=headers).json()["installation_id"]
        == first["installation_id"]
    )
    assert client.get("/api/v1/connection", headers=second_headers).status_code == 200


def test_pair_attempts_globally_bounded(client):
    for _ in range(10):
        assert client.post("/api/v1/pair", json={"code": "0" * 20}).status_code == 403
    assert client.post("/api/v1/pair", json={"code": "1" * 20}).status_code == 429
