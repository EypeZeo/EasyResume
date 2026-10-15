import pytest
from easyresume.api import create_app
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path):
    app = create_app(tmp_path)
    with TestClient(app, base_url="http://127.0.0.1") as client:
        headers = {"Origin": "http://127.0.0.1", "X-EasyResume-Client": "workbench"}
        token = client.post("/api/v1/session", headers=headers).json()["token"]
        client.headers.update({"Origin": "http://127.0.0.1", "Authorization": f"Bearer {token}"})
        yield client


@pytest.fixture
def setup_workspace(client):
    profile = client.post(
        "/api/v1/profiles",
        json={
            "name": "合成测试画像",
            "education_completed": "本科",
            "skills": ["Python", "SQL"],
            "experience_years": 3,
            "confirmed": True,
        },
    ).json()
    strategy = client.post(
        "/api/v1/strategies",
        json={
            "name": "测试策略",
            "profile_id": profile["id"],
            "directions": ["开发"],
            "skills": ["Python"],
            "require_double": True,
            "require_social": True,
        },
    ).json()
    return profile, strategy


def create_job(client, text="本科及以上，2年工作经验。Python。固定月薪 10-15K，双休，五险一金。", **changes):
    job = client.post("/api/v1/jobs/parse", json={"text": text}).json()["job"]
    job.update(title="合成开发职位", company="合成企业", city="上海", extraction_checked=True)
    job.update(changes)
    response = client.post("/api/v1/jobs", json={"job": job})
    assert response.status_code == 200, response.text
    return response.json()
