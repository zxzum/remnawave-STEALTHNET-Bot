import assert from "node:assert/strict";
import test from "node:test";

const upload = await import("./upload.js") as unknown as {
  isAllowedUploadedImage?: (mimetype: string) => boolean;
  makeFilename?: (originalname: string, mimetype?: string) => string;
};

test("allows raster image MIME types and rejects SVG", () => {
  assert.equal(typeof upload.isAllowedUploadedImage, "function");
  assert.equal(upload.isAllowedUploadedImage?.("image/jpeg"), true);
  assert.equal(upload.isAllowedUploadedImage?.("image/png"), true);
  assert.equal(upload.isAllowedUploadedImage?.("image/webp"), true);
  assert.equal(upload.isAllowedUploadedImage?.("image/gif"), true);
  assert.equal(upload.isAllowedUploadedImage?.("image/svg+xml"), false);
});

test("canonicalizes accepted image filenames from MIME type", () => {
  assert.equal(typeof upload.makeFilename, "function");
  const filename = upload.makeFilename?.("payload.js", "image/png");
  assert.match(filename ?? "", /\.png$/);
  assert.doesNotMatch(filename ?? "", /\.js$/);
});
