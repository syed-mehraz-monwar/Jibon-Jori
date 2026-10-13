import { getSupabase, requireUserId, toApiError } from "../lib/supabase";
import { ApiError } from "../lib/http";
import { mapMedia, paginationFor, rangeFor, type MediaRow } from "../lib/mappers";
import { ALLOWED_MEDIA_MIME, MEDIA_BYTES_MAX } from "../lib/validation";
import type { MediaItem, Pagination } from "../lib/types";

export type MediaCreateInput = {
  firebasePath: string;
  kind: "photo" | "document";
  mime: string;
  bytes: number;
  isPrimary?: boolean;
};

export type MediaUploadResult = {
  media: MediaItem;
  storage: {
    provider: string;
    path: string;
    url: string | null;
    contentType: string;
  };
};

const SELECT = "id, profile_id, storage_path, kind, mime, bytes, is_primary, created_at";
const PROVIDER = "supabase-storage";

function bucketFor(kind: "photo" | "document"): "profile-photos" | "profile-documents" {
  return kind === "photo" ? "profile-photos" : "profile-documents";
}

/** Keeps only a safe basename; the object always lives under the caller's folder. */
function safeFileName(name: string, mime: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "").slice(-120) || "upload";
  if (/\.[A-Za-z0-9]{1,5}$/.test(cleaned)) return cleaned;
  const extension = mime === "application/pdf" ? "pdf" : mime.split("/")[1] ?? "bin";
  return `${cleaned}.${extension}`;
}

/**
 * `/api/media` — metadata over the `public.media` table plus the private Supabase
 * Storage buckets (`profile-photos`, `profile-documents`).
 *
 * Two write paths exist, and they are not equivalent:
 *
 *   * `upload` puts the real bytes in Storage and then records the metadata row. The
 *     bucket's own size/MIME limits are enforced by Storage, and the row is checked
 *     by the `media` table constraints, so the type and size are never taken from
 *     the browser's claim alone.
 *   * `create` registers metadata only, for objects already present in Storage.
 *
 * Storage paths must begin with the caller's profile id: the bucket policies (and a
 * `media` CHECK constraint) require `<profileId>/<name>`, so a path outside that
 * folder is rejected rather than silently rewritten.
 */
export const mediaApi = {
  listMine: async (
    params: { page?: number; limit?: number } = {},
    _signal?: AbortSignal
  ): Promise<{ media: MediaItem[]; pagination: Pagination }> => {
    const userId = await requireUserId();
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const [from, to] = rangeFor(page, limit);

    const { data, error, count } = await getSupabase()
      .from("media")
      .select(SELECT, { count: "exact" })
      .eq("profile_id", userId)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) throw toApiError(error);
    return {
      media: ((data ?? []) as MediaRow[]).map(mapMedia),
      pagination: paginationFor(page, limit, count ?? 0),
    };
  },

  create: async (input: MediaCreateInput): Promise<{ media: MediaItem }> => {
    const userId = await requireUserId();
    const path = input.firebasePath.trim();
    if (!path.startsWith(`${userId}/`)) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        `The storage path must begin with your profile id ("${userId}/").`
      );
    }

    const { data, error } = await getSupabase()
      .from("media")
      .insert({
        profile_id: userId,
        storage_path: path,
        kind: input.kind,
        mime: input.mime,
        bytes: input.bytes,
        is_primary: input.kind === "photo" && input.isPrimary === true,
      })
      .select(SELECT)
      .single();
    if (error) throw toApiError(error);
    return { media: mapMedia(data as MediaRow) };
  },

  /** Uploads real bytes to Storage, then records the metadata row. */
  upload: async (
    file: File,
    options: { kind?: "photo" | "document"; isPrimary?: boolean } = {}
  ): Promise<MediaUploadResult> => {
    const userId = await requireUserId();
    const kind = options.kind ?? (file.type === "application/pdf" ? "document" : "photo");

    if (!(ALLOWED_MEDIA_MIME as readonly string[]).includes(file.type)) {
      throw new ApiError(400, "VALIDATION_ERROR", "That file type is not allowed.");
    }
    if (file.size <= 0 || file.size > MEDIA_BYTES_MAX) {
      throw new ApiError(400, "VALIDATION_ERROR", "That file exceeds the upload size limit.");
    }

    const bucket = bucketFor(kind);
    const path = `${userId}/${crypto.randomUUID()}-${safeFileName(file.name, file.type)}`;

    const uploaded = await getSupabase().storage.from(bucket).upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (uploaded.error) throw toApiError(uploaded.error);

    const { data, error } = await getSupabase()
      .from("media")
      .insert({
        profile_id: userId,
        storage_path: path,
        kind,
        mime: file.type,
        bytes: file.size,
        is_primary: kind === "photo" && options.isPrimary === true,
      })
      .select(SELECT)
      .single();
    if (error) {
      // The bytes are already stored; remove them so a failed insert leaves no orphan.
      await getSupabase().storage.from(bucket).remove([path]);
      throw toApiError(error);
    }

    return {
      media: mapMedia(data as MediaRow),
      storage: { provider: PROVIDER, path, url: null, contentType: file.type },
    };
  },

  getMine: async (mediaId: string): Promise<{ media: MediaItem }> => {
    const userId = await requireUserId();
    const { data, error } = await getSupabase()
      .from("media")
      .select(SELECT)
      .eq("id", mediaId)
      .eq("profile_id", userId)
      .maybeSingle();
    if (error) throw toApiError(error);
    if (!data) throw new ApiError(404, "NOT_FOUND", "That media item does not exist.");
    return { media: mapMedia(data as MediaRow) };
  },

  /** A time-limited delivery URL, or an explicit reason why none was issued. */
  deliveryUrl: async (
    mediaId: string,
    ttlSeconds = 300
  ): Promise<{ url: string | null; provider: string | null; expiresInSeconds: number; reason: string | null }> => {
    const userId = await requireUserId();
    const { data, error } = await getSupabase()
      .from("media")
      .select(SELECT)
      .eq("id", mediaId)
      .eq("profile_id", userId)
      .maybeSingle();
    if (error) throw toApiError(error);

    if (!data) {
      return { url: null, provider: PROVIDER, expiresInSeconds: ttlSeconds, reason: "NOT_FOUND" };
    }

    const row = data as MediaRow;
    const signed = await getSupabase()
      .storage.from(bucketFor(row.kind))
      .createSignedUrl(row.storage_path, ttlSeconds);
    if (signed.error || !signed.data?.signedUrl) {
      return {
        url: null,
        provider: PROVIDER,
        expiresInSeconds: ttlSeconds,
        reason: signed.error?.message ?? "SIGN_FAILED",
      };
    }
    return { url: signed.data.signedUrl, provider: PROVIDER, expiresInSeconds: ttlSeconds, reason: null };
  },

  setPrimary: async (mediaId: string): Promise<{ media: MediaItem }> => {
    const userId = await requireUserId();
    const target = await getSupabase()
      .from("media")
      .select(SELECT)
      .eq("id", mediaId)
      .eq("profile_id", userId)
      .maybeSingle();
    if (target.error) throw toApiError(target.error);
    if (!target.data) throw new ApiError(404, "NOT_FOUND", "That media item does not exist.");
    if ((target.data as MediaRow).kind !== "photo") {
      throw new ApiError(400, "VALIDATION_ERROR", "Only a photo can be the primary photo.");
    }

    // Clear the previous primary first: a partial unique index allows only one.
    const cleared = await getSupabase()
      .from("media")
      .update({ is_primary: false })
      .eq("profile_id", userId)
      .eq("is_primary", true);
    if (cleared.error) throw toApiError(cleared.error);

    const { data, error } = await getSupabase()
      .from("media")
      .update({ is_primary: true })
      .eq("id", mediaId)
      .eq("profile_id", userId)
      .select(SELECT)
      .single();
    if (error) throw toApiError(error);
    return { media: mapMedia(data as MediaRow) };
  },

  remove: async (mediaId: string): Promise<{ media: MediaItem }> => {
    const userId = await requireUserId();
    const { data, error } = await getSupabase()
      .from("media")
      .delete()
      .eq("id", mediaId)
      .eq("profile_id", userId)
      .select(SELECT)
      .maybeSingle();
    if (error) throw toApiError(error);
    if (!data) throw new ApiError(404, "NOT_FOUND", "That media item does not exist.");

    const row = data as MediaRow;
    // Best-effort object cleanup; the metadata row is already gone, so a Storage
    // failure must not surface as a failed delete.
    await getSupabase().storage.from(bucketFor(row.kind)).remove([row.storage_path]);
    return { media: mapMedia(row) };
  },
};
