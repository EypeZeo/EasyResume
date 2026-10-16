"""Profile deletion must serialize with private, profile-derived writes."""

import threading

import pytest
from conftest import create_job
from easyresume.models import Record
from sqlalchemy import event, select


def write_request(kind, profile, strategy, job):
    if kind == "profile":
        return "/api/v1/profiles", {
            "parent_id": profile["id"],
            "text": "synthetic child private content",
            "confirmed": True,
        }
    if kind == "scratch":
        return "/api/v1/scratch", {
            "kind": "profile",
            "entity_id": profile["id"],
            "expected_version": 0,
            "payload": {"parent_id": profile["id"], "text": "synthetic scratch private content"},
        }
    return "/api/v1/drafts", {"job_id": job["id"], "strategy_id": strategy["id"], "kind": "greeting"}


@pytest.mark.parametrize("kind", ["profile", "scratch", "draft"])
def test_deletion_waits_for_private_writer_then_purges_committed_record(client, setup_workspace, kind):
    profile, strategy = setup_workspace
    job = create_job(client)
    path, payload = write_request(kind, profile, strategy, job)
    engine = client.app.state.sessions.kw["bind"]
    writer_paused = threading.Event()
    release_writer = threading.Event()
    delete_entered_sql = threading.Event()
    deletion_done = threading.Event()
    writer_thread_id = []
    responses = {}
    failures = []

    def checkpoint(connection, cursor, statement, parameters, context, executemany):
        if writer_paused.is_set() and threading.get_ident() not in writer_thread_id:
            delete_entered_sql.set()
        compiled = getattr(context, "compiled_parameters", None)
        is_target_insert = (
            statement.startswith("INSERT INTO records") and compiled and compiled[0].get("kind") == kind
        )
        if is_target_insert and not writer_paused.is_set():
            writer_thread_id.append(threading.get_ident())
            writer_paused.set()
            if not release_writer.wait(8):
                raise RuntimeError("test did not release writer")

    def write():
        try:
            responses["write"] = client.post(path, json=payload)
        except BaseException as error:
            failures.append(error)

    def delete():
        try:
            responses["delete"] = client.delete(f"/api/v1/profiles/{profile['id']}")
        except BaseException as error:
            failures.append(error)
        finally:
            deletion_done.set()

    event.listen(engine, "before_cursor_execute", checkpoint)
    writer = threading.Thread(target=write)
    deleter = threading.Thread(target=delete)
    try:
        writer.start()
        assert writer_paused.wait(3), "writer did not reach the controlled insert boundary"
        deleter.start()
        assert delete_entered_sql.wait(3), "delete did not begin its database operation"
        # Previously deletion committed in this window, leaving the later child/draft orphaned.
        assert not deletion_done.wait(0.15), "deletion overtook an already-validated private writer"
    finally:
        release_writer.set()
        writer.join(6)
        if deleter.ident is not None:
            deleter.join(6)
        event.remove(engine, "before_cursor_execute", checkpoint)
    assert not writer.is_alive() and not deleter.is_alive()
    assert not failures
    assert responses["write"].status_code == 200, responses["write"].text
    assert responses["delete"].status_code == 200, responses["delete"].text
    deleted_count = 2 if kind == "profile" else 1
    assert responses["delete"].json()["deleted"] == deleted_count
    state = client.get("/api/v1/state").json()
    assert state["profiles"] == [] and state["drafts"] == []
    assert client.get(f"/api/v1/scratch/profile?entity_id={profile['id']}").json()["payload"] is None
    with client.app.state.sessions() as session:
        assert not list(
            session.scalars(select(Record).where(Record.kind.in_(["profile", "draft", "scratch"])))
        )


@pytest.mark.parametrize("kind,expected_status", [("profile", 404), ("scratch", 404), ("draft", 409)])
def test_writer_arriving_after_profile_deletion_cannot_recreate_private_data(
    client, setup_workspace, kind, expected_status
):
    profile, strategy = setup_workspace
    job = create_job(client)
    path, payload = write_request(kind, profile, strategy, job)
    assert client.delete(f"/api/v1/profiles/{profile['id']}").status_code == 200
    response = client.post(path, json=payload)
    assert response.status_code == expected_status
    with client.app.state.sessions() as session:
        assert not list(
            session.scalars(select(Record).where(Record.kind.in_(["profile", "draft", "scratch"])))
        )
