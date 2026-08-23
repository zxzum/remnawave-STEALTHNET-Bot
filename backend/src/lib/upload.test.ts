import assert from "node:assert/strict";
import test from "node:test";

const upload = await import("./upload.js") as unknown as {
  isAllowedUploadedImage?: (mimetype: string) => boolean;
};

test("allows raster image MIME types and rejects SVG", () => {
  assert.equal(typeof upload.isAllowedUploadedImage, "function");
  assert.equal(upload.isAllowedUploadedImage?.("image/jpeg"), true);
  assert.equal(upload.isAllowedUploadedImage?.("image/png"), true);
  assert.equal(upload.isAllowedUploadedImage?.("image/webp"), true);
  assert.equal(upload.isAllowedUploadedImage?.("image/gif"), true);
  assert.equal(upload.isAllowedUploadedImage?.("image/svg+xml"), false);
});
