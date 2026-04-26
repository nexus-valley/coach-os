type AuthInputProps = {
  label: string;
} & React.InputHTMLAttributes<HTMLInputElement>;

export function AuthInput({ className = "", label, ...props }: AuthInputProps) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-700">{label}</span>
      <input
        className={[
          "mt-2 h-12 w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 text-sm text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:bg-white focus:ring-4 focus:ring-zinc-950/10",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        {...props}
      />
    </label>
  );
}
