import { useEffect, useState } from 'react';
import { useAuth } from '../../../auth/useAuth.ts';
import { Button } from '../../../components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card.tsx';
import { Input } from '../../../components/ui/input.tsx';
import { Label } from '../../../components/ui/label.tsx';
import { Badge } from '../../../components/ui/badge.tsx';
import { Avatar, AvatarFallback, AvatarImage } from '../../../components/ui/avatar.tsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select.tsx';
import { Building2, Copy, Link, LogOut, Plus, Trash2, UserPlus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog.tsx';
import type { OrgDetails, OrgInvite } from '../../../api/types.ts';
import {
  getOrgDetails,
  createOrg,
  createInvite,
  getInvites,
  revokeInvite,
  updateMemberRole,
  removeMember,
  leaveOrg,
  updateOrg,
} from '../../../api/endpoints/settings.ts';

export function OrganizationSection() {
  const { profile, refreshProfile } = useAuth();

  if (!profile?.org_id) {
    return <CreateOrgView onCreated={refreshProfile} />;
  }

  return <OrgManagementView orgId={profile.org_id} userRole={profile.org_role} userId={profile.uid} onLeft={refreshProfile} />;
}

// --- Create Org View ---

function CreateOrgView({ onCreated }: { onCreated: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setError('');
    try {
      await createOrg({ name: name.trim(), domain: domain.trim() || undefined });
      await onCreated();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create organization');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Create an Organization</CardTitle>
        <CardDescription>
          Organizations let you collaborate with team members and share collections.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="org-name">Organization name</Label>
          <Input
            id="org-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Acme Marketing"
            className="max-w-sm"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="org-domain">Email domain (optional)</Label>
          <Input
            id="org-domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="e.g. acme.com"
            className="max-w-sm"
          />
          <p className="text-xs text-muted-foreground">
            Users signing in with this email domain will automatically join your organization.
          </p>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button onClick={handleCreate} disabled={!name.trim() || creating}>
          <Building2 className="mr-2 h-3.5 w-3.5" />
          {creating ? 'Creating...' : 'Create Organization'}
        </Button>
      </CardContent>
    </Card>
  );
}

// --- Org Management View ---

function OrgManagementView({
  orgId,
  userRole,
  userId,
  onLeft,
}: {
  orgId: string;
  userRole: string | null;
  userId: string;
  onLeft: () => Promise<void>;
}) {
  const [org, setOrg] = useState<OrgDetails | null>(null);
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState('');
  const [savingName, setSavingName] = useState(false);

  const isOwner = userRole === 'owner';
  const isAdmin = userRole === 'admin' || isOwner;

  const fetchData = async () => {
    try {
      const [orgData, inviteData] = await Promise.all([
        getOrgDetails(),
        isAdmin ? getInvites().catch(() => []) : Promise.resolve([]),
      ]);
      setOrg(orgData);
      setInvites(inviteData);
      setNewName(orgData.name);
    } catch {
      // handle error
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [orgId]);

  const handleRoleChange = async (uid: string, role: string) => {
    try {
      await updateMemberRole(uid, role);
      await fetchData();
    } catch {
      // handle error
    }
  };

  const handleRemoveMember = async (uid: string) => {
    try {
      await removeMember(uid);
      await fetchData();
    } catch {
      // handle error
    }
  };

  const handleLeave = async () => {
    try {
      await leaveOrg();
      await onLeft();
    } catch {
      // handle error
    }
  };

  const handleSaveName = async () => {
    if (!newName.trim() || newName === org?.name) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    try {
      await updateOrg({ name: newName.trim() });
      await fetchData();
      setEditingName(false);
    } catch {
      // handle error
    } finally {
      setSavingName(false);
    }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    try {
      await revokeInvite(inviteId);
      setInvites((prev) => prev.filter((i) => i.invite_id !== inviteId));
    } catch {
      // handle error
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
        </CardContent>
      </Card>
    );
  }

  if (!org) return null;

  return (
    <div className="space-y-6">
      {/* Org Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Organization Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            {editingName && isAdmin ? (
              <div className="flex items-center gap-2">
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="max-w-sm"
                />
                <Button size="sm" onClick={handleSaveName} disabled={savingName}>
                  {savingName ? 'Saving...' : 'Save'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setEditingName(false); setNewName(org.name); }}>
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{org.name}</span>
                {isAdmin && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingName(true)}>
                    Edit
                  </Button>
                )}
              </div>
            )}
          </div>
          {org.domain && (
            <div className="space-y-1">
              <Label>Domain</Label>
              <p className="text-sm text-muted-foreground">{org.domain}</p>
            </div>
          )}
          <div className="space-y-1">
            <Label>Members</Label>
            <p className="text-sm text-muted-foreground">{org.members.length} member{org.members.length !== 1 ? 's' : ''}</p>
          </div>
        </CardContent>
      </Card>

      {/* Members */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Members</CardTitle>
            <CardDescription>People in your organization.</CardDescription>
          </div>
          {isAdmin && (
            <Button size="sm" onClick={() => setInviteDialogOpen(true)}>
              <UserPlus className="mr-2 h-3.5 w-3.5" />
              Invite
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                {isAdmin && <TableHead className="w-[100px]">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {org.members.map((member) => (
                <TableRow key={member.uid}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={member.photo_url || undefined} />
                        <AvatarFallback className="text-xs">
                          {(member.display_name?.[0] || member.email?.[0] || '?').toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-medium">{member.display_name || 'Unknown'}</p>
                        <p className="text-xs text-muted-foreground">{member.email}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {isOwner && member.uid !== userId ? (
                      <Select
                        value={member.role}
                        onValueChange={(val) => handleRoleChange(member.uid, val)}
                      >
                        <SelectTrigger className="h-8 w-[110px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="member">Member</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="owner">Owner</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="secondary" className="capitalize">
                        {member.role}
                      </Badge>
                    )}
                  </TableCell>
                  {isAdmin && (
                    <TableCell>
                      {member.uid !== userId && member.role !== 'owner' && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => handleRemoveMember(member.uid)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pending Invites */}
      {isAdmin && invites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pending Invites</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {invites.filter((i) => i.status === 'pending').map((invite) => (
                <div key={invite.invite_id} className="flex items-center justify-between rounded-md border border-border p-3">
                  <div>
                    <p className="text-sm font-medium">{invite.email}</p>
                    <p className="text-xs text-muted-foreground capitalize">{invite.role} &middot; Expires {new Date(invite.expires_at).toLocaleDateString()}</p>
                  </div>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleRevokeInvite(invite.invite_id)}>
                    Revoke
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Danger Zone */}
      {!isOwner && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-base text-destructive">Leave Organization</CardTitle>
            <CardDescription>You will lose access to shared collections.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10" onClick={handleLeave}>
              <LogOut className="mr-2 h-3.5 w-3.5" />
              Leave {org.name}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Invite Dialog */}
      <InviteMemberDialog
        open={inviteDialogOpen}
        onOpenChange={setInviteDialogOpen}
        onInvited={fetchData}
      />
    </div>
  );
}

// --- Invite Dialog ---

function InviteMemberDialog({
  open,
  onOpenChange,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvited: () => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [creating, setCreating] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setEmail('');
    setRole('member');
    setInviteLink('');
    setCopied(false);
    setError('');
  };

  const handleCreate = async () => {
    if (!email.trim()) return;
    setCreating(true);
    setError('');
    try {
      const invite = await createInvite({ email: email.trim(), role });
      const link = `${window.location.origin}/invite/${invite.invite_code}`;
      setInviteLink(link);
      onInvited();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create invite');
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={(val) => { onOpenChange(val); if (!val) reset(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Invite a team member</DialogTitle>
          <DialogDescription>
            Generate an invite link to share with your team member.
          </DialogDescription>
        </DialogHeader>

        {!inviteLink ? (
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email address</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@company.com"
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button onClick={handleCreate} disabled={!email.trim() || creating} className="w-full">
              <Plus className="mr-2 h-3.5 w-3.5" />
              {creating ? 'Creating...' : 'Generate Invite Link'}
            </Button>
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Invite link</Label>
              <div className="flex items-center gap-2">
                <div className="flex-1 truncate rounded-md border border-border bg-muted/50 px-3 py-2 text-xs font-mono">
                  {inviteLink}
                </div>
                <Button size="sm" variant="outline" onClick={handleCopy}>
                  {copied ? 'Copied!' : <><Copy className="mr-1.5 h-3.5 w-3.5" />Copy</>}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Share this link with {email}. It expires in 7 days.
              </p>
            </div>
            <Button variant="outline" className="w-full" onClick={() => { reset(); }}>
              Invite another
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
