import asyncio
import json
import time

import httpx
import pytest
from easyresume import ai
from easyresume.ai import call_provider, further_redaction, redact_resume, service_url, validate_suggestions

SAMPLE = (
    "姓名：示例测试人\n电话："
    + "139"
    + "0000"
    + "2345\n邮箱：sample@example.test\n详细地址：示例市示例路1号\n教育经历\n示例学院 2020.09-2024.06 本科\n专业技能\n熟悉Linux系统"
)


def setup_ai(client):
    response = client.put("/api/v1/ai/config", json={"enabled": True, "api_key": "synthetic-provider-secret"})
    assert response.status_code == 200
    preview = client.post("/api/v1/ai/preview", json={"text": SAMPLE})
    assert preview.status_code == 200
    return preview.json()


def wait_result(client, ident):
    for _ in range(50):
        result = client.get(f"/api/v1/ai/tasks/{ident}").json()
        if result["status"] != "waiting":
            return result
        time.sleep(0.01)
    pytest.fail("task did not complete")


def test_redaction_multiline_and_context():
    cleaned = redact_resume(SAMPLE)
    assert "示例测试人" not in cleaned and "sample@" not in cleaned and "示例路" not in cleaned
    assert "示例学院" in cleaned and "2020.09" in cleaned and "Linux" in cleaned
    assert "假设名字" not in redact_resume("姓 名\n: 假设名字\n教育经历\n测试学院")


def test_ai_default_off_and_reader_cannot_configure(client):
    assert client.get("/api/v1/ai/config").json()["enabled"] is False
    assert client.post("/api/v1/ai/preview", json={"text": SAMPLE}).status_code == 409
    pairing = client.post("/api/v1/pairing").json()
    reader = client.post("/api/v1/pair", json={"code": pairing["code"], "label": "AI-test"}).json()
    assert (
        client.get("/api/v1/ai/config", headers={"Authorization": "Bearer " + reader["token"]}).status_code
        == 403
    )


def test_ai_only_confirmed_redacted_payload_and_unconfirmed_suggestions(client):
    observed = []

    async def provider(config, key, text):
        observed.append((config, key, text))
        return {
            "skill_records": [
                {
                    "name": "Linux",
                    "category": "系统",
                    "usage": "used",
                    "snippet": "熟悉Linux系统",
                    "confirmed": True,
                }
            ]
        }

    client.app.state.ai_provider = provider
    preview = setup_ai(client)
    assert not observed
    body = {"preview_id": preview["preview_id"], "text": preview["text"], "confirmed": False}
    assert client.post("/api/v1/ai/tasks", json=body).status_code == 409
    body["confirmed"] = True
    response = client.post("/api/v1/ai/tasks", json=body)
    assert response.status_code == 200, response.text
    result = wait_result(client, response.json()["id"])
    assert result["status"] == "completed", result
    assert observed[0][2] == preview["text"]
    assert "示例测试人" not in observed[0][2]
    assert result["profile"]["skill_records"][0]["confirmed"] is False
    assert client.get("/api/v1/state").json()["profiles"] == []
    assert client.post("/api/v1/ai/tasks", json=body).status_code == 409
    assert "synthetic-provider-secret" not in client.get("/api/v1/ai/config").text
    assert "synthetic-provider-secret" not in client.get("/api/v1/backup").text
    with client.app.state.sessions() as session:
        from easyresume.models import Record
        from sqlalchemy import select

        assert "synthetic-provider-secret" not in json.dumps(
            [r.data for r in session.scalars(select(Record))]
        )


def test_config_change_invalidates_preview_and_does_not_forward_key(client):
    preview = setup_ai(client)
    changed = client.put(
        "/api/v1/ai/config", json={"enabled": True, "base_url": "https://example.invalid/v1"}
    )
    assert changed.json()["key_set"] is False
    assert (
        client.post(
            "/api/v1/ai/tasks",
            json={"preview_id": preview["preview_id"], "text": preview["text"], "confirmed": True},
        ).status_code
        == 409
    )
    assert client.put("/api/v1/ai/config", json={"base_url": "http://example.invalid"}).status_code == 422
    assert (
        client.put("/api/v1/ai/config", json={"base_url": "https://user:secret@example.invalid"}).status_code
        == 422
    )


def test_ai_cancel_and_failure_preserve_local_data(client, setup_workspace):
    async def slow(*args):
        await asyncio.sleep(30)

    client.app.state.ai_provider = slow
    preview = setup_ai(client)
    job = client.post(
        "/api/v1/ai/tasks",
        json={"preview_id": preview["preview_id"], "text": preview["text"], "confirmed": True},
    ).json()
    cancelled = client.delete(f"/api/v1/ai/tasks/{job['id']}").json()
    assert cancelled["status"] == "cancelled"
    assert len(client.get("/api/v1/state").json()["profiles"]) == 1

    async def bad(*args):
        return {"education_records": [{"school": "Invented", "snippet": "not in original"}]}

    client.app.state.ai_provider = bad
    preview = client.post("/api/v1/ai/preview", json={"text": SAMPLE}).json()
    job = client.post(
        "/api/v1/ai/tasks",
        json={"preview_id": preview["preview_id"], "text": preview["text"], "confirmed": True},
    ).json()
    assert wait_result(client, job["id"])["status"] == "failed"
    assert len(client.get("/api/v1/state").json()["profiles"]) == 1


def test_invalid_ai_schema_and_instructions_rejected():
    with pytest.raises(ValueError):
        validate_suggestions({"execute": "send-message"}, "source")
    with pytest.raises(ValueError):
        validate_suggestions(
            {"education_records": [{"snippet": "source", "start_date": "2024-99"}]}, "source"
        )


def test_redaction_without_section_labels_and_spaced_contacts():
    text = "陈示例\nsample @ example . test\n示例路 123 号\n2020.09-2024.06\n合成学院 本科"
    cleaned = redact_resume(text)
    assert "陈示例" not in cleaned
    assert "example" not in cleaned
    assert "示例路" not in cleaned
    assert "合成学院" in cleaned
    assert "Example Person" not in redact_resume("Example Person\n2020-2024\nExample College")


def test_preview_binding_allows_only_additional_redactions(client):
    observed = []

    async def provider(config, key, text):
        observed.append(text)
        return {"skill_records": []}

    client.app.state.ai_provider = provider
    preview = setup_ai(client)
    body = {
        "preview_id": preview["preview_id"],
        "text": preview["text"] + "\nNEW PRIVATE DATA",
        "confirmed": True,
    }
    assert client.post("/api/v1/ai/tasks", json=body).status_code == 409
    assert observed == []
    edited = preview["text"].replace("示例学院", "[已移除]")
    body["text"] = edited
    result = client.post("/api/v1/ai/tasks", json=body)
    assert result.status_code == 200
    assert wait_result(client, result.json()["id"])["status"] == "completed"
    assert observed == [edited]
    assert further_redaction("abc", "[REDACTED]bc")
    assert not further_redaction("abc", "bac")


@pytest.mark.parametrize(
    "record,kind,text",
    [
        ({"name": "Invented Skill", "snippet": "Linux"}, "skill_records", "Linux"),
        ({"name": "Python", "usage": "used", "snippet": "不熟悉Python"}, "skill_records", "不熟悉Python"),
        (
            {"school": "Invented University", "snippet": "Example College"},
            "education_records",
            "Example College",
        ),
        ({"degree": "博士", "snippet": "示例学院 本科"}, "education_records", "示例学院 本科"),
        ({"start_date": "2024-09", "snippet": "2020.09-2024.06"}, "education_records", "2020.09-2024.06"),
        ({"education_form": "full_time", "snippet": "非全日制本科"}, "education_records", "非全日制本科"),
        ({"employment_type": "full_time", "snippet": "示例公司 工程师"}, "work_records", "示例公司 工程师"),
    ],
)
def test_truthful_snippet_does_not_ground_invented_fields(record, kind, text):
    with pytest.raises(ValueError):
        validate_suggestions({kind: [record]}, text)


def test_ai_provenance_and_links_are_never_trusted():
    result = validate_suggestions(
        {
            "skill_records": [
                {
                    "name": "Linux",
                    "snippet": "熟悉Linux系统",
                    "id": "forged",
                    "source": "manual",
                    "confirmed": True,
                    "work_record_ids": ["other-resume-record"],
                }
            ]
        },
        "熟悉Linux系统",
    )
    record = result["skill_records"][0]
    assert record["source"] == "ai" and not record["confirmed"]
    assert record["id"] != "forged" and record["work_record_ids"] == []


def test_ai_skill_alias_uses_local_canonical_name():
    result = validate_suggestions(
        {"skill_records": [{"name": "postgres", "snippet": "使用Postgres维护数据库"}]},
        "使用Postgres维护数据库",
    )
    assert result["skill_records"][0]["name"] == "PostgreSQL"


def mock_provider_http(monkeypatch, handler):
    original = httpx.AsyncClient

    def factory(**kwargs):
        assert kwargs["trust_env"] is False and kwargs["follow_redirects"] is False
        return original(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(ai.httpx, "AsyncClient", factory)


def completion(content="{}", reason="stop"):
    return {"choices": [{"finish_reason": reason, "message": {"content": content}}]}


def provider_call():
    return asyncio.run(
        call_provider(
            {"model": "synthetic-model", "base_url": "https://provider.invalid/v1"},
            "synthetic-secret",
            "Linux",
        )
    )


def test_provider_http_request_is_text_only_and_bounded(monkeypatch):
    observed = []

    def handler(request):
        observed.append(request)
        return httpx.Response(200, json=completion('{"skill_records":[]}'))

    mock_provider_http(monkeypatch, handler)
    assert provider_call() == {"skill_records": []}
    request = observed[0]
    assert str(request.url) == "https://provider.invalid/v1/chat/completions"
    payload = json.loads(request.content)
    assert payload["messages"][1] == {"role": "user", "content": "Linux"}
    assert payload["stream"] is False and "files" not in payload
    assert request.headers["authorization"] == "Bearer synthetic-secret"


@pytest.mark.parametrize(
    "response",
    [
        completion('{"skill_records":[]}', "length"),
        completion(""),
        completion("not-json"),
        completion("[]"),
        {"choices": []},
        {"choices": [None]},
        completion(None),
    ],
)
def test_provider_rejects_empty_truncated_or_non_json(monkeypatch, response):
    mock_provider_http(monkeypatch, lambda _: httpx.Response(200, json=response))
    with pytest.raises(ValueError, match="AI 返回"):
        provider_call()


def test_provider_http_error_does_not_expose_response_body(monkeypatch):
    mock_provider_http(monkeypatch, lambda _: httpx.Response(401, text="synthetic-secret raw-personal-data"))
    with pytest.raises(ValueError) as error:
        provider_call()
    assert "401" in str(error.value)
    assert "synthetic-secret" not in str(error.value) and "raw-personal-data" not in str(error.value)


def test_provider_response_length_and_stream_limit(monkeypatch):
    monkeypatch.setattr(ai, "MAX_RESPONSE_BYTES", 128)
    mock_provider_http(monkeypatch, lambda _: httpx.Response(200, content=b"x" * 129))
    with pytest.raises(ValueError, match="大小限制"):
        provider_call()


def test_provider_stream_without_content_length_is_bounded(monkeypatch):
    class Stream(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b"x" * 80
            yield b"x" * 80

    monkeypatch.setattr(ai, "MAX_RESPONSE_BYTES", 128)
    mock_provider_http(monkeypatch, lambda _: httpx.Response(200, stream=Stream()))
    with pytest.raises(ValueError, match="大小限制"):
        provider_call()


@pytest.mark.parametrize("body", [b"", b"not-json", b"\xff\xfeinvalid"])
def test_provider_invalid_outer_response_is_safe(monkeypatch, body):
    mock_provider_http(monkeypatch, lambda _: httpx.Response(200, content=body))
    with pytest.raises(ValueError, match="AI 返回"):
        provider_call()


def test_provider_total_timeout_even_if_transport_is_slow(monkeypatch):
    monkeypatch.setattr(ai, "PROVIDER_TIMEOUT_SECONDS", 0.01)

    async def handler(request):
        await asyncio.sleep(0.05)
        return httpx.Response(200, json=completion('{"skill_records":[]}'))

    mock_provider_http(monkeypatch, handler)
    with pytest.raises(TimeoutError):
        provider_call()


def test_provider_deadline_also_stops_slow_response_stream(monkeypatch):
    class Stream(httpx.AsyncByteStream):
        async def __aiter__(self):
            for _ in range(10):
                await asyncio.sleep(0.01)
                yield b"x" * 8

    monkeypatch.setattr(ai, "PROVIDER_TIMEOUT_SECONDS", 0.02)
    mock_provider_http(monkeypatch, lambda _: httpx.Response(200, stream=Stream()))
    with pytest.raises(TimeoutError):
        provider_call()


def test_task_errors_do_not_trust_provider_error_prefix(client):
    async def provider(*args):
        raise ValueError("AI 返回 synthetic-secret raw-personal-data")

    client.app.state.ai_provider = provider
    preview = setup_ai(client)
    result = client.post(
        "/api/v1/ai/tasks",
        json={"preview_id": preview["preview_id"], "text": preview["text"], "confirmed": True},
    ).json()
    result = wait_result(client, result["id"])
    assert result["status"] == "failed"
    assert "synthetic-secret" not in result["error"] and "raw-personal-data" not in result["error"]


def test_task_timeout_returns_recoverable_message(client, monkeypatch):
    monkeypatch.setattr(ai, "TASK_TIMEOUT_SECONDS", 0.01)

    async def provider(*args):
        await asyncio.sleep(0.1)

    client.app.state.ai_provider = provider
    preview = setup_ai(client)
    result = client.post(
        "/api/v1/ai/tasks",
        json={"preview_id": preview["preview_id"], "text": preview["text"], "confirmed": True},
    ).json()
    result = wait_result(client, result["id"])
    assert result["status"] == "failed" and "超时" in result["error"]


def test_expired_preview_never_dispatches(client, monkeypatch):
    observed = []

    async def provider(*args):
        observed.append(True)
        return {"skill_records": []}

    client.app.state.ai_provider = provider
    monkeypatch.setattr(ai, "PREVIEW_TTL_SECONDS", 0.01)
    preview = setup_ai(client)
    time.sleep(0.02)
    result = client.post(
        "/api/v1/ai/tasks",
        json={"preview_id": preview["preview_id"], "text": preview["text"], "confirmed": True},
    )
    assert result.status_code == 409 and observed == []


def test_cancelled_provider_cannot_publish_late_result(client):
    async def provider(*args):
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            return {"skill_records": []}

    client.app.state.ai_provider = provider
    preview = setup_ai(client)
    result = client.post(
        "/api/v1/ai/tasks",
        json={"preview_id": preview["preview_id"], "text": preview["text"], "confirmed": True},
    ).json()
    cancelled = client.delete(f"/api/v1/ai/tasks/{result['id']}").json()
    assert cancelled["status"] == "cancelled" and "profile" not in cancelled


@pytest.mark.parametrize(
    "url", ["https://example.invalid:invalid", "https://[invalid", "https://example.invalid/with space"]
)
def test_invalid_service_url_rejected(url):
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as error:
        service_url(url)
    assert error.value.status_code == 422
