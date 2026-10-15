from conftest import create_job
from easyresume.execution import digest
from easyresume.models import Action, now_iso


def test_boundary_and_missing_token(client):
    assert client.get("/api/v1/state", headers={"Authorization": ""}).status_code == 401
    assert client.get("/api/v1/state", headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.get("/api/v1/health", headers={"Host": "evil.example"}).status_code == 403
    assert (
        client.post(
            "/api/v1/session", headers={"Origin": "https://evil.example", "X-EasyResume-Client": "workbench"}
        ).status_code
        == 403
    )


def test_candidate_and_pending_end_to_end(client, setup_workspace):
    create_job(client)
    create_job(client, "硕士及以上，Python", title="另一合成职位")
    state = client.get("/api/v1/state").json()
    assert [j["assessment"]["group"] for j in state["jobs"]] == ["candidate", "pending"]


def test_duplicate_job_and_optimistic_concurrency(client, setup_workspace):
    a = create_job(client)
    b = create_job(client)
    assert a["id"] == b["id"] and b["duplicate"]
    body = {"job": {**a["data"], "saved": True}, "expected_version": a["version"]}
    assert client.put(f"/api/v1/jobs/{a['id']}", json=body).status_code == 200
    assert client.put(f"/api/v1/jobs/{a['id']}", json=body).status_code == 409
    restored = client.post(f"/api/v1/undo/{a['id']}").json()
    assert restored["data"]["saved"] is False


def test_preview_does_not_change_strategy(client, setup_workspace):
    _, s = setup_workspace
    create_job(client, "本科，Python，五险一金")
    result = client.post("/api/v1/strategies/preview", json={**s["data"], "require_double": False}).json()
    assert result["preview_only"]
    assert result["results"][0]["assessment"]["group"] == "candidate"
    assert client.get("/api/v1/state").json()["strategies"][0]["data"]["require_double"] is True


def test_evidence_conflict_and_explicit_retraction(client, setup_workspace):
    j = create_job(client)
    response = client.post(
        f"/api/v1/jobs/{j['id']}/evidence",
        json={
            "expected_version": j["version"],
            "evidence": {
                "field": "rest",
                "value": "single",
                "source": "hr",
                "snippet": "实际单休",
                "observed_at": now_iso(),
            },
        },
    )
    assert response.status_code == 200
    state = client.get("/api/v1/state").json()
    assert state["jobs"][0]["assessment"]["group"] == "pending"
    old_index = next(i for i, e in enumerate(j["data"]["evidence"]) if e["field"] == "rest")
    assert (
        client.post(
            f"/api/v1/jobs/{j['id']}/evidence/{old_index}/retract",
            json={"text": "页面信息已失效，已向HR核实"},
        ).status_code
        == 200
    )
    assert client.get("/api/v1/state").json()["jobs"][0]["assessment"]["group"] == "excluded"


def test_blacklist_restore(client, setup_workspace):
    j = create_job(client)
    b = client.post("/api/v1/blacklist", json={"target": "job", "value": j["id"]}).json()
    assert client.get("/api/v1/state").json()["jobs"][0]["assessment"]["group"] == "excluded"
    client.delete(f"/api/v1/blacklist/{b['id']}")
    assert client.get("/api/v1/state").json()["jobs"][0]["assessment"]["group"] == "candidate"


def test_draft_uses_confirmed_facts_and_no_send_route(client, setup_workspace):
    p, s = setup_workspace
    j = create_job(client)
    response = client.post("/api/v1/drafts", json={"job_id": j["id"], "strategy_id": s["id"]})
    assert response.status_code == 200
    draft = response.json()["data"]
    assert "本科" in draft["content"] and "Python" in draft["content"]
    assert "3年" not in draft["content"]  # No unsupported assertion of job-specific experience.
    assert not draft["sending_enabled"]
    assert client.post("/api/v1/actions").status_code == 409
    client.delete(f"/api/v1/profiles/{p['id']}")
    state = client.get("/api/v1/state").json()
    assert not state["profiles"] and not state["drafts"]
    assert state["strategies"][0]["data"]["profile_id"] is None


def test_draft_edit_rejects_stale_version(client, setup_workspace):
    _, strategy = setup_workspace
    job = create_job(client)
    draft = client.post("/api/v1/drafts", json={"job_id": job["id"], "strategy_id": strategy["id"]}).json()
    body = {"text": "已核对的合成草稿", "expected_version": draft["version"]}
    assert client.put(f"/api/v1/drafts/{draft['id']}", json=body).status_code == 200
    assert client.put(f"/api/v1/drafts/{draft['id']}", json=body).status_code == 409


def test_pairing_one_use_reader_cannot_approve_or_read_workbench(client):
    code = client.post("/api/v1/pairing").json()["code"]
    reader = client.post("/api/v1/pair", json={"code": code}).json()
    assert client.post("/api/v1/pair", json={"code": code}).status_code == 403
    headers = {"Authorization": f"Bearer {reader['token']}", "Origin": "chrome-extension://synthetic"}
    assert client.get("/api/v1/state", headers=headers).status_code == 403
    assert (
        client.post("/api/v1/actions", headers={**headers, "Origin": "http://127.0.0.1"}).status_code == 403
    )
    assert (
        client.post("/api/v1/session", headers={**headers, "X-EasyResume-Client": "workbench"}).status_code
        == 403
    )
    observation = {
        "url": "https://www.zhipin.com/job_detail/synthetic123.html",
        "title": "合成职位",
        "company": "合成公司",
        "text": "本科，Python，双休",
        "platform_job_id": "synthetic123",
        "page_kind": "detail",
    }
    response = client.post("/api/v1/observations", json=observation, headers=headers)
    assert response.status_code == 200, response.text
    assert client.post("/api/v1/observations", json=observation, headers=headers).json()["duplicate"]
    assert (
        client.post(
            "/api/v1/observations", json={**observation, "url": "https://evil.example"}, headers=headers
        ).status_code
        == 422
    )
    client.delete(f"/api/v1/connections/{reader['installation_id']}")
    assert client.post("/api/v1/observations", json=observation, headers=headers).status_code == 401


def test_changed_observation_preserves_evidence_until_review(client, setup_workspace):
    observation = {
        "url": "https://www.zhipin.com/job_detail/synthetic-change.html",
        "title": "合成变更职位",
        "company": "合成公司",
        "text": "本科，Python，双休，五险一金",
        "platform_job_id": "synthetic-change",
    }
    result = client.post("/api/v1/observations", json=observation).json()
    original = next(j for j in client.get("/api/v1/state").json()["jobs"] if j["id"] == result["job_id"])
    changed = client.post(
        "/api/v1/observations", json={**observation, "text": "本科，Python，单休，五险一金"}
    ).json()
    state = client.get("/api/v1/state").json()
    assert state["jobs"][0]["data"]["rest"] == "double"
    obs = next(o for o in state["observations"] if o["id"] == changed["id"])
    proposal = obs["data"]["proposed_job"]
    proposal["extraction_checked"] = True
    response = client.post(
        f"/api/v1/observations/{obs['id']}/accept",
        json={"job": proposal, "expected_version": original["version"]},
    )
    assert response.status_code == 200
    rest_evidence = [e["value"] for e in response.json()["data"]["evidence"] if e["field"] == "rest"]
    assert rest_evidence == ["double", "single"]
    assert client.get("/api/v1/state").json()["jobs"][0]["assessment"]["group"] == "pending"


def test_backup_redacts_raw_and_restore_never_rewinds_ledger(client, setup_workspace):
    create_job(
        client,
        "本科，Python，双休，五险一金。联系人：合成HR\n电话：" + "138" + "0000" + "1234",
        activity="today",
    )
    backup = client.get("/api/v1/backup").json()
    assert not any(r["kind"] in {"draft", "credential", "action"} for r in backup["records"])
    job = next(r for r in backup["records"] if r["kind"] == "job")
    assert job["data"]["text"] == "" and job["data"]["evidence"] == []
    assert job["data"]["activity"] == "unknown"
    with client.app.state.sessions.begin() as session:
        session.add(
            Action(
                id="attempt-1",
                state="unknown",
                platform="boss",
                identity="account:synthetic",
                binding={},
                digest=digest({}),
                epoch="old",
                attempted_at=now_iso(),
            )
        )
        session.add(
            Action(
                id="approved-1",
                state="approved",
                platform="boss",
                identity="account:synthetic",
                binding={},
                digest=digest({}),
                epoch="old",
                approved_at=now_iso(),
            )
        )
    preview = client.post("/api/v1/restore/preview", json=backup).json()
    assert (
        client.post("/api/v1/restore", json={"backup": backup, "preview_digest": "wrong"}).status_code == 409
    )
    response = client.post("/api/v1/restore", json={"backup": backup, "preview_digest": preview["digest"]})
    assert response.status_code == 200
    with client.app.state.sessions() as session:
        assert session.get(Action, "attempt-1").attempted_at
        assert session.get(Action, "approved-1").state == "cancelled"
    assert client.get("/api/v1/state").status_code == 401  # Old UI connection was invalidated.


def test_csv_formula_and_no_raw_hr_info(client, setup_workspace):
    create_job(client, title="=HYPERLINK(合成测试)")
    response = client.get("/api/v1/export.csv")
    assert response.status_code == 200
    assert "'=HYPERLINK" in response.text


def test_invalid_salary_and_weight_rejected(client):
    assert (
        client.post("/api/v1/strategies", json={"salary_floor": 10000, "salary_ideal": 5000}).status_code
        == 422
    )
    assert client.post("/api/v1/strategies", json={"weights": {"invented": 1}}).status_code == 422


def test_scratch_is_local_not_exported(client):
    assert (
        client.post("/api/v1/scratch", json={"kind": "profile", "text": "合成未完成输入"}).status_code == 200
    )
    assert client.get("/api/v1/scratch/profile").json()["text"] == "合成未完成输入"
    assert not any(r["kind"] == "scratch" for r in client.get("/api/v1/backup").json()["records"])


def test_last_evidence_retraction_clears_derived_value(client, setup_workspace):
    job = create_job(client)
    index = next(i for i, e in enumerate(job["data"]["evidence"]) if e["field"] == "rest")
    response = client.post(f"/api/v1/jobs/{job['id']}/evidence/{index}/retract", json={"text": "来源已失效"})
    assert response.status_code == 200
    assert response.json()["data"]["rest"] == "unknown"
    assert client.get("/api/v1/state").json()["jobs"][0]["assessment"]["group"] == "pending"


def test_deleting_profile_preserves_other_profiles_derived_data(client, setup_workspace):
    a, _ = setup_workspace
    b = client.post(
        "/api/v1/profiles", json={"name": "独立画像B", "confirmed": True, "education_completed": "本科"}
    ).json()
    s = client.post("/api/v1/strategies", json={"name": "策略B", "profile_id": b["id"]}).json()
    j = create_job(client)
    draft = client.post("/api/v1/drafts", json={"job_id": j["id"], "strategy_id": s["id"]}).json()
    client.post("/api/v1/scratch", json={"kind": "profile", "profile_id": b["id"], "text": "B未完成的修改"})
    assert client.delete(f"/api/v1/profiles/{a['id']}").status_code == 200
    state = client.get("/api/v1/state").json()
    assert any(r["id"] == b["id"] for r in state["profiles"])
    assert any(r["id"] == draft["id"] for r in state["drafts"])
    assert client.get("/api/v1/scratch/profile").json()["text"] == "B未完成的修改"


def test_outcomes_remain_attributed_to_first_contact_strategy_version(client, setup_workspace):
    _, strategy = setup_workspace
    job = create_job(client)
    assert client.post("/api/v1/outcomes", json={"job_id": job["id"], "kind": "positive"}).status_code == 409
    contact = client.post(
        "/api/v1/outcomes", json={"job_id": job["id"], "kind": "contact", "strategy_id": strategy["id"]}
    ).json()
    client.put(
        f"/api/v1/strategies/{strategy['id']}",
        json={"strategy": strategy["data"], "expected_version": strategy["version"]},
    )
    client.post("/api/v1/outcomes", json={"job_id": job["id"], "kind": "positive"})
    repeated = client.post(
        "/api/v1/outcomes", json={"job_id": job["id"], "kind": "contact", "strategy_id": strategy["id"]}
    ).json()
    assert repeated["id"] == contact["id"]
    cohort = client.get("/api/v1/statistics").json()["cohorts"][0]
    assert cohort["strategy_version"] == 1
    assert cohort["contacts"] == cohort["positive"] == cohort["awaiting_window"] == 1
    assert cohort["window_contacts"] == 0
