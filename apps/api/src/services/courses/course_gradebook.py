"""Read-only course grades for staff with grading access."""

from fastapi import HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func
from sqlmodel import col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
    GradingTypeEnum,
)
from src.db.courses.courses import Course
from src.db.trail_runs import TrailRun
from src.db.user_organizations import UserOrganization
from src.db.users import PublicUser, User
from src.security.rbac import AccessAction, check_resource_access
from src.services.courses.activities.assignments import compute_assignment_grade
from src.services.courses.courses import get_course_user_rights


class GradebookAssignment(BaseModel):
    assignment_uuid: str
    title: str
    max_grade: int
    ungraded: bool


class GradebookResult(BaseModel):
    assignment_uuid: str
    status: AssignmentUserSubmissionStatus
    display_grade: str | None = None


class GradebookLearner(BaseModel):
    user_id: int
    username: str
    results: list[GradebookResult]


class CourseGradebook(BaseModel):
    assignments: list[GradebookAssignment]
    learners: list[GradebookLearner]


async def get_course_gradebook(
    request: Request, course_uuid: str, current_user: PublicUser, db: AsyncSession
) -> CourseGradebook:
    if not isinstance(current_user, PublicUser) or current_user.id <= 0:
        raise HTTPException(status_code=403, detail="Grading access required")

    await check_resource_access(request, db, current_user, course_uuid, AccessAction.UPDATE)
    rights = await get_course_user_rights(request, course_uuid, current_user, db)
    if not rights["permissions"]["grade_assignments"]:
        raise HTTPException(status_code=403, detail="Grading access required")

    course = (await db.exec(select(Course).where(Course.course_uuid == course_uuid))).one()
    return await read_course_gradebook(course, db)


async def read_course_gradebook(course: Course, db: AsyncSession) -> CourseGradebook:
    members = select(UserOrganization.user_id).where(UserOrganization.org_id == course.org_id)
    enrolled = select(TrailRun.user_id).where(
        TrailRun.course_id == course.id,
        TrailRun.org_id == course.org_id,
        col(TrailRun.user_id).in_(members),
    )
    users = (await db.exec(
        select(User.id, User.username)
        .where(col(User.id).in_(enrolled))
        .order_by(User.username, User.id)
    )).all()
    learners = {
        user_id: GradebookLearner(user_id=user_id, username=username, results=[])
        for user_id, username in users
    }

    assignments = (await db.exec(
        select(Assignment)
        .where(Assignment.course_id == course.id, Assignment.org_id == course.org_id)
        .order_by(Assignment.id)
    )).all()
    by_id = {assignment.id: assignment for assignment in assignments}

    maxima = dict((await db.exec(
        select(AssignmentTask.assignment_id, func.sum(AssignmentTask.max_grade_value))
        .where(col(AssignmentTask.assignment_id).in_(by_id))
        .group_by(col(AssignmentTask.assignment_id))
    )).all())

    # Retries update the submission in place. On older data with duplicate
    # submissions, prefer the highest attempt and then the most recent row.
    submissions = (await db.exec(
        select(AssignmentUserSubmission)
        .where(
            col(AssignmentUserSubmission.assignment_id).in_(by_id),
            col(AssignmentUserSubmission.user_id).in_(enrolled),
        )
        .order_by(
            col(AssignmentUserSubmission.attempt_number).desc(),
            col(AssignmentUserSubmission.id).desc(),
        )
    )).all()
    seen: set[tuple[int, int]] = set()
    for submission in submissions:
        key = (submission.user_id, submission.assignment_id)
        if key in seen or submission.user_id not in learners:
            continue
        seen.add(key)
        assignment = by_id[submission.assignment_id]
        display_grade = None
        if not assignment.ungraded and submission.submission_status == AssignmentUserSubmissionStatus.GRADED:
            grade = compute_assignment_grade(
                submission.grade,
                maxima.get(assignment.id) or 0,
                assignment.grading_type,
                pass_threshold_percentage=assignment.pass_threshold_percentage,
            )
            points = f"{grade['grade']}/{grade['max_grade']}"
            display_grade = (
                points if assignment.grading_type == GradingTypeEnum.NUMERIC
                else f"{grade['display_grade']} ({points})"
            )
        learners[submission.user_id].results.append(GradebookResult(
            assignment_uuid=assignment.assignment_uuid,
            status=submission.submission_status,
            display_grade=display_grade,
        ))

    return CourseGradebook(
        assignments=[
            GradebookAssignment(
                assignment_uuid=assignment.assignment_uuid,
                title=assignment.title,
                max_grade=maxima.get(assignment.id) or 0,
                ungraded=bool(assignment.ungraded),
            )
            for assignment in assignments
        ],
        learners=list(learners.values()),
    )
