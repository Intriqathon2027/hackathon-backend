import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Patch,
  Param,
  Delete,
  HttpException,
  HttpStatus,
  Query,
} from "@nestjs/common";
import { TeamService } from "./team.service";
import { CreateTeamDTO } from "./dto/create-team.dto";
import { SupabaseUser } from "../common/decorators/supabase-user.decorator";
import { SupabaseDecodedUser } from "../common/decorators/supabase-decoded-user.types";
import { TeamStatus } from "@prisma/client";
import { UpdateTeamDTO } from "./dto/update-team.dto";
import { AutogenerateUserBasedDTO } from "./dto/autogenerate-user-based.dto";
import { Roles } from "src/common/decorators/roles.decorator";
import { Role } from "@prisma/client";

@Controller("team")
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  private async handleRequest<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      console.error(error);

      const errorMessage = this.getErrorMessage(error);
      throw new HttpException(errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === "string") {
      return error;
    }
    return "Internal Server Error";
  }

  @Post()
  async create(
    @Body() newTeamData: CreateTeamDTO,
    @SupabaseUser() supabaseUser: SupabaseDecodedUser,
  ) {
    return this.handleRequest(() =>
      this.teamService.create(newTeamData, supabaseUser.sub),
    );
  }

  @Post("autogenerate")
  @Roles(Role.ORGANIZER)
  async autogenerateTeams(@SupabaseUser() supabaseUser: SupabaseDecodedUser) {
    return this.handleRequest(() =>
      this.teamService.autogenerateTeams(supabaseUser.sub),
    );
  }

  @Post("autogenerate/user-based")
  @Roles(Role.ORGANIZER)
  async autogenerateUserBasedTeams(
    @Body() options: AutogenerateUserBasedDTO,
    @SupabaseUser() supabaseUser: SupabaseDecodedUser,
  ) {
    return this.handleRequest(() =>
      this.teamService.autogenerateUserBasedTeams(options, supabaseUser.sub),
    );
  }

  @Put(":id")
  @Roles(Role.ORGANIZER)
  async update(
    @Param("id") id: string,
    @Body() updateTeamData: UpdateTeamDTO,
    @SupabaseUser() supabaseUser: SupabaseDecodedUser,
  ) {
    return this.handleRequest(() =>
      this.teamService.update(id, updateTeamData, supabaseUser.sub),
    );
  }

  @Patch(":id/status")
  async updateStatus(
    @Param("id") id: string,
    @Body("status") status: TeamStatus,
    @SupabaseUser() supabaseUser: SupabaseDecodedUser,
  ) {
    return this.handleRequest(() =>
      this.teamService.updateStatus(id, status, supabaseUser.sub),
    );
  }

  @Patch(":id/ignore-constraints")
  @Roles(Role.ORGANIZER)
  async updateIgnoreConstraints(
    @Param("id") id: string,
    @Body("ignoreConstraints") ignoreConstraints: boolean,
    @SupabaseUser() supabaseUser: SupabaseDecodedUser,
  ) {
    return this.handleRequest(() =>
      this.teamService.updateIgnoreConstraints(
        id,
        ignoreConstraints,
        supabaseUser.sub,
      ),
    );
  }

  @Post("leave")
  async leaveTeam(@SupabaseUser() supabaseUser: SupabaseDecodedUser) {
    return this.handleRequest(() =>
      this.teamService.leaveTeam(supabaseUser.sub),
    );
  }

  @Post(":teamId/join")
  async joinTeam(
    @Param("teamId") teamId: string,
    @SupabaseUser() supabaseUser: SupabaseDecodedUser,
  ) {
    return this.handleRequest(() =>
      this.teamService.joinTeam(teamId, supabaseUser.sub),
    );
  }

  @Post(":teamId/users/:userId")
  @Roles(Role.ORGANIZER)
  async assignUserToTeam(
    @Param("teamId") teamId: string,
    @Param("userId") userId: string,
    @SupabaseUser() supabaseUser: SupabaseDecodedUser,
    @Query("participant") participant?: string,
  ) {
    const isParticipant = participant === "true";
    return this.handleRequest(() =>
      this.teamService.assignUserToTeam(
        teamId,
        userId,
        supabaseUser.sub,
        isParticipant,
      ),
    );
  }

  @Delete(":teamId/users/:userId")
  @Roles(Role.ORGANIZER)
  async withdrawUserFromTeam(
    @Param("teamId") teamId: string,
    @Param("userId") userId: string,
    @SupabaseUser() supabaseUser: SupabaseDecodedUser,
    @Query("participant") participant?: string,
  ) {
    const isParticipant = participant === "true";
    return this.handleRequest(() =>
      this.teamService.withdrawUserFromTeam(
        teamId,
        userId,
        supabaseUser.sub,
        isParticipant,
      ),
    );
  }

  @Get(":id")
  async findOne(@Param("id") id: string) {
    return this.handleRequest(() => this.teamService.findOne(id));
  }

  @Get()
  async findAll() {
    return this.handleRequest(() => this.teamService.findAll());
  }

  @Delete(":id")
  @Roles(Role.ORGANIZER)
  async remove(
    @Param("id") id: string,
    @SupabaseUser() supabaseUser: SupabaseDecodedUser,
  ) {
    return this.handleRequest(() =>
      this.teamService.remove(id, supabaseUser.sub),
    );
  }
}
