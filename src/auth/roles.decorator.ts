import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../common/types';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/** Requires ADMIN or COLABORADOR */
export const StaffOnly = () => Roles('ADMIN', 'COLABORADOR');

/** Requires ADMIN only */
export const AdminOnly = () => Roles('ADMIN');
