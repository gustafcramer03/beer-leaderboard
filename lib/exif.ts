"use client";

import exifr from "exifr";

// When did a photo get taken? For offline beers we trust the photo's own EXIF
// capture time (DateTimeOriginal) instead of the upload time. If a photo has no
// EXIF time (screenshots, stripped metadata, some Android shots), we fall back to
// the file's last-modified time so logging never gets blocked — the user can
// still adjust it before submitting.
export type PhotoTime = {
  date: Date;
  source: "exif" | "file";
};

export async function readPhotoTime(file: File): Promise<PhotoTime> {
  try {
    // Pull only the date tags we care about; fast and avoids decoding the image.
    const tags = await exifr.parse(file, [
      "DateTimeOriginal",
      "CreateDate",
      "ModifyDate",
    ]);
    const d: Date | undefined =
      tags?.DateTimeOriginal ?? tags?.CreateDate ?? tags?.ModifyDate;
    if (d instanceof Date && !isNaN(d.getTime())) {
      return { date: d, source: "exif" };
    }
  } catch {
    /* fall through to file time */
  }
  return { date: new Date(file.lastModified), source: "file" };
}
