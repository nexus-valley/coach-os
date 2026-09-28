import type { ComponentPropsWithRef } from "react";

import { fieldControlClassName } from "./fieldControlStyles";

export type TextareaProps = ComponentPropsWithRef<"textarea">;

export function Textarea({
  className = "",
  ref,
  ...props
}: TextareaProps) {
  return (
    <textarea
      {...props}
      className={fieldControlClassName(
        "min-h-28 resize-y px-3 py-3 leading-6",
        className,
      )}
      ref={ref}
    />
  );
}
