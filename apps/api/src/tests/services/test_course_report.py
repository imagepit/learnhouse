import csv
import os
from io import BytesIO, StringIO
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from httpx import ASGITransport, AsyncClient
from pypdf import PdfReader
import pytest
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.courses.assignments import AssignmentUserSubmission, AssignmentUserSubmissionStatus
from src.db.trail_runs import TrailRun
from src.db.trail_steps import TrailStep
from src.db.trails import Trail
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.db.users import PublicUser
from src.routers.courses.courses import router
from src.security.auth import get_current_user
from src.security.features_utils.dependencies import require_courses_feature
from src.services.courses.course_report import CourseReportCohort, list_course_report_cohorts, prepare_course_report


@pytest.fixture
async def report_cohorts(db, course, activity, assignment, assignment_task, regular_user, admin_user):
    for group_id, label, learner, grade, complete in (
        (11, "A社 / 第1回", regular_user, 80, True),
        (12, "B社 / 第1回", admin_user, 0, False),
    ):
        db.add(UserGroup(id=group_id, org_id=course.org_id, name=label, description=""))
        db.add(UserGroupResource(
            usergroup_id=group_id, org_id=course.org_id, resource_uuid=course.course_uuid,
        ))
        db.add(UserGroupUser(usergroup_id=group_id, org_id=course.org_id, user_id=learner.id))
        trail = Trail(org_id=course.org_id, user_id=learner.id)
        db.add(trail)
        await db.flush()
        run = TrailRun(
            course_id=course.id, org_id=course.org_id, user_id=learner.id, trail_id=trail.id,
            creation_date="", update_date="",
        )
        db.add(run)
        await db.flush()
        db.add(TrailStep(
            complete=complete, teacher_verified=False, grade="", trailrun_id=run.id,
            trail_id=trail.id, activity_id=activity.id, course_id=course.id,
            org_id=course.org_id, user_id=learner.id, creation_date="", update_date="",
        ))
        db.add(AssignmentUserSubmission(
            grade=grade, submission_status=AssignmentUserSubmissionStatus.GRADED,
            user_id=learner.id, assignment_id=assignment.id,
            assignmentusersubmission_uuid=f"aus_report_{group_id}",
            creation_date="", update_date="",
        ))
    await db.commit()


async def test_each_report_uses_only_its_company_learners(db, course, report_cohorts, regular_user, admin_user):
    a = await prepare_course_report(course, CourseReportCohort(group_id=11, company="A社", session="第1回"), db)
    b = await prepare_course_report(course, CourseReportCohort(group_id=12, company="B社", session="第1回"), db)
    assert a.cohort.company == "A社"
    assert b.cohort.company == "B社"
    assert a.total_activities == b.total_activities == 1
    assert a.completed == {regular_user.id: 1}
    assert b.completed == {}
    assert [(row.user_id, row.results[0].display_grade) for row in a.gradebook.learners] == [
        (regular_user.id, "80/100")
    ]
    assert [(row.user_id, row.results[0].display_grade) for row in b.gradebook.learners] == [
        (admin_user.id, "0/100")
    ]


async def test_report_rejects_overlapping_enrolled_learners(db, course, report_cohorts, admin_user):
    db.add(UserGroupUser(usergroup_id=11, org_id=course.org_id, user_id=admin_user.id))
    await db.commit()
    for cohort in await list_course_report_cohorts(course, db):
        with pytest.raises(HTTPException) as exc:
            await prepare_course_report(course, cohort, db)
        assert exc.value.status_code == 409


@pytest.mark.parametrize("extension", ["csv", "pdf"])
async def test_course_report_downloads_keep_same_course_companies_separate(
    engine, course, report_cohorts, regular_user, admin_user, extension,
):
    if extension == "pdf" and not Path(os.getenv(
        "LEARNHOUSE_REPORT_FONT", "/usr/share/fonts/noto/NotoSansCJK-Regular.ttc",
    )).is_file():
        pytest.skip("Noto CJK is required for the PDF integration test")
    app = FastAPI()
    app.include_router(router, prefix="/courses")
    operator = PublicUser.model_validate(admin_user)
    learner = PublicUser.model_validate(regular_user)

    async def current_user(request: Request):
        return learner if request.headers.get("x-fixture-role") == "learner" else operator

    async def request_db():
        async with AsyncSession(engine, expire_on_commit=False) as session:
            yield session

    app.dependency_overrides[get_current_user] = current_user
    app.dependency_overrides[get_db_session] = request_db
    app.dependency_overrides[require_courses_feature] = lambda: None
    path = f"/courses/{course.course_uuid}/gradebook"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://example.test") as client:
        unfiltered = await client.get(path)
        assert {row["username"] for row in unfiltered.json()["learners"]} == {learner.username, operator.username}

        a = {"group_id": 11, "company": "A社", "session": "第1回"}
        b = {"group_id": 12, "company": "B社", "session": "第1回"}
        for selection, expected, other, done, grade in (
            (a, learner.username, operator.username, "1", "80/100"),
            (b, operator.username, learner.username, "0", "0/100"),
        ):
            url = f"{path}/report.{extension}"
            denied = await client.post(url, json=selection, headers={"x-fixture-role": "learner"})
            assert denied.status_code == 403
            response = await client.post(url, json=selection)
            assert response.status_code == 200, response.text
            assert response.headers["cache-control"] == "private, no-store"
            if extension == "csv":
                rows = list(csv.reader(StringIO(response.content.decode("utf-8-sig"))))
                assert rows[1:] == [[selection["company"], "第1回", expected, done, "1", grade]]
            else:
                pdf = PdfReader(BytesIO(response.content))
                content = "\n".join(page.extract_text() for page in pdf.pages).replace("\x00", "")
                for value in (expected, selection["company"], grade, f"{done}/1"):
                    assert value in content
                assert other not in content
            assert (await client.post(url, json={**selection, "company": "C社"})).status_code == 404


async def test_report_rejects_duplicate_unlinked_and_empty_cohorts(db, course, report_cohorts):
    for id, name in ((13, "A社 / 第1回"), (14, "C社 / 第1回"), (15, "A社 / 第2回")):
        db.add(UserGroup(id=id, org_id=course.org_id, name=name, description=""))
        if id != 14:
            db.add(UserGroupResource(
                usergroup_id=id, org_id=course.org_id, resource_uuid=course.course_uuid,
            ))
    await db.commit()

    assert [item.group_id for item in await list_course_report_cohorts(course, db)] == [15, 12]
    for selection, status in (
        (CourseReportCohort(group_id=11, company="A社", session="第1回"), 404),
        (CourseReportCohort(group_id=13, company="A社", session="第1回"), 404),
        (CourseReportCohort(group_id=14, company="C社", session="第1回"), 404),
        (CourseReportCohort(group_id=15, company="A社", session="第2回"), 409),
        (CourseReportCohort(group_id=12, company="A社", session="第1回"), 404),
    ):
        with pytest.raises(HTTPException) as exc:
            await prepare_course_report(course, selection, db)
        assert exc.value.status_code == status
