import { cn } from "../../lib/cn";

/**
 * Icon set.
 *
 * Every icon is a drawn 24x24 outline glyph with no embedded text — the label
 * lives in the surrounding link/button, which is what a screen reader reads.
 * Keeping them inline avoids an icon-font or an extra dependency in the APK.
 */
export type IconName =
  | "home"
  | "search"
  | "heart"
  | "chat"
  | "user"
  | "bell"
  | "shield"
  | "chart"
  | "sliders"
  | "menu"
  | "close"
  | "back"
  | "logout"
  | "info"
  | "sparkle"
  | "check"
  | "camera"
  | "map-pin"
  | "eye"
  | "link"
  | "droplet"
  | "moon";

const PATHS: Record<IconName, string[]> = {
  home: ["M3 10.5 12 3l9 7.5", "M5.5 9.5V21h13V9.5", "M9.75 21v-6h4.5v6"],
  search: ["M10.75 4a6.75 6.75 0 1 1 0 13.5 6.75 6.75 0 0 1 0-13.5Z", "m15.6 15.6 4.65 4.65"],
  heart: [
    "M12 20.5S3.5 15.2 3.5 9.4A4.9 4.9 0 0 1 12 6.2a4.9 4.9 0 0 1 8.5 3.2c0 5.8-8.5 11.1-8.5 11.1Z",
  ],
  chat: ["M4.5 5.5h15v11h-8.2L6.5 20v-3.5h-2v-11Z", "M8.5 10.75h7"],
  user: ["M12 12.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M4.5 20.5c.9-3.6 3.9-5.5 7.5-5.5s6.6 1.9 7.5 5.5"],
  bell: ["M6.5 17.5V11a5.5 5.5 0 0 1 11 0v6.5", "M4.5 17.5h15", "M10 20.5a2 2 0 0 0 4 0"],
  shield: ["M12 3.5 5 6.2v5.3c0 4.3 2.9 7.6 7 9 4.1-1.4 7-4.7 7-9V6.2L12 3.5Z", "m9.25 11.9 2 2 3.5-3.6"],
  chart: ["M4.5 20.5h15", "M8 20.5v-6", "M12.5 20.5V8", "M17 20.5v-9.5"],
  sliders: [
    "M4.5 8h5.5",
    "M14 8h5.5",
    "M4.5 16h4",
    "M13.5 16h6",
    "M12 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4",
    "M10 14a2 2 0 1 1 0 4 2 2 0 0 1 0-4",
  ],
  menu: ["M4.5 7h15", "M4.5 12h15", "M4.5 17h15"],
  close: ["m6 6 12 12", "m18 6-12 12"],
  back: ["m14.5 5.5-6.5 6.5 6.5 6.5"],
  logout: ["M15 4.5H19.5V19.5H15", "M12 15.5 16 12l-4-3.5", "M16 12H4.5"],
  info: ["M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17Z", "M12 11v5.5", "M12 8.2v.1"],
  sparkle: ["m12 3.5 1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9L12 3.5Z", "M18.5 16.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z"],
  check: ["m5 12.5 4.5 4.5L19 7.5"],
  camera: ["M4.5 8.5h3l1.5-2h6l1.5 2h3v11h-15v-11Z", "M12 17a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Z"],
  "map-pin": ["M12 21s6.5-5.7 6.5-10.4A6.5 6.5 0 0 0 5.5 10.6C5.5 15.3 12 21 12 21Z", "M12 12.8a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8Z"],
  eye: ["M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z", "M12 14.75A2.75 2.75 0 1 0 12 9.25a2.75 2.75 0 0 0 0 5.5Z"],
  link: ["M10 13.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5L11 7.5", "M14 10.5a3.5 3.5 0 0 0-5 0L6.5 13a3.5 3.5 0 0 0 5 5L13 16.5"],
  droplet: ["M12 3.5c3 3.6 5.5 6.4 5.5 9.4a5.5 5.5 0 0 1-11 0c0-3 2.5-5.8 5.5-9.4Z"],
  moon: ["M20 14.5A8.2 8.2 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"],
};

export function Icon({
  name,
  className,
  strokeWidth = 1.7,
}: {
  name: IconName;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-5 w-5", className)}
    >
      {PATHS[name].map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}
