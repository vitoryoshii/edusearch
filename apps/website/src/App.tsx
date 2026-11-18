import { useTheme } from "@edusearch/ui";
import Header from "./components/Header";
import Hero from "./components/Hero";
import HowItWorks from "./components/HowItWorks";
import Differentials from "./components/Differentials";
import ForStudents from "./components/ForStudents";
import ForTeachers from "./components/ForTeachers";
import About from "./components/About";
import Footer from "./components/Footer";

export default function App() {
  // O website acompanha o tema do sistema operacional (sem preferência salva).
  useTheme({ persist: false });

  return (
    <>
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2 focus:text-fg-strong focus:shadow-raised"
      >
        Pular para o conteúdo
      </a>
      <Header />
      <main id="conteudo" tabIndex={-1} className="focus:outline-none">
        <Hero />
        <HowItWorks />
        <Differentials />
        <ForStudents />
        <ForTeachers />
        <About />
      </main>
      <Footer />
    </>
  );
}
