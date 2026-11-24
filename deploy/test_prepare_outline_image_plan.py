import copy
import importlib.util
import unittest
from pathlib import Path
from uuid import uuid4

SPEC = importlib.util.spec_from_file_location("prepare_images", Path(__file__).with_name("prepare-outline-image-plan.py"))
prepare_images = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(prepare_images)
ENDPOINT = "https://" + "0" * 32 + ".r2.cloudflarestorage.com"


class R2:
    def __init__(self, size=21, mime="image/svg+xml"):
        self.size = size
        self.mime = mime

    def head_object(self, *, Bucket, Key):
        if Bucket != "outline-originals" or Key != "uploads/folder/sample.svg":
            raise AssertionError("unexpected object")
        return {"ContentLength": self.size, "ContentType": self.mime}


class PrepareTest(unittest.TestCase):
    def setUp(self):
        self.image = str(uuid4())
        doc = str(uuid4())
        link = f"/api/attachments.redirect?id={self.image}"
        self.record = {
            "course_uuid": f"course_{uuid4()}",
            "activity_uuid": f"activity_{uuid4()}",
            "activity_version": 3,
            "outline_document": {"id": doc, "revision": 2, "markdown": f"![Original alt]({link})\n\n![Second use]({link})"},
            "activity_content": {"type": "doc", "content": [
                {"type": "blockImage", "attrs": {"unsplash_url": f"https://outline.itpit.net{link}", "size": {"width": 40}}},
                {"type": "codeBlock", "content": [{"type": "text", "text": f"![Literal text]({link})"}]},
                {"type": "blockImage", "attrs": {"unsplash_url": f"https://outline.itpit.net{link}", "alt": "Keep this alt"}},
            ]},
            "attachments": [
                {"id": self.image, "document_id": doc, "contentType": "image/svg+xml", "size": 21,
                 "signedUrl": f"{ENDPOINT}/outline-originals/uploads/folder/sample.svg?X-Amz-Signature=unused"},
            ],
        }

    def test_only_rewrites_matching_image_nodes_and_deduplicates_catalog(self):
        records = [self.record]
        catalog, plan = prepare_images.prepare(records, ENDPOINT, R2())
        self.assertEqual((catalog, plan), prepare_images.prepare(records, ENDPOINT, R2()))
        self.assertEqual(len(catalog["images"]), 1)
        self.assertEqual(plan["counts"][0]["references"], 2)
        first, code, second = plan["activities"][0]["after"]["content"]
        self.assertEqual(first["attrs"], {"outlineAttachmentId": self.image, "size": {"width": 40}, "alt": "Original alt"})
        self.assertEqual(second["attrs"]["alt"], "Keep this alt")
        self.assertEqual(code, self.record["activity_content"]["content"][1])
        self.assertNotIn("X-Amz", str((catalog, plan)))
        migrated = {**self.record, "activity_content": plan["activities"][0]["after"]}
        _, repeat_plan = prepare_images.prepare([migrated], ENDPOINT, R2())
        self.assertEqual(repeat_plan["activities"], [])

    def test_removes_only_the_generated_link_after_its_image(self):
        link = self.record["attachments"][0]["id"]
        href = f"https://outline.itpit.net/api/attachments.redirect?id={link}"
        paragraph = {"type": "paragraph", "content": [
            {"type": "text", "text": "Original alt：Outlineで画像を開く",
             "marks": [{"type": "link", "attrs": {"href": href}}]},
        ]}
        original_link = copy.deepcopy(paragraph)
        original_link["content"][0]["text"] = "原文の参考リンク"
        self.record["activity_content"]["content"].insert(1, paragraph)
        self.record["activity_content"]["content"].append(original_link)
        _, plan = prepare_images.prepare([self.record], ENDPOINT, R2())
        result = plan["activities"][0]["after"]["content"]
        self.assertEqual([n["type"] for n in result], ["blockImage", "codeBlock", "blockImage", "paragraph"])
        self.assertEqual(result[-1], original_link)

    def test_refuses_metadata_for_another_document_or_bucket(self):
        for field, value in [
            ("document_id", str(uuid4())),
            ("signedUrl", f"{ENDPOINT}/wrong/uploads/folder/sample.svg?X-Amz-Signature=unused"),
            ("signedUrl", f"{ENDPOINT}/outline-originals/uploads/%2e%2e/sample.svg?X-Amz-Signature=unused"),
        ]:
            record = copy.deepcopy(self.record)
            record["attachments"][0][field] = value
            with self.assertRaises(ValueError):
                prepare_images.prepare([record], ENDPOINT, R2())

    def test_refuses_missing_or_different_original(self):
        for r2 in [R2(size=22), R2(mime="image/png")]:
            with self.assertRaises(ValueError):
                prepare_images.prepare([self.record], ENDPOINT, r2)
        self.record["outline_document"]["markdown"] = f'~~~\n![Example](/api/attachments.redirect?id={self.image})\n~~~'
        with self.assertRaises(ValueError):
            prepare_images.prepare([self.record], ENDPOINT, R2())

    def test_rechecks_all_versions_and_content_before_apply(self):
        _, plan = prepare_images.prepare([self.record], ENDPOINT, R2())
        prepare_images.verify_current(plan, [self.record])
        for record in [
            {**self.record, "activity_version": 4},
            {**self.record, "outline_document": {**self.record["outline_document"], "revision": 3}},
            {**self.record, "activity_content": {"type": "doc", "content": []}},
        ]:
            with self.assertRaises(ValueError):
                prepare_images.verify_current(plan, [record])


if __name__ == "__main__":
    unittest.main()
