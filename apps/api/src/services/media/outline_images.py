import json
import logging
import os
import re
from base64 import urlsafe_b64encode
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from time import time
from typing import Protocol
from urllib.parse import urlsplit
from uuid import UUID

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

logger = logging.getLogger(__name__)
CACHE_CONTROL = "private, no-store"
EXPIRES_IN = 60
_PREVIEW_CONTEXT = b"learnhouse-outline-preview-v1"
_ENDPOINT = re.compile(r"https://[0-9a-f]{32}\.r2\.cloudflarestorage\.com")
_IMAGE_TYPES = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
}


@dataclass(frozen=True)
class ImageRef:
    course_uuid: str
    activity_uuid: str
    attachment_id: str

    def __post_init__(self):
        for value, prefix in (
            (self.course_uuid, "course_"), (self.activity_uuid, "activity_"),
            (self.attachment_id, ""),
        ):
            if not isinstance(value, str) or not value.startswith(prefix):
                raise ValueError("Invalid image reference")
            suffix = value.removeprefix(prefix)
            if str(UUID(suffix)) != suffix:
                raise ValueError("Invalid image reference")


@dataclass(frozen=True)
class ImageObject:
    object_key: str
    content_type: str


def parse_catalog(value: object) -> dict[ImageRef, ImageObject]:
    if not isinstance(value, dict) or value.get("version") != 1 or not isinstance(value.get("images"), list):
        raise ValueError("Invalid Outline image catalog")
    catalog = {}
    for row in value["images"]:
        if not isinstance(row, dict):
            raise ValueError("Invalid Outline image entry")
        ref = ImageRef(row["course_uuid"], row["activity_uuid"], row["attachment_id"])
        key = row["object_key"]
        if (not isinstance(key, str) or not key.startswith("uploads/") or len(key.encode()) > 1024
                or "\\" in key or any(ord(c) < 32 or ord(c) == 127 for c in key)
                or any(part in ("", ".", "..") for part in key.split("/"))):
            raise ValueError("Invalid Outline image key")
        mime = _IMAGE_TYPES.get(Path(key).suffix.lower())
        if not mime or row["content_type"] != mime or ref in catalog:
            raise ValueError("Invalid MIME type or duplicate Outline image")
        catalog[ref] = ImageObject(key, mime)
    return catalog


class ObjectSigner(Protocol):
    def generate_presigned_url(self, ClientMethod: str, *, Params: dict[str, str], ExpiresIn: int) -> str: ...


@dataclass(frozen=True)
class ImagePreview:
    origin: str
    cipher: AESGCM

    def url(self, object_key: str, width: int) -> str:
        nonce = os.urandom(12)
        content = json.dumps([object_key, width, int(time()) + EXPIRES_IN]).encode()
        token = nonce + self.cipher.encrypt(nonce, content, _PREVIEW_CONTEXT)
        return f"{self.origin}/preview/{urlsafe_b64encode(token).decode().rstrip('=')}"


@cache
def get_image_preview() -> ImagePreview | None:
    origin = os.environ.get("LEARNHOUSE_OUTLINE_IMAGE_WORKER_ORIGIN", "").rstrip("/")
    key = os.environ.get("LEARNHOUSE_OUTLINE_IMAGE_PREVIEW_KEY", "")
    if not origin and not key:
        return None
    if not re.fullmatch(r"https://[a-z0-9-]+(?:\.[a-z0-9-]+)+", origin) or not re.fullmatch(r"[0-9a-fA-F]{64}", key):
        logger.warning("Outline image transformation disabled: invalid configuration")
        return None
    return ImagePreview(origin, AESGCM(bytes.fromhex(key)))


@dataclass(frozen=True)
class OutlineImages:
    endpoint: str
    bucket: str
    catalog: dict[ImageRef, ImageObject]
    client: ObjectSigner

    def sign(self, ref: ImageRef, *, preview_width: int | None = None) -> str | None:
        image = self.catalog.get(ref)
        if image is None:
            return None
        if preview_width is not None and image.content_type in ("image/png", "image/jpeg"):
            preview = get_image_preview()
            if preview:
                return preview.url(image.object_key, preview_width)
        params = {
            "Bucket": self.bucket, "Key": image.object_key,
            "ResponseCacheControl": CACHE_CONTROL, "ResponseContentType": image.content_type,
        }
        if image.content_type == "image/svg+xml":
            params["ResponseContentDisposition"] = "attachment"
        url = self.client.generate_presigned_url("get_object", Params=params, ExpiresIn=EXPIRES_IN)
        parsed = urlsplit(url)
        if (f"{parsed.scheme}://{parsed.netloc}" != self.endpoint
                or not parsed.path.startswith(f"/{self.bucket}/") or not parsed.query):
            raise ValueError("Unexpected Outline image signing destination")
        return url


@cache
def get_outline_images() -> OutlineImages | None:
    endpoint = os.environ.get("LEARNHOUSE_OUTLINE_R2_ENDPOINT", "")
    bucket = os.environ.get("LEARNHOUSE_OUTLINE_R2_BUCKET", "")
    catalog_path = os.environ.get("LEARNHOUSE_OUTLINE_IMAGE_CATALOG", "")
    access_key = os.environ.get("LEARNHOUSE_OUTLINE_R2_ACCESS_KEY_ID", "")
    secret = os.environ.get("LEARNHOUSE_OUTLINE_R2_SECRET_ACCESS_KEY", "")
    if not all((endpoint, bucket, catalog_path, access_key, secret)):
        return None
    try:
        if not _ENDPOINT.fullmatch(endpoint) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,61}[a-z0-9]", bucket):
            raise ValueError("Invalid Outline R2 endpoint or bucket")
        catalog = parse_catalog(json.loads(Path(catalog_path).read_text(encoding="utf-8")))
        client = boto3.client(
            "s3", endpoint_url=endpoint, region_name="auto",
            aws_access_key_id=access_key, aws_secret_access_key=secret,
            config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        )
        return OutlineImages(endpoint, bucket, catalog, client)
    except (OSError, ValueError, TypeError, KeyError, BotoCoreError, ClientError):
        logger.warning("Outline image delivery disabled: invalid configuration")
        return None
