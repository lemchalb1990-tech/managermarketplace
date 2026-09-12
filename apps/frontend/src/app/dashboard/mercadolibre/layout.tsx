import { MlCompanyProvider } from './MlCompanyContext';

export default function MercadolibreLayout({ children }: { children: React.ReactNode }) {
  return <MlCompanyProvider>{children}</MlCompanyProvider>;
}
