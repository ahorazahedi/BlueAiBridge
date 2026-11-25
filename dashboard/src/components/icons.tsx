// A small, consistent icon set (24px grid, 1.8 stroke).
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 16): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
});
const mk = (d: React.ReactNode) =>
  function Icon({ size, ...p }: P) {
    return (
      <svg {...base(size)} {...p}>
        {d}
      </svg>
    );
  };

export const IOverview = mk(<><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>);
export const IChat = mk(<><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" /><path d="M8.5 11h7M8.5 14h4" /></>);
export const ITraffic = mk(<><path d="M7 4v16M7 4 3.5 7.5M7 4l3.5 3.5" /><path d="M17 20V4M17 20l-3.5-3.5M17 20l3.5-3.5" /></>);
export const IClients = mk(<><rect x="2.5" y="4" width="13" height="10" rx="1.5" /><path d="M6 18h6M9 14v4" /><rect x="17.5" y="8" width="4" height="12" rx="1" /></>);
export const IBook = mk(<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14Z" /><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" /></>);
export const IHealth = mk(<><path d="M3 12h4l2.5-6 4 12 2.5-6H21" /></>);
export const ISettings = mk(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>);
export const IActivity = mk(<><path d="M12 8v4l3 2" /><circle cx="12" cy="12" r="9" /></>);
export const ISearch = mk(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>);
export const IRefresh = mk(<><path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" /><path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" /><path d="M21 3v5h-5M3 21v-5h5" /></>);
export const ICheck = mk(<path d="M20 6 9 17l-5-5" />);
export const ICheckCircle = mk(<><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.5 2.5L16 9.5" /></>);
export const IAlert = mk(<><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>);
export const IXCircle = mk(<><circle cx="12" cy="12" r="9" /><path d="m15 9-6 6M9 9l6 6" /></>);
export const IX = mk(<path d="M18 6 6 18M6 6l12 12" />);
export const IInfo = mk(<><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></>);
export const IDownload = mk(<><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 21h14" /></>);
export const IExternal = mk(<><path d="M14 4h6v6M20 4l-9 9" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></>);
export const ICopy = mk(<><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></>);
export const IPause = mk(<><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></>);
export const IPlay = mk(<path d="M7 4v16l13-8L7 4Z" />);
export const ISun = mk(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>);
export const IMoon = mk(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />);
export const ILink = mk(<><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>);
export const IBolt = mk(<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />);
export const IShield = mk(<><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></>);
export const IClock = mk(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
export const IData = mk(<><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>);
export const IUsers = mk(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" /></>);
export const ITrash = mk(<><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></>);
export const IArrowRight = mk(<path d="M5 12h14M13 6l6 6-6 6" />);
export const IFolder = mk(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />);
export const ITerminal = mk(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></>);
export const IFilter = mk(<path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" />);
export const IMenu = mk(<path d="M4 6h16M4 12h16M4 18h16" />);
export const IBridge = mk(<><path d="M3 17c3-7 15-7 18 0" /><path d="M7 13.5V17M12 12v5M17 13.5V17M2 17h20" /></>);

export function ClaudeMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M12 2.5l1.6 6.1 5.6-3-3 5.6 6.1 1.6-6.1 1.6 3 5.6-5.6-3L12 21.5l-1.6-6.1-5.6 3 3-5.6-6.1-1.6 6.1-1.6-3-5.6 5.6 3L12 2.5Z" />
    </svg>
  );
}
export function GptMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3.5a4 4 0 0 1 3.9 3.1 4 4 0 0 1 3.6 6.1 4 4 0 0 1-3.6 5.5 4 4 0 0 1-7.8 0 4 4 0 0 1-3.6-5.5 4 4 0 0 1 3.6-6.1A4 4 0 0 1 12 3.5Z" />
      <circle cx="12" cy="12" r="2.4" />
    </svg>
  );
}
