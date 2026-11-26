import { Injectable } from "@nestjs/common";
import axios, { AxiosResponse } from "axios";
import { UUID } from "crypto";
import { DiscordUser } from "passport-discord-auth";
import { UpdateUserDto } from "src/user/dto/update-user.dto";
import { UserService } from "src/user/user.service";

// Types for GitHub & Discord responses
export interface DiscordApiUser {
  id: string;
  username: string;
  discriminator?: string;
  avatar?: string | null;
  email?: string | null;
}

export interface GithubApiUser {
  id: number;
  login: string;
  name?: string;
  avatar_url?: string;
  email?: string | null;
  access_token?: string;
}

interface OAuthTokenResponse {
  access_token: string;
  token_type?: string;
  scope?: string;
}

@Injectable()
export class AuthService {
  constructor(private readonly userService: UserService) {}

  // -------------------------
  // Discord OAuth2
  // -------------------------
  async getDiscordUser(code: string): Promise<DiscordApiUser> {
    const tokenRes: AxiosResponse<OAuthTokenResponse> = await axios.post(
      "https://discord.com/api/oauth2/token",
      new URLSearchParams({
        client_id: process.env.OAUTH2_DISCORD_CLIENT_ID!,
        client_secret: process.env.OAUTH2_DISCORD_CLIENT_SECRET!,
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.DISCORD_REDIRECT_URI!,
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      },
    );

    const access_token = tokenRes.data.access_token;

    const userRes: AxiosResponse<DiscordApiUser> = await axios.get(
      "https://discord.com/api/users/@me",
      { headers: { Authorization: `Bearer ${access_token}` } },
    );

    return userRes.data;
  }

  async updateUserWithDiscord(
    userId: string,
    supabaseUserId: string,
    discordUser: DiscordUser,
  ): Promise<void> {
    const userId_uuid = userId as UUID;

    const updatedUser: UpdateUserDto = {
      discord: {
        id: discordUser.id,
        username: discordUser.username,
      },
    };

    await this.userService.update(userId_uuid, updatedUser, supabaseUserId);
  }

  async unlinkDiscord(userId: string, supabaseUserId: string): Promise<void> {
    await this.userService.update(
      userId as UUID,
      { discord: null },
      supabaseUserId,
    );
  }

  // -------------------------
  // GitHub OAuth2
  // -------------------------
  async getGithubUser(code: string): Promise<GithubApiUser> {
    const tokenRes: AxiosResponse<OAuthTokenResponse> = await axios.post(
      "https://github.com/login/oauth/access_token",
      {
        client_id: process.env.OAUTH2_GITHUB_CLIENT_ID!,
        client_secret: process.env.OAUTH2_GITHUB_CLIENT_SECRET!,
        code,
        redirect_uri: process.env.GITHUB_REDIRECT_URI!,
      },
      { headers: { Accept: "application/json" } },
    );

    const access_token = tokenRes.data.access_token;

    const userRes: AxiosResponse<GithubApiUser> = await axios.get(
      "https://api.github.com/user",
      {
        headers: { Authorization: `Bearer ${access_token}` },
      },
    );

    return { ...userRes.data, access_token };
  }

  async updateUserWithGithub(
    userId: string,
    supabaseUserId: string,
    githubUser: GithubApiUser,
  ): Promise<void> {
    await this.userService.update(
      userId as UUID,
      {
        github: {
          id: githubUser.id.toString(),
          username: githubUser.login,
          accessToken: githubUser.access_token,
        },
      },
      supabaseUserId,
    );
  }

  async unlinkGithub(userId: string, supabaseUserId: string): Promise<void> {
    await this.userService.update(
      userId as UUID,
      { github: null },
      supabaseUserId,
    );
  }
}
