import Link from "next/link";
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
} from "react";

import {
  buttonControlClasses,
  buttonVariantClasses,
  type ButtonVariant,
} from "./buttonStyles";

export type { ButtonVariant } from "./buttonStyles";

export type ButtonSize = "sm" | "md" | "lg";

type ButtonAnchorOnlyProps = Pick<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "download" | "rel" | "target"
>;

export type ButtonProps = {
  children: ReactNode;
  className?: string;
  fullWidth?: boolean;
  href?: string;
  isLoading?: boolean;
  leftIcon?: ReactNode;
  loadingText?: string;
  rightIcon?: ReactNode;
  size?: ButtonSize;
  variant?: ButtonVariant;
} & ButtonHTMLAttributes<HTMLButtonElement> &
  ButtonAnchorOnlyProps;

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-10 px-4 text-sm",
  md: "h-11 px-5 text-sm",
  lg: "h-12 px-6 text-base",
};

const safeLinkAttributeNames = new Set([
  "id",
  "role",
  "title",
  "tabIndex",
]);

function pickSafeLinkAttributes(
  props: ButtonHTMLAttributes<HTMLButtonElement>,
) {
  const attributes: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(props)) {
    if (
      safeLinkAttributeNames.has(name) ||
      name.startsWith("aria-") ||
      name.startsWith("data-")
    ) {
      attributes[name] = value;
    }
  }

  delete attributes["aria-busy"];
  delete attributes["aria-disabled"];

  return attributes as AnchorHTMLAttributes<HTMLAnchorElement>;
}

function preventDisabledLinkPointerActivation(
  event: MouseEvent<HTMLAnchorElement>,
) {
  event.preventDefault();
}

function preventDisabledLinkKeyboardActivation(
  event: KeyboardEvent<HTMLAnchorElement>,
) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
  }
}

export function Button({
  children,
  className = "",
  disabled,
  fullWidth = false,
  href,
  isLoading = false,
  leftIcon,
  loadingText,
  download,
  rel,
  rightIcon,
  size = "md",
  target,
  type = "button",
  variant = "primary",
  ...nativeProps
}: ButtonProps) {
  const isDisabled = disabled || isLoading;
  const classes = [
    buttonControlClasses,
    buttonVariantClasses[variant],
    sizeClasses[size],
    fullWidth ? "w-full" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const buttonContent = (
    <span className="relative inline-grid min-w-0 grid-cols-1 grid-rows-1 items-center justify-items-center">
      <span
        className={`col-start-1 row-start-1 inline-flex min-w-0 items-center justify-center gap-2 ${isLoading ? "opacity-0" : "opacity-100"}`}
      >
        {leftIcon}
        <span>{children}</span>
        {rightIcon}
      </span>
      <span
        aria-hidden="true"
        className={`col-start-1 row-start-1 inline-flex min-w-0 items-center justify-center gap-2 ${isLoading ? "visible" : "invisible"}`}
      >
        <span
          aria-hidden="true"
          className={`h-4 w-4 rounded-full border-2 border-current border-r-transparent opacity-80 ${isLoading ? "animate-spin" : ""}`}
        />
        {loadingText ? <span>{loadingText}</span> : null}
      </span>
    </span>
  );

  if (href) {
    const linkAttributes = pickSafeLinkAttributes(nativeProps);

    return (
      <Link
        {...linkAttributes}
        aria-busy={isLoading || undefined}
        aria-disabled={isDisabled || undefined}
        className={classes}
        download={download}
        href={href}
        onAuxClick={
          isDisabled ? preventDisabledLinkPointerActivation : undefined
        }
        onClick={isDisabled ? preventDisabledLinkPointerActivation : undefined}
        onKeyDown={
          isDisabled ? preventDisabledLinkKeyboardActivation : undefined
        }
        rel={rel}
        tabIndex={isDisabled ? -1 : linkAttributes.tabIndex}
        target={target}
      >
        {buttonContent}
      </Link>
    );
  }

  return (
    <button
      {...nativeProps}
      aria-busy={isLoading || undefined}
      className={classes}
      disabled={isDisabled}
      type={type}
    >
      {buttonContent}
    </button>
  );
}
