import { useNavigate } from 'react-router';
import { Button } from '../../components/ui/button.tsx';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.tsx';

export function AccessDeniedPage() {
  const navigate = useNavigate();

  return (
    <div className="flex h-screen items-center justify-center bg-background p-6">
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Access denied</CardTitle>
          <CardDescription>
            You don't have permission to view this page. If you believe this is a
            mistake, contact your administrator.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button onClick={() => navigate('/')}>Go home</Button>
          <Button variant="outline" onClick={() => navigate(-1)}>
            Back
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
