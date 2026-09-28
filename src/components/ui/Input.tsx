import type { ComponentPropsWithRef } from "react";

import { fieldControlClassName } from "./fieldControlStyles";

export type TextInputType =
  | "date"
  | "datetime-local"
  | "email"
  | "month"
  | "number"
  | "password"
  | "search"
  | "tel"
  | "text"
  | "time"
  | "url"
  | "week";

export type InputProps = Omit<
  ComponentPropsWithRef<"input">,
  "type"
> & {
  type?: TextInputType;
};

export function Input({
  className = "",
  ref,
  type = "text",
  ...props
}: InputProps) {
  return (
    <input
      {...props}
      className={fieldControlClassName("h-11 px-3 leading-5", className)}
      ref={ref}
      type={type}
    />
  );
}
