import { useEffect, useState } from 'react';
import { useAuth } from '../../../auth/useAuth.ts';
import { Button } from '../../../components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card.tsx';
import { Label } from '../../../components/ui/label.tsx';
import { Switch } from '../../../components/ui/switch.tsx';
import { RadioGroup, RadioGroupItem } from '../../../components/ui/radio-group.tsx';
import { Save } from 'lucide-react';
import { updateProfile } from '../../../api/endpoints/settings.ts';

export function PrivacySection() {
  const { profile, refreshProfile } = useAuth();

  const [emailNotifications, setEmailNotifications] = useState(true);
  const [allowModelTraining, setAllowModelTraining] = useState(false);
  const [dataRetentionDays, setDataRetentionDays] = useState('365');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load from profile preferences
  useEffect(() => {
    if (profile?.preferences) {
      setEmailNotifications(profile.preferences.email_notifications);
      setAllowModelTraining(profile.preferences.allow_model_training);
      setDataRetentionDays(String(profile.preferences.data_retention_days));
    }
  }, [profile?.preferences]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await updateProfile({
        preferences: {
          email_notifications: emailNotifications,
          allow_model_training: allowModelTraining,
          data_retention_days: parseInt(dataRetentionDays),
        },
      });
      await refreshProfile();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // handle error
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notifications</CardTitle>
          <CardDescription>Control how we communicate with you.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Email notifications</Label>
              <p className="text-xs text-muted-foreground">
                Receive email updates about collection completions and insights.
              </p>
            </div>
            <Switch
              checked={emailNotifications}
              onCheckedChange={setEmailNotifications}
            />
          </div>
        </CardContent>
      </Card>

      {/* Data Usage */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Data & AI</CardTitle>
          <CardDescription>How your data is used.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Allow data for model improvement</Label>
              <p className="text-xs text-muted-foreground">
                Your queries and results may be used to improve our AI models.
              </p>
            </div>
            <Switch
              checked={allowModelTraining}
              onCheckedChange={setAllowModelTraining}
            />
          </div>
        </CardContent>
      </Card>

      {/* Retention */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Data Retention</CardTitle>
          <CardDescription>How long collected data is stored.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RadioGroup value={dataRetentionDays} onValueChange={setDataRetentionDays}>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="30" id="retention-30" />
              <Label htmlFor="retention-30" className="text-sm">30 days</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="90" id="retention-90" />
              <Label htmlFor="retention-90" className="text-sm">90 days</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="365" id="retention-365" />
              <Label htmlFor="retention-365" className="text-sm">1 year</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="-1" id="retention-forever" />
              <Label htmlFor="retention-forever" className="text-sm">Forever</Label>
            </div>
          </RadioGroup>
          <p className="text-xs text-muted-foreground">
            After this period, collected post data will be archived. Insights and reports are always retained.
          </p>
        </CardContent>
      </Card>

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving} size="sm">
          <Save className="mr-2 h-3.5 w-3.5" />
          {saving ? 'Saving...' : 'Save preferences'}
        </Button>
        {saved && (
          <span className="text-sm text-green-600">Saved successfully</span>
        )}
      </div>
    </div>
  );
}
