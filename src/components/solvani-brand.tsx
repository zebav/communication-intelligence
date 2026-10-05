import Image from "next/image";

type MarkProps = {
  size?: "sm" | "md" | "lg";
  label?: string;
};

type LogoProps = {
  variant?: "light" | "dark";
  compact?: boolean;
};

const sizes = { sm: 28, md: 42, lg: 68 } as const;

/** Reusable visual identity; the SVG assets are the canonical brand mark. */
export function SolvaniMark({ size = "md", label = "Solvani" }: MarkProps) {
  const pixels = sizes[size];
  return <Image src="/brand/solvani-mark-dark.svg" alt={label} width={pixels} height={pixels} priority={size === "lg"} />;
}

export function SolvaniLogo({ variant = "light", compact = false }: LogoProps) {
  if (compact) return <SolvaniMark size="sm" />;
  return <Image src={variant === "light" ? "/brand/solvani-logo-dark.svg" : "/brand/solvani-logo.svg"} alt="Solvani" width={165} height={36} priority />;
}
