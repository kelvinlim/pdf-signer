export type SignatureMime = "image/png" | "image/jpeg";

/** A signature image ready to be previewed now and stamped into a PDF later. */
export interface Signature {
  bytes: Uint8Array;
  mime: SignatureMime;
  /** Object URL for previewing; release with `revokeSignature`. */
  url: string;
  /** Natural pixel size, used for the default aspect ratio. */
  width: number;
  height: number;
}

/** Identify PNG/JPEG by magic bytes rather than trusting the file extension. */
export function sniffMime(bytes: Uint8Array): SignatureMime | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  return null;
}

export async function loadSignature(bytes: Uint8Array): Promise<Signature> {
  const mime = sniffMime(bytes);
  if (!mime) throw new Error("Unsupported image. Choose a PNG or JPG file.");

  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { bytes, mime, url, width: img.naturalWidth, height: img.naturalHeight };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("Could not decode the image. The file may be corrupt.");
  }
}

export function revokeSignature(sig: Signature | null) {
  if (sig) URL.revokeObjectURL(sig.url);
}
