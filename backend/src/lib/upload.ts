import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";

const UPLOADS_ROOT = "/app/uploads";

const UPLOAD_DIRS = {
  mascots: path.join(UPLOADS_ROOT, "mascots"),
  videos: path.join(UPLOADS_ROOT, "videos"),
  tickets: path.join(UPLOADS_ROOT, "tickets"),
} as const;

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export function isAllowedUploadedImage(mimetype: string): boolean {
  return ALLOWED_IMAGE_MIME_TYPES.has(mimetype.trim().toLowerCase());
}

function ensureUploadDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeFilename(originalname: string): string {
  const ext = path.extname(originalname).toLowerCase();
  const hash = crypto.randomBytes(12).toString("hex");
  return `${hash}${ext}`;
}

// ——— Mascot upload (PNG/JPG/WEBP, max 5MB) ———
const mascotStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, ensureUploadDir(UPLOAD_DIRS.mascots)),
  filename: (_req, file, cb) => cb(null, makeFilename(file.originalname)),
});

export const uploadMascotImage = multer({
  storage: mascotStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".png", ".jpg", ".jpeg", ".webp"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Допустимые форматы: PNG, JPG, WEBP"));
    }
  },
});

// ——— Video upload (MP4/WEBM, max 150MB) ———
const videoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, ensureUploadDir(UPLOAD_DIRS.videos)),
  filename: (_req, file, cb) => cb(null, makeFilename(file.originalname)),
});

export const uploadVideo = multer({
  storage: videoStorage,
  limits: { fileSize: 150 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".mp4", ".webm"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Допустимые форматы: MP4, WEBM"));
    }
  },
});

// ——— Ticket attachments (PNG/JPG/WEBP/GIF, max 10MB, до 5 файлов за раз) ———
// Используется как клиентской частью тикетов (POST /client/tickets, /client/tickets/:id/messages),
// так и админской (POST /admin/tickets/:id/messages).
const ticketStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, ensureUploadDir(UPLOAD_DIRS.tickets)),
  filename: (_req, file, cb) => cb(null, makeFilename(file.originalname)),
});

export const uploadTicketAttachment = multer({
  storage: ticketStorage,
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    if (isAllowedUploadedImage(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Допустимые форматы: PNG, JPG, WEBP, GIF"));
    }
  },
});

/** Удалить файл из uploads (safe, не бросает ошибку) */
export function removeUploadedFile(relativePath: string): void {
  try {
    const full = path.join(UPLOADS_ROOT, relativePath);
    if (fs.existsSync(full)) fs.unlinkSync(full);
  } catch {
    // ignore
  }
}

/** Превратить filename в относительный URL для API */
export function mascotUrl(filename: string): string {
  return `/api/uploads/mascots/${filename}`;
}

export function videoUploadUrl(filename: string): string {
  return `/api/uploads/videos/${filename}`;
}

export function ticketAttachmentUrl(filename: string): string {
  return `/api/uploads/tickets/${filename}`;
}
