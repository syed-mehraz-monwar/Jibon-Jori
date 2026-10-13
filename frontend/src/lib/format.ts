import type { Gender, MaritalStatus, NotificationType } from "./types";

export const GENDER_LABELS: Record<Gender, string> = {
  male: "Male",
  female: "Female",
  other: "Other",
};

export const MARITAL_STATUS_LABELS: Record<MaritalStatus, string> = {
  never_married: "Never married",
  divorced: "Divorced",
  widowed: "Widowed",
  annulled: "Annulled",
};

export const PHOTO_VISIBILITY_LABELS = {
  public: "Anyone",
  members: "Signed-in members",
  private: "Only me",
} as const;

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  like: "Like",
  comment: "Comment",
  rating: "Rating",
  match: "Match",
  security: "Security",
  system: "System",
};

export const INTERACTION_LABELS = {
  "-1": "Disliked",
  "1": "Liked",
  "2": "Favourite",
} as const;

export function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** `yyyy-mm-dd` for a native `<input type="date">`, derived from an ISO string. */
export function toDateInputValue(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  const seconds = Math.round(diffMs / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return formatDate(value);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** The compatibility score is a 0..1 fraction; the UI shows a percentage. */
export function toPercent(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return "-";
  return `${Math.round(fraction * 100)}%`;
}

/** Builds a readable pagination window, e.g. `1 ... 4 5 6 ... 20`. */
export function paginationWindow(page: number, totalPages: number, span = 2): (number | "...")[] {
  if (totalPages <= 0) return [];
  const pages = new Set<number>([1, totalPages]);
  for (let i = page - span; i <= page + span; i += 1) {
    if (i >= 1 && i <= totalPages) pages.add(i);
  }
  const sorted = [...pages].sort((a, b) => a - b);
  const out: (number | "...")[] = [];
  let previous = 0;
  for (const value of sorted) {
    if (previous && value - previous > 1) out.push("...");
    out.push(value);
    previous = value;
  }
  return out;
}

/** The last path segment of a Firebase Storage path, for display only. */
export function fileNameFromPath(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}
