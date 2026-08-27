"""HTTP surface for Office mode. A separate `APIRouter` (built, not
module-global, per `desktop_api.build_router`) rather than more inline
closures in `web_ui.create_app` — the roster+team+work-item+meeting surface
is large enough to deserve its own file the way voice/desktop already do.

Phase 1: roster CRUD. Phase 2 (this file's `/assign` + `/work-items` routes):
real task execution. `/meetings` and `/events` (SSE) land in Phase 3/4.
"""
from __future__ import annotations
import asyncio
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from . import brain
from .office import OfficeManager
from .project_resolve import ProjectNotFound, ProjectPathMissing


class EmployeeCreate(BaseModel):
    name: str
    role: str = ""
    avatar: str = ""
    personality: str = ""
    model: str = ""
    engine: str = ""
    skill_ids: list[str] = []
    team_id: Optional[str] = None


class EmployeeUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    avatar: Optional[str] = None
    personality: Optional[str] = None
    model: Optional[str] = None
    engine: Optional[str] = None
    skill_ids: Optional[list[str]] = None
    team_id: Optional[str] = None


class TeamCreate(BaseModel):
    name: str
    description: str = ""


class TeamUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class AssignBody(BaseModel):
    prompt: str
    project: Optional[str] = None


class MeetingCreate(BaseModel):
    team_id: str
    participant_ids: list[str]
    topic: str


def build_router(office: OfficeManager | None) -> APIRouter:
    router = APIRouter()

    def _office() -> OfficeManager:
        # Office is an optional dependency (mirrors app.state.chat/hub being
        # nullable): a build that never constructs one still boots, it just
        # 404s the office surface instead of crashing at import time.
        if office is None:
            raise HTTPException(status_code=503, detail="Office mode is not configured")
        return office

    @router.get("/api/office/employees")
    def list_employees(team_id: Optional[str] = None):
        return _office().list_employees(team_id=team_id)

    @router.post("/api/office/employees")
    def create_employee(body: EmployeeCreate):
        return _office().create_employee(**body.model_dump())

    @router.put("/api/office/employees/{employee_id}")
    def update_employee(employee_id: str, body: EmployeeUpdate):
        row = _office().update_employee(employee_id, **body.model_dump(exclude_unset=True))
        if row is None:
            raise HTTPException(status_code=404, detail="employee not found")
        return row

    @router.delete("/api/office/employees/{employee_id}")
    def delete_employee(employee_id: str):
        ok = _office().delete_employee(employee_id)
        if not ok:
            raise HTTPException(status_code=404, detail="employee not found")
        return {"ok": True}

    @router.get("/api/office/teams")
    def list_teams():
        return _office().list_teams()

    @router.post("/api/office/teams")
    def create_team(body: TeamCreate):
        return _office().create_team(**body.model_dump())

    @router.put("/api/office/teams/{team_id}")
    def update_team(team_id: str, body: TeamUpdate):
        row = _office().update_team(team_id, **body.model_dump(exclude_unset=True))
        if row is None:
            raise HTTPException(status_code=404, detail="team not found")
        return row

    @router.delete("/api/office/teams/{team_id}")
    def delete_team(team_id: str):
        ok = _office().delete_team(team_id)
        if not ok:
            raise HTTPException(status_code=404, detail="team not found")
        return {"ok": True}

    @router.post("/api/office/employees/{employee_id}/assign")
    async def assign_employee_task(employee_id: str, body: AssignBody):
        try:
            return _office().assign_task(employee_id, body.prompt, project=body.project)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except (ProjectNotFound, ProjectPathMissing) as e:
            raise HTTPException(status_code=404, detail=str(e))
        except RuntimeError as e:
            raise HTTPException(status_code=503, detail=str(e))

    @router.post("/api/office/teams/{team_id}/assign")
    async def assign_team_task(team_id: str, body: AssignBody):
        try:
            return _office().assign_team_task(team_id, body.prompt, project=body.project)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except (ProjectNotFound, ProjectPathMissing) as e:
            raise HTTPException(status_code=404, detail=str(e))
        except RuntimeError as e:
            raise HTTPException(status_code=503, detail=str(e))

    @router.get("/api/office/work-items")
    def list_work_items(employee_id: Optional[str] = None, team_id: Optional[str] = None,
                         limit: int = 50):
        return _office().list_work_items(employee_id=employee_id, team_id=team_id, limit=limit)

    @router.get("/api/office/work-items/{work_id}")
    def get_work_item(work_id: str):
        row = _office().store.get_work_item(work_id)
        if row is None:
            raise HTTPException(status_code=404, detail="work item not found")
        return row

    @router.post("/api/office/meetings")
    async def create_meeting(body: MeetingCreate):
        try:
            return await _office().run_meeting(body.team_id, body.participant_ids, body.topic,
                                               triggered_by="manual")
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    @router.get("/api/office/meetings")
    def list_meetings(team_id: Optional[str] = None, limit: int = 50):
        return _office().list_meetings(team_id=team_id, limit=limit)

    @router.get("/api/office/events")
    async def office_events(request: Request):
        # Near-literal copy of web_ui.py's /api/tasks/events: same in-process
        # pub/sub (`Store.publish`/`subscribe`), just filtered to office_* types
        # so the Office canvas doesn't also wake up on every task/session event.
        store = _office().store.main_store
        queue: asyncio.Queue = asyncio.Queue()
        loop = asyncio.get_running_loop()

        def listener(event):
            if not str(event.get("type", "")).startswith("office_"):
                return
            try:
                loop.call_soon_threadsafe(queue.put_nowait, event)
            except Exception:
                pass

        store.subscribe(listener)

        async def event_generator():
            try:
                while True:
                    if await request.is_disconnected():
                        break
                    try:
                        event = await asyncio.wait_for(queue.get(), timeout=15.0)
                        yield brain.sse(event)
                    except asyncio.TimeoutError:
                        yield "data: {\"type\": \"keep-alive\"}\n\n"
            finally:
                store.unsubscribe(listener)

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            },
        )

    return router
