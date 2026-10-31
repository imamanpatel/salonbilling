import { Link } from 'react-router';
import { EmptyState } from '../components/ui.jsx';

export default function NotFoundPage() {
  return (
    <EmptyState
      title="Page not found"
      description="This page does not exist or you do not have access to it."
      action={<Link to="/" className="text-sm font-medium text-brand-700 hover:underline">Back to dashboard</Link>}
    />
  );
}
