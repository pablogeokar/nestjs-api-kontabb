import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { CurrentUser as CurrentUserType } from '../common/types';

export const CurrentUser = createParamDecorator(
    (data: keyof CurrentUserType | undefined, ctx: ExecutionContext) => {
        const request = ctx.switchToHttp().getRequest();
        const user = request.user as CurrentUserType;
        return data ? user?.[data] : user;
    },
);
