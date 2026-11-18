import logging
import os
from pathlib import Path
from time import perf_counter
from typing import Literal

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, Field
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.users import AnonymousUser, PublicUser
from src.security.auth import get_current_user
from src.services.courses.activities.access import verify_activity_reader_access_by_uuid
from src.services.media.outline_images import CACHE_CONTROL, ImageRef, get_outline_images

logger = logging.getLogger("uvicorn.error")
router = APIRouter()
_HEADERS = {"Cache-Control": CACHE_CONTROL}


class ImagePreviewRequest(BaseModel):
    attachments: list[str] = Field(min_length=1, max_length=32)
    width: Literal[640, 1200]


async def _authorize_images(request: Request, course_uuid: str, activity_uuid: str, db: AsyncSession):
    catalog_path = os.environ.get("LEARNHOUSE_OUTLINE_IMAGE_CATALOG")
    if catalog_path and Path(catalog_path).with_name("measure-db-checkout").is_file():
        started = perf_counter()
        try:
            await db.connection()
        finally:
            logger.info("outline_image_db_checkout_ms=%.3f", (perf_counter() - started) * 1000)

    try:
        user = await get_current_user(request, db)
        if not isinstance(user, (AnonymousUser, PublicUser)):
            raise HTTPException(403, "Image access denied")
        await verify_activity_reader_access_by_uuid(
            request, activity_uuid, user, db, course_uuid=course_uuid,
        )
    except HTTPException as error:
        raise HTTPException(error.status_code, error.detail, headers={**(error.headers or {}), **_HEADERS}) from None


@router.post("/courses/{course_uuid}/activities/{activity_uuid}/outline-images")
async def preview_outline_images(
    request: Request,
    course_uuid: str,
    activity_uuid: str,
    batch: ImagePreviewRequest,
    db: AsyncSession = Depends(get_db_session),
):
    try:
        refs = [ImageRef(course_uuid, activity_uuid, value) for value in dict.fromkeys(batch.attachments)]
    except ValueError:
        raise HTTPException(404, "Image not found", headers=_HEADERS) from None
    await _authorize_images(request, course_uuid, activity_uuid, db)
    storage = get_outline_images()
    if storage is None:
        raise HTTPException(404, "Image not found", headers=_HEADERS)
    try:
        images = {
            ref.attachment_id: url for ref in refs
            if (url := storage.sign(ref, preview_width=batch.width)) is not None
        }
    except (BotoCoreError, ClientError, ValueError):
        raise HTTPException(503, "Image temporarily unavailable", headers=_HEADERS) from None
    return JSONResponse({"images": images}, headers=_HEADERS)


@router.get("/courses/{course_uuid}/activities/{activity_uuid}/outline-images/{attachment_id}")
async def redirect_outline_image(
    request: Request,
    course_uuid: str,
    activity_uuid: str,
    attachment_id: str,
    db: AsyncSession = Depends(get_db_session),
):
    try:
        ref = ImageRef(course_uuid, activity_uuid, attachment_id)
    except ValueError:
        raise HTTPException(404, "Image not found", headers=_HEADERS) from None
    await _authorize_images(request, course_uuid, activity_uuid, db)
    storage = get_outline_images()
    try:
        url = storage.sign(ref) if storage else None
    except (BotoCoreError, ClientError, ValueError):
        raise HTTPException(503, "Image temporarily unavailable", headers=_HEADERS) from None
    if url is None:
        raise HTTPException(404, "Image not found", headers=_HEADERS)
    return RedirectResponse(url, status_code=302, headers=_HEADERS)
