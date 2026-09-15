import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { endpoints } from './api';

/**
 * Score screenshot pipeline (Module 2E, agent.md §4 "Low data / 3G"):
 *   pick (gallery or camera) → resize to ≤1280px → JPEG, stepping the
 *   quality down until the payload is ≤ 500KB → upload → public URL.
 *
 * Storage is the backend's concern (local in dev, Cloudinary in 3D) — the
 * app only ever receives a URL to attach to the result pick.
 */

export const MAX_BYTES = 500 * 1024;
const MAX_EDGE = 1280;
const QUALITIES = [0.8, 0.65, 0.5, 0.38, 0.28, 0.2];

export interface PickedImage {
  uri: string;
  width: number;
  height: number;
}

export async function pickFromGallery(): Promise<PickedImage | null> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    quality: 1,
    exif: false,
  });
  if (res.canceled || !res.assets[0]) return null;
  const a = res.assets[0];
  return { uri: a.uri, width: a.width, height: a.height };
}

export async function pickFromCamera(): Promise<PickedImage | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error('Camera permission is needed to photograph the score screen');
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: false });
  if (res.canceled || !res.assets[0]) return null;
  const a = res.assets[0];
  return { uri: a.uri, width: a.width, height: a.height };
}

export interface CompressedImage {
  base64: string;
  bytes: number;
  width: number;
  height: number;
  quality: number;
}

/** Downscale + re-encode until ≤ MAX_BYTES. Throws if even the lowest quality is too big. */
export async function compressForUpload(img: PickedImage): Promise<CompressedImage> {
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  const target = { width: Math.round(img.width * scale), height: Math.round(img.height * scale) };

  const ctx = ImageManipulator.manipulate(img.uri);
  if (scale < 1) ctx.resize(target);
  const ref = await ctx.renderAsync();
  try {
    for (const quality of QUALITIES) {
      const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: quality, base64: true });
      const b64 = out.base64 ?? '';
      const bytes = Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
      if (bytes <= MAX_BYTES) return { base64: b64, bytes, width: out.width, height: out.height, quality };
    }
  } finally {
    ref.release();
  }
  throw new Error('Could not shrink the screenshot under 500KB — try cropping to just the score');
}

/** Full pipeline → the URL to submit with the result pick. */
export async function uploadScreenshot(img: PickedImage, matchId: string): Promise<{ url: string; bytes: number }> {
  const c = await compressForUpload(img);
  const { url, bytes } = await endpoints.uploadScreenshot(c.base64, matchId);
  return { url, bytes };
}
