import Link from "next/link";

type BrandLockupProps = {
  href?: string;
  variant?: "light" | "dark";
  size?: "regular" | "compact";
  descriptor?: string;
  className?: string;
};

export default function BrandLockup({
  href = "/",
  variant = "light",
  size = "regular",
  descriptor,
  className = "",
}: BrandLockupProps) {
  return (
    <Link
      href={href}
      className={`sc-brand-lockup sc-brand-lockup--${variant} sc-brand-lockup--${size} ${className}`}
      aria-label={href === "/" ? "SaviraCortex home" : "SaviraCortex"}
    >
      <span className="sc-brand-symbol" aria-hidden="true">S</span>
      <span className="sc-brand-wordmark">Savira<span>Cortex</span></span>
      {descriptor && <span className="sc-brand-descriptor">{descriptor}</span>}
    </Link>
  );
}
