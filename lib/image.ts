"use client";

// Downscale + re-encode a camera photo before upload so storage stays tiny
// (~100-200 KB instead of multi-MB). Keeps us comfortably inside Supabase's
// free 1 GB storage tier even with thousands of photos over a trip.
const MAX_DIM = 1280; // longest edge, px
const QUALITY = 0.7; // JPEG quality

export async function compressImage(file: File): Promise<File> {
  // Only process raster images; leave anything odd untouched.
  if (!file.type.startsWith("image/")) return file;

  try {
    const bitmap = await loadBitmap(file);
    const { width, height } = bitmap;
    const scale = Math.min(1, MAX_DIM / Math.max(width, height));
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY),
    );
    if (!blob) return file;

    // If compression somehow made it bigger, keep the original.
    if (blob.size >= file.size) return file;

    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return file; // never block a log on compression failing
  }
}

// Square-crop (centre) + downscale a profile photo to a small avatar. Avatars
// are shown tiny, so 256px JPEG keeps each one to a few KB.
const AVATAR_DIM = 256;

export async function compressAvatar(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  try {
    const bitmap = await loadBitmap(file);
    const { width, height } = bitmap;
    const side = Math.min(width, height);
    const sx = (width - side) / 2;
    const sy = (height - side) / 2;

    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_DIM;
    canvas.height = AVATAR_DIM;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_DIM, AVATAR_DIM);
    if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.8),
    );
    if (!blob) return file;
    return new File([blob], "avatar.jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  // createImageBitmap honours EXIF orientation on modern browsers (incl. iOS 16+).
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* fall through to <img> */
    }
  }
  return await new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}
