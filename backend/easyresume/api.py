import csv
import hashlib
import hmac
import io
import json
import secrets
import threading
import time
from collections import deque
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from easyresume import __version__
from easyresume.ai import install_ai
from easyresume.db import database, migrate
from easyresume.documents import MAX_FILE, extract_document
from easyresume.engine import ALGORITHM_VERSION, evaluate
from easyresume.execution import digest, invalidate, recover
from easyresume.models import Action, Credential, Record, now_iso, uid
from easyresume.parsing import PARSER_VERSION, parse_job, parse_profile
from easyresume.privacy import csv_cell, public_job, public_profile, redact, safe_url
from easyresume.resume import normalize_profile
from easyresume.schemas import (
    BlacklistInput,
    DraftEditInput,
    DraftInput,
    EvidenceInput,
    Job,
    JobInput,
    ObservationInput,
    OutcomeInput,
    PairInput,
    Profile,
    Strategy,
    StrategyInput,
    TextInput,
)


def serialized(record: Record) -> dict:
    return {
        "id": record.id,
        "kind": record.kind,
        "data": record.data,
        "version": record.version,
        "archived": record.archived,
        "created_at": record.created_at,
        "updated_at": record.updated_at,
    }


def _observation_timestamp(value: str) -> float:
    try:
        parsed = datetime.fromisoformat(value)
        return (parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed).timestamp()
    except (ValueError, TypeError):
        return 0


class ConnectionProbeInput(BaseModel):
    installation_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")
    challenge: str = Field(pattern=r"^[a-f0-9]{64}$")


def create_app(data_dir: Path, *, development=False, static_dir: Path | None = None) -> FastAPI:
    engine, sessions = database(data_dir / "easyresume.sqlite3")
    migrate(engine)
    gui_token = secrets.token_urlsafe(32)
    epoch = uid()

    @asynccontextmanager
    async def lifespan(app):
        with sessions.begin() as session:
            recover(session)
        yield
        await app.state.cancel_ai()
        engine.dispose()

    app = FastAPI(
        title="EasyResume Local API", version=__version__, lifespan=lifespan, docs_url=None, redoc_url=None
    )
    app.state.sessions = sessions
    app.state.epoch = epoch
    app.state.gui_token = gui_token
    app.state.data_dir = data_dir
    connection_lock = threading.Lock()
    connection_activity: dict[str, tuple[float, str]] = {}
    pairing_attempts: deque[float] = deque()

    def touch_connection(installation_id):
        with connection_lock:
            connection_activity[installation_id] = (time.monotonic(), now_iso())

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, exc: RequestValidationError):
        # Validation errors must not reflect resume text, file bytes or API credentials.
        return JSONResponse({"detail": [{"loc": item["loc"], "type": item["type"], "msg": item["msg"]}
                                        for item in exc.errors()]}, status_code=422)

    @app.middleware("http")
    async def boundary(request: Request, call_next):
        try:
            content_length = int(request.headers.get("content-length", "0"))
        except ValueError:
            return JSONResponse({"detail": "无效请求长度"}, status_code=400)
        maximum = 22 * 1024 * 1024 if request.url.path.endswith("/upload") else 10 * 1024 * 1024
        if content_length > maximum:
            return JSONResponse({"detail": "请求超过大小限制"}, status_code=413)
        hostname = (request.headers.get("host", "").split(":")[0]).lower()
        if hostname not in {"127.0.0.1", "localhost"}:
            return JSONResponse({"detail": "仅允许本机访问"}, status_code=403)
        origin = request.headers.get("origin")
        local_origin = origin == f"http://{request.headers.get('host')}"
        if development and origin in {"http://127.0.0.1:5173", "http://localhost:5173"}:
            local_origin = True
        extension_origin = bool(origin and origin.startswith("chrome-extension://"))
        extension_route = request.url.path in {
            "/api/v1/pair",
            "/api/v1/observations",
            "/api/v1/health",
            "/api/v1/connection",
            "/api/v1/connection/probe",
        }
        if origin and not local_origin and not (extension_origin and extension_route):
            return JSONResponse({"detail": "请求来源不受信任"}, status_code=403)
        if request.method == "OPTIONS":
            response = Response(status_code=204)
        else:
            response = await call_next(request)
        if origin and (local_origin or extension_origin and extension_route):
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Headers"] = (
                "Authorization,Content-Type,X-EasyResume-Client"
            )
            response.headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,DELETE,OPTIONS"
            response.headers["Vary"] = "Origin"
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        )
        return response

    def get_session():
        with sessions() as session:
            yield session

    def authenticate(request: Request, session: Session = Depends(get_session)):
        bearer = request.headers.get("authorization", "")
        token = bearer.removeprefix("Bearer ") if bearer.startswith("Bearer ") else ""
        if token and secrets.compare_digest(token, app.state.gui_token):
            return {"role": "workbench", "id": "workbench"}
        if token:
            credential = session.scalar(
                select(Credential).where(
                    Credential.digest == hashlib.sha256(token.encode()).hexdigest(),
                    Credential.revoked.is_(False),
                    Credential.role == "reader",
                )
            )
            if credential:
                return {"role": "reader", "id": credential.id}
        raise HTTPException(401, "连接已失效，请从本地工作台重新连接")

    def workbench(auth=Depends(authenticate)):
        if auth["role"] != "workbench":
            raise HTTPException(403, "只读扩展无权执行此操作")
        return auth

    install_ai(app, sessions, workbench)

    @app.post("/api/v1/connection/probe")
    def connection_probe(body: ConnectionProbeInput, request: Request, session: Session = Depends(get_session)):
        # Discovery must not send a Bearer credential to an unverified local port.
        # Only the original credential database can prove possession of its digest.
        credential = session.get(Credential, body.installation_id)
        if not credential or credential.role != "reader":
            raise HTTPException(404, "未找到此连接")
        status = "revoked" if credential.revoked else "active"
        # Bind the proof to the actual listener, not a caller-supplied Host header.
        port = request.scope["server"][1]
        origin = "http://127.0.0.1" + (f":{port}" if port != 80 else "")
        message = f"EasyResume:1:{body.installation_id}:{body.challenge}:{epoch}:{status}:{origin}"
        proof = hmac.new(credential.digest.encode(), message.encode(), hashlib.sha256).hexdigest()
        return {
            "name": "EasyResume", "protocol": 1, "installation_id": body.installation_id,
            "challenge": body.challenge, "instance": epoch, "status": status, "origin": origin, "proof": proof,
        }

    @app.get("/api/v1/connection")
    def connection(auth=Depends(authenticate)):
        if auth["role"] == "reader":
            touch_connection(auth["id"])
        return {"protocol": 1, "installation_id": auth["id"], "instance": epoch, "permissions": ["read"]}

    @app.delete("/api/v1/connection")
    def disconnect(auth=Depends(authenticate), session: Session = Depends(get_session)):
        if auth["role"] != "reader":
            raise HTTPException(403, "此接口只用于扩展断开自身连接")
        credential = session.get(Credential, auth["id"])
        credential.revoked = True
        invalidate(session, "扩展连接撤销")
        session.commit()
        with connection_lock:
            connection_activity.pop(auth["id"], None)
        return {"revoked": True}

    @app.get("/api/v1/connections/status", dependencies=[Depends(workbench)])
    def connection_status(session: Session = Depends(get_session)):
        connections = []
        with connection_lock:
            activity = dict(connection_activity)
        for credential in session.scalars(
            select(Credential).where(Credential.role == "reader", Credential.revoked.is_(False))
        ):
            seen = activity.get(credential.id)
            connections.append({
                "id": credential.id, "label": credential.label, "created_at": credential.created_at,
                "state": "connected" if seen and time.monotonic() - seen[0] < 20 else "idle",
                "last_seen_at": seen[1] if seen else None,
            })
        return {"connections": connections, "active_window_seconds": 20}

    def get_record(session, record_id, kind=None):
        record = session.get(Record, record_id)
        if not record or kind and record.kind != kind:
            raise HTTPException(404, "记录不存在")
        return record

    def all_kind(session, kind, include_archived=False):
        query = select(Record).where(Record.kind == kind)
        if not include_archived:
            query = query.where(Record.archived.is_(False))
        return list(session.scalars(query.order_by(Record.created_at.desc())))

    def add(session, kind, data, record_id=None):
        record = Record(id=record_id or uid(), kind=kind, data=data)
        session.add(record)
        session.flush()
        return record

    def change(session, record, data, expected):
        if expected is None or expected != record.version:
            raise HTTPException(409, "记录已变化，请刷新后重新核对")
        old = serialized(record)
        updated = session.execute(
            update(Record)
            .where(Record.id == record.id, Record.version == expected)
            .values(data=data, version=expected + 1, updated_at=now_iso())
        )
        if updated.rowcount != 1:
            raise HTTPException(409, "并发修改冲突，请刷新")
        add(session, "history", {"record": old})
        invalidate(session, "记录版本已变化")
        session.flush()
        session.refresh(record)
        return record

    def assess(session, record, strategy_record):
        strategy = Strategy.model_validate(strategy_record.data)
        profile_record = session.get(Record, strategy.profile_id) if strategy.profile_id else None
        profile = (
            Profile.model_validate(profile_record.data)
            if profile_record and profile_record.kind == "profile"
            else None
        )
        blocked = [{**b.data, "job_id": record.id} for b in all_kind(session, "blacklist")]
        result = evaluate(Job.model_validate(record.data), profile, strategy, blocked)
        result["snapshot"] = {
            "job_id": record.id,
            "job_version": record.version,
            "profile_id": strategy.profile_id,
            "strategy_id": strategy_record.id,
            "strategy_version": strategy_record.version,
        }
        return result

    def save_assessments(session):
        for strategy_record in all_kind(session, "strategy"):
            for job_record in all_kind(session, "job"):
                result = assess(session, job_record, strategy_record)
                fingerprint = digest(
                    {
                        "snapshot": result["snapshot"],
                        "algorithm": ALGORITHM_VERSION,
                        "reasons": result["reasons"],
                        "low": result["low"],
                        "high": result["high"],
                    }
                )
                exists = session.get(Record, fingerprint)
                if not exists:
                    add(
                        session,
                        "evaluation",
                        {"result": result, "job": job_record.data, "strategy": strategy_record.data},
                        fingerprint,
                    )

    @app.get("/api/v1/health")
    def health():
        return {
            "name": "EasyResume",
            "version": __version__,
            "protocol": 1,
            "instance": epoch,
            "mode": "read_only_platform",
            "capabilities": ["observe_boss"],
            "verified_actions": [],
            "platform_status": "experimental_unverified",
        }

    @app.post("/api/v1/session")
    def local_session(request: Request):
        origin = request.headers.get("origin", "")
        allowed = {f"http://{request.headers.get('host')}"}
        if development:
            allowed |= {"http://127.0.0.1:5173", "http://localhost:5173"}
        if origin not in allowed or request.headers.get("x-easyresume-client") != "workbench":
            raise HTTPException(403, "请从本地工作台打开")
        return {"token": app.state.gui_token, "protocol": 1, "instance": epoch}

    @app.get("/api/v1/state", dependencies=[Depends(workbench)])
    def state(strategy_id: str | None = None, session: Session = Depends(get_session)):
        strategies = all_kind(session, "strategy")
        current = session.get(Record, strategy_id) if strategy_id else strategies[0] if strategies else None
        if current and current.kind != "strategy":
            raise HTTPException(404, "策略不存在")
        jobs = []
        for record in all_kind(session, "job"):
            jobs.append(
                {**serialized(record), "assessment": assess(session, record, current) if current else None}
            )
        display_order = {"candidate": 0, "pending": 1, "stretch": 2, "excluded": 3}
        jobs.sort(
            key=lambda j: (
                display_order.get((j["assessment"] or {}).get("group"), 4),
                -((j["assessment"] or {}).get("low") or 0),
                ((j["assessment"] or {}).get("high") or 0) - ((j["assessment"] or {}).get("low") or 0),
                -_observation_timestamp(j["data"].get("observed_at", "")),
            )
        )
        return {
            "profiles": [serialized(p) for p in all_kind(session, "profile")],
            "strategies": [serialized(s) for s in strategies],
            "current_strategy_id": current.id if current else None,
            "jobs": jobs,
            "blacklist": [serialized(x) for x in all_kind(session, "blacklist")],
            "drafts": [serialized(x) for x in all_kind(session, "draft")],
            "outcomes": [serialized(x) for x in all_kind(session, "outcome")],
            "observations": [serialized(x) for x in all_kind(session, "observation")],
            "connections": [
                {"id": c.id, "label": c.label, "created_at": c.created_at}
                for c in session.scalars(
                    select(Credential).where(Credential.role == "reader", Credential.revoked.is_(False))
                )
            ],
            "features": {
                "sending": False,
                "cloud_ai": True,
                "ocr": False,
                "company_api": False,
                "maps": False,
            },
            "parser_version": PARSER_VERSION,
        }

    @app.post("/api/v1/profiles/parse", dependencies=[Depends(workbench)])
    def profile_parse(body: TextInput):
        return {
            "profile": parse_profile(body.text),
            "parser_version": PARSER_VERSION,
            "warnings": ["规则仅用于预填；请核对学历、在读状态与相关工作年限"],
        }

    @app.post("/api/v1/scratch", dependencies=[Depends(workbench)])
    def scratch_save(body: dict, session: Session = Depends(get_session)):
        session.connection().exec_driver_sql("BEGIN IMMEDIATE")
        if "payload" in body:
            kind, entity = body.get("kind"), body.get("entity_id", "new")
            if (
                kind not in {"profile", "strategy", "job"}
                or not isinstance(entity, str)
                or len(entity) > 100
                or not isinstance(body["payload"], dict)
                or len(json.dumps(body["payload"], ensure_ascii=False)) > 300000
            ):
                raise HTTPException(422, "编辑草稿格式不正确")
            if kind == "profile":
                if entity != "new":
                    get_record(session, entity, "profile")
                if body["payload"].get("parent_id"):
                    get_record(session, body["payload"]["parent_id"], "profile")
            record_id = "scratch-" + digest({"kind": kind, "entity": entity})[:48]
            existing = session.get(Record, record_id)
            expected = body.get("expected_version")
            actual = existing.version if existing else 0
            if expected != actual:
                raise HTTPException(409, "另一窗口已修改草稿，请恢复最新草稿后继续")
            data = {
                "entity_id": entity,
                "payload": body["payload"],
                "base_version": body.get("base_version"),
                "profile_id": entity if kind == "profile" else body["payload"].get("profile_id"),
            }
            if existing:
                changed = session.execute(
                    update(Record)
                    .where(Record.id == record_id, Record.version == expected)
                    .values(data=data, version=expected + 1, updated_at=now_iso())
                )
                if changed.rowcount != 1:
                    raise HTTPException(409, "草稿已变化，请重新读取")
            else:
                try:
                    add(session, "scratch", data, record_id)
                except IntegrityError as exc:
                    session.rollback()
                    raise HTTPException(409, "另一窗口已创建草稿，请重新读取") from exc
            session.commit()
            return {**data, "saved": True, "version": actual + 1}
        kind, text = body.get("kind"), body.get("text")
        if kind not in {"job", "profile"} or not isinstance(text, str) or len(text) > 100000:
            raise HTTPException(422, "输入草稿格式不正确")
        record_id = f"scratch-{kind}"
        existing = session.get(Record, record_id)
        data = {"text": text, "profile_id": body.get("profile_id") if kind == "profile" else None}
        if data["profile_id"]:
            get_record(session, data["profile_id"], "profile")
        if existing:
            existing.data = data
            existing.updated_at = now_iso()
        else:
            add(session, "scratch", data, record_id)
        session.commit()
        return {"saved": True}

    @app.get("/api/v1/scratch/{kind}", dependencies=[Depends(workbench)])
    def scratch_read(kind: str, entity_id: str | None = None, session: Session = Depends(get_session)):
        if kind not in {"job", "profile", "strategy"}:
            raise HTTPException(404)
        if entity_id is not None:
            record_id = "scratch-" + digest({"kind": kind, "entity": entity_id})[:48]
            record = session.get(Record, record_id)
            return {**record.data, "version": record.version} if record else {"payload": None, "version": 0}
        record = session.get(Record, f"scratch-{kind}")
        return record.data if record else {"text": ""}

    @app.post("/api/v1/profiles/upload", dependencies=[Depends(workbench)])
    def profile_upload(file: UploadFile):
        data = file.file.read(MAX_FILE + 1)
        try:
            result = extract_document(data)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        return {
            "profile": parse_profile(result["text"]),
            "format": result["format"],
            "parser_version": PARSER_VERSION,
            "warnings": result.get("warnings", []),
        }

    @app.post("/api/v1/profiles", dependencies=[Depends(workbench)])
    def profile_save(body: Profile, session: Session = Depends(get_session)):
        session.connection().exec_driver_sql("BEGIN IMMEDIATE")
        if body.parent_id:
            get_record(session, body.parent_id, "profile")
        record = add(session, "profile", normalize_profile(body).model_dump())
        invalidate(session, "画像已更新，请重新生成草稿")
        session.commit()
        return serialized(record)

    @app.delete("/api/v1/profiles/{record_id}", dependencies=[Depends(workbench)])
    async def profile_delete(record_id: str, session: Session = Depends(get_session)):
        session.connection().exec_driver_sql("BEGIN IMMEDIATE")
        get_record(session, record_id, "profile")
        await app.state.cancel_ai()
        ids = {record_id}
        profiles = all_kind(session, "profile", True)
        while True:
            children = {p.id for p in profiles if p.data.get("parent_id") in ids}
            if children <= ids:
                break
            ids |= children
        for strategy in all_kind(session, "strategy", True):
            if strategy.data.get("profile_id") in ids:
                strategy.data = {**strategy.data, "profile_id": None}
                strategy.version += 1
        for r in list(session.scalars(select(Record))):
            related = r.data.get("profile_id") in ids
            if r.kind == "scratch":
                payload = r.data.get("payload", {})
                related |= payload.get("parent_id") in ids or payload.get("profile_id") in ids
            if r.kind == "evaluation":
                related = r.data.get("result", {}).get("snapshot", {}).get("profile_id") in ids
            elif r.kind == "history":
                old = r.data.get("record", {})
                related = old.get("id") in ids or old.get("data", {}).get("profile_id") in ids
            if r.id in ids or related:
                session.delete(r)
        invalidate(session, "画像已删除")
        session.commit()
        return {"deleted": len(ids), "note": "原文、画像及本地衍生草稿已删除；外部备份不会自动删除"}

    @app.post("/api/v1/strategies", dependencies=[Depends(workbench)])
    def strategy_create(body: Strategy, session: Session = Depends(get_session)):
        session.connection().exec_driver_sql("BEGIN IMMEDIATE")
        if body.profile_id:
            get_record(session, body.profile_id, "profile")
        record = add(session, "strategy", body.model_dump())
        save_assessments(session)
        session.commit()
        return serialized(record)

    @app.put("/api/v1/strategies/{record_id}", dependencies=[Depends(workbench)])
    def strategy_change(record_id: str, body: StrategyInput, session: Session = Depends(get_session)):
        session.connection().exec_driver_sql("BEGIN IMMEDIATE")
        if body.strategy.profile_id:
            get_record(session, body.strategy.profile_id, "profile")
        record = change(
            session,
            get_record(session, record_id, "strategy"),
            body.strategy.model_dump(),
            body.expected_version,
        )
        save_assessments(session)
        session.commit()
        return serialized(record)

    @app.post("/api/v1/strategies/preview", dependencies=[Depends(workbench)])
    def strategy_preview(body: Strategy, session: Session = Depends(get_session)):
        temporary = Record(id="preview", kind="strategy", data=body.model_dump(), version=0)
        return {
            "preview_only": True,
            "results": [
                {"id": j.id, "title": j.data["title"], "assessment": assess(session, j, temporary)}
                for j in all_kind(session, "job")
            ],
        }

    @app.post("/api/v1/jobs/parse", dependencies=[Depends(workbench)])
    def job_parse(body: TextInput):
        return {"job": parse_job(body.text), "parser_version": PARSER_VERSION}

    @app.post("/api/v1/jobs", dependencies=[Depends(workbench)])
    def job_save(body: JobInput, session: Session = Depends(get_session)):
        job = body.job
        if not job.title.strip() or not job.company.strip():
            raise HTTPException(422, "请填写职位名称和公司主体")
        identity = (
            {"platform": job.platform, "platform_job_id": job.platform_job_id}
            if job.platform_job_id
            else {
                "title": job.title.strip(),
                "company": job.company.strip(),
                "city": job.city.strip(),
                "text": job.text,
            }
        )
        record_id = digest(identity)
        existing = session.get(Record, record_id)
        if existing:
            return {**serialized(existing), "duplicate": True}
        for evidence in job.evidence:
            if evidence.source == "page" and evidence.field in {
                "rest",
                "social",
                "fund",
                "dispatch",
                "outsourcing",
                "education",
                "experience",
            }:
                value = getattr(job, "experience_min" if evidence.field == "experience" else evidence.field)
                if value != evidence.value:
                    evidence.note = "用户已校正提取；依据类别仍为页面声明"
                    evidence.value = value
                evidence.extraction_checked = job.extraction_checked
        record = add(session, "job", job.model_dump(), record_id)
        save_assessments(session)
        session.commit()
        return serialized(record)

    @app.post("/api/v1/jobs/{record_id}/evidence/{index}/retract", dependencies=[Depends(workbench)])
    def evidence_retract(
        record_id: str, index: int, body: TextInput, session: Session = Depends(get_session)
    ):
        record = get_record(session, record_id, "job")
        job = Job.model_validate(record.data)
        if index < 0 or index >= len(job.evidence):
            raise HTTPException(404, "证据不存在")
        job.evidence[index].active = False
        job.evidence[index].note = "用户撤回：" + body.text[:280]
        field = job.evidence[index].field
        remaining = [e for e in job.evidence if e.field == field and e.active]
        if field in {
            "rest",
            "social",
            "fund",
            "dispatch",
            "outsourcing",
            "ownership",
            "contract_company",
            "service_company",
        }:
            empty = (
                "unknown"
                if field in {"rest", "ownership"}
                else ""
                if field in {"contract_company", "service_company"}
                else None
            )
            setattr(job, field, remaining[-1].value if remaining else empty)
        elif not remaining and field == "education":
            job.education = "unknown"
            job.education_mode = "unknown"
            job.education_form = "unknown"
        elif not remaining and field == "experience":
            job.experience_min = None
        elif not remaining and field == "salary":
            job.salary_min = job.salary_max = None
            job.salary_kind = "unknown"
            job.salary_period = "unknown"
        record = change(session, record, job.model_dump(), record.version)
        save_assessments(session)
        session.commit()
        return serialized(record)

    @app.post("/api/v1/observations/{record_id}/accept", dependencies=[Depends(workbench)])
    def accept_observation(record_id: str, body: JobInput, session: Session = Depends(get_session)):
        observation = get_record(session, record_id, "observation")
        record = get_record(session, observation.data.get("job_id", ""), "job")
        if (
            body.job.platform != record.data["platform"]
            or body.job.platform_job_id != record.data["platform_job_id"]
        ):
            raise HTTPException(409, "观察与原职位身份不一致，请单独导入")
        record = change(session, record, body.job.model_dump(), body.expected_version)
        observation.data = {k: v for k, v in observation.data.items() if k != "proposed_job"}
        observation.data = {**observation.data, "status": "reviewed"}
        save_assessments(session)
        session.commit()
        return serialized(record)

    @app.put("/api/v1/jobs/{record_id}", dependencies=[Depends(workbench)])
    def job_change(record_id: str, body: JobInput, session: Session = Depends(get_session)):
        record = change(
            session, get_record(session, record_id, "job"), body.job.model_dump(), body.expected_version
        )
        save_assessments(session)
        session.commit()
        return serialized(record)

    @app.post("/api/v1/jobs/{record_id}/evidence", dependencies=[Depends(workbench)])
    def evidence_add(record_id: str, body: EvidenceInput, session: Session = Depends(get_session)):
        record = get_record(session, record_id, "job")
        job = Job.model_validate(record.data)
        field = body.evidence.field
        if field not in {
            "rest",
            "social",
            "fund",
            "dispatch",
            "outsourcing",
            "ownership",
            "contract_company",
            "service_company",
        }:
            raise HTTPException(422, "此字段请在职位编辑页确认")
        if field in {"social", "fund", "dispatch", "outsourcing"} and not isinstance(
            body.evidence.value, bool
        ):
            raise HTTPException(422, "此字段需要是/否值")
        if len(job.evidence) >= 100:
            raise HTTPException(422, "证据已达上限")
        job.evidence.append(body.evidence)
        setattr(job, field, body.evidence.value)
        try:
            data = Job.model_validate(job.model_dump()).model_dump()
        except ValueError as exc:
            raise HTTPException(422, "证据值格式不正确") from exc
        record = change(session, record, data, body.expected_version)
        save_assessments(session)
        session.commit()
        return serialized(record)

    @app.post("/api/v1/blacklist", dependencies=[Depends(workbench)])
    def blacklist_add(body: BlacklistInput, session: Session = Depends(get_session)):
        record = add(session, "blacklist", body.model_dump())
        invalidate(session, "黑名单变化")
        save_assessments(session)
        session.commit()
        return serialized(record)

    @app.delete("/api/v1/blacklist/{record_id}", dependencies=[Depends(workbench)])
    def blacklist_delete(record_id: str, session: Session = Depends(get_session)):
        record = get_record(session, record_id, "blacklist")
        record.archived = True
        save_assessments(session)
        session.commit()
        return {"restored": True}

    @app.post("/api/v1/drafts", dependencies=[Depends(workbench)])
    def draft_create(body: DraftInput, session: Session = Depends(get_session)):
        session.connection().exec_driver_sql("BEGIN IMMEDIATE")
        job_record = get_record(session, body.job_id, "job")
        strategy_record = get_record(session, body.strategy_id, "strategy")
        profile_id = strategy_record.data.get("profile_id")
        profile_record = session.get(Record, profile_id) if profile_id else None
        if not profile_record or not profile_record.data.get("confirmed"):
            raise HTTPException(409, "请先确认简历并绑定策略")
        assessment = assess(session, job_record, strategy_record)
        if assessment["group"] == "excluded":
            raise HTTPException(409, "岗位已排除，请先明确修改相关条件")
        if body.kind == "questions":
            content = "您好，想进一步了解这个岗位：\n" + "\n".join(
                assessment["questions"] or ["请问实际工作地点、固定薪资和合同签约主体分别是什么？"]
            )
            facts = []
        else:
            skills = [
                s
                for s in profile_record.data["skills"]
                if s.casefold() in {j.casefold() for j in job_record.data["skills"]}
            ]
            content = f"您好，关注到贵司的{job_record.data['title']}岗位。"
            facts = []
            degree = profile_record.data["education_completed"]
            if degree not in {"unknown", "none"}:
                content += f"我的已完成学历是{degree}。"
                facts.append(f"已确认学历：{degree}")
            if skills:
                content += "简历中包含" + "、".join(skills[:3]) + "相关经历，想进一步了解岗位要求。"
                facts.append("已确认技能：" + "、".join(skills[:3]))
            else:
                content += "希望进一步了解岗位职责与匹配要求。"
            if assessment["group"] == "stretch":
                content += "部分资格条件存在差距，想请问是否接受相近经历。"
        data = {
            "job_id": job_record.id,
            "job_version": job_record.version,
            "strategy_id": strategy_record.id,
            "strategy_version": strategy_record.version,
            "profile_id": profile_record.id,
            "content": content,
            "facts": facts,
            "kind": body.kind,
            "sending_enabled": False,
        }
        record = add(session, "draft", data)
        session.commit()
        return serialized(record)

    @app.put("/api/v1/drafts/{record_id}", dependencies=[Depends(workbench)])
    def draft_edit(record_id: str, body: DraftEditInput, session: Session = Depends(get_session)):
        record = get_record(session, record_id, "draft")
        record = change(session, record, {**record.data, "content": body.text}, body.expected_version)
        session.commit()
        return serialized(record)

    @app.post("/api/v1/actions", dependencies=[Depends(workbench)])
    def sending_gate():
        raise HTTPException(409, "平台动作尚未通过真实验证；当前仅支持生成草稿和人工操作，不会派发发送指令")

    @app.post("/api/v1/pairing", dependencies=[Depends(workbench)])
    def pairing(request: Request, session: Session = Depends(get_session)):
        # Twenty random digits provide ~66 bits; the five-digit port is routing only.
        code = "".join(str(secrets.randbelow(10)) for _ in range(20))
        add_expiry = (datetime.now(UTC) + timedelta(minutes=5)).isoformat()
        session.add(
            Credential(
                digest=hashlib.sha256(code.encode()).hexdigest(), role="pairing", expires_at=add_expiry
            )
        )
        session.commit()
        return {
            "code": code,
            "connection_code": "-".join([
                f"{request.url.port or 80:05d}", *(code[i:i + 5] for i in range(0, 20, 5))
            ]),
            "expires_at": add_expiry,
            "permissions": ["observe_boss"],
            "note": "只读配对，不授予发送或审批权限",
        }

    @app.post("/api/v1/pair")
    def pair(body: PairInput, session: Session = Depends(get_session)):
        if body.protocol != 1:
            raise HTTPException(409, "扩展协议不兼容，请升级")
        # Global process-wide bound, so opening more tabs cannot multiply guesses.
        with connection_lock:
            current = time.monotonic()
            while pairing_attempts and current - pairing_attempts[0] >= 60:
                pairing_attempts.popleft()
            if len(pairing_attempts) >= 10:
                raise HTTPException(429, "连接尝试过于频繁，请一分钟后重试")
            pairing_attempts.append(current)
        hashed = hashlib.sha256(body.code.encode()).hexdigest()
        result = session.execute(
            update(Credential)
            .where(
                Credential.digest == hashed,
                Credential.role == "pairing",
                Credential.revoked.is_(False),
                Credential.expires_at > now_iso(),
            )
            .values(revoked=True)
        )
        if result.rowcount != 1:
            raise HTTPException(403, "配对码已过期或已使用")
        token = secrets.token_urlsafe(32)
        credential = Credential(
            digest=hashlib.sha256(token.encode()).hexdigest(), role="reader", label=body.label
        )
        session.add(credential)
        session.commit()
        touch_connection(credential.id)
        return {
            "token": token,
            "protocol": 1,
            "instance": epoch,
            "installation_id": credential.id,
            "permissions": ["observe_boss"],
        }

    @app.delete("/api/v1/connections/{record_id}", dependencies=[Depends(workbench)])
    def revoke(record_id: str, session: Session = Depends(get_session)):
        credential = session.get(Credential, record_id)
        if not credential:
            raise HTTPException(404, "连接不存在")
        credential.revoked = True
        invalidate(session, "扩展连接撤销")
        session.commit()
        return {"revoked": True}

    @app.post("/api/v1/observations")
    def observe(body: ObservationInput, auth=Depends(authenticate), session: Session = Depends(get_session)):
        if body.protocol != 1:
            raise HTTPException(409, "协议版本不兼容")
        parsed_url = urlsplit(body.url)
        platforms = {"www.zhipin.com": "boss", "zhipin.com": "boss", "www.zhaopin.com": "zhaopin",
                     "zhaopin.com": "zhaopin", "sou.zhaopin.com": "zhaopin", "jobs.zhaopin.com": "zhaopin"}
        platform = platforms.get(parsed_url.hostname)
        if parsed_url.scheme != "https" or not platform or parsed_url.username or parsed_url.password:
            raise HTTPException(422, "仅接受 BOSS 或智联职位页面观察")
        if any(part in parsed_url.path.lower() for part in ("/chat", "/passport", "/login", "/resume", "/user/")):
            raise HTTPException(422, "不接受聊天、登录或个人资料页面")
        if body.blocked:
            raise HTTPException(409, "检测到验证或异常，请在平台处理后手动恢复")
        observation_id = digest(
            {
                "installation": auth["id"],
                "url": safe_url(body.url),
                "job": body.platform_job_id,
                "text": body.text,
                "title": body.title,
                "company": body.company,
                "city": body.city,
                "employment_type": body.employment_type,
                "recruitment_type": body.recruitment_type,
            }
        )
        if session.get(Record, observation_id):
            return {"duplicate": True, "id": observation_id}
        observation = add(
            session,
            "observation",
            {
                "url": safe_url(body.url),
                "city": body.city,
                "page_kind": body.page_kind,
                "employment_type": body.employment_type,
                "recruitment_type": body.recruitment_type,
                "platform_job_id": body.platform_job_id,
                "account_identified": False,
                "installation_id": auth["id"],
                "status": "awaiting_review",
                "observed_at": now_iso(),
            },
            observation_id,
        )
        job = parse_job(
            redact(body.text),
            title=redact(body.title),
            company=redact(body.company),
            city=body.city,
            platform=platform,
            source_url=safe_url(body.url),
            platform_job_id=body.platform_job_id,
        )
        key = (
            digest({"platform": platform, "platform_job_id": body.platform_job_id})
            if body.platform_job_id
            else digest({"observation": observation_id})
        )
        existing = session.get(Record, key)
        changed = bool(
            existing
            and any(
                existing.data.get(field) != getattr(job, field)
                for field in ["text", "title", "company", "city"]
            )
        )
        if not existing:
            add(session, "job", job.model_dump(), key)
        else:
            observation.data = {
                **observation.data,
                "status": "changed_requires_review" if changed else "repeat",
            }
        observation.data = {**observation.data, "job_id": key}
        if changed:
            proposal = {
                **job.model_dump(),
                "saved": existing.data.get("saved", False),
                "progress": existing.data.get("progress", "discovered"),
                "evidence": existing.data.get("evidence", []) + job.model_dump()["evidence"],
            }
            observation.data = {**observation.data, "proposed_job": proposal}
        save_assessments(session)
        session.commit()
        return {
            "id": observation.id,
            "job_id": key,
            "status": observation.data["status"],
            "sending_enabled": False,
        }

    @app.get("/api/v1/export.csv", dependencies=[Depends(workbench)])
    def export_csv(strategy_id: str | None = None, session: Session = Depends(get_session)):
        strategy = (
            get_record(session, strategy_id, "strategy")
            if strategy_id
            else next(iter(all_kind(session, "strategy")), None)
        )
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(
            ["职位", "公司", "城市", "分组", "匹配下限", "匹配上限", "原因", "下一步", "来源链接"]
        )
        for record in all_kind(session, "job"):
            result = assess(session, record, strategy) if strategy else {}
            writer.writerow(
                [
                    csv_cell(x)
                    for x in [
                        record.data["title"],
                        record.data["company"],
                        record.data["city"],
                        result.get("label", "未评估"),
                        result.get("low"),
                        result.get("high"),
                        "；".join(r["message"] for r in result.get("reasons", [])),
                        "；".join(result.get("questions", [])),
                        safe_url(record.data["source_url"]),
                    ]
                ]
            )
        return Response(
            "\ufeff" + output.getvalue(),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="easyresume-jobs.csv"'},
        )

    @app.get("/api/v1/backup", dependencies=[Depends(workbench)])
    def backup(session: Session = Depends(get_session)):
        records = []
        for record in session.scalars(
            select(Record).where(Record.kind.in_(["profile", "strategy", "job", "blacklist"]))
        ):
            data = record.data.copy()
            if record.kind == "job":
                data = public_job(data)
            if record.kind == "profile":
                data = public_profile(data)
            records.append({"id": record.id, "kind": record.kind, "data": data, "archived": record.archived})
        return {
            "format": "easyresume-backup",
            "version": 2,
            "created_at": now_iso(),
            "omissions": [
                "原文和证据片段",
                "HR信息与活跃状态",
                "聊天与草稿",
                "简历原件及姓名",
                "连接凭据与操作授权",
            ],
            "records": records,
            "restore_notice": "恢复的是脱敏历史，画像与字段需要重新确认；不会恢复发送权限。旧备份可能重新带回曾删除的记录。",
        }

    def validate_backup(body: dict):
        if (
            not isinstance(body, dict)
            or body.get("format") != "easyresume-backup"
            or body.get("version") not in {1, 2}
            or not isinstance(body.get("records"), list)
            or len(body["records"]) > 10000
        ):
            raise HTTPException(422, "备份格式或版本不支持")
        validated = []
        ids = set()
        try:
            for item in body["records"]:
                if (
                    not isinstance(item, dict)
                    or not isinstance(item.get("id"), str)
                    or not item["id"]
                    or len(item["id"]) > 64
                    or item["id"] in ids
                    or item["id"] == "ai-config"
                    or item["id"].startswith("scratch-")
                ):
                    raise ValueError("重复或无效ID")
                ids.add(item["id"])
                kind, data = item["kind"], item["data"]
                if not isinstance(data, dict):
                    raise ValueError("无效记录")
                if kind == "job":
                    data = {k: v for k, v in public_job(data).items() if k != "privacy_omissions"}
                    data = Job.model_validate(data).model_dump()
                elif kind == "profile":
                    data = Profile.model_validate(
                        public_profile(Profile.model_validate(data).model_dump())
                    ).model_dump()
                elif kind == "strategy":
                    data = Strategy.model_validate(data).model_dump()
                elif kind == "blacklist":
                    data = BlacklistInput.model_validate(data).model_dump()
                else:
                    raise ValueError("不支持的记录类型")
                validated.append(
                    {"id": item["id"], "kind": kind, "data": data, "archived": bool(item.get("archived"))}
                )
        except (ValueError, KeyError, TypeError) as exc:
            raise HTTPException(422, "备份包含无效记录") from exc
        return validated

    @app.post("/api/v1/restore/preview", dependencies=[Depends(workbench)])
    def restore_preview(body: dict, session: Session = Depends(get_session)):
        validated = validate_backup(body)
        check_restore_collisions(validated, session)
        existing = {r.id for r in session.scalars(select(Record))}
        return {
            "digest": restore_digest(body, session),
            "counts": {
                k: sum(r["kind"] == k for r in validated) for k in ["profile", "strategy", "job", "blacklist"]
            },
            "new_counts": {
                k: sum(r["kind"] == k and r["id"] not in existing for r in validated)
                for k in ["profile", "strategy", "job", "blacklist"]
            },
            "skipped_counts": {
                k: sum(r["kind"] == k and r["id"] in existing for r in validated)
                for k in ["profile", "strategy", "job", "blacklist"]
            },
            "omissions": body.get("omissions", []),
            "warning": "将合并脱敏历史；不覆盖现有记录，不恢复授权，撤销扩展连接。画像、证据需重新确认；已删除的历史资料可能重新出现。",
        }

    def restore_digest(body, session):
        current = [
            (r.id, r.kind, r.version, r.updated_at, r.archived)
            for r in session.scalars(
                select(Record)
                .where(Record.kind.in_(["profile", "strategy", "job", "blacklist"]))
                .order_by(Record.id)
            )
        ]
        return digest({"backup": body, "current": current})

    def check_restore_collisions(records, session):
        for record in records:
            existing = session.get(Record, record["id"])
            if existing and existing.kind != record["kind"]:
                raise HTTPException(422, "备份记录标识与现有数据冲突，请检查备份来源")

    @app.post("/api/v1/restore", dependencies=[Depends(workbench)])
    async def restore(body: dict, session: Session = Depends(get_session)):
        # Hold the SQLite writer reservation between preview validation and merge.
        session.connection().exec_driver_sql("BEGIN IMMEDIATE")
        source = body.get("backup", {})
        if body.get("preview_digest") != restore_digest(source, session):
            raise HTTPException(409, "备份已变化，请重新预览")
        records = validate_backup(source)
        check_restore_collisions(records, session)
        await app.state.cancel_ai()
        inserted = 0
        for item in records:
            if not session.get(Record, item["id"]):
                record = add(session, item["kind"], item["data"], item["id"])
                record.archived = item["archived"]
                inserted += 1
        invalidate(session, "备份恢复使旧授权失效")
        session.execute(
            update(Action).where(Action.state == "possible").values(state="unknown", result="恢复后需要核对")
        )
        session.execute(update(Credential).values(revoked=True))
        session.commit()
        app.state.gui_token = secrets.token_urlsafe(32)
        return {
            "inserted": inserted,
            "sending_enabled": False,
            "reconnect": True,
            "note": "已合并脱敏历史；原文与证据片段因隐私设置未备份，不是数据损坏。请重新核对画像并配对扩展。",
        }

    @app.post("/api/v1/undo/{record_id}", dependencies=[Depends(workbench)])
    def undo(record_id: str, session: Session = Depends(get_session)):
        record = get_record(session, record_id)
        history = [h for h in all_kind(session, "history") if h.data["record"]["id"] == record_id]
        if not history:
            raise HTTPException(404, "没有可撤销的本地编辑")
        previous = history[0].data["record"]
        data = previous["data"]
        change(session, record, data, record.version)
        history[0].archived = True
        save_assessments(session)
        session.commit()
        return serialized(record)

    @app.post("/api/v1/outcomes", dependencies=[Depends(workbench)])
    def outcome(body: OutcomeInput, session: Session = Depends(get_session)):
        get_record(session, body.job_id, "job")
        contact_id = digest({"job": body.job_id, "event": "first_contact"})
        contact = session.get(Record, contact_id)
        if body.kind == "contact":
            if contact:
                return serialized(contact)
            if not body.strategy_id:
                raise HTTPException(422, "首次联系需要选择策略")
            strategy_record = get_record(session, body.strategy_id, "strategy")
            event = add(
                session,
                "outcome",
                {
                    "job_id": body.job_id,
                    "strategy_id": strategy_record.id,
                    "strategy_version": strategy_record.version,
                    "kind": "contact",
                    "source": "manual_report",
                    "observed_at": now_iso(),
                },
                contact_id,
            )
        else:
            if not contact:
                raise HTTPException(409, "请先人工登记首次联系，再记录后续结果")
            data = {**contact.data, "kind": body.kind, "observed_at": now_iso()}
            event_id = digest({"job": body.job_id, "event": body.kind})
            event = session.get(Record, event_id) or add(session, "outcome", data, event_id)
        session.commit()
        return serialized(event)

    @app.get("/api/v1/statistics", dependencies=[Depends(workbench)])
    def statistics(session: Session = Depends(get_session)):
        events = all_kind(session, "outcome")
        contacts = [r for r in events if r.data["kind"] == "contact"]
        cohorts = {}
        for contact in contacts:
            key = f"{contact.data['strategy_id']}@{contact.data['strategy_version']}"
            cohort = cohorts.setdefault(
                key,
                {
                    "strategy_id": contact.data["strategy_id"],
                    "strategy_version": contact.data["strategy_version"],
                    "contacts": 0,
                    "positive": 0,
                    "negative": 0,
                    "interview": 0,
                    "offer": 0,
                    "no_reply": 0,
                    "unrecorded": 0,
                    "awaiting_window": 0,
                    "window_contacts": 0,
                    "window_positive": 0,
                },
            )
            cohort["contacts"] += 1
            followups = {
                r.data["kind"]: r
                for r in events
                if r.data["job_id"] == contact.data["job_id"] and r.data["kind"] != "contact"
            }
            for kind in ["positive", "negative", "interview", "offer", "no_reply"]:
                cohort[kind] += kind in followups
            if not followups or set(followups) == {"unobserved"}:
                cohort["unrecorded"] += 1
            start = datetime.fromisoformat(contact.data["observed_at"])
            cutoff = start + timedelta(days=14)
            if datetime.now(UTC) < cutoff:
                cohort["awaiting_window"] += 1
            else:
                cohort["window_contacts"] += 1
                cohort["window_positive"] += any(
                    k in followups and datetime.fromisoformat(followups[k].data["observed_at"]) <= cutoff
                    for k in ["positive", "interview", "offer"]
                )
        return {
            "source": "manual_report",
            "window_days": 14,
            "cohorts": list(cohorts.values()),
            "note": "按首次联系策略版本归因；未登记不等于无回复。14天窗口未满不计算成熟比例，小样本不宣布优胜。人工登记不等于平台自动成功证据。",
        }

    if static_dir and static_dir.is_dir():
        assets = static_dir / "assets"
        if assets.is_dir():
            app.mount("/assets", StaticFiles(directory=assets), name="assets")

        @app.get("/{path:path}")
        def frontend(path: str):
            if path.startswith("api/"):
                raise HTTPException(404)
            return FileResponse(static_dir / "index.html")
    else:

        @app.get("/")
        def no_build():
            return {"message": "工作台尚未构建，请执行 pnpm build 后启动。", "health": "/api/v1/health"}

    return app
