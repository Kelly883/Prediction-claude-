import { getActivePlans } from '@/lib/plans';
import TicketCard from './TicketCard';

export default async function PlansSection() {
  const plans = await getActivePlans();

  if (plans.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', color: 'var(--chalk-muted)' }}>
        Plans aren't published yet — check back shortly.
      </div>
    );
  }

  return (
    <div className="plans-grid">
      {plans.map((plan, i) => (
        <TicketCard key={plan.id} plan={plan} featured={i === 1 && plans.length >= 2} />
      ))}
    </div>
  );
}
