export type ButtonVariant =
  | "destructive"
  | "ghost"
  | "outline"
  | "premium"
  | "primary"
  | "secondary"
  | "success";

export const buttonControlClasses =
  "inline-flex items-center justify-center rounded-ui font-semibold transition-[background-color,border-color,color,box-shadow,filter] duration-[var(--ui-motion-fast)] ease-[var(--ui-motion-easing)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-subtle disabled:text-content-muted disabled:shadow-none disabled:hover:border-line disabled:hover:bg-surface-subtle disabled:hover:text-content-muted disabled:hover:brightness-100 aria-disabled:pointer-events-none aria-disabled:cursor-not-allowed aria-disabled:border-line aria-disabled:bg-surface-subtle aria-disabled:text-content-muted aria-disabled:shadow-none aria-disabled:hover:border-line aria-disabled:hover:bg-surface-subtle aria-disabled:hover:text-content-muted aria-disabled:hover:brightness-100";

export const buttonVariantClasses: Record<ButtonVariant, string> = {
  destructive:
    "border border-status-danger bg-status-danger text-content-inverse hover:brightness-95 focus-visible:outline-focus-inverse",
  ghost:
    "bg-transparent text-content-muted hover:bg-action-primary-subtle hover:text-content-primary focus-visible:outline-focus",
  outline:
    "border border-line-strong bg-transparent text-content-primary hover:border-action-primary hover:bg-surface-subtle focus-visible:outline-focus",
  premium:
    "border border-[#D9A32F]/30 bg-[#0B2A3D] text-white shadow-md shadow-[#0B2A3D]/15 hover:bg-[#082236] focus-visible:outline-focus-inverse",
  primary:
    "border border-action-primary bg-action-primary text-content-inverse hover:border-action-primary-hover hover:bg-action-primary-hover focus-visible:outline-focus-inverse",
  secondary:
    "border border-line bg-surface text-content-primary hover:border-line-strong hover:bg-surface-subtle focus-visible:outline-focus",
  success:
    "border border-status-success bg-status-success text-content-inverse hover:brightness-95 focus-visible:outline-focus-inverse",
};
