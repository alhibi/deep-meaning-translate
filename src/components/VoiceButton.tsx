import type { ButtonHTMLAttributes } from "react";
/** Keeps voice controls on the existing press-soft design system. */
export function VoiceButton({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={`press-soft ${className}`} {...props} />;
}
