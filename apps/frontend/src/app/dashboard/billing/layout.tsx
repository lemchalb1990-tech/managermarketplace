import { BillingCompanyProvider } from './BillingCompanyContext';

export default function BillingLayout({ children }: { children: React.ReactNode }) {
  return <BillingCompanyProvider>{children}</BillingCompanyProvider>;
}
