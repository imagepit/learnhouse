"""Prepare course reports for exactly one company and cohort."""

import csv
import os
import re
from collections import Counter
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from io import StringIO

from fastapi import HTTPException
from fpdf import FPDF
from fpdf.fonts import FontFace
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlmodel import col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.assignments import AssignmentUserSubmissionStatus
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.courses import Course
from src.db.trail_runs import StatusEnum, TrailRun
from src.db.trail_steps import TrailStep
from src.db.user_organizations import UserOrganization
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.services.courses.course_gradebook import CourseGradebook, GradebookLearner, read_course_gradebook


class CourseReportCohort(BaseModel):
    group_id: int = Field(gt=0)
    company: str
    session: str


@dataclass
class CourseReport:
    course_name: str
    cohort: CourseReportCohort
    gradebook: CourseGradebook
    completed: dict[int, int]
    total_activities: int


async def _linked_cohorts(course: Course, db: AsyncSession) -> list[CourseReportCohort]:
    linked_groups = select(UserGroupResource.usergroup_id).where(
        UserGroupResource.org_id == course.org_id,
        UserGroupResource.resource_uuid == course.course_uuid,
    )
    groups = (await db.exec(
        select(UserGroup.id, UserGroup.name)
        .where(UserGroup.org_id == course.org_id, col(UserGroup.id).in_(linked_groups))
        .order_by(UserGroup.name, UserGroup.id)
    )).all()
    cohorts = []
    for group_id, name in groups:
        parts = [part.strip() for part in name.split(" / ")]
        if len(parts) == 2 and all(parts):
            cohorts.append(CourseReportCohort(group_id=group_id, company=parts[0], session=parts[1]))
    return cohorts


def _unique_cohorts(cohorts: list[CourseReportCohort]) -> list[CourseReportCohort]:
    counts = Counter((cohort.company, cohort.session) for cohort in cohorts)
    return [cohort for cohort in cohorts if counts[cohort.company, cohort.session] == 1]


async def list_course_report_cohorts(course: Course, db: AsyncSession) -> list[CourseReportCohort]:
    return _unique_cohorts(await _linked_cohorts(course, db))


async def prepare_course_report(course: Course, selection: CourseReportCohort, db: AsyncSession) -> CourseReport:
    cohorts = await _linked_cohorts(course, db)
    if selection not in _unique_cohorts(cohorts):
        raise HTTPException(status_code=404, detail="Report cohort not found")

    members = select(UserOrganization.user_id).where(UserOrganization.org_id == course.org_id)
    active_runs = select(TrailRun.id, TrailRun.user_id).where(
        TrailRun.course_id == course.id,
        TrailRun.org_id == course.org_id,
        TrailRun.status != StatusEnum.STATUS_CANCELLED,
        col(TrailRun.user_id).in_(members),
    ).subquery()
    # Read membership for all report cohorts in one query. A learner in more
    # than one cannot be attributed to a single company or run on this course.
    membership = (await db.exec(
        select(UserGroupUser.user_id, UserGroupUser.usergroup_id).where(
            UserGroupUser.org_id == course.org_id,
            col(UserGroupUser.usergroup_id).in_([cohort.group_id for cohort in cohorts]),
            col(UserGroupUser.user_id).in_(select(active_runs.c.user_id)),
        ).distinct()
    )).all()
    selected_ids = {user_id for user_id, cohort_id in membership if cohort_id == selection.group_id}
    if any(user_id in selected_ids and cohort_id != selection.group_id for user_id, cohort_id in membership):
        raise HTTPException(status_code=409, detail="Report cohort membership overlaps")
    if not selected_ids:
        raise HTTPException(status_code=409, detail="No enrolled learners in report cohort")

    gradebook = await read_course_gradebook(course, db, user_ids=selected_ids)
    if not gradebook.learners:
        raise HTTPException(status_code=409, detail="No enrolled learners in report cohort")
    course_activities = select(ChapterActivity.activity_id).where(
        ChapterActivity.course_id == course.id,
        ChapterActivity.org_id == course.org_id,
    ).distinct()
    total = (await db.exec(select(func.count()).select_from(course_activities.subquery()))).one()
    completed = dict((await db.exec(
        select(TrailStep.user_id, func.count(col(TrailStep.activity_id).distinct()))
        .where(
            TrailStep.course_id == course.id,
            TrailStep.org_id == course.org_id,
            col(TrailStep.complete).is_(True),
            col(TrailStep.trailrun_id).in_(select(active_runs.c.id)),
            col(TrailStep.user_id).in_([learner.user_id for learner in gradebook.learners]),
            col(TrailStep.activity_id).in_(course_activities),
        )
        .group_by(col(TrailStep.user_id))
    )).all())
    return CourseReport(course.name, selection, gradebook, completed, total)


_SUBMISSION_LABELS = {
    AssignmentUserSubmissionStatus.NOT_SUBMITTED: "未提出",
    AssignmentUserSubmissionStatus.PENDING: "作業中",
    AssignmentUserSubmissionStatus.SUBMITTED: "採点待ち",
    AssignmentUserSubmissionStatus.LATE: "遅延提出・採点待ち",
    AssignmentUserSubmissionStatus.GRADED: "採点済み",
}


def _assignment_results(report: CourseReport, learner: GradebookLearner) -> Iterator[str]:
    results = {result.assignment_uuid: result for result in learner.results}
    for assignment in report.gradebook.assignments:
        result = results.get(assignment.assignment_uuid)
        status = result.status if result else AssignmentUserSubmissionStatus.NOT_SUBMITTED
        if result and result.display_grade is not None:
            yield result.display_grade
        elif assignment.ungraded and status in (
            AssignmentUserSubmissionStatus.SUBMITTED, AssignmentUserSubmissionStatus.LATE,
        ):
            yield "提出済み・採点対象外"
        else:
            yield _SUBMISSION_LABELS[status]


def render_course_report_csv(report: CourseReport) -> bytes:
    output = StringIO(newline="")
    writer = csv.writer(output, quoting=csv.QUOTE_ALL)

    def row(fields: Iterable[str]) -> None:
        writer.writerow(
            "'" + field if re.match(r"[\t\r\n]|\s*[=+\-@＝＋－＠]", field) else field
            for field in fields
        )

    row(["企業", "開催回", "受講者", "完了教材数", "全教材数",
         *(assignment.title for assignment in report.gradebook.assignments)])
    for learner in report.gradebook.learners:
        row([
            report.cohort.company, report.cohort.session, learner.username,
            str(report.completed.get(learner.user_id, 0)), str(report.total_activities),
            *_assignment_results(report, learner),
        ])
    return output.getvalue().encode("utf-8-sig")


def _pdf_label(value: str) -> str:
    text = " ".join(value.split())
    return text if len(text) <= 250 else text[:249] + "…"


def render_course_report(report: CourseReport) -> bytes:
    pdf = FPDF()
    font_path = os.getenv("LEARNHOUSE_REPORT_FONT", "/usr/share/fonts/noto/NotoSansCJK-Regular.ttc")
    pdf.add_font("Noto", fname=font_path)
    pdf.set_title("コース成績レポート")
    pdf.set_margins(16, 16, 16)
    pdf.set_auto_page_break(True, margin=16)
    pdf.add_page()

    def line(value: str, size: int = 11) -> None:
        pdf.set_font("Noto", size=size)
        pdf.multi_cell(w=0, h=6, text=value, new_x="LMARGIN", new_y="NEXT", wrapmode="CHAR")

    line("コース成績レポート", 18)
    pdf.ln(3)
    line(f"コース　{_pdf_label(report.course_name)}")
    line(f"企業　{_pdf_label(report.cohort.company)}")
    line(f"開催回　{_pdf_label(report.cohort.session)}")
    line(f"対象　{len(report.gradebook.learners)}名")
    chapter_names = {chapter.id: chapter.name for chapter in report.gradebook.chapters}
    for learner in report.gradebook.learners:
        if pdf.will_page_break(39):
            pdf.add_page()
        pdf.ln(5)
        line(_pdf_label(learner.username), 13)
        count = report.completed.get(learner.user_id, 0)
        total = report.total_activities
        progress = f"{count}/{total}件（{count / total:.0%}）" if total else "対象教材なし"
        line(f"受講進捗　{progress}")
        if not report.gradebook.assignments:
            line("成績対象の課題なし")
            continue
        with pdf.table(
            col_widths=(1, 2, 1), line_height=5, padding=2, wrapmode="CHAR",
            headings_style=FontFace(fill_color=(233, 239, 246)),
        ) as table:
            table.row(("章", "クイズ・課題", "成績・提出状況"))
            for assignment, value in zip(report.gradebook.assignments, _assignment_results(report, learner), strict=True):
                table.row((
                    _pdf_label(chapter_names.get(assignment.chapter_id, "章未設定")),
                    _pdf_label(assignment.title),
                    value,
                ))
    return bytes(pdf.output())
