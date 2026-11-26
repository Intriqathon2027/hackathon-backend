import { Injectable, CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role } from "@prisma/client";
import { ROLES_KEY } from "../decorators/roles.decorator";
import { SupabaseDecodedUser } from "../decorators/supabase-decoded-user.types";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ user?: SupabaseDecodedUser }>();
    const user = request.user;

    if (!user || !user.sub) {
      return false;
    }

    const dbUser = await this.prisma.user.findUnique({
      where: { supabaseUserId: user.sub },
    });

    if (!dbUser) {
      return false;
    }

    return requiredRoles.some((role) => dbUser.role === role);
  }
}
