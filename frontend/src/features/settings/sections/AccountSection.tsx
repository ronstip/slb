import { useState } from 'react';
import { useAuth } from '../../../auth/useAuth.ts';
import { Avatar, AvatarFallback, AvatarImage } from '../../../components/ui/avatar.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card.tsx';
import { Input } from '../../../components/ui/input.tsx';
import { Label } from '../../../components/ui/label.tsx';
import { Badge } from '../../../components/ui/badge.tsx';
import { Building2, Mail, Save } from 'lucide-react';
import { updateProfile } from '../../../api/endpoints/settings.ts';

export function AccountSection() {
  const { user, profile, refreshProfile } = useAuth();

  const [displayName, setDisplayName] = useState(
    user?.displayName || profile?.display_name || ''
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const photoURL = user?.photoURL || profile?.photo_url || undefined;
  const email = user?.email || profile?.email || '';
  const initial = displayName?.[0] || email?.[0] || '?';
  const hasChanges = displayName !== (user?.displayName || profile?.display_name || '');

  const handleSave = async () => {
    if (!hasChanges) return;
    setSaving(true);
    setSaved(false);
    try {
      await updateProfile({ display_name: displayName });
      await refreshProfile();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // TODO: toast error
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Profile Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
          <CardDescription>Your personal account information.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Avatar */}
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={photoURL} />
              <AvatarFallback className="bg-accent text-lg font-medium text-accent-foreground">
                {initial.toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="text-sm font-medium text-foreground">{displayName || 'No name set'}</p>
              <p className="text-xs text-muted-foreground">Profile photo from your sign-in provider</p>
            </div>
          </div>

          {/* Display Name */}
          <div className="space-y-2">
            <Label htmlFor="display-name">Display name</Label>
            <Input
              id="display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Enter your name"
              className="max-w-sm"
            />
          </div>

          {/* Email */}
          <div className="space-y-2">
            <Label>Email</Label>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Mail className="h-4 w-4" />
              {email}
            </div>
            <p className="text-xs text-muted-foreground">
              Email is managed by your sign-in provider and cannot be changed here.
            </p>
          </div>

          {/* Save */}
          <div className="flex items-center gap-3">
            <Button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              size="sm"
            >
              <Save className="mr-2 h-3.5 w-3.5" />
              {saving ? 'Saving...' : 'Save changes'}
            </Button>
            {saved && (
              <span className="text-sm text-green-600">Saved successfully</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Organization Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Organization</CardTitle>
          <CardDescription>Your current workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">
              {profile?.org_name || 'Personal Workspace'}
            </span>
            {profile?.org_role && (
              <Badge variant="secondary" className="text-xs capitalize">
                {profile.org_role}
              </Badge>
            )}
          </div>
          {!profile?.org_id && (
            <p className="mt-2 text-xs text-muted-foreground">
              You're not part of an organization. Create or join one in the Organization tab.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
