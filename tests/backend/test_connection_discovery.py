import hashlib
import hmac

from easyresume.api import create_app
from fastapi.testclient import TestClient


def reader(client):
    offer = client.post("/api/v1/pairing").json()
    result = client.post("/api/v1/pair", json={"code": offer["code"]}).json()
    return result


def probe(client, paired, challenge="a" * 64):
    return client.post(
        "/api/v1/connection/probe",
        json={"installation_id": paired["installation_id"], "challenge": challenge},
        headers={"Authorization": "", "Origin": "chrome-extension://synthetic"},
    )


def assert_proof(body, paired):
    message = (
        f"EasyResume:1:{paired['installation_id']}:{body['challenge']}:"
        f"{body['instance']}:{body['status']}:{body['origin']}"
    )
    expected = hmac.new(
        hashlib.sha256(paired["token"].encode()).hexdigest().encode(),
        message.encode(), hashlib.sha256,
    ).hexdigest()
    assert hmac.compare_digest(body["proof"], expected)
    assert "token" not in body and "digest" not in body


def test_discovery_proves_original_credential_database_without_bearer(client):
    paired = reader(client)
    response = probe(client, paired)
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "chrome-extension://synthetic"
    body = response.json()
    assert body["status"] == "active"
    assert body["instance"] == paired["instance"]
    assert_proof(body, paired)
    second = probe(client, paired, "b" * 64).json()
    assert second["proof"] != body["proof"]
    assert_proof(second, paired)


def test_revoked_discovery_is_authenticated_and_does_not_repair(client):
    paired = reader(client)
    client.delete("/api/v1/connections/" + paired["installation_id"])
    body = probe(client, paired).json()
    assert body["status"] == "revoked"
    assert_proof(body, paired)
    assert client.get("/api/v1/connections/status").json()["connections"] == []
    response = client.get(
        "/api/v1/connection", headers={"Authorization": "Bearer " + paired["token"]},
    )
    assert response.status_code == 401


def test_discovery_survives_restart_and_port_change(client):
    paired = reader(client)
    app = create_app(client.app.state.data_dir)
    with TestClient(app, base_url="http://127.0.0.1:8766") as restarted:
        response = probe(restarted, paired)
        assert response.status_code == 200
        body = response.json()
        assert body["origin"] == "http://127.0.0.1:8766"
        assert body["instance"] != paired["instance"]
        assert_proof(body, paired)
        assert restarted.get(
            "/api/v1/connection", headers={"Authorization": "Bearer " + paired["token"]},
        ).status_code == 200


def test_unknown_or_non_reader_identity_cannot_obtain_proof(client):
    offer = client.post("/api/v1/pairing").json()
    assert probe(client, {"installation_id": "missing"}).status_code == 404
    assert probe(client, {"installation_id": offer["code"]}).status_code == 404
    assert probe(client, {"installation_id": "workbench"}).status_code == 404
    response = client.post(
        "/api/v1/connection/probe",
        json={"installation_id": "missing", "challenge": "short"},
    )
    assert response.status_code == 422


def test_remote_origin_cannot_use_discovery(client):
    paired = reader(client)
    response = client.post(
        "/api/v1/connection/probe",
        json={"installation_id": paired["installation_id"], "challenge": "a" * 64},
        headers={"Authorization": "", "Origin": "https://example.com"},
    )
    assert response.status_code == 403
    assert "proof" not in response.json()


def test_discovery_proof_uses_listener_port_even_when_host_is_forged(client):
    paired = reader(client)
    response = client.post(
        "http://127.0.0.1:8766/api/v1/connection/probe",
        json={"installation_id": paired["installation_id"], "challenge": "c" * 64},
        headers={"Host": "127.0.0.1:8765", "Origin": "chrome-extension://synthetic", "Authorization": ""},
    )
    body = response.json()
    assert body["origin"] == "http://127.0.0.1:8766"
    assert_proof(body, paired)
