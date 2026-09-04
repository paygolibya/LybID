import { useLanguage } from './i18n';
import { Nav } from './components/Nav';
import { Hero } from './components/Hero';
import { Features } from './components/Features';
import { Solutions } from './components/Solutions';
import { WhySelfHosted } from './components/WhySelfHosted';
import { Pricing } from './components/Pricing';
import { FinalCta } from './components/FinalCta';
import { Footer } from './components/Footer';

export function App() {
  const { fontBody } = useLanguage();

  return (
    <div className={`${fontBody} min-h-screen bg-paper text-ink`}>
      <Nav />
      <Hero />
      <Features />
      <Solutions />
      <WhySelfHosted />
      <Pricing />
      <FinalCta />
      <Footer />
    </div>
  );
}
