import { useEffect, useRef, useState } from "react";
import { CloseIcon, GithubIcon, Logo, MenuIcon, buttonClasses, cn } from "@edusearch/ui";
import { APP_URL, GITHUB_URL, NAV_LINKS } from "../constants";

export default function Header() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    firstLinkRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    const onResize = () => window.innerWidth >= 1024 && setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b bg-bg/90 backdrop-blur-sm transition-colors",
        scrolled || open ? "border-line" : "border-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-5 sm:px-8">
        <a href="#conteudo" aria-label="EduSearch — início" className="-m-1 shrink-0 rounded-md p-1">
          <Logo className="h-8 sm:h-9" />
        </a>

        <nav aria-label="Navegação principal" className="hidden items-center gap-7 lg:flex">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm font-medium text-fg transition-colors hover:text-link"
            >
              {l.label}
            </a>
          ))}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className={buttonClasses({ variant: "secondary", size: "sm" })}
          >
            <GithubIcon className="h-4 w-4" />
            GitHub
            <span className="sr-only"> (abre em nova aba)</span>
          </a>
          {APP_URL && (
            <a href={APP_URL} className={buttonClasses({ size: "sm" })}>
              Ver demonstração
            </a>
          )}
        </nav>

        <button
          ref={toggleRef}
          type="button"
          className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-control text-fg-strong hover:bg-surface-muted lg:hidden"
          aria-expanded={open}
          aria-controls="menu-mobile"
          aria-label={open ? "Fechar menu" : "Abrir menu"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <CloseIcon className="h-6 w-6" /> : <MenuIcon className="h-6 w-6" />}
        </button>
      </div>

      {open && (
        <nav
          id="menu-mobile"
          aria-label="Navegação principal"
          className="animate-fade-in border-t border-line bg-bg px-5 pb-6 sm:px-8 lg:hidden"
        >
          <ul className="flex flex-col pt-2">
            {NAV_LINKS.map((l, i) => (
              <li key={l.href}>
                <a
                  ref={i === 0 ? firstLinkRef : undefined}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="flex min-h-12 items-center border-b border-line text-base font-medium text-fg-strong"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className={buttonClasses({ variant: "secondary", fullWidth: true })}
            >
              <GithubIcon className="h-5 w-5" />
              GitHub
              <span className="sr-only"> (abre em nova aba)</span>
            </a>
            {APP_URL && (
              <a href={APP_URL} className={buttonClasses({ fullWidth: true })}>
                Ver demonstração
              </a>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}
