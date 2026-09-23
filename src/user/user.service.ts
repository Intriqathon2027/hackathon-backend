import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { PrismaService } from "../prisma/prisma.service";
import { UUID } from "crypto";
import { UserResponse } from "./dto/user-response";
import { HackathonConfigKey, Role } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { UserResponseReduced } from "./dto/user-response-reduced";
import { ExpertTeamsResponse } from "./dto/expert-teams-response";
import { MailerService } from "../mailer/mailer.service";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { S3BucketService } from "../s3-bucket/s3-bucket.service";
import {
  getAllSubjectIds,
  parseThemesSettings,
} from "../configuration/utils/themes.util";

@Injectable()
export class UserService {
  private supabaseAdmin = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!, // ⚠️ côté serveur uniquement
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailerService: MailerService,
    private readonly S3BucketService: S3BucketService,
  ) {}

  async create(
    createUserDto: CreateUserDto,
    supabaseUserId: string,
  ): Promise<UserResponse> {
    const requestingUser = await this.prisma.user.findUnique({
      where: { supabaseUserId },
    });
    if (!requestingUser) {
      throw new NotFoundException("You are not authenticated");
    }
    if (requestingUser.role !== Role.ORGANIZER) {
      throw new ForbiddenException("You are not authorized to create users");
    }

    // Create user in supabase auth first
    const { data: authUser, error: authError } =
      await this.supabaseAdmin.auth.admin.createUser({
        email: createUserDto.email,
        email_confirm: true,
        password: Math.random().toString(36).slice(-8), // Generate a random password
      });

    if (authError) {
      throw new ConflictException(`Supabase Auth Error: ${authError.message}`);
    }

    return await this.prisma.user.create({
      data: {
        supabaseUserId: authUser.user?.id,
        ...createUserDto,
        github: createUserDto.github ?? undefined,
        discord: createUserDto.discord ?? undefined,
      },
    });
  }

  async login(supabaseUserId: string): Promise<UserResponse> {
    // Check if the user exists
    const user = await this.prisma.user.findUnique({
      where: { supabaseUserId },
    });
    if (!user) {
      throw new NotFoundException("User not found.");
    }
    return user;
  }

  async invite(userId: UUID, supabaseUserId: string): Promise<void> {
    // Check if the user exists
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException("User not found.");
    }

    // Check if the requesting user has the right role
    const requestingUser = await this.prisma.user.findUnique({
      where: { supabaseUserId },
    });
    if (!requestingUser) {
      throw new NotFoundException("You are not authenticated");
    }
    if (requestingUser.role !== Role.ORGANIZER) {
      throw new ForbiddenException("You are not authorized to invite users.");
    }

    // Send invitation logic here

    await this.mailerService.sendInviteEmail(
      user.email,
      `${process.env.BASE_URL}/first-login?email=${user.email}`,
    );
    return;
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });
    if (!user) {
      throw new NotFoundException("User not found.");
    }

    const passwordReset = await this.prisma.passwordReset.findFirst({
      where: {
        userId: user.id,
      },
    });

    if (passwordReset) {
      await this.prisma.passwordReset.delete({
        where: { id: passwordReset.id },
      });
    }

    const token = Math.random().toString(36).substring(2);
    const expiresAt = new Date(Date.now() + 3600 * 1000);

    await this.prisma.passwordReset.create({
      data: {
        userId: user.id,
        token,
        expiresAt,
      },
    });

    // Here you would send the token to the user's email
    // For simplicity, we'll just log it

    await this.mailerService.sendPasswordResetEmail(
      user.email,
      `${process.env.BASE_URL}/reset-password?token=${token}&email=${email}`,
    );

    return;
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto): Promise<void> {
    // Check if the user exists
    const user = await this.prisma.user.findUnique({
      where: { email: resetPasswordDto.email },
    });
    if (!user) {
      throw new NotFoundException("User not found.");
    }

    const passwordReset = await this.prisma.passwordReset.findFirst({
      where: {
        userId: user.id,
      },
    });

    if (!passwordReset) {
      throw new NotFoundException("Password reset request not found.");
    }

    if (passwordReset.token !== resetPasswordDto.token) {
      if (passwordReset.expiresAt < new Date()) {
        await this.prisma.passwordReset.delete({
          where: { id: passwordReset.id },
        });
      }
      throw new ForbiddenException("Invalid token.");
    }

    if (passwordReset.expiresAt < new Date()) {
      await this.prisma.passwordReset.delete({
        where: { id: passwordReset.id },
      });
      throw new ForbiddenException("Token has expired.");
    }

    if (!this.isPasswordStrong(resetPasswordDto.newPassword)) {
      throw new BadRequestException("New password is not strong enough.");
    }

    await this.prisma.passwordReset.delete({
      where: { id: passwordReset.id },
    });

    const { error } = await this.supabaseAdmin.auth.admin.updateUserById(
      user.supabaseUserId,
      {
        password: resetPasswordDto.newPassword,
      },
    );

    if (error) {
      throw new ForbiddenException(
        `Failed to reset password: ${error.message}`,
      );
    }

    return;
  }

  async findAll(): Promise<UserResponse[]> {
    return await this.prisma.user.findMany({
      orderBy: [{ firstname: "asc" }, { lastname: "asc" }, { email: "asc" }],
    });
  }

  async findAllReduced(): Promise<UserResponseReduced[]> {
    return await this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        firstname: true,
        lastname: true,
        school: true,
        role: true,
        teamId: true,
        favoriteSubjectIds: true,
        team: { select: { id: true, name: true } },
        juryTeams: { select: { id: true, name: true } },
        mentorTeams: { select: { id: true, name: true } },
      },
      orderBy: [{ firstname: "asc" }, { lastname: "asc" }, { email: "asc" }],
    });
  }

  async findOne(id: UUID): Promise<UserResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async findExpertTeams(id: UUID): Promise<ExpertTeamsResponse> {
    const teams = await this.prisma.user.findUnique({
      where: { id },
      select: {
        juryTeams: {
          include: {
            members: true,
            juries: true,
            mentors: true,
          },
        },
        mentorTeams: {
          include: {
            members: true,
            juries: true,
            mentors: true,
          },
        },
      },
    });

    if (!teams) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return teams;
  }

  async update(
    id: UUID,
    updateUserDto: UpdateUserDto,
    supabaseUserId: string,
  ): Promise<UserResponse> {
    const user = await this.findOne(id);

    if (user.supabaseUserId !== supabaseUserId) {
      const requestingUser = await this.prisma.user.findUnique({
        where: { supabaseUserId },
      });
      if (!requestingUser) {
        throw new NotFoundException("You are not authenticated");
      }
      if (requestingUser.role !== Role.ORGANIZER) {
        throw new ForbiddenException("You can only update your own profile");
      }
    }

    if (updateUserDto.email && updateUserDto.email !== user.email) {
      const requestingUser = await this.prisma.user.findUnique({
        where: { email: updateUserDto.email },
      });
      if (requestingUser) {
        throw new ConflictException("Email already in use");
      }

      const { error: authError } =
        await this.supabaseAdmin.auth.admin.updateUserById(
          user.supabaseUserId,
          {
            email: updateUserDto.email,
            email_confirm: true,
          },
        );

      if (authError) {
        throw new ConflictException(
          `Supabase Auth Error: ${authError.message}`,
        );
      }
    }

    if (
      updateUserDto.profilePicturePath !== undefined &&
      user.profilePicturePath &&
      updateUserDto.profilePicturePath !== user.profilePicturePath
    ) {
      await this.S3BucketService.deleteFile("users", user.profilePicturePath);
    }

    if (user.role !== Role.PARTICIPANT) {
      delete updateUserDto.favoriteSubjectIds;
    } else if (
      updateUserDto.favoriteSubjectIds !== undefined &&
      updateUserDto.favoriteSubjectIds.length > 0
    ) {
      await this.validateFavoriteSubjectIds(updateUserDto.favoriteSubjectIds);
    }

    const dataToUpdate: any = {
      ...updateUserDto,
      github: updateUserDto.github ?? undefined,
      discord: updateUserDto.discord ?? undefined,
    };

    if (updateUserDto.profilePicturePath !== undefined) {
      dataToUpdate.profilePicturePath = updateUserDto.profilePicturePath;
    }

    return await this.prisma.user.update({
      where: { id },
      data: dataToUpdate,
    });
  }

  async remove(id: UUID, supabaseUserId: string): Promise<void> {
    const user = await this.findOne(id);

    if (user.supabaseUserId !== supabaseUserId) {
      const requestingUser = await this.prisma.user.findUnique({
        where: { supabaseUserId },
      });
      if (!requestingUser) {
        throw new NotFoundException("You are not authenticated");
      }
      if (requestingUser.role !== Role.ORGANIZER) {
        throw new ForbiddenException("You can only update your own profile");
      }
    }

    await this.prisma.user.delete({
      where: { id },
    });
    await this.supabaseAdmin.auth.admin.deleteUser(user.supabaseUserId);
    return;
  }

  /**
   * A subject ranking must contain every available subject exactly once,
   * ordered by decreasing preference.
   */
  private async validateFavoriteSubjectIds(
    favoriteSubjectIds: string[],
  ): Promise<void> {
    const config = await this.prisma.hackathonConfig.findUnique({
      where: { key: HackathonConfigKey.THEMES },
    });

    const availableSubjectIds = getAllSubjectIds(
      parseThemesSettings(config?.value),
    );

    if (availableSubjectIds.length === 0) {
      throw new BadRequestException(
        "No subject is available yet, the ranking cannot be saved.",
      );
    }

    const rankedIds = new Set(favoriteSubjectIds);
    if (rankedIds.size !== favoriteSubjectIds.length) {
      throw new BadRequestException(
        "The subject ranking contains duplicated subjects.",
      );
    }

    const unknownIds = favoriteSubjectIds.filter(
      (id) => !availableSubjectIds.includes(id),
    );
    if (unknownIds.length) {
      throw new BadRequestException(
        `Unknown subjects in the ranking: ${unknownIds.join(", ")}`,
      );
    }

    const missingIds = availableSubjectIds.filter((id) => !rankedIds.has(id));
    if (missingIds.length) {
      throw new BadRequestException(
        `The ranking must contain every available subject. Missing: ${missingIds.join(", ")}`,
      );
    }
  }

  private isPasswordStrong(password: string) {
    const regex =
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    return regex.test(password);
  }
}
