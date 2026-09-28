export const fieldControlBaseStyles =
  "w-full rounded-ui border border-line bg-surface text-sm text-content-primary outline-none placeholder:text-content-muted transition-[background-color,border-color,color,box-shadow] duration-[var(--ui-motion-fast)] ease-[var(--ui-motion-easing)] hover:border-line-strong focus-visible:border-action-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus aria-invalid:border-status-danger aria-invalid:focus-visible:border-status-danger aria-invalid:focus-visible:outline-status-danger disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-subtle disabled:text-content-muted disabled:opacity-100 disabled:hover:border-line";

export function fieldControlClassName(
  layout: string,
  className?: string,
) {
  return [fieldControlBaseStyles, layout, className]
    .filter(Boolean)
    .join(" ");
}
