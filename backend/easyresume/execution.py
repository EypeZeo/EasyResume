"""Durable execution contract. No production platform executor is enabled."""

import hashlib
import json
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from easyresume.models import Action, now_iso

VERIFIED_ACTIONS: frozenset[tuple[str, str]] = frozenset()


def digest(binding: dict) -> str:
    return hashlib.sha256(json.dumps(binding, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def invalidate(session: Session, why: str):
    session.execute(
        update(Action).where(Action.state.in_(["draft", "approved"])).values(state="cancelled", result=why)
    )


def recover(session: Session):
    session.execute(
        update(Action)
        .where(Action.state == "possible")
        .values(state="unknown", result="进程重启：只核对，不再次派发")
    )
    invalidate(session, "服务重启使旧授权失效")


def claim(
    session: Session,
    action_id: str,
    epoch: str,
    binding: dict,
    *,
    verified_actions=VERIFIED_ACTIONS,
    paused=True,
    now=None,
):
    """Called by a future verified executor, never exposed as arbitrary HTTP dispatch.

    The caller must not dispatch before transaction commit. Once possible, never claim again.
    """
    now = now or datetime.now(UTC)
    session.connection().exec_driver_sql("BEGIN IMMEDIATE")
    action = session.get(Action, action_id)
    if not action or action.state != "approved":
        raise ValueError("动作不存在或不能再次派发")
    if paused or (action.platform, binding.get("kind")) not in verified_actions:
        raise ValueError("平台动作未通过真实验证，或当前已暂停")
    if action.epoch != epoch or action.digest != digest(binding):
        raise ValueError("授权版本或动作内容变化")
    approved = datetime.fromisoformat(action.approved_at)
    if now < approved or now - approved > timedelta(seconds=60):
        raise ValueError("授权已过期或时钟异常")
    attempted = list(
        session.scalars(
            select(Action).where(Action.attempted_at.is_not(None), Action.platform == action.platform)
        )
    )
    day = now.astimezone(ZoneInfo("Asia/Shanghai")).date()
    today = [
        a
        for a in attempted
        if datetime.fromisoformat(a.attempted_at).astimezone(ZoneInfo("Asia/Shanghai")).date() == day
    ]
    # Unknown identity uses platform-wide cap; reliable identities include unknown attempts conservatively.
    relevant = [
        a
        for a in today
        if not action.identity.startswith("account:")
        or a.identity == action.identity
        or not a.identity.startswith("account:")
    ]
    if len(relevant) >= 10:
        raise ValueError("工具当日额度已用完")
    if any(a.state == "possible" for a in attempted):
        raise ValueError("已有在途动作，请先核对")
    if attempted:
        last = max(datetime.fromisoformat(a.attempted_at) for a in attempted)
        if now - last < timedelta(seconds=60):
            raise ValueError("冷却时间未到或时钟回退")
    action.state = "possible"
    action.attempted_at = now.isoformat()
    session.flush()
    return {"id": action.id, "state": "possible", "binding": action.binding, "recorded_at": now_iso()}
