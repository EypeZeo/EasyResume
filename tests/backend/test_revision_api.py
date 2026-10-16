from easyresume.privacy import public_profile


def test_structured_drafts_recover_and_conflict(client):
    payload = {"text": "合成草稿", "education_records": [{"school": "测试学院"}]}
    body = {"kind": "profile", "entity_id": "new", "payload": payload, "expected_version": 0}
    assert client.post("/api/v1/scratch", json=body).json()["version"] == 1
    assert client.get("/api/v1/scratch/profile?entity_id=new").json()["payload"] == payload
    assert client.post("/api/v1/scratch", json=body).status_code == 409
    body["expected_version"] = 1
    assert client.post("/api/v1/scratch", json=body).json()["version"] == 2
    assert client.get("/api/v1/scratch/profile?entity_id=other").json()["payload"] is None


def test_connection_checks_revoked_reader(client):
    pairing = client.post("/api/v1/pairing").json()
    reader = client.post("/api/v1/pair", json={"code": pairing["code"], "label": "test"}).json()
    headers = {"Authorization": "Bearer " + reader["token"], "Origin": "chrome-extension://synthetic"}
    response = client.get("/api/v1/connection", headers=headers)
    assert response.status_code == 200
    assert response.json()["installation_id"] == reader["installation_id"]
    assert client.delete("/api/v1/connections/" + reader["installation_id"]).status_code == 200
    assert client.get("/api/v1/connection", headers=headers).status_code == 401


def test_backup_structured_evidence_allowlist():
    cleaned = public_profile(
        {
            "name": "private",
            "text": "private raw",
            "schema_version": 2,
            "work_records": [
                {
                    "id": "work",
                    "company": "example",
                    "snippet": "private evidence",
                    "responsibilities": "private duties",
                    "confirmed": True,
                }
            ],
            "skill_records": [
                {"id": "skill", "name": "Linux", "snippet": "private source", "confirmed": True}
            ],
        }
    )
    assert "private" not in str(cleaned)
    assert cleaned["work_records"][0]["confirmed"] is False


def test_restore_counts_and_stale_preview(client, setup_workspace):
    backup = client.get("/api/v1/backup").json()
    preview = client.post("/api/v1/restore/preview", json=backup).json()
    assert preview["new_counts"]["profile"] == 0
    assert preview["skipped_counts"]["profile"] == 1
    client.post("/api/v1/profiles", json={"name": "合成新增"})
    assert (
        client.post(
            "/api/v1/restore", json={"backup": backup, "preview_digest": preview["digest"]}
        ).status_code
        == 409
    )
    backup["version"] = 1
    assert client.post("/api/v1/restore/preview", json=backup).status_code == 200


def test_malformed_and_reserved_backup_records_rejected(client):
    for record in [
        "not a record",
        {"id": "p", "kind": "profile", "data": {"education_records": ["bad"]}},
        {"id": "ai-config", "kind": "profile", "data": {}},
    ]:
        backup = {"format": "easyresume-backup", "version": 2, "records": [record]}
        assert client.post("/api/v1/restore/preview", json=backup).status_code == 422


def test_deleted_profile_draft_cannot_be_resurrected(client, setup_workspace):
    profile, _ = setup_workspace
    body = {
        "kind": "profile",
        "entity_id": "new",
        "payload": {"parent_id": profile["id"], "text": "合成待编辑文本"},
        "expected_version": 0,
    }
    assert client.post("/api/v1/scratch", json=body).status_code == 200
    assert client.delete(f"/api/v1/profiles/{profile['id']}").status_code == 200
    assert client.get("/api/v1/scratch/profile?entity_id=new").json()["payload"] is None
    assert client.post("/api/v1/scratch", json=body).status_code == 404


def test_validation_errors_do_not_reflect_private_input(client):
    secret = "synthetic-secret-" * 400
    response = client.put("/api/v1/ai/config", json={"api_key": secret})
    assert response.status_code == 422
    assert "synthetic-secret" not in response.text
    assert all("input" not in item and "ctx" not in item for item in response.json()["detail"])
