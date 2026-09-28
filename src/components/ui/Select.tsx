import type { ComponentPropsWithRef } from "react";

import { fieldControlClassName } from "./fieldControlStyles";

export type SelectProps = ComponentPropsWithRef<"select">;

export function Select({
  className = "",
  multiple,
  ref,
  size,
  ...props
}: SelectProps) {
  const isListbox = multiple || (typeof size === "number" && size > 1);
  const layout = isListbox
    ? "min-h-11 px-3 py-2 leading-5"
    : "h-11 px-3 leading-5";

  return (
    <select
      {...props}
      className={fieldControlClassName(layout, className)}
      multiple={multiple}
      ref={ref}
      size={size}
    />
  );
}
