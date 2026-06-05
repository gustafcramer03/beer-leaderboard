"use client";

import { useRef, useState } from "react";

type Props = {
  label: string;
  onCapture: (file: File) => void;
  disabled?: boolean;
  // When true, omit the capture attribute so the picker opens the photo library
  // (for choosing existing shots) instead of forcing the live camera.
  fromGallery?: boolean;
};

// Opens the rear camera on phones via the capture attribute; falls back to the
// gallery on desktop. With fromGallery it always opens the photo library.
// Shows a thumbnail of the chosen shot.
export function CameraCapture({ label, onCapture, disabled, fromGallery }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    onCapture(file);
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        {...(fromGallery ? {} : { capture: "environment" as const })}
        className="hidden"
        onChange={handleFile}
      />
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt={label}
          className="h-48 w-48 rounded-2xl object-cover ring-2 ring-accent"
        />
      ) : (
        <div className="flex h-48 w-48 items-center justify-center rounded-2xl border-2 border-dashed border-accent/40 text-5xl">
          📷
        </div>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="press rounded-full bg-accent px-6 py-3 font-semibold text-accent-contrast shadow disabled:opacity-40"
      >
        {preview ? `Retake ${label}` : `📸 ${label}`}
      </button>
    </div>
  );
}
