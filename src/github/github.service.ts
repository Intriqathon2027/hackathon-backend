import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import axios from "axios";
import { PrismaService } from "src/prisma/prisma.service";
import { ConfigurationService } from "src/configuration/configuration.service";
import { HackathonConfigKey, Role, SubmissionStatus } from "@prisma/client";

// Define the possible shapes of GitHub data
interface GitHubData {
  accessToken?: string;
  token?: string;
  access_token?: string;
  login?: string;
  username?: string;
  nickname?: string;
  [key: string]: unknown;
}

export interface GitHubRepoResponse {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string;
  [key: string]: unknown;
}

@Injectable()
export class GithubService {
  constructor(
    private prismaService: PrismaService,
    private configurationService: ConfigurationService,
  ) { }

  async createPrivateRepo(supabaseUserId: string): Promise<GitHubRepoResponse> {
    const user = await this.prismaService.user.findUnique({
      where: { supabaseUserId },
    });

    if (!user || !user.github) {
      throw new Error("GitHub user not linked");
    }

    // Parse and type the github data
    const githubData: GitHubData =
      typeof user.github === "string"
        ? (JSON.parse(user.github) as GitHubData)
        : (user.github as GitHubData);

    const userGithubToken =
      githubData.accessToken ?? githubData.token ?? githubData.access_token;

    if (!userGithubToken) {
      throw new Error("GitHub access token not found on user.github");
    }

    const day = String(new Date().getDate()).padStart(2, "0");
    const repoName = `private-repo-hackathon-${day}`;

    const res = await axios.post<GitHubRepoResponse>(
      "https://api.github.com/user/repos",
      {
        name: repoName,
        private: true,
        description: "Private repo created by our app 🚀",
      },
      {
        headers: {
          Authorization: `Bearer ${userGithubToken}`,
          Accept: "application/vnd.github+json",
        },
      },
    );

    return res.data;
  }

  async initializeHackathonOrg(supabaseUserId: string) {
    // 1. Validate User
    const user = await this.prismaService.user.findUnique({
      where: { supabaseUserId },
    });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    if (user.role !== Role.ORGANIZER) {
      throw new ForbiddenException(
        "Only organizers can initialize the hackathon org",
      );
    }

    // 2. Get Config (Hackathon Name)
    const textsConfig = await this.configurationService.findOne(
      HackathonConfigKey.TEXTS,
    );
    const hackathonName = (textsConfig.value as { hackathonName?: string })
      ?.hackathonName;

    if (!hackathonName) {
      throw new BadRequestException("Hackathon name not configured");
    }

    // 3. Get GitHub Token
    if (!user.github) {
      throw new BadRequestException("Organizer must have GitHub linked");
    }

    const githubData: GitHubData =
      typeof user.github === "string"
        ? (JSON.parse(user.github) as GitHubData)
        : (user.github as GitHubData);

    const userGithubToken =
      githubData.accessToken ?? githubData.token ?? githubData.access_token;

    if (!userGithubToken) {
      throw new BadRequestException(
        "GitHub access token not found for organizer",
      );
    }

    const headers = {
      Authorization: `Bearer ${userGithubToken}`,
      Accept: "application/vnd.github+json",
    };

    const orgName = hackathonName.trim().replace(/\s+/g, "-");

    // 4. Check if Organization exists
    // Note: Creating an organization via API is not generally supported for checking existence in this way without potential 404.
    // We try to fetch it.
    let orgExists = false;
    try {
      await axios.get(`https://api.github.com/orgs/${orgName}`, {
        headers,
      });
      orgExists = true;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        // Organization does not exist
      } else {
        throw error;
      }
    }

    if (!orgExists) {
      // NOTE: Creating an organization via API is restricted and usually not possible for standard users.
      // We will throw an error implementation-wise, advising the user.
      throw new BadRequestException(
        `Organization '${hackathonName}' does not exist on GitHub. Please create it manually first.`,
      );
    }

    const teams = await this.prismaService.team.findMany({
      include: {
        members: true,
        juries: true,
        mentors: true,
      },
    });

    // 5. Loop through teams and create repos / add members
    const results: Array<{
      team: string;
      repo?: string;
      status: string;
    }> = [];

    for (const team of teams) {
      const repoName = team.name.replace(/\s+/g, "-").toLowerCase(); // Normalize name

      // Create Repo
      let repoUrl = "";
      try {
        const createRes = await axios.post<{ html_url: string }>(
          `https://api.github.com/orgs/${orgName}/repos`,
          {
            name: repoName,
            private: true,
            description: `Repository for team ${team.name}`,
          },
          { headers },
        );
        repoUrl = createRes.data.html_url;
      } catch (error) {
        if (axios.isAxiosError(error)) {
          if (error.response?.status === 422) {
            // Repo likely already exists. Try to get it.
            // We continue to add members.
            repoUrl = `https://github.com/${orgName}/${repoName}`;
          } else if (error.response?.status === 403) {
            // 🛑 CRITIQUE : L'utilisateur n'a pas les droits de créer un repo
            throw new ForbiddenException(
              `You do not have permission to create repositories in the organization '${orgName}'. Please ensure you are an organization owner or have repository creation privileges.`,
            );
          } else {
            console.error(`Failed to create repo for team ${team.name}`, error);
            results.push({ team: team.name, status: "failed_repo_creation" });
            continue;
          }
        } else {
          // Non-axios error
          console.error(`Failed to create repo for team ${team.name}`, error);
          results.push({ team: team.name, status: "failed_repo_creation" });
          continue;
        }
      }

      // Create or update Submission
      await this.prismaService.submission.upsert({
        where: { teamId: team.id },
        update: { githubLink: repoUrl },
        create: {
          teamId: team.id,
          githubLink: repoUrl,
          status: SubmissionStatus.NOT_SUBMITTED,
        },
      });

      // Add Members, juries, mentors
      for (const member of team.members
        .concat(team.juries)
        .concat(team.mentors)) {
        if (!member.github) continue;

        const memberGithubData: GitHubData =
          typeof member.github === "string"
            ? (JSON.parse(member.github) as GitHubData)
            : (member.github as GitHubData);

        // We need the username (login). usually stored in profile or we have to fetch it if we stored the token.
        // Assuming we stored the profile info or at least the username in the json.
        // If the 'github' field structure is not guaranteed to have 'login' or 'username', we might need to fetch 'user' from github using their token,
        // OR rely on what's stored. The prompt didn't specify the `github` JSON structure fully but usually auth providers store profile.
        // Let's assume `login` or `username` exists.

        const username =
          memberGithubData.login ||
          memberGithubData.username ||
          memberGithubData.nickname;

        if (username) {
          try {
            await axios.put(
              `https://api.github.com/repos/${orgName}/${repoName}/collaborators/${username}`,
              { permission: "push" },
              { headers },
            );
          } catch (err) {
            console.error(
              `Failed to add user ${username} to repo ${repoName}`,
              err,
            );
          }
        }
      }
      results.push({ team: team.name, repo: repoUrl, status: "success" });
    }

    return results;
  }
}
