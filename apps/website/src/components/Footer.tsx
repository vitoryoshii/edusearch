import Wordmark from "./Wordmark";
import { GithubIcon } from "./icons";
import { GITHUB_URL } from "../constants";

export default function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-gelo">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div>
          <Wordmark />
          <p className="mt-2 text-sm text-slate-500">EduSearch © 2026 · Projeto HackBrasil 2026</p>
        </div>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 text-sm font-medium text-profundo hover:text-petroleo"
        >
          <GithubIcon className="h-5 w-5" />
          GitHub
        </a>
      </div>
    </footer>
  );
}
