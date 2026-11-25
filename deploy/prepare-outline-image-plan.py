#!/usr/bin/env python3
# /// script
# dependencies = ["boto3", "markdown-it-py"]
# ///
import argparse
import copy
import json
import os
import re
from collections import Counter
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit
from uuid import UUID

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from markdown_it import MarkdownIt

OUTLINE_HOST = "outline.itpit.net"
BUCKET = "outline-originals"
R2_ENDPOINT = re.compile(r"https://[0-9a-f]{32}\.r2\.cloudflarestorage\.com")
MIMES = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
}


class PlanError(ValueError):
    pass


def uuid_value(value, prefix=""):
    if not isinstance(value, str) or not value.startswith(prefix):
        raise PlanError("Invalid identifier")
    suffix = value.removeprefix(prefix)
    if str(UUID(suffix)) != suffix:
        raise PlanError("Invalid identifier")
    return value


def outline_attachment_id(src):
    if not isinstance(src, str):
        return None
    parts = urlsplit(src)
    if (parts.scheme, parts.netloc) not in {("", ""), ("https", OUTLINE_HOST)}:
        return None
    if parts.path != "/api/attachments.redirect" or parts.fragment:
        return None
    query = parse_qs(parts.query, strict_parsing=True)
    if set(query) != {"id"} or len(query["id"]) != 1:
        raise PlanError("Invalid Outline attachment URL")
    return uuid_value(query["id"][0])


def document_images(markdown):
    refs = []
    for token in MarkdownIt("commonmark").enable("table").parse(markdown):
        for child in token.children or ():
            if child.type == "image":
                ref = outline_attachment_id(child.attrGet("src"))
                if ref:
                    refs.append((ref, child.content))
    return refs


def object_metadata(attachment, endpoint, s3):
    parts = urlsplit(attachment["signedUrl"])
    prefix = f"/{BUCKET}/"
    if (f"{parts.scheme}://{parts.netloc}" != endpoint
            or not parts.path.startswith(prefix) or not parts.query.startswith("X-Amz-")
            or parts.fragment):
        raise PlanError("Attachment points outside the fixed R2 bucket")
    key = unquote(parts.path.removeprefix(prefix), errors="strict")
    if (not key.startswith("uploads/") or len(key.encode()) > 1024 or "\\" in key
            or any(ord(c) < 32 or ord(c) == 127 for c in key)
            or any(part in ("", ".", "..") for part in key.split("/"))):
        raise PlanError("Invalid R2 image key")
    mime = MIMES.get(Path(key).suffix.lower())
    if mime is None or attachment["contentType"] != mime:
        raise PlanError("Outline attachment MIME type differs from its image format")
    actual = s3.head_object(Bucket=BUCKET, Key=key)
    if actual["ContentLength"] != attachment["size"] or actual["ContentType"] != mime:
        raise PlanError("R2 image size or MIME type differs from Outline")
    return key, mime


def is_outline_image_fallback(node, attachment_id):
    content = node.get("content", [])
    if not attachment_id or node.get("type") != "paragraph" or len(content) != 1:
        return False
    link = content[0]
    text = link.get("text", "")
    marks = link.get("marks", [])
    if (link.get("type") != "text" or len(marks) != 1
            or (text != "Outlineで画像を開く" and not text.endswith("：Outlineで画像を開く"))):
        return False
    href = f"/api/attachments.redirect?id={attachment_id}"
    return marks[0].get("type") == "link" and marks[0].get("attrs", {}).get("href") in {
        href, f"https://{OUTLINE_HOST}{href}",
    }


def rewrite_content(document, refs):
    if document.get("type") != "doc" or not isinstance(document.get("content"), list):
        raise PlanError("Invalid activity document")
    updated = copy.deepcopy(document)
    expected = Counter(ref for ref, _ in refs)
    labels = {}
    for ref, alt in refs:
        labels.setdefault(ref, []).append(alt)
    seen = Counter()

    def visit(node):
        if node.get("type") == "blockImage":
            attrs = node.get("attrs", {})
            old = outline_attachment_id(attrs.get("unsplash_url"))
            current = attrs.get("outlineAttachmentId")
            ref = old or current
            if ref:
                uuid_value(ref)
                if expected[ref] <= seen[ref] or (old and current and old != current):
                    raise PlanError("Activity image does not match its Outline document")
                if attrs.get("blockObject") or attrs.get("externalUrl"):
                    raise PlanError("Outline reference conflicts with an existing image source")
                if old:
                    attrs.pop("unsplash_url")
                    attrs["outlineAttachmentId"] = ref
                    if not attrs.get("alt"):
                        attrs["alt"] = labels[ref][seen[ref]]
                seen[ref] += 1
        if "content" in node:
            children = []
            preceding_attachment = None
            for child in node["content"]:
                if is_outline_image_fallback(child, preceding_attachment):
                    preceding_attachment = None
                    continue
                visit(child)
                children.append(child)
                preceding_attachment = (
                    child.get("attrs", {}).get("outlineAttachmentId")
                    if child.get("type") == "blockImage" else None
                )
            node["content"] = children

    visit(updated)
    if seen != expected:
        raise PlanError("Outline and activity image counts differ")
    return updated


def prepare(records, endpoint, s3):
    if not R2_ENDPOINT.fullmatch(endpoint):
        raise PlanError("Invalid R2 endpoint")
    catalog, changes, counts = [], [], []
    seen = set()
    for record in sorted(records, key=lambda row: (row["course_uuid"], row["activity_uuid"])):
        course = uuid_value(record["course_uuid"], "course_")
        activity = uuid_value(record["activity_uuid"], "activity_")
        source = record["outline_document"]
        doc_id = uuid_value(source["id"])
        revision = source["revision"]
        version = record["activity_version"]
        if activity in seen or type(revision) is not int or revision < 1 or type(version) is not int or version < 1:
            raise PlanError("Duplicate activity or invalid revision")
        seen.add(activity)
        refs = document_images(source["markdown"])
        by_id = {}
        for item in record["attachments"]:
            ref = uuid_value(item["id"])
            if ref in by_id or item["document_id"] != doc_id:
                raise PlanError("Duplicate attachment or metadata from another document")
            by_id[ref] = item
        expected = {ref for ref, _ in refs}
        if set(by_id) != expected:
            raise PlanError("Attachment metadata does not match the source document")
        before = record["activity_content"]
        after = rewrite_content(before, refs)
        for ref in sorted(expected):
            key, mime = object_metadata(by_id[ref], endpoint, s3)
            catalog.append(dict(course_uuid=course, activity_uuid=activity, attachment_id=ref,
                                object_key=key, content_type=mime))
        counts.append(dict(activity_uuid=activity, references=len(refs)))
        if before != after:
            changes.append(dict(course_uuid=course, activity_uuid=activity, activity_version=version,
                                document_id=doc_id, document_revision=revision, before=before, after=after))
    return {"version": 1, "images": catalog}, {"version": 1, "activities": changes, "counts": counts}


def verify_current(plan, fresh_snapshots):
    by_activity = {}
    for record in fresh_snapshots:
        activity = uuid_value(record["activity_uuid"], "activity_")
        if activity in by_activity:
            raise PlanError("Duplicate activity snapshot")
        by_activity[activity] = record
    for original in plan["activities"]:
        current = by_activity.get(original["activity_uuid"])
        if (current is None or current["course_uuid"] != original["course_uuid"]
                or current["activity_version"] != original["activity_version"]
                or current["activity_content"] != original["before"]
                or current["outline_document"]["revision"] != original["document_revision"]
                or current["outline_document"]["id"] != original["document_id"]):
            raise PlanError("Activity or Outline document changed after the plan was generated")


def main():
    parser = argparse.ArgumentParser(description="Prepare Outline image references without downloading originals.")
    parser.add_argument("snapshot", type=Path)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--out", type=Path, help="New local directory for catalog.json and updates.json")
    mode.add_argument("--check-current", type=Path, help="Existing updates.json to compare against fresh snapshots")
    args = parser.parse_args()
    try:
        snapshots = json.loads(args.snapshot.read_text())
        if args.check_current:
            verify_current(json.loads(args.check_current.read_text()), snapshots)
            print("Activity versions, Outline revisions, and activity content match.")
            return
        endpoint = os.environ["LEARNHOUSE_OUTLINE_R2_ENDPOINT"]
        if not R2_ENDPOINT.fullmatch(endpoint):
            raise PlanError("Invalid R2 endpoint")
        s3 = boto3.client(
            "s3", endpoint_url=endpoint, region_name="auto",
            aws_access_key_id=os.environ["LEARNHOUSE_OUTLINE_R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["LEARNHOUSE_OUTLINE_R2_SECRET_ACCESS_KEY"],
            config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        )
        catalog, plan = prepare(snapshots, endpoint, s3)
        args.out.mkdir(mode=0o700)
        for name, document in (("catalog.json", catalog), ("updates.json", plan)):
            with (args.out / name).open("x", encoding="utf-8") as handle:
                json.dump(document, handle, ensure_ascii=False, indent=2, sort_keys=True)
                handle.write("\n")
        print(f"Prepared {len(catalog['images'])} registrations and {len(plan['activities'])} activity updates.")
    except PlanError as error:
        parser.exit(1, f"Preparation failed: {error}.\n")
    except (OSError, UnicodeError, TypeError, ValueError, KeyError, AttributeError, BotoCoreError, ClientError):
        parser.exit(1, "Preparation failed. Check snapshot structure, local output, and R2 read access.\n")


if __name__ == "__main__":
    main()
