import type { AccessCapability, MembershipRole } from '@michel/contracts';

const READ_CAPABILITIES: AccessCapability[] = ['people:read', 'configuration:read', 'cameras:view'];

export const ROLE_CAPABILITIES: Record<MembershipRole, AccessCapability[]> = {
  OWNER: [
    ...READ_CAPABILITIES,
    'people:manage',
    'administrators:manage',
    'configuration:manage',
    'alerts:manage',
    'medications:manage',
    'cameras:manage',
    'cameras:privacy',
  ],
  ADMINISTRATOR: [
    ...READ_CAPABILITIES,
    'people:manage',
    'configuration:manage',
    'alerts:manage',
    'medications:manage',
    'cameras:manage',
    'cameras:privacy',
  ],
  CAREGIVER: [...READ_CAPABILITIES, 'alerts:manage', 'medications:manage', 'cameras:privacy'],
  VIEWER: READ_CAPABILITIES,
};

export const rolesFor = (capability: AccessCapability): MembershipRole[] =>
  (Object.keys(ROLE_CAPABILITIES) as MembershipRole[]).filter((role) =>
    ROLE_CAPABILITIES[role].includes(capability),
  );

export const capabilitiesFor = (role: MembershipRole): AccessCapability[] => [
  ...ROLE_CAPABILITIES[role],
];

export const activeMembership = (userId: string, roles?: readonly MembershipRole[]) => ({
  userId,
  disabledAt: null,
  ...(roles ? { systemRole: { in: [...roles] } } : {}),
});
