from fastapi import HTTPException
import pytest

from src.db.courses.assignments import AssignmentUserSubmission, AssignmentUserSubmissionStatus
from src.db.trail_runs import TrailRun
from src.db.trail_steps import TrailStep
from src.db.trails import Trail
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
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
