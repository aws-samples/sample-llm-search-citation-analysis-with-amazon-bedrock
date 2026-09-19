/**
 * Centralized icon library.
 *
 * All icons follow the same Heroicons-style outline convention used across
 * the app: 24×24 viewBox, stroke-based, `currentColor`, configurable size
 * and class via props so they inherit the surrounding text color and dark
 * mode treatment automatically.
 *
 * See `docs/design-system.md` for icon usage guidelines.
 */

interface IconProps {
  /** Tailwind size classes (default: `w-5 h-5`). */
  readonly className?: string;
  /** Title for accessible labelling. When provided, icon becomes labelled. */
  readonly title?: string;
}

const baseProps = (className?: string, title?: string) => ({
  className: className ?? 'w-5 h-5',
  fill: 'none' as const,
  stroke: 'currentColor' as const,
  viewBox: '0 0 24 24',
  'aria-hidden': title === undefined,
  role: title === undefined ? undefined : 'img',
});

const strokeProps = {
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  strokeWidth: 1.5,
};

export const PauseIcon = ({
  className, title 
}: IconProps) => (
  <svg {...baseProps(className, title)}>
    {title && <title>{title}</title>}
    <path {...strokeProps} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

export const PlayIcon = ({
  className, title 
}: IconProps) => (
  <svg {...baseProps(className, title)}>
    {title && <title>{title}</title>}
    <path {...strokeProps} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
    <path {...strokeProps} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

export const PencilIcon = ({
  className, title 
}: IconProps) => (
  <svg {...baseProps(className, title)}>
    {title && <title>{title}</title>}
    <path {...strokeProps} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
  </svg>
);

export const TrashIcon = ({
  className, title 
}: IconProps) => (
  <svg {...baseProps(className, title)}>
    {title && <title>{title}</title>}
    <path {...strokeProps} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

export const PlusIcon = ({
  className, title 
}: IconProps) => (
  <svg {...baseProps(className, title)}>
    {title && <title>{title}</title>}
    <path {...strokeProps} d="M12 4v16m8-8H4" />
  </svg>
);

export const CloseIcon = ({
  className, title 
}: IconProps) => (
  <svg {...baseProps(className, title)}>
    {title && <title>{title}</title>}
    <path {...strokeProps} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

export const ChevronDownIcon = ({
  className, title 
}: IconProps) => (
  <svg {...baseProps(className, title)}>
    {title && <title>{title}</title>}
    <path {...strokeProps} d="M19 9l-7 7-7-7" />
  </svg>
);

export const SearchIcon = ({
  className, title 
}: IconProps) => (
  <svg {...baseProps(className, title)}>
    {title && <title>{title}</title>}
    <path {...strokeProps} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
);

export const LinkIcon = ({
  className, title 
}: IconProps) => (
  <svg {...baseProps(className, title)}>
    {title && <title>{title}</title>}
    <path {...strokeProps} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
  </svg>
);

export const GlobeIcon = ({
  className, title 
}: IconProps) => (
  <svg {...baseProps(className, title)}>
    {title && <title>{title}</title>}
    <path {...strokeProps} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
  </svg>
);

export const KeyIcon = ({
  className, title 
}: IconProps) => (
  <svg {...baseProps(className, title)}>
    {title && <title>{title}</title>}
    <path {...strokeProps} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
  </svg>
);

export const WarningIcon = ({
  className, title 
}: IconProps) => (
  <svg {...baseProps(className, title)}>
    {title && <title>{title}</title>}
    <path {...strokeProps} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
);

export const CheckIcon = ({
  className, title
}: IconProps) => (
  <svg {...baseProps(className, title)}>
    {title && <title>{title}</title>}
    <path {...strokeProps} d="M5 13l4 4L19 7" />
  </svg>
);

export const ArrowRightIcon = ({
  className, title
}: IconProps) => (
  <svg {...baseProps(className, title)}>
    {title && <title>{title}</title>}
    <path {...strokeProps} d="M14 5l7 7m0 0l-7 7m7-7H3" />
  </svg>
);

export const EyeIcon = ({
  className, title
}: IconProps) => (
  <svg {...baseProps(className, title)}>
    {title && <title>{title}</title>}
    <path {...strokeProps} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path {...strokeProps} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
);

export const CogIcon = ({
  className, title
}: IconProps) => (
  <svg {...baseProps(className, title)}>
    {title && <title>{title}</title>}
    <path {...strokeProps} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path {...strokeProps} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

export const RefreshIcon = ({
  className, title
}: IconProps) => (
  <svg {...baseProps(className, title)}>
    {title && <title>{title}</title>}
    <path {...strokeProps} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
);

export const ClockIcon = ({
  className, title
}: IconProps) => (
  <svg {...baseProps(className, title)}>
    {title && <title>{title}</title>}
    <path {...strokeProps} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

export const CollectionIcon = ({
  className, title
}: IconProps) => (
  <svg {...baseProps(className, title)}>
    {title && <title>{title}</title>}
    <path {...strokeProps} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
  </svg>
);
