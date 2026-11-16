/** Logotipo oficial do EduSearch (original em assets/branding/logo-horizontal.png). */
export default function Wordmark({ className = "h-8 sm:h-9" }: { className?: string }) {
  return (
    <img
      src="/brand/logo.webp"
      alt="EduSearch"
      width={498}
      height={96}
      className={`w-auto ${className}`}
    />
  );
}
