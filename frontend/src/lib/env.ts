/**
 * Environment contract for the browser bundle.
 *
 * Only `VITE_`-prefixed variables reach the bundle, so nothing here may be a
 * secret. The Supabase URL and anon key are public by design (the anon key is a
 * public API key protected by row level security), unlike the service role key
 * which must never appear in the client.
 */
export const env = {
  supabaseUrl: (import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, ""),
  supabaseAnonKey: (import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim(),
  googleMapsApiKey: (import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? "").trim(),
  youtubeVideoIds: (import.meta.env.VITE_YOUTUBE_VIDEO_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0),
  /**
   * Project attribution shown on the About page. Kept in the environment so the
   * displayed names/ids live in deployment configuration, not in committed
   * source; the About page falls back to a neutral team line when unset.
   */
  developerName: (import.meta.env.VITE_DEVELOPER_NAME ?? "").trim(),
  developerId: (import.meta.env.VITE_DEVELOPER_ID ?? "").trim(),
  institution: (import.meta.env.VITE_INSTITUTION ?? "").trim(),
  courseName: (import.meta.env.VITE_COURSE_NAME ?? "").trim(),
};

export const hasGoogleMapsKey = env.googleMapsApiKey.length > 0;

/**
 * One-line project credit, used where there is no room for the full table (the
 * launch/session-restore screen). Only the parts that are actually configured
 * appear, so an unconfigured build shows the neutral fallback instead of a line
 * of empty separators. This is presentation only: the About page renders the
 * same values as a labelled list.
 */
export function developerCredit(): string {
  const name = env.developerName || "the JibonJori team";
  const id = env.developerId ? ` (${env.developerId})` : "";
  const parts = [env.institution, env.courseName].filter((value) => value.length > 0);
  const where = parts.length > 0 ? ` · ${parts.join(" · ")}` : "";
  return `Built by ${name}${id}${where}`;
}
