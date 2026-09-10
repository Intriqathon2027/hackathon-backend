import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { HackathonConfigKey, Role, TeamStatus, User } from "@prisma/client";
import { CreateTeamDTO } from "./dto/create-team.dto";
import { UpdateTeamDTO } from "./dto/update-team.dto";
import { TeamResponse } from "./dto/team-response";
import { Theme } from "src/configuration/entities/theme-subject.entity";
import { spawn } from "child_process";
import { join } from "path";
import * as path from "path";
import { promises as fs } from "fs";
import { MatchmakingTeam } from "./types/matchmaking-team.interface";
import { parseThemesSettings } from "src/configuration/utils/themes.util";

@Injectable()
export class TeamService {
  constructor(private readonly prisma: PrismaService) {}

  private userPreviewSelect = {
    id: true,
    firstname: true,
    lastname: true,
    school: true,
    role: true,
  };

  // ------------ AUTOGENERATE TEAMS ------------

  getThemeId(themes: Theme[], subjectId: string): string {
    for (const theme of themes) {
      if (theme.subjects.some((s) => s.id === subjectId)) {
        return theme.id;
      }
    }
    throw new NotFoundException(
      `No theme found for subject with id '${subjectId}'.`
    );
  }

  getSubjectName(themes: Theme[], subjectId: string): string {
    for (const theme of themes) {
      const subject = theme.subjects.find((s) => s.id === subjectId);
      if (subject) {
        return subject.name;
      }
    }
    throw new NotFoundException(`No subject found with id '${subjectId}'.`);
  }

  async runMatchmakingScript(
    usersPath: string,
    configPath: string
  ): Promise<MatchmakingTeam[]> {
    const scriptPath = path.join(process.cwd(), "python", "matchmaking.py");
    const pythonPath = path.join(process.cwd(), "venv", "bin", "python");

    return new Promise<MatchmakingTeam[]>((resolve, reject) => {
      const pythonProcess = spawn(pythonPath, [
        scriptPath,
        usersPath,
        configPath,
      ]);
      //const pythonProcess = spawn(pythonPath, [scriptPath]);

      let dataString: string = "";
      let errorString: string = "";

      pythonProcess.stdout.on("data", (data: Buffer) => {
        dataString += data.toString("utf-8");
      });

      pythonProcess.stderr.on("data", (data: Buffer) => {
        errorString += data.toString("utf-8");
      });

      pythonProcess.on("close", (code: number | null) => {
        if (code === 0) {
          try {
            const result: MatchmakingTeam[] = JSON.parse(
              dataString
            ) as MatchmakingTeam[];
            resolve(result);
          } catch (err) {
            reject(
              new Error(
                `Failed to parse matchmaking script output: ${String(err)}`
              )
            );
          }
        } else {
          reject(
            new Error(
              `Matchmaking script exited with code ${code}: ${errorString}`
            )
          );
        }
      });
    });
  }

  async saveTmpMatchmakingSettingsFile(): Promise<string> {
    const config = await this.prisma.hackathonConfig.findUnique({
      where: { key: HackathonConfigKey.MATCHMAKING },
    });

    const tmpDir = join(process.cwd(), "python", "tmp_matchmaking");
    const filePath = join(tmpDir, "matchmaking_config.json");

    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(config?.value || {}), "utf-8");
    return filePath;
  }

  async saveTmpUsersFile(usersJson: string, filename: string): Promise<string> {
    const tmpDir = join(process.cwd(), "python", "tmp_matchmaking");
    const filePath = join(tmpDir, filename);

    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(filePath, usersJson, "utf-8");
    return filePath;
  }

  async autogenerateTeams(supabaseUserId: string) {
    await this.validateUserRole(supabaseUserId, Role.ORGANIZER);

    // 1. Préparation globale
    const configPath = await this.saveTmpMatchmakingSettingsFile();

    const themesConfig = await this.prisma.hackathonConfig.findUnique({
      where: { key: HackathonConfigKey.THEMES },
    });
    const themeSettings = parseThemesSettings(themesConfig?.value || []);
    const subjectsIds = themeSettings.flatMap((t) =>
      t.subjects.map((s) => s.id)
    );

    // 2. Regroupement des participants sans équipe par sujet préféré,
    // c'est-à-dire le premier sujet de leur classement de sujets
    const participants = await this.prisma.user.findMany({
      where: {
        role: Role.PARTICIPANT,
        teamId: null,
      },
      select: { id: true, school: true, favoriteSubjectIds: true },
    });

    const usersByFavoriteSubject = new Map<
      string,
      { id: string; school: string | null }[]
    >();

    for (const participant of participants) {
      // Le sujet préféré est le premier sujet du classement encore proposé
      const favoriteSubjectId = participant.favoriteSubjectIds.find((id) =>
        subjectsIds.includes(id),
      );
      if (!favoriteSubjectId) {
        continue;
      }

      const usersOfSubject =
        usersByFavoriteSubject.get(favoriteSubjectId) ?? [];
      usersOfSubject.push({ id: participant.id, school: participant.school });
      usersByFavoriteSubject.set(favoriteSubjectId, usersOfSubject);
    }

    // 3. Lancement PARALLÈLE des calculs pour chaque sujet préféré
    const matchmakingTasks = [...usersByFavoriteSubject.entries()].map(
      async ([subjectId, users]) => {
        // Fichier unique par sujet pour éviter les collisions
        const userFileName = `users_${subjectId}.json`;
        const userPath = await this.saveTmpUsersFile(
          JSON.stringify(users),
          userFileName,
        );

        // Exécution du script Python
        const teams = await this.runMatchmakingScript(userPath, configPath);

        return { subjectId, teams };
      },
    );

    const results = await Promise.all(matchmakingTasks);

    let numberOfTeamsCreated = 0;

    for (const result of results) {
      const { subjectId, teams } = result;
      const themeId = this.getThemeId(themeSettings, subjectId);

      for (const mmTeam of teams) {
        numberOfTeamsCreated++;
        const teamName = `Team_${numberOfTeamsCreated}`;

        const createTeamDTO: CreateTeamDTO = {
          name: teamName,
          description: `Auto-generated team for subject ${subjectId}`,
          subjectId: subjectId,
          themeId: themeId,
          memberIds: mmTeam.members.map((m) => m.user_id),
        };

        await this.create(createTeamDTO, supabaseUserId);
      }
    }

    return { count: numberOfTeamsCreated };
  }
  // ------------------ CRUD ------------------

  async create(newTeamData: CreateTeamDTO, supabaseUserId: string) {
    await this.validateThemeAndSubject(
      newTeamData.themeId,
      newTeamData.subjectId
    );

    await Promise.all([
      this.validateUsersExist(newTeamData.memberIds || []),
      this.validateUsersExist(newTeamData.juryIds || []),
      this.validateUsersExist(newTeamData.mentorIds || []),
    ]);

    const team = await this.prisma.team.create({
      data: {
        name: newTeamData.name,
        description: newTeamData.description,
        themeId: newTeamData.themeId,
        subjectId: newTeamData.subjectId,
        members: {
          connect: newTeamData.memberIds?.map((id) => ({ id })) || [],
        },
        juries: {
          connect: newTeamData.juryIds?.map((id) => ({ id })) || [],
        },
        mentors: {
          connect: newTeamData.mentorIds?.map((id) => ({ id })) || [],
        },
      },
    });

    return { id: team.id };
  }

  async update(
    id: string,
    updateTeamData: UpdateTeamDTO,
    supabaseUserId: string
  ) {
    await this.checkTeamExists(id);
    if (updateTeamData.themeId && updateTeamData.subjectId) {
      await this.validateThemeAndSubject(
        updateTeamData.themeId,
        updateTeamData.subjectId
      );
    }
    await Promise.all([
      this.validateUsersExist(updateTeamData.memberIds || []),
      this.validateUsersExist(updateTeamData.juryIds || []),
      this.validateUsersExist(updateTeamData.mentorIds || []),
    ]);

    const updatedTeam = await this.prisma.team.update({
      where: { id },
      data: {
        name: updateTeamData.name,
        description: updateTeamData.description,
        themeId: updateTeamData.themeId,
        subjectId: updateTeamData.subjectId,
        members: updateTeamData.memberIds
          ? { set: updateTeamData.memberIds.map((id) => ({ id })) }
          : undefined,
        juries: updateTeamData.juryIds
          ? { set: updateTeamData.juryIds.map((id) => ({ id })) }
          : undefined,
        mentors: updateTeamData.mentorIds
          ? { set: updateTeamData.mentorIds.map((id) => ({ id })) }
          : undefined,
      },
    });

    return { id: updatedTeam.id };
  }

  async updateStatus(id: string, status: TeamStatus, supabaseUserId: string) {
    await this.validateUserAndTeam(id, supabaseUserId);

    const team = await this.prisma.team.update({
      where: { id },
      data: { status },
    });

    return { id: team.id };
  }

  async updateIgnoreConstraints(
    id: string,
    ignoreConstraints: boolean,
    supabaseUserId: string
  ) {
    await this.validateUserAndTeam(id, supabaseUserId);

    const team = await this.prisma.team.update({
      where: { id },
      data: { ignoreConstraints },
    });

    return { id: team.id };
  }

  async findOne(id: string): Promise<TeamResponse> {
    const team = await this.prisma.team.findUnique({
      where: { id },
      include: {
        members: { select: this.userPreviewSelect },
        juries: { select: this.userPreviewSelect },
        mentors: { select: this.userPreviewSelect },
      },
    });

    if (!team) throw new NotFoundException(`Team with id '${id}' not found`);
    return team as TeamResponse;
  }

  async findAll(): Promise<TeamResponse[]> {
    const teams = await this.prisma.team.findMany({
      include: {
        members: { select: this.userPreviewSelect },
        juries: { select: this.userPreviewSelect },
        mentors: { select: this.userPreviewSelect },
      },
    });

    return teams as TeamResponse[];
  }

  async assignUserToTeam(
    teamId: string,
    userId: string,
    supabaseUserId: string,
    isParticipant: boolean
  ) {
    await this.validateUserAndTeam(teamId, supabaseUserId, isParticipant);

    const user = await this.validateUserExists(userId);
    if (user.teamId) {
      throw new ForbiddenException(
        `User with id '${userId}' is already a member of team with id '${user.teamId}'.`
      );
    }

    let proprety = "members";
    switch (user.role) {
      case Role.JURY:
        proprety = "juries";
        break;
      case Role.MENTOR:
        proprety = "mentors";
        break;
    }

    const team = await this.prisma.team.update({
      where: { id: teamId },
      data: { [proprety]: { connect: { id: userId } } },
    });

    return { id: team.id };
  }

  async leaveTeam(supabaseUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { supabaseUserId },
    });

    if (!user) throw new NotFoundException("User not found.");

    if (!user.teamId) {
      throw new ForbiddenException("You are not part of any team.");
    }

    return this.disconnectUserFromTeam(user.teamId, user);
  }

  async joinTeam(teamId: string, supabaseUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { supabaseUserId },
    });

    if (!user) throw new NotFoundException("User not found.");

    if (user.role !== Role.PARTICIPANT) {
      throw new ForbiddenException("Only participants can join teams.");
    }

    if (user.teamId) {
      throw new ForbiddenException("You are already part of a team.");
    }

    await this.checkTeamExists(teamId);

    // Add user to team
    const team = await this.prisma.team.update({
      where: { id: teamId },
      data: { members: { connect: { id: user.id } } },
    });

    return { id: team.id };
  }

  async withdrawUserFromTeam(
    teamId: string,
    userId: string,
    supabaseUserId: string,
    isParticipant: boolean
  ) {
    await this.validateUserAndTeam(teamId, supabaseUserId, isParticipant);

    const user = await this.validateUserExists(userId);

    return this.disconnectUserFromTeam(teamId, user);
  }

  /**
   * Fonction chapeau : gère le retrait d’un user d’une team selon son rôle
   */
  private async disconnectUserFromTeam(teamId: string, user: User) {
    let relationKey: "members" | "juries" | "mentors";

    switch (user.role) {
      case Role.PARTICIPANT:
        if (user.teamId !== teamId) {
          throw new ForbiddenException(
            `User with id '${user.id}' is not a member of team with id '${teamId}'.`
          );
        }
        relationKey = "members";
        break;

      case Role.JURY:
        relationKey = "juries";
        break;

      case Role.MENTOR:
        relationKey = "mentors";
        break;

      default:
        throw new ForbiddenException(
          `Cannot withdraw user with role '${user.role}' from a team.`
        );
    }

    const team = await this.prisma.team.update({
      where: { id: teamId },
      data: { [relationKey]: { disconnect: { id: user.id } } },
    });

    return { id: team.id };
  }

  async remove(id: string, supabaseUserId: string) {
    await this.validateUserAndTeam(id, supabaseUserId);

    const team = await this.prisma.team.delete({ where: { id } });
    return { id: team.id };
  }

  // ------------------ Utils ------------------

  private async validateUserRole(supabaseUserId: string, role: Role) {
    const user = await this.prisma.user.findUnique({
      where: { supabaseUserId },
    });
    if (!user) throw new NotFoundException("User not found.");
    if (user.role !== role)
      throw new ForbiddenException("Only organizer can perform this action.");
    return user;
  }

  private async validateUserExists(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException(`User with id '${id}' not found.`);
    return user;
  }

  private async validateUsersExist(userIds: string[]) {
    if (!userIds.length || userIds.length === 0) return;

    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true },
    });

    const foundIds = users.map((u) => u.id);
    const missingIds = userIds.filter((id) => !foundIds.includes(id));
    if (missingIds.length) {
      throw new NotFoundException(`Users not found: ${missingIds.join(", ")}`);
    }
  }

  private async checkTeamExists(teamId: string) {
    const team = await this.prisma.team.findUnique({ 
      where: { id: teamId },
      include: {
        members: { select: { id: true } },
        juries: { select: { id: true } },
        mentors: { select: { id: true } },
      }
    });
    if (!team)
      throw new NotFoundException(`Team with id '${teamId}' not found.`);
    return team;
  }

  private async validateUserAndTeam(
    teamId: string,
    supabaseUserId: string,
    isParticipant = false
  ) {
    if (isParticipant) {
      this.validateUserRole(supabaseUserId, Role.PARTICIPANT);
    } else {
      await this.validateUserRole(supabaseUserId, Role.ORGANIZER);
      return this.checkTeamExists(teamId);
    }
  }

  private async validateThemeAndSubject(themeId: string, subjectId: string) {
    const config = await this.prisma.hackathonConfig.findUnique({
      where: { key: HackathonConfigKey.THEMES },
    });
    if (!config) throw new NotFoundException("No themes configuration found.");

    const themes = parseThemesSettings(config.value);
    const theme = themes.find((t) => t.id === themeId);
    if (!theme)
      throw new NotFoundException(`Theme with id '${themeId}' not found.`);

    const subject = theme.subjects.find((s) => s.id === subjectId);
    if (!subject)
      throw new NotFoundException(
        `Subject with id '${subjectId}' not found in theme '${themeId}'.`
      );
  }
}
