type CardProps = {
  children: React.ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>;

export function Card({ children, className = "", ...props }: CardProps) {
  return (
    <div
      className={[
        "rounded-3xl border border-[#D8E8F0] bg-white text-[#0B1F33] shadow-xl shadow-[#0B2A3D]/10 backdrop-blur",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </div>
  );
}
