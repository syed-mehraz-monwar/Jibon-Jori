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
};

export const hasGoogleMapsKey = env.googleMapsApiKey.length > 0;
