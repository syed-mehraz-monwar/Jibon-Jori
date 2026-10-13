import { useRef, useState, type FormEvent } from "react";
import { mediaApi } from "../../api/media.api";
import { useToast } from "../../context/ToastContext";
import { useAsync } from "../../hooks/useAsync";
import { ApiError } from "../../lib/http";
import {
  ALLOWED_MEDIA_MIME,
  MEDIA_BYTES_MAX,
  firebasePathError,
  mediaBytesError,
} from "../../lib/validation";
import { fileNameFromPath, formatBytes, formatDate } from "../../lib/format";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Checkbox } from "../ui/Checkbox";
import { EmptyState } from "../ui/EmptyState";
import { ErrorState } from "../ui/ErrorState";
import { Field } from "../ui/Field";
import { Input } from "../ui/Input";
import { Pagination } from "../ui/Pagination";
import { Select } from "../ui/Select";
import { Spinner } from "../ui/Spinner";

type Kind = "photo" | "document";

const MEDIA_PAGE_SIZE = 12;

/**
 * Profile media manager.
 *
 * The primary action uploads the real bytes to `POST /api/media/me/upload`. The backend
 * decides the type and size from the file signature and hands the bytes to the
 * configured object-storage provider, so nothing here is trusted to describe the file.
 *
 * When the deployment has no storage provider the API answers `503
 * STORAGE_NOT_CONFIGURED`. That is surfaced verbatim, and the metadata-only registration
 * form is revealed as a fallback for deployments that store files outside the
 * application - it is never used to imply that a file was uploaded when it was not.
 */
export function MediaManager() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const media = useAsync(() => mediaApi.listMine({ page, limit: MEDIA_PAGE_SIZE }), [page]);

  const [kind, setKind] = useState<Kind>("photo");
  const [isPrimary, setIsPrimary] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Metadata-only fallback state.
  const [firebasePath, setFirebasePath] = useState("");
  const [mime, setMime] = useState<string>(ALLOWED_MEDIA_MIME[0]);
  const [bytes, setBytes] = useState<number | null>(null);

  function onFileChange(next: File | null) {
    setFileError(null);
    setStorageUnavailable(null);
    setFile(null);
    if (!next) return;

    if (!(ALLOWED_MEDIA_MIME as readonly string[]).includes(next.type)) {
      setFileError(`Unsupported type. Allowed: ${ALLOWED_MEDIA_MIME.join(", ")}.`);
      return;
    }
    const sizeProblem = mediaBytesError(next.size);
    if (sizeProblem) {
      setFileError(sizeProblem);
      return;
    }

    // Local validation is a convenience; the backend re-derives the type and size from
    // the bytes, so these values are never sent as authority.
    setFile(next);
    setKind(next.type === "application/pdf" ? "document" : "photo");
    setMime(next.type);
    setBytes(next.size);
  }

  async function onUpload(event: FormEvent) {
    event.preventDefault();
    setFileError(null);

    if (!file) {
      setFileError("Choose a file to upload.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await mediaApi.upload(file, { kind, isPrimary });
      toast.success(`Uploaded to ${result.storage.provider}.`);
      setFile(null);
      setIsPrimary(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      media.reload();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "STORAGE_NOT_CONFIGURED") {
        // Expected until storage credentials are configured: say so, and offer the
        // metadata-only path rather than failing silently.
        setStorageUnavailable(caught.message);
      } else {
        setFileError(caught instanceof ApiError ? caught.message : "Could not upload the file.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function onRegisterMetadata(event: FormEvent) {
    event.preventDefault();
    setFileError(null);

    const pathProblem = firebasePathError(firebasePath);
    if (pathProblem) {
      setFileError(pathProblem);
      return;
    }
    if (bytes === null) {
      setFileError("Enter the size in bytes.");
      return;
    }
    if (kind === "document" && mime !== "application/pdf") {
      setFileError("A document entry must be a PDF.");
      return;
    }
    if (kind === "photo" && !mime.startsWith("image/")) {
      setFileError("A photo entry must use an image MIME type.");
      return;
    }

    setSubmitting(true);
    try {
      await mediaApi.create({
        firebasePath: firebasePath.trim(),
        kind,
        mime,
        bytes,
        ...(kind === "photo" && isPrimary ? { isPrimary: true } : {}),
      });
      toast.success("Media registered.");
      setFirebasePath("");
      setBytes(null);
      setIsPrimary(false);
      media.reload();
    } catch (caught) {
      setFileError(caught instanceof ApiError ? caught.message : "Could not register the media.");
    } finally {
      setSubmitting(false);
    }
  }

  async function makePrimary(id: string) {
    setBusyId(id);
    try {
      await mediaApi.setPrimary(id);
      toast.success("Primary photo updated.");
      media.reload();
    } catch (caught) {
      toast.error("Could not set the primary photo", caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    try {
      await mediaApi.remove(id);
      toast.success("Media removed.");
      media.reload();
    } catch (caught) {
      toast.error("Could not remove the media", caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card title="Photos and documents" className="flex flex-col gap-5">
      {media.status === "loading" ? (
        <div className="flex justify-center py-6">
          <Spinner className="h-6 w-6 text-brand-600" />
        </div>
      ) : media.status === "error" ? (
        <ErrorState error={media.error} onRetry={media.reload} />
      ) : (media.data?.media.length ?? 0) === 0 ? (
        <EmptyState
          title="No media yet"
          description="Upload a photo to show on your profile. The first primary photo appears in search results."
        />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {media.data?.media.map((item) => (
            <li key={item.id} className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="truncate text-sm font-medium text-slate-800" title={item.firebasePath}>
                  {fileNameFromPath(item.firebasePath)}
                </span>
                {item.isPrimary ? (
                  <span className="jj-chip shrink-0" style={{ padding: "0.1rem 0.5rem" }}>
                    Primary
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {item.kind} &middot; {item.mime} &middot; {formatBytes(item.bytes)}
              </p>
              <p className="text-xs text-slate-400">Added {formatDate(item.createdAt)}</p>
              <div className="mt-2 flex gap-2">
                {item.kind === "photo" && !item.isPrimary ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={busyId === item.id}
                    onClick={() => void makePrimary(item.id)}
                  >
                    Set primary
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="danger"
                  loading={busyId === item.id}
                  onClick={() => void remove(item.id)}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {media.data?.pagination ? (
        <Pagination
          page={media.data.pagination.page}
          totalPages={media.data.pagination.totalPages}
          total={media.data.pagination.total}
          onChange={setPage}
        />
      ) : null}

      <form className="flex flex-col gap-4 border-t border-slate-200 pt-5" onSubmit={onUpload} noValidate>
        <h3 className="text-sm font-semibold text-slate-800">Upload a file</h3>
        <p className="text-xs text-slate-500">
          The file type and size are verified from the file's actual bytes on the server, not from its
          extension or the browser's claim.
        </p>

        <Field
          label="Choose a file"
          htmlFor="media-file"
          error={fileError ?? undefined}
          hint={`Allowed: ${ALLOWED_MEDIA_MIME.join(", ")}. Up to ${MEDIA_BYTES_MAX.toLocaleString()} bytes.`}
        >
          <input
            ref={fileInputRef}
            id="media-file"
            type="file"
            accept={ALLOWED_MEDIA_MIME.join(",")}
            onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700"
          />
        </Field>

        {file ? (
          <p className="text-xs text-slate-600">
            Selected: <span className="font-medium">{file.name}</span> &middot; {formatBytes(file.size)}
            {kind === "document" ? " &middot; document" : ""}
          </p>
        ) : null}

        {kind === "photo" ? (
          <Checkbox
            label="Make this the primary photo"
            description="Only one primary photo can exist at a time."
            checked={isPrimary}
            onChange={(event) => setIsPrimary(event.target.checked)}
          />
        ) : null}

        <div>
          <Button type="submit" loading={submitting}>
            Upload
          </Button>
        </div>

        {storageUnavailable ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800" role="status">
            {storageUnavailable} You can still register metadata for a file that already exists in storage
            using the form below.
          </p>
        ) : null}
      </form>

      {storageUnavailable ? (
        <form
          className="flex flex-col gap-4 border-t border-slate-200 pt-5"
          onSubmit={onRegisterMetadata}
          noValidate
        >
          <h3 className="text-sm font-semibold text-slate-800">Register existing storage metadata</h3>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Storage path"
              htmlFor="media-path"
              required
              hint="For example profiles/arif/avatar.jpg."
            >
              <Input
                id="media-path"
                value={firebasePath}
                onChange={(event) => setFirebasePath(event.target.value)}
                placeholder="profiles/me/avatar.jpg"
              />
            </Field>

            <Field label="Kind" htmlFor="media-kind" required>
              <Select
                id="media-kind"
                value={kind}
                onChange={(event) => {
                  const next = event.target.value as Kind;
                  setKind(next);
                  setMime(next === "document" ? "application/pdf" : "image/jpeg");
                }}
                options={[
                  { value: "photo", label: "Photo" },
                  { value: "document", label: "Document (PDF)" },
                ]}
              />
            </Field>

            <Field label="MIME type" htmlFor="media-mime" required>
              <Select
                id="media-mime"
                value={mime}
                onChange={(event) => setMime(event.target.value)}
                options={ALLOWED_MEDIA_MIME.map((value) => ({ value, label: value }))}
              />
            </Field>

            <Field
              label="Size in bytes"
              htmlFor="media-bytes"
              required
              hint={`Up to ${MEDIA_BYTES_MAX.toLocaleString()} bytes.`}
            >
              <Input
                id="media-bytes"
                type="number"
                min={1}
                max={MEDIA_BYTES_MAX}
                value={bytes ?? ""}
                onChange={(event) => setBytes(event.target.value === "" ? null : Number(event.target.value))}
              />
            </Field>
          </div>

          <div>
            <Button type="submit" variant="secondary" loading={submitting}>
              Register metadata
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
