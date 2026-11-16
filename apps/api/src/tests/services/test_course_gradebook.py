from fastapi import HTTPException
import pytest

from src.db.courses.assignments import AssignmentUserSubmissionStatus
from src.db.trail_runs import TrailRun
from src.db.trails import Trail
from src.db.users import PublicUser
from src.services.courses.course_gradebook import get_course_gradebook, read_course_gradebook


async def test_gradebook_only_includes_enrolled_members_and_preserves_zero(
    db, course, assignment, assignment_task, regular_user, user_submission
):
    gradebook = await read_course_gradebook(course, db)
    assert gradebook.assignments[0].max_grade == 100
    assert gradebook.learners == []

    trail = Trail(org_id=course.org_id, user_id=regular_user.id)
    db.add(trail)
    await db.flush()
    db.add(TrailRun(
        trail_id=trail.id, course_id=course.id, org_id=course.org_id,
        user_id=regular_user.id, creation_date="", update_date="",
    ))
    user_submission.grade = 0
    await db.commit()

    gradebook = await read_course_gradebook(course, db)
    assert [learner.user_id for learner in gradebook.learners] == [regular_user.id]
    pending = gradebook.learners[0].results[0]
    assert pending.status == AssignmentUserSubmissionStatus.SUBMITTED
    assert pending.display_grade is None

    user_submission.submission_status = AssignmentUserSubmissionStatus.GRADED
    await db.commit()
    gradebook = await read_course_gradebook(course, db)
    assert gradebook.learners[0].results[0].display_grade == "0/100"


async def test_course_gradebook_rejects_learner_and_allows_admin(
    db, course, regular_user, admin_user, mock_request
):
    with pytest.raises(HTTPException) as error:
        await get_course_gradebook(
            mock_request, course.course_uuid, PublicUser.model_validate(regular_user), db
        )
    assert error.value.status_code == 403

    gradebook = await get_course_gradebook(
        mock_request, course.course_uuid, PublicUser.model_validate(admin_user), db
    )
    assert gradebook.learners == []
