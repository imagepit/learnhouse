from fastapi import HTTPException
import pytest
from sqlmodel import select

from src.db.courses.assignments import AssignmentUserSubmissionStatus
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
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

async def test_gradebook_uses_current_chapter_in_course_order(db, course, chapter, activity, assignment):
    earlier_chapter = Chapter(name="New first chapter", org_id=course.org_id, course_id=course.id)
    db.add(earlier_chapter)
    await db.flush()
    db.add(CourseChapter(
        order=0, chapter_id=earlier_chapter.id, org_id=course.org_id,
        course_id=course.id, creation_date="", update_date="",
    ))
    link = (await db.exec(
        select(ChapterActivity).where(ChapterActivity.activity_id == activity.id)
    )).one()
    link.chapter_id = earlier_chapter.id
    await db.commit()

    gradebook = await read_course_gradebook(course, db)
    assert [item.id for item in gradebook.chapters] == [earlier_chapter.id, chapter.id]
    assert assignment.chapter_id == chapter.id
    assert gradebook.assignments[0].chapter_id == earlier_chapter.id


async def test_gradebook_keeps_assignments_without_a_linked_chapter(db, course, assignment):
    course_chapter = (await db.exec(
        select(CourseChapter).where(CourseChapter.course_id == course.id)
    )).one()
    await db.delete(course_chapter)
    await db.commit()

    gradebook = await read_course_gradebook(course, db)
    assert gradebook.chapters == []
    assert gradebook.assignments[0].chapter_id is None
