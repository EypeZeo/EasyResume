from datetime import UTC, datetime, timedelta

import pytest
from easyresume.execution import claim, digest, recover
from easyresume.models import Action


def action(client, name="action-1", **changes):
    binding = {
        "kind": "text",
        "message": "合成测试内容",
        "recipient": "synthetic",
        "executor": "synthetic-tab",
    }
    data = {
        "id": name,
        "state": "approved",
        "platform": "boss",
        "identity": "account:synthetic",
        "binding": binding,
        "digest": digest(binding),
        "epoch": "test-epoch",
        "approved_at": datetime.now(UTC).isoformat(),
    }
    data.update(changes)
    with client.app.state.sessions.begin() as session:
        session.add(Action(**data))
    return binding


def test_production_gate_never_enabled(client):
    binding = action(client)
    with client.app.state.sessions() as session, pytest.raises(ValueError, match="未通过"):
        claim(session, "action-1", "test-epoch", binding, paused=False)


def test_one_dispatch_then_only_reconcile(client):
    binding = action(client)
    with client.app.state.sessions() as session:
        result = claim(
            session, "action-1", "test-epoch", binding, paused=False, verified_actions={("boss", "text")}
        )
        assert result["state"] == "possible"
        session.commit()
    with client.app.state.sessions() as session, pytest.raises(ValueError, match="再次派发"):
        claim(session, "action-1", "test-epoch", binding, paused=False, verified_actions={("boss", "text")})
    with client.app.state.sessions.begin() as session:
        recover(session)
    with client.app.state.sessions() as session:
        assert session.get(Action, "action-1").state == "unknown"


@pytest.mark.parametrize(
    "change,epoch,message", [({"message": "changed"}, "test-epoch", "内容变化"), ({}, "other-epoch", "版本")]
)
def test_binding_changes_rejected(client, change, epoch, message):
    binding = action(client)
    with client.app.state.sessions() as session, pytest.raises(ValueError, match=message):
        claim(
            session,
            "action-1",
            epoch,
            {**binding, **change},
            paused=False,
            verified_actions={("boss", "text")},
        )


def test_expired_approval_rejected(client):
    binding = action(client, approved_at=(datetime.now(UTC) - timedelta(seconds=61)).isoformat())
    with client.app.state.sessions() as session, pytest.raises(ValueError, match="过期"):
        claim(session, "action-1", "test-epoch", binding, paused=False, verified_actions={("boss", "text")})


def test_unknown_identity_does_not_reset_platform_daily_cap(client):
    now = datetime(2026, 10, 15, 4, 0, tzinfo=UTC)
    for i in range(10):
        action(
            client,
            f"prior-{i}",
            state="unknown",
            identity="installation:unknown",
            attempted_at=(now - timedelta(seconds=70 + i)).isoformat(),
        )
    binding = action(client, approved_at=(now - timedelta(seconds=1)).isoformat())
    with client.app.state.sessions() as session, pytest.raises(ValueError, match="额度"):
        claim(
            session,
            "action-1",
            "test-epoch",
            binding,
            paused=False,
            verified_actions={("boss", "text")},
            now=now,
        )
