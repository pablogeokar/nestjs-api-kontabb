import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { CurrentUser as CurrentUserType } from '../common/types';

export const CurrentUser = createParamDecorator(
    (data: keyof CurrentUserType | undefined, ctx: ExecutionContext) => {
        const request = ctx
            .switchToHttp()
            .getRequest<{ user?: CurrentUserType }>();
        const user = request.user;
        return data ? user?.[data] : user;
    },
);
