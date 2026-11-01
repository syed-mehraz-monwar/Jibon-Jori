/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
  readonly VITE_YOUTUBE_VIDEO_IDS?: string;
  readonly VITE_DEVELOPER_NAME?: string;
  readonly VITE_DEVELOPER_ID?: string;
  readonly VITE_INSTITUTION?: string;
  readonly VITE_COURSE_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
