import json
from unittest.mock import AsyncMock
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from sqlalchemy import update

from src.db.user_organizations import UserOrganization
from src.routers import external_activity_images
from src.services.ai.tools import doc_ops
from src.services.media.outline_images import get_image_preview, get_outline_images

R2 = "https://" + "0" * 32 + ".r2.cloudflarestorage.com"
ATTACHMENT = str(uuid4())


@pytest.fixture
async def images(monkeypatch, tmp_path, db, course, activity):
    course.course_uuid = f"course_{uuid4()}"
    activity.activity_uuid = f"activity_{uuid4()}"
    course.public = True
    course.published = True
    activity.published = True
    db.add(course)
    db.add(activity)
    await db.commit()

    row = dict(course_uuid=course.course_uuid, activity_uuid=activity.activity_uuid,
               attachment_id=ATTACHMENT, object_key="uploads/sample.svg", content_type="image/svg+xml")
    catalog = tmp_path / "catalog.json"
    catalog.write_text(json.dumps({"version": 1, "images": [row]}))
    env = {"ENDPOINT": R2, "BUCKET": "outline-originals",
           "ACCESS_KEY_ID": "fake-access-key", "SECRET_ACCESS_KEY": "fake-secret"}
    for key, value in env.items():
        monkeypatch.setenv(f"LEARNHOUSE_OUTLINE_R2_{key}", value)
    monkeypatch.setenv("LEARNHOUSE_OUTLINE_IMAGE_CATALOG", str(catalog))
    get_outline_images.cache_clear()
    get_image_preview.cache_clear()
    app = FastAPI()
    app.include_router(external_activity_images.router, prefix="/api/v1")
    app.dependency_overrides[get_db_session] = lambda: db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://learnhouse.test") as client:
        yield client, row, catalog
    get_outline_images.cache_clear()
    get_image_preview.cache_clear()


def image_path(row):
    return f"/api/v1/courses/{row['course_uuid']}/activities/{row['activity_uuid']}/outline-images/{row['attachment_id']}"


async def test_batch_authorizes_once_and_only_issues_urls_for_registered_images(images, monkeypatch):
    client, row, catalog = images
    png = str(uuid4())
    missing = str(uuid4())
    catalog.write_text(json.dumps({"version": 1, "images": [
        row, {**row, "attachment_id": png, "object_key": "uploads/sample.png", "content_type": "image/png"},
    ]}))
    monkeypatch.setenv("LEARNHOUSE_OUTLINE_IMAGE_WORKER_ORIGIN", "https://preview.example.org")
    monkeypatch.setenv("LEARNHOUSE_OUTLINE_IMAGE_PREVIEW_KEY", "00" * 32)
    verifier = AsyncMock(wraps=external_activity_images.verify_activity_reader_access_by_uuid)
    monkeypatch.setattr(external_activity_images, "verify_activity_reader_access_by_uuid", verifier)
    batch_path = image_path(row).rsplit("/", 1)[0]
    response = await client.post(batch_path, json={"attachments": [png, ATTACHMENT, png, missing], "width": 640})
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "private, no-store"
    verifier.assert_awaited_once()
    urls = response.json()["images"]
    assert set(urls) == {png, ATTACHMENT}
    assert urls[png].startswith("https://preview.example.org/preview/")
    assert "sample.png" not in urls[png]
    assert parse_qs(urlsplit(urls[ATTACHMENT]).query)["response-content-disposition"] == ["attachment"]
    original = await client.get(batch_path + "/" + png)
    assert original.headers["location"].startswith(R2 + "/")


async def test_batch_denies_revoked_users_and_cross_course_references(images, db, course):
    client, row, _ = images
    params = {"attachments": [ATTACHMENT], "width": 1200}
    wrong = image_path({**row, "course_uuid": f"course_{uuid4()}"}).rsplit("/", 1)[0]
    assert (await client.post(wrong, json=params)).status_code == 404
    batch_path = image_path(row).rsplit("/", 1)[0]
    assert (await client.post(batch_path, json={**params, "width": 100})).status_code == 422
    assert (await client.post(batch_path, json={**params, "attachments": [ATTACHMENT] * 33})).status_code == 422
    course.public = False
    db.add(course)
    await db.commit()
    denied = await client.post(batch_path, json=params)
    assert denied.status_code == 401
    assert denied.headers["cache-control"] == "private, no-store"
    assert "images" not in denied.json()


async def test_public_redirect_uses_dedicated_bucket_and_signed_response_controls(images):
    client, row, _ = images
    response = await client.get(image_path(row))
    assert response.status_code == 302, response.text
    assert response.headers["cache-control"] == "private, no-store"
    url = urlsplit(response.headers["location"])
    assert f"{url.scheme}://{url.netloc}" == R2
    assert url.path == "/outline-originals/uploads/sample.svg"
    query = parse_qs(url.query)
    assert query["X-Amz-Expires"] == ["60"]
    assert query["response-cache-control"] == ["private, no-store"]
    assert query["response-content-type"] == ["image/svg+xml"]
    assert query["response-content-disposition"] == ["attachment"]
    assert query["X-Amz-Credential"][0].startswith("fake-access-key/")
    assert "fake-secret" not in response.headers["location"]


async def test_checkout_timing_is_opt_in_and_preserves_redirect(images, caplog):
    client, row, catalog = images
    caplog.set_level("INFO", logger="uvicorn.error")
    assert (await client.get(image_path(row))).status_code == 302
    assert "outline_image_db_checkout_ms=" not in caplog.text

    catalog.with_name("measure-db-checkout").touch()
    assert (await client.get(image_path(row))).status_code == 302
    samples = [r.getMessage() for r in caplog.records
               if r.getMessage().startswith("outline_image_db_checkout_ms=")]
    assert len(samples) == 1
    assert float(samples[0].split("=")[1]) >= 0


async def test_revoking_public_access_or_substituting_ids_never_redirects(images, db, course):
    client, row, _ = images
    for wrong, identify in [
        ("attachment_id", str(uuid4())),
        ("activity_uuid", f"activity_{uuid4()}"),
        ("course_uuid", f"course_{uuid4()}"),
    ]:
        response = await client.get(image_path({**row, wrong: identify}))
        assert response.status_code == 404
        assert "location" not in response.headers
    course.public = False
    db.add(course)
    await db.commit()
    response = await client.get(image_path(row))
    assert response.status_code == 401
    assert response.headers["cache-control"] == "private, no-store"
    assert "location" not in response.headers


async def test_private_course_denies_other_org_and_accepts_admin(images, db, course, monkeypatch, admin_user, regular_user, other_org):
    client, row, _ = images
    course.public = False
    db.add(course)
    await db.commit()

    await db.execute(update(UserOrganization).where(UserOrganization.user_id == regular_user.id).values(org_id=other_org.id))
    await db.commit()

    async def cookie_user(request, _db):
        return admin_user if request.cookies.get("LH_access") else regular_user

    monkeypatch.setattr(external_activity_images, "get_current_user", cookie_user)
    response = await client.get(image_path(row))
    assert response.status_code == 403
    assert "location" not in response.headers
    client.cookies.set("LH_access", "test-session")
    response = await client.get(image_path(row))
    assert response.status_code == 302, response.text


@pytest.mark.parametrize("bad_catalog", [
    lambda row: [row, row],
    lambda row: [{**row, "object_key": "uploads/../sample.svg"}],
    lambda row: [{**row, "content_type": "image/png"}],
    lambda row: [{**row, "object_key": 5}],
])
async def test_invalid_catalog_disables_image_signing(images, bad_catalog):
    client, row, catalog = images
    catalog.write_text(json.dumps({"version": 1, "images": bad_catalog(row)}))
    response = await client.get(image_path(row))
    assert response.status_code == 404
    assert "location" not in response.headers


async def test_without_credentials_does_not_sign(images, monkeypatch):
    client, row, _ = images
    monkeypatch.delenv("LEARNHOUSE_OUTLINE_R2_SECRET_ACCESS_KEY")
    response = await client.get(image_path(row))
    assert response.status_code == 404
    assert "location" not in response.headers


def test_ai_can_validate_https_image_urls_without_granting_outline_access():
    assert not doc_ops.attrs_problems("blockImage", {"externalUrl": "https://example.org/photo.png", "alt": "Photo"})
    for url in ["http://example.org/photo.png", "https://name:pass@example.org/photo.png", "javascript:alert(1)"]:
        assert doc_ops.attrs_problems("blockImage", {"externalUrl": url})

    editor = doc_ops.Editor({"type": "doc", "content": [{"type": "blockImage", "attrs": {"outlineAttachmentId": ATTACHMENT}}]})
    editor.set_attrs([0], {"alt": "Updated description"})
    assert editor.node([0])["attrs"]["outlineAttachmentId"] == ATTACHMENT
    with pytest.raises(doc_ops.DocError):
        editor.set_attrs([0], {"outlineAttachmentId": str(uuid4())})
