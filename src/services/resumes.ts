import type { Env } from '../env';

export const MAX_RESUME_BYTES = 10 * 1024 * 1024;

export type ResumeSummary = {
  filename: string;
  contentType: string;
  bytes: number;
  uploadedAt: string;
};

type ResumeRow = {
  resume_object_key: string | null;
  resume_filename: string | null;
  resume_content_type: string | null;
  resume_bytes: number | null;
  resume_uploaded_at: string | null;
};

type ResumeFormat = {
  contentType: string;
  matches: (bytes: Uint8Array) => boolean;
};

const FORMATS: Record<string, ResumeFormat> = {
  '.pdf': { contentType: 'application/pdf', matches: (bytes) => startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]) },
  '.doc': { contentType: 'application/msword', matches: (bytes) => startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) },
  '.docx': { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', matches: isZip },
  '.odt': { contentType: 'application/vnd.oasis.opendocument.text', matches: isZip },
  '.rtf': { contentType: 'application/rtf', matches: (bytes) => new TextDecoder().decode(bytes.slice(0, 5)).toLowerCase() === '{\\rtf' },
};

export class ResumeUploadError extends Error {
  constructor(
    readonly status: 400 | 404 | 413 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ResumeUploadError';
  }
}

export async function readResumeBody(request: Request): Promise<ArrayBuffer> {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_RESUME_BYTES) {
    throw new ResumeUploadError(413, 'resume_too_large', 'Resume files must be 10 MB or smaller.');
  }
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESUME_BYTES) {
      await reader.cancel().catch(() => {});
      throw new ResumeUploadError(413, 'resume_too_large', 'Resume files must be 10 MB or smaller.');
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}

export function resumeSummary(row: ResumeRow | null | undefined): ResumeSummary | null {
  if (!row?.resume_object_key || !row.resume_filename || !row.resume_content_type || !row.resume_uploaded_at) return null;
  return {
    filename: row.resume_filename,
    contentType: row.resume_content_type,
    bytes: Number(row.resume_bytes ?? 0),
    uploadedAt: row.resume_uploaded_at,
  };
}

export async function uploadParticipantResume(
  env: Env,
  participantId: number,
  encodedFilename: string | undefined,
  body: ArrayBuffer,
): Promise<ResumeSummary> {
  if (!env.RECORDINGS) throw new ResumeUploadError(503, 'resume_storage_not_configured', 'Resume uploads are not configured yet.');
  const current = await resumeRow(env, participantId);
  if (!current) throw new ResumeUploadError(404, 'participant_not_found', 'Participant not found.');
  if (!body.byteLength) throw new ResumeUploadError(400, 'empty_resume', 'Choose a resume file to upload.');
  if (body.byteLength > MAX_RESUME_BYTES) throw new ResumeUploadError(413, 'resume_too_large', 'Resume files must be 10 MB or smaller.');

  const filename = safeFilename(encodedFilename);
  const extension = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  const format = FORMATS[extension];
  if (!format) throw new ResumeUploadError(400, 'unsupported_resume_type', 'Use a PDF, DOC, DOCX, ODT, or RTF file.');
  if (!format.matches(new Uint8Array(body).slice(0, 16))) {
    throw new ResumeUploadError(400, 'invalid_resume_file', `That file does not appear to be a valid ${extension.slice(1).toUpperCase()} document.`);
  }

  const objectKey = `resumes/${participantId}/${crypto.randomUUID()}${extension}`;
  const uploadedAt = new Date().toISOString();
  await env.RECORDINGS.put(objectKey, body, {
    httpMetadata: { contentType: format.contentType, cacheControl: 'private, no-store' },
  });
  try {
    await env.DB.prepare(
      `UPDATE participants SET resume_object_key = ?2, resume_filename = ?3,
         resume_content_type = ?4, resume_bytes = ?5, resume_uploaded_at = ?6,
         updated_at = datetime('now') WHERE id = ?1`,
    ).bind(participantId, objectKey, filename, format.contentType, body.byteLength, uploadedAt).run();
  } catch (cause) {
    await env.RECORDINGS.delete(objectKey).catch(() => {});
    throw cause;
  }
  if (current.resume_object_key && current.resume_object_key !== objectKey) {
    await env.RECORDINGS.delete(current.resume_object_key).catch(() => {});
  }
  return { filename, contentType: format.contentType, bytes: body.byteLength, uploadedAt };
}

export async function removeParticipantResume(env: Env, participantId: number): Promise<boolean> {
  const current = await resumeRow(env, participantId);
  if (!current) return false;
  await env.DB.prepare(
    `UPDATE participants SET resume_object_key = NULL, resume_filename = NULL,
       resume_content_type = NULL, resume_bytes = NULL, resume_uploaded_at = NULL,
       updated_at = datetime('now') WHERE id = ?1`,
  ).bind(participantId).run();
  if (current.resume_object_key && env.RECORDINGS) {
    await env.RECORDINGS.delete(current.resume_object_key).catch(() => {});
  }
  return true;
}

export async function participantResume(env: Env, participantId: number) {
  if (!env.RECORDINGS) throw new ResumeUploadError(503, 'resume_storage_not_configured', 'Resume storage is not configured.');
  const row = await resumeRow(env, participantId);
  const summary = resumeSummary(row);
  if (!row || !summary || !row.resume_object_key?.startsWith(`resumes/${participantId}/`)) {
    throw new ResumeUploadError(404, 'resume_not_found', 'No resume is attached to this profile.');
  }
  const object = await env.RECORDINGS.get(row.resume_object_key);
  if (!object) throw new ResumeUploadError(404, 'resume_not_found', 'The attached resume could not be found.');
  return { object, summary };
}

export function resumeDownloadHeaders(summary: ResumeSummary): Record<string, string> {
  const fallback = summary.filename.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'resume';
  return {
    'Content-Type': summary.contentType,
    'Content-Disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(summary.filename)}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  };
}

async function resumeRow(env: Env, participantId: number) {
  return env.DB.prepare(
    `SELECT resume_object_key, resume_filename, resume_content_type, resume_bytes, resume_uploaded_at
     FROM participants WHERE id = ?1`,
  ).bind(participantId).first<ResumeRow>();
}

function safeFilename(encodedFilename: string | undefined) {
  let decoded = '';
  try {
    decoded = decodeURIComponent(encodedFilename ?? '');
  } catch {
    decoded = '';
  }
  const filename = decoded.split(/[\\/]/).at(-1)?.replace(/[\r\n\0"]/g, '').trim().slice(0, 180) ?? '';
  if (!filename || !filename.includes('.')) throw new ResumeUploadError(400, 'missing_filename', 'The resume filename is missing.');
  return filename;
}

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

function isZip(bytes: Uint8Array) {
  return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])
    || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])
    || startsWith(bytes, [0x50, 0x4b, 0x07, 0x08]);
}
